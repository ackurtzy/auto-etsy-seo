import { assertAuthority, canonicalDigest, type TitleOperation } from "../../../packages/operations/src/index.ts";
import { EtsyClient, refreshEtsyToken } from "../../../packages/etsy/src/index.ts";
import { CredentialVault, type EncryptedCredential } from "../../../packages/security/src/credential-vault.ts";
import type { AppEnv } from "./env.ts";
import { sendIncidentNotification } from "./notifier.ts";
import { OperationRepository, type CredentialRow } from "./repository.ts";

function inputFromOperation(operation: TitleOperation) {
  return {
    id: operation.id,
    idempotencyKey: operation.idempotencyKey,
    tenantId: operation.tenantId,
    shopId: operation.shopId,
    listingId: operation.listingId,
    actorId: operation.actorId,
    baselineTitle: operation.baselineTitle,
    proposedTitle: operation.proposedTitle,
    authority: operation.authority,
    approvalExpiresAt: operation.approvalExpiresAt,
    kind: operation.kind,
    ...(operation.parentOperationId ? { parentOperationId: operation.parentOperationId } : {}),
  } as const;
}

export async function loadAccessToken(env: AppEnv, repository: OperationRepository, credential: CredentialRow, now: Date): Promise<string> {
  const vault = await CredentialVault.fromBase64Key(env.CREDENTIAL_ENCRYPTION_KEY);
  const context = { tenantId: credential.tenant_id, shopId: credential.shop_connection_id, version: credential.version };
  if (Date.parse(credential.expires_at) - now.getTime() > 120_000) {
    return vault.decrypt({ algorithm: "AES-GCM-256", nonce: credential.access_nonce, ciphertext: credential.access_ciphertext }, context);
  }
  const refresh = await vault.decrypt({ algorithm: "AES-GCM-256", nonce: credential.refresh_nonce, ciphertext: credential.refresh_ciphertext }, context);
  const tokens = await refreshEtsyToken(env.ETSY_CLIENT_ID, refresh);
  const nextVersion = credential.version + 1;
  const nextContext = { ...context, version: nextVersion };
  const [accessEncrypted, refreshEncrypted] = await Promise.all([
    vault.encrypt(tokens.accessToken, nextContext),
    vault.encrypt(tokens.refreshToken, nextContext),
  ]);
  await repository.rotateCredential(
    credential,
    accessEncrypted as EncryptedCredential,
    refreshEncrypted as EncryptedCredential,
    new Date(now.getTime() + tokens.expiresInSeconds * 1000).toISOString(),
    now.toISOString(),
  );
  return tokens.accessToken;
}

export async function verifyKeep(
  env: AppEnv,
  parent: TitleOperation,
  actorId: string,
  idempotencyKey: string,
): Promise<TitleOperation> {
  const repository = new OperationRepository(env.DB);
  const authority = await repository.loadAuthority(parent.tenantId, parent.shopId, actorId);
  if (!authority.actorActive || authority.actorRole === "viewer") throw new Error("role_forbidden");
  if (authority.applicationKillSwitch || authority.shopKillSwitch || authority.restoredQuarantine) throw new Error("kill_switch_active");
  if (!authority.scopes.includes("listings_r")) throw new Error("required_scope_missing");
  if (String(env.ETSY_EGRESS_ENABLED) !== "true") throw new Error("runtime_egress_gate_disabled");
  const credential = await repository.loadCredential(parent.shopId);
  const token = await loadAccessToken(env, repository, credential, new Date());
  const etsy = new EtsyClient({ apiKey: env.ETSY_API_KEY, accessToken: token, baseUrl: env.ETSY_BASE_URL });
  const observed = await etsy.getListing(parent.listingId);
  return repository.recordKeep(parent, actorId, idempotencyKey, observed.title, new Date().toISOString());
}

