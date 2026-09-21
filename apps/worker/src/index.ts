import { clerkMiddleware, getAuth } from "@hono/clerk-auth";
import { Hono } from "hono";
import { z } from "zod";
import type { TitleCommandInput, TitleOperation } from "../../../packages/operations/src/index.ts";
import type { AppEnv } from "./env.ts";
import { OperationRepository } from "./repository.ts";
import { verifyKeep } from "./runtime.ts";
import { finishEtsyOAuth, startEtsyOAuth } from "./oauth.ts";

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
const oauthStartSchema = z.object({ externalShopId: z.string().regex(/^\d+$/) }).strict();
const MAX_REQUEST_BYTES = 65_536;

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
  if (Number.isFinite(length) && length > 65_536) return c.json({ error: { code: "request_too_large" } }, 413);
  await next();
  c.header("x-content-type-options", "nosniff");
  c.header("referrer-policy", "no-referrer");
  c.header("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=()");
  c.header("cache-control", c.req.path.startsWith("/api/") ? "no-store" : "no-cache");
});

app.get("/health", (c) => c.json({
  status: "ok",
  environment: c.env.ENVIRONMENT,
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
    tenantId: c.req.param("tenantId"), actorId: c.get("actorId"), externalShopId: parsed.data.externalShopId,
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
