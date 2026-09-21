import { canonicalDigest, canonicalTitle, validateTitle } from "./title.ts";
import type { AuthoritySnapshot, TitleCommandInput, TitleOperation } from "./types.ts";
import { InMemoryOperationStore } from "./store.ts";

function assertAuthority(input: TitleCommandInput, authority: AuthoritySnapshot, now: string): void {
  if (!authority.actorActive) throw new Error("actor_revoked");
  if (authority.actorRole === "viewer") throw new Error("role_forbidden");
  if (authority.applicationKillSwitch || authority.shopKillSwitch) throw new Error("kill_switch_active");
  if (authority.restoredQuarantine) throw new Error("restore_quarantine_active");
  if (!authority.scopes.includes("listings_w") || !authority.scopes.includes("listings_r")) {
    throw new Error("required_scope_missing");
  }
  if (
    input.authority.tenantEpoch !== authority.tenantEpoch ||
    input.authority.shopEpoch !== authority.shopEpoch ||
    input.authority.capabilityEpoch !== authority.capabilityEpoch
  ) {
    throw new Error("authority_epoch_stale");
  }
  if (Date.parse(input.approvalExpiresAt) <= Date.parse(now)) throw new Error("approval_expired");
  if (authority.capabilityMode === "disabled") throw new Error("capability_disabled");
  if (authority.capabilityMode === "canary") {
    const permit = authority.canary;
    if (!permit || Date.parse(permit.expiresAt) <= Date.parse(now)) throw new Error("canary_permit_expired");
    if (
      permit.listingId !== input.listingId ||
      permit.baselineDigest !== canonicalDigest(input.baselineTitle) ||
      permit.proposedDigest !== canonicalDigest(input.proposedTitle)
    ) {
      throw new Error("canary_permit_mismatch");
    }
  }
}

export function titleCommandDigest(input: TitleCommandInput): string {
  return canonicalDigest(JSON.stringify({
    tenantId: input.tenantId,
    shopId: input.shopId,
    listingId: input.listingId,
    actorId: input.actorId,
    baselineTitle: canonicalTitle(input.baselineTitle),
    proposedTitle: canonicalTitle(input.proposedTitle),
    authority: input.authority,
    approvalExpiresAt: input.approvalExpiresAt,
    kind: input.kind ?? "apply",
    parentOperationId: input.parentOperationId ?? null,
  }));
}

export function acceptTitleCommand(
  store: InMemoryOperationStore,
  input: TitleCommandInput,
  authority: AuthoritySnapshot,
  now: string,
): { operation: TitleOperation; duplicate: boolean } {
  const operation = buildTitleOperation(input, authority, now);
  const scope = `${input.tenantId}:${input.shopId}:${input.idempotencyKey}`;
  const existingId = store.idempotency.get(scope);
  return { operation: store.accept(operation), duplicate: existingId !== undefined };
}

export function buildTitleOperation(
  input: TitleCommandInput,
  authority: AuthoritySnapshot,
  now: string,
): TitleOperation {
  const baseline = canonicalTitle(input.baselineTitle);
  const proposed = canonicalTitle(input.proposedTitle);
  const validation = validateTitle(proposed);
  if (!validation.ok) throw new Error(validation.issues[0] ?? "title_invalid");
  if (input.kind !== "keep" && canonicalDigest(baseline) === canonicalDigest(proposed)) throw new Error("title_noop");
  assertAuthority(input, authority, now);
  const operation: TitleOperation = {
    id: input.id,
    requestDigest: titleCommandDigest(input),
    idempotencyKey: input.idempotencyKey,
    tenantId: input.tenantId,
    shopId: input.shopId,
    listingId: input.listingId,
    actorId: input.actorId,
    baselineTitle: baseline,
    proposedTitle: proposed,
    baselineDigest: canonicalDigest(baseline),
    proposedDigest: canonicalDigest(proposed),
    authority: input.authority,
    approvalExpiresAt: input.approvalExpiresAt,
    kind: input.kind ?? "apply",
    ...(input.parentOperationId ? { parentOperationId: input.parentOperationId } : {}),
    state: "queued",
    version: 1,
    acceptedAt: now,
    reconciliationReads: 0,
  };
  return operation;
}

export { assertAuthority };