export async function executeOrReconcile(env: AppEnv, operationId: string): Promise<TitleOperation["state"]> {
  const repository = new OperationRepository(env.DB);
  let operation = await repository.getOperation(operationId);
  if (["verified", "rejected", "cancelled_before_dispatch", "conflict", "manual_required"].includes(operation.state)) return operation.state;
  if (operation.state === "dispatching" || operation.state === "unknown" || operation.state === "verifying") {
    return reconcile(env, repository, operation);
  }
  const now = new Date();
  const authority = await repository.loadAuthority(operation.tenantId, operation.shopId, operation.actorId);
  try {
    assertAuthority(inputFromOperation(operation), authority, now.toISOString());
  } catch (error) {
    await repository.setTerminal(operation.id, ["queued", "validating", "prepared"], "cancelled_before_dispatch", error instanceof Error ? error.message : "authority_invalid", now.toISOString());
    return "cancelled_before_dispatch";
  }
  if (String(env.ETSY_EGRESS_ENABLED) !== "true" || String(env.TITLE_WRITES_ENABLED) !== "true") {
    await repository.setTerminal(operation.id, ["queued", "validating", "prepared"], "cancelled_before_dispatch", "runtime_write_gate_disabled", now.toISOString());
    return "cancelled_before_dispatch";
  }
  const credential = await repository.loadCredential(operation.shopId);
  const token = await loadAccessToken(env, repository, credential, now);
  const etsy = new EtsyClient({ apiKey: env.ETSY_API_KEY, accessToken: token, baseUrl: env.ETSY_BASE_URL });
  const fresh = await etsy.getListing(operation.listingId);
  if (!(await repository.prepare(operation, fresh.title, now.toISOString()))) return "conflict";

  operation = await repository.getOperation(operationId);
  const dispatchAuthority = await repository.loadAuthority(operation.tenantId, operation.shopId, operation.actorId);
  try {
    assertAuthority(inputFromOperation(operation), dispatchAuthority, new Date().toISOString());
  } catch (error) {
    await repository.setTerminal(operation.id, ["prepared"], "cancelled_before_dispatch", error instanceof Error ? error.message : "authority_invalid", new Date().toISOString());
    return "cancelled_before_dispatch";
  }
  const dispatchRead = Date.now() - now.getTime() > 5_000 ? await etsy.getListing(operation.listingId) : fresh;
  if (canonicalDigest(dispatchRead.title) !== operation.baselineDigest) {
    await repository.setTerminal(operation.id, ["prepared"], "conflict", "owned_field_changed_before_dispatch", new Date().toISOString());
    return "conflict";
  }
  const claimed = await repository.claimDispatch(operation, new Date().toISOString());
  if (!claimed) return reconcile(env, repository, await repository.getOperation(operation.id));
  try {
    const response = await etsy.patchTitle(credential.external_shop_id, operation.listingId, operation.proposedTitle);
    await repository.recordAttemptResult(operation.id, "response_received", response.status, new Date().toISOString());
  } catch (error) {
    await repository.recordAttemptResult(operation.id, "transport_ambiguous", null, new Date().toISOString());
    const code = error instanceof Error ? error.message.split(":", 1)[0]! : "transport_ambiguous";
    await repository.markUnknown(operation, code, new Date().toISOString());
    const sent = await sendIncidentNotification(env, { operationId: operation.id, code });
    await repository.recordNotification(operation, sent, new Date().toISOString());
    return "unknown";
  }
  const readback = await etsy.getListing(operation.listingId);
  if (await repository.verify(operation, readback.title, "verified_response_and_readback", new Date().toISOString())) return "verified";
  await repository.markUnknown(operation, "readback_mismatch", new Date().toISOString());
  const sent = await sendIncidentNotification(env, { operationId: operation.id, code: "readback_mismatch" });
  await repository.recordNotification(operation, sent, new Date().toISOString());
  return "unknown";
}

async function reconcile(env: AppEnv, repository: OperationRepository, operation: TitleOperation): Promise<TitleOperation["state"]> {
  if (String(env.ETSY_EGRESS_ENABLED) !== "true") return operation.state;
  const now = new Date();
  let credential: CredentialRow;
  try {
    credential = await repository.loadCredential(operation.shopId);
  } catch {
    await repository.requireManual(operation, "credential_unavailable_during_reconciliation", now.toISOString());
    return "manual_required";
  }
  const token = await loadAccessToken(env, repository, credential, now);
  const etsy = new EtsyClient({ apiKey: env.ETSY_API_KEY, accessToken: token, baseUrl: env.ETSY_BASE_URL });
  const reads = await repository.incrementReconciliation(operation.id, now.toISOString());
  try {
    const observed = await etsy.getListing(operation.listingId);
    if (canonicalDigest(observed.title) === operation.proposedDigest) {
      await repository.verify(operation, observed.title, "verified_observed_desired_state", new Date().toISOString());
      return "verified";
    }
    if (canonicalDigest(observed.title) !== operation.baselineDigest) {
      await repository.setTerminal(operation.id, ["dispatching", "verifying", "unknown"], "conflict", "reconciliation_owned_field_conflict", new Date().toISOString());
      return "conflict";
    }
  } catch {
    // A bounded later workflow step will retry this read; never replay mutation.
  }
  if (reads >= 5) {
    await repository.requireManual(operation, "reconciliation_exhausted", new Date().toISOString());
    return "manual_required";
  }
  return "unknown";
}
