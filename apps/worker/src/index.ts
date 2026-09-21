import { clerkMiddleware, getAuth } from "@hono/clerk-auth";
import { Hono } from "hono";
import { z } from "zod";
import type { TitleCommandInput, TitleOperation } from "../../../packages/operations/src/index.ts";
import type { AppEnv } from "./env.ts";
import { OperationRepository } from "./repository.ts";
import { verifyKeep } from "./runtime.ts";
import { finishEtsyOAuth, startEtsyOAuth } from "./oauth.ts";
import { GateRepository } from "./gate-repository.ts";
import { collectGate1Evidence } from "./g1-collector.ts";
import { prepareGateProtocol } from "./gate-protocols.ts";

export { ShopCoordinator } from "./coordinator.ts";
export { OperationWorkflow } from "./workflow.ts";

type Variables = { actorId: string };
const app = new Hono<{ Bindings: AppEnv; Variables: Variables }>();

const commandSchema = z.object({
  idempotencyKey: z.string().min(8).max(128),
  listingId: z.string().regex(/^\d+$/),
  baselineTitle: z.string(),
  proposedTitle: z.string(),
  approvalExpiresAt: z.iso.datetime(),
  authority: z.object({
    tenantEpoch: z.number().int().positive(),
    shopEpoch: z.number().int().positive(),
    capabilityEpoch: z.number().int().positive(),
  }).strict(),
}).strict();

const keepSchema = z.object({ idempotencyKey: z.string().min(8).max(128) }).strict();
const revertSchema = keepSchema.extend({
  approvalExpiresAt: z.iso.datetime(),
  authority: z.object({
    tenantEpoch: z.number().int().positive(),
    shopEpoch: z.number().int().positive(),
    capabilityEpoch: z.number().int().positive(),
  }).strict(),
}).strict();
const oauthStartSchema = z.object({
  externalShopId: z.string().regex(/^\d+$/),
  accessMode: z.enum(["read_only", "title_canary"]).default("read_only"),
}).strict();
const gateResponseSchema = z.object({
  outcome: z.enum(["matched", "resolved_difference", "unavailable_disabled", "differs", "cannot_verify"]),
  note: z.string().max(2000).default(""),
  evidenceRevision: z.string().min(1).max(128),
}).strict();
const gateApprovalSchema = z.object({ disposition: z.string().min(1).max(160) }).strict();
const MAX_REQUEST_BYTES = 65_536;
const MAX_ARTIFACT_BYTES = 10_485_760;
const ARTIFACT_MEDIA_TYPES = new Set(["image/png", "image/jpeg", "application/pdf", "application/json"]);

async function readBoundedJson(request: Request): Promise<unknown> {
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_REQUEST_BYTES) {
      await reader.cancel();
      throw new Error("request_too_large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    return null;
  }
}

app.use("*", async (c, next) => {
  const length = Number(c.req.header("content-length") ?? "0");
  const artifactUpload = /\/gates\/runs\/[^/]+\/items\/[^/]+\/artifacts$/.test(c.req.path) && c.req.method === "POST";
  const limit = artifactUpload ? MAX_ARTIFACT_BYTES : MAX_REQUEST_BYTES;
  if (Number.isFinite(length) && length > limit) return c.json({ error: { code: "request_too_large" } }, 413);
  await next();
  c.header("x-content-type-options", "nosniff");
  c.header("referrer-policy", "no-referrer");
  c.header("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=()");
  c.header("cache-control", c.req.path.startsWith("/api/") ? "no-store" : "no-cache");
});

app.get("/health", (c) => c.json({
  status: "ok",
  environment: c.env.ENVIRONMENT,
  etsyReadEgressEnabled: String(c.env.ETSY_READ_EGRESS_ENABLED) === "true",
  etsyEgressEnabled: String(c.env.ETSY_EGRESS_ENABLED) === "true",
  titleWritesEnabled: String(c.env.TITLE_WRITES_ENABLED) === "true",
  executorVersion: c.env.EXECUTOR_VERSION,
}));

app.use("/api/v1/*", clerkMiddleware());
app.use("/api/v1/*", async (c, next) => {
  const auth = getAuth(c);
  if (!auth?.userId) return c.json({ error: { code: "unauthorized" } }, 401);
  c.set("actorId", auth.userId);
  await next();
});

app.post("/api/v1/tenants/:tenantId/oauth/etsy/start", async (c) => {
  const parsed = oauthStartSchema.safeParse(await readBoundedJson(c.req.raw));
  if (!parsed.success) return c.json({ error: { code: "contract_invalid" } }, 400);
  const authorizationUrl = await startEtsyOAuth(c.env, {
    tenantId: c.req.param("tenantId"), actorId: c.get("actorId"), externalShopId: parsed.data.externalShopId, accessMode: parsed.data.accessMode,
  });
  return c.json({ authorizationUrl });
});

app.get("/api/v1/oauth/etsy/callback", async (c) => {
  const state = c.req.query("state");
  const code = c.req.query("code");
  if (!state || !code) return c.json({ error: { code: "oauth_callback_invalid" } }, 400);
  const result = await finishEtsyOAuth(c.env, { state, code, actorId: c.get("actorId") });
  return c.redirect(`/?connected=${encodeURIComponent(result.shopConnectionId)}`, 303);
});

app.get("/api/v1/session", async (c) => {
  return c.json(await new GateRepository(c.env.DB).listSession(c.get("actorId")));
});

app.get("/api/v1/tenants/:tenantId/shops/:shopId/gates", async (c) => {
  const repository = new GateRepository(c.env.DB);
  return c.json(await repository.listGates({ tenantId: c.req.param("tenantId"), shopId: c.req.param("shopId"), actorId: c.get("actorId") }));
});

app.post("/api/v1/tenants/:tenantId/shops/:shopId/gates/G1/collect", async (c) => {
  return c.json(await collectGate1Evidence(c.env, {
    tenantId: c.req.param("tenantId"),
    shopId: c.req.param("shopId"),
    actorId: c.get("actorId"),
  }, new Date()), 201);
});

app.post("/api/v1/tenants/:tenantId/shops/:shopId/gates/:gateId/prepare", async (c) => {
  const gateId = z.enum(["G2", "G3"]).safeParse(c.req.param("gateId"));
  if (!gateId.success) return c.json({ error: { code: "contract_invalid" } }, 400);
  const repository = new GateRepository(c.env.DB);
  return c.json(await prepareGateProtocol(repository, {
    tenantId: c.req.param("tenantId"), shopId: c.req.param("shopId"), actorId: c.get("actorId"),
  }, gateId.data, new Date()), 201);
});

app.get("/api/v1/tenants/:tenantId/shops/:shopId/gates/runs/:runId", async (c) => {
  return c.json(await new GateRepository(c.env.DB).getRun(
    { tenantId: c.req.param("tenantId"), shopId: c.req.param("shopId"), actorId: c.get("actorId") },
    c.req.param("runId"),
  ));
});

app.post("/api/v1/tenants/:tenantId/shops/:shopId/gates/runs/:runId/items/:itemId/responses", async (c) => {
  const parsed = gateResponseSchema.safeParse(await readBoundedJson(c.req.raw));
  if (!parsed.success) return c.json({ error: { code: "contract_invalid" } }, 400);
  const repository = new GateRepository(c.env.DB);
  const scope = { tenantId: c.req.param("tenantId"), shopId: c.req.param("shopId"), actorId: c.get("actorId") };
  await repository.recordResponse(scope, c.req.param("runId"), c.req.param("itemId"), parsed.data.outcome, parsed.data.note, parsed.data.evidenceRevision, new Date().toISOString());
  return c.json(await repository.getRun(scope, c.req.param("runId")), 201);
});

app.post("/api/v1/tenants/:tenantId/shops/:shopId/gates/runs/:runId/items/:itemId/artifacts", async (c) => {
  const mediaType = (c.req.header("content-type") ?? "").split(";", 1)[0]!.trim().toLowerCase();
  const claimedSha256 = c.req.header("x-content-sha256") ?? "";
  if (!ARTIFACT_MEDIA_TYPES.has(mediaType) || !/^[a-f0-9]{64}$/.test(claimedSha256)) return c.json({ error: { code: "artifact_contract_invalid" } }, 400);
  const bytes = await readBoundedBytes(c.req.raw, MAX_ARTIFACT_BYTES);
  if (bytes.byteLength === 0) return c.json({ error: { code: "artifact_contract_invalid" } }, 400);
  const digestSource = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const actualSha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", digestSource))].map((value) => value.toString(16).padStart(2, "0")).join("");
  if (actualSha256 !== claimedSha256) return c.json({ error: { code: "artifact_digest_mismatch" } }, 400);
  const scope = { tenantId: c.req.param("tenantId"), shopId: c.req.param("shopId"), actorId: c.get("actorId") };
  const r2Key = `gate-evidence/${c.req.param("runId")}/${crypto.randomUUID()}`;
  await c.env.RECOVERY_BUCKET.put(r2Key, bytes, { httpMetadata: { contentType: mediaType }, customMetadata: { sha256: actualSha256 } });
  try {
    await new GateRepository(c.env.DB).recordArtifact(scope, {
      runId: c.req.param("runId"), itemId: c.req.param("itemId"), r2Key, mediaType,
      byteLength: bytes.byteLength, contentSha256: actualSha256,
    }, new Date().toISOString());
  } catch (error) {
    await c.env.RECOVERY_BUCKET.delete(r2Key);
    throw error;
  }
  return c.json({ contentSha256: actualSha256, byteLength: bytes.byteLength }, 201);
});

app.post("/api/v1/tenants/:tenantId/shops/:shopId/gates/runs/:runId/approve", async (c) => {
  const parsed = gateApprovalSchema.safeParse(await readBoundedJson(c.req.raw));
  if (!parsed.success) return c.json({ error: { code: "contract_invalid" } }, 400);
  const repository = new GateRepository(c.env.DB);
  const scope = { tenantId: c.req.param("tenantId"), shopId: c.req.param("shopId"), actorId: c.get("actorId") };
  await repository.approve(scope, c.req.param("runId"), parsed.data.disposition, new Date().toISOString());
  return c.json(await repository.getRun(scope, c.req.param("runId")));
});

app.post("/api/v1/tenants/:tenantId/shops/:shopId/title-commands", async (c) => {
  const parsed = commandSchema.safeParse(await readBoundedJson(c.req.raw));
  if (!parsed.success) return c.json({ error: { code: "contract_invalid" } }, 400);
  const repository = new OperationRepository(c.env.DB);
  const actorId = c.get("actorId");
  const tenantId = c.req.param("tenantId");
  const shopId = c.req.param("shopId");
  const authority = await repository.loadAuthority(tenantId, shopId, actorId);
  const command: TitleCommandInput = {
    id: crypto.randomUUID(),
    idempotencyKey: parsed.data.idempotencyKey,
    tenantId,
    shopId,
    listingId: parsed.data.listingId,
    actorId,
    baselineTitle: parsed.data.baselineTitle,
    proposedTitle: parsed.data.proposedTitle,
    approvalExpiresAt: parsed.data.approvalExpiresAt,
    authority: parsed.data.authority,
  };
  const accepted = await repository.acceptTitleCommand(command, authority, new Date().toISOString());
  const coordinator = c.env.SHOP_COORDINATOR.getByName(`${tenantId}:${shopId}`);
  await coordinator.enqueue(accepted.operation.id);
  return c.json({ operation: publicOperation(accepted.operation), duplicate: accepted.duplicate }, accepted.duplicate ? 200 : 202);
});

app.post("/api/v1/tenants/:tenantId/shops/:shopId/operations/:operationId/revert", async (c) => {
  const parsed = revertSchema.safeParse(await readBoundedJson(c.req.raw));
  if (!parsed.success) return c.json({ error: { code: "contract_invalid" } }, 400);
  const repository = new OperationRepository(c.env.DB);
  const actorId = c.get("actorId");
  const tenantId = c.req.param("tenantId");
  const shopId = c.req.param("shopId");
  const parent = await repository.getScopedOperation(c.req.param("operationId"), tenantId, shopId);
  if (parent.state !== "verified") return c.json({ error: { code: "parent_not_verified" } }, 409);
  const authority = await repository.loadAuthority(tenantId, shopId, actorId);
  const accepted = await repository.acceptTitleCommand({
    id: crypto.randomUUID(),
    idempotencyKey: parsed.data.idempotencyKey,
    tenantId,
    shopId,
    listingId: parent.listingId,
    actorId,
    baselineTitle: parent.proposedTitle,
    proposedTitle: parent.baselineTitle,
    approvalExpiresAt: parsed.data.approvalExpiresAt,
    authority: parsed.data.authority,
    parentOperationId: parent.id,
    kind: "revert",
  }, authority, new Date().toISOString());
  await c.env.SHOP_COORDINATOR.getByName(`${tenantId}:${shopId}`).enqueue(accepted.operation.id);
  return c.json({ operation: publicOperation(accepted.operation), duplicate: accepted.duplicate }, accepted.duplicate ? 200 : 202);
});

app.post("/api/v1/tenants/:tenantId/shops/:shopId/operations/:operationId/keep", async (c) => {
  const parsed = keepSchema.safeParse(await readBoundedJson(c.req.raw));
  if (!parsed.success) return c.json({ error: { code: "contract_invalid" } }, 400);
  const repository = new OperationRepository(c.env.DB);
  const tenantId = c.req.param("tenantId");
  const shopId = c.req.param("shopId");
  const parent = await repository.getScopedOperation(c.req.param("operationId"), tenantId, shopId);
  if (parent.state !== "verified") return c.json({ error: { code: "parent_not_verified" } }, 409);
  const decision = await verifyKeep(c.env, parent, c.get("actorId"), parsed.data.idempotencyKey);
  return c.json({ operation: publicOperation(decision) }, decision.state === "verified" ? 200 : 409);
});

app.get("/api/v1/tenants/:tenantId/shops/:shopId/operations/:operationId", async (c) => {
  const repository = new OperationRepository(c.env.DB);
  await repository.loadAuthority(c.req.param("tenantId"), c.req.param("shopId"), c.get("actorId"));
  const operation = await repository.getScopedOperation(c.req.param("operationId"), c.req.param("tenantId"), c.req.param("shopId"));
  return c.json({ operation: publicOperation(operation) });
});

app.onError((error, c) => {
  const known = error instanceof Error ? error.message.split(":", 1)[0]! : "internal_error";
  const safeCodes = new Set([
    "authority_not_found", "actor_revoked", "role_forbidden", "kill_switch_active", "restore_quarantine_active",
    "required_scope_missing", "authority_epoch_stale", "approval_expired", "capability_disabled", "canary_permit_expired",
    "canary_permit_mismatch", "title_empty", "title_too_long", "title_outer_whitespace", "title_unsupported_character",
    "title_repeated_limited_character", "title_noop", "idempotency_conflict", "conditional_acceptance_rejected",
    "operation_not_found", "parent_not_verified", "shop_lane_blocked",
    "runtime_egress_gate_disabled",
    "oauth_state_invalid", "oauth_shop_identity_mismatch", "oauth_callback_invalid",
    "request_too_large",
    "gate_items_invalid", "gate_evidence_stale", "gate_item_not_found", "gate_run_not_found", "gate_not_approvable",
    "collection_authority_not_found", "collection_scopes_missing", "collection_budget_invalid", "collection_daily_budget_exhausted",
    "runtime_read_egress_gate_disabled", "collection_evidence_empty", "collection_pagination_limit_exceeded",
    "artifact_contract_invalid", "artifact_digest_mismatch",
    "gate_dependency_not_approved",
    "gate_run_closed", "gate_already_approved", "gate_approval_conflict", "gate_disposition_invalid",
  ]);
  const code = safeCodes.has(known) ? known : "internal_error";
  console.error(JSON.stringify({ level: "error", code, requestId: c.req.header("cf-ray") ?? crypto.randomUUID() }));
  return c.json({ error: { code } }, code === "internal_error" ? 500 : code === "operation_not_found" ? 404 : 409);
});

function publicOperation(operation: TitleOperation) {
  return {
    id: operation.id,
    listingId: operation.listingId,
    state: operation.state,
    kind: operation.kind,
    baselineTitle: operation.baselineTitle,
    proposedTitle: operation.proposedTitle,
    requestDigest: operation.requestDigest,
    acceptedAt: operation.acceptedAt,
    preparedAt: operation.preparedAt ?? null,
    dispatchedAt: operation.dispatchedAt ?? null,
    verifiedAt: operation.verifiedAt ?? null,
    verificationKind: operation.verificationKind ?? null,
    failureCode: operation.failureCode ?? null,
    reconciliationReads: operation.reconciliationReads,
  };
}

export default app;

async function readBoundedBytes(request: Request, limit: number): Promise<Uint8Array> {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new Error("request_too_large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
