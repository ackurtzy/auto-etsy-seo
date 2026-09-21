import { buildEtsyAuthorizationUrl, EtsyClient, exchangeEtsyAuthorizationCode } from "../../../packages/etsy/src/index.ts";
import { canonicalDigest } from "../../../packages/operations/src/index.ts";
import { CredentialVault } from "../../../packages/security/src/credential-vault.ts";
import type { AppEnv } from "./env.ts";
import { OperationRepository } from "./repository.ts";

const scopeModes = {
  read_only: ["listings_r", "transactions_r", "shops_r"],
  title_canary: ["listings_r", "transactions_r", "shops_r", "listings_w"],
} as const;

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

async function challenge(verifier: string): Promise<string> {
  return base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
}

interface OAuthStateRow {
  state_digest: string;
  tenant_id: string;
  actor_id: string;
  expected_external_shop_id: string;
  verifier_nonce: string;
  verifier_ciphertext: string;
  redirect_uri: string;
  expires_at: string;
  consumed_at: string | null;
  requested_scopes_json: string;
}

export async function startEtsyOAuth(env: AppEnv, input: { tenantId: string; actorId: string; externalShopId: string; accessMode: keyof typeof scopeModes }): Promise<string> {
  await new OperationRepository(env.DB).assertTenantOwner(input.tenantId, input.actorId);
  const verifierBytes = crypto.getRandomValues(new Uint8Array(48));
  const verifier = base64Url(verifierBytes);
  const state = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const redirectUri = `${String(env.PUBLIC_APP_ORIGIN).replace(/\/$/u, "")}/api/v1/oauth/etsy/callback`;
  const vault = await CredentialVault.fromBase64Key(env.CREDENTIAL_ENCRYPTION_KEY);
  const encrypted = await vault.encrypt(verifier, { tenantId: input.tenantId, shopId: "oauth-state", version: 1 });
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 10 * 60 * 1000).toISOString();
  await env.DB.prepare(`
    INSERT INTO oauth_states(state_digest,tenant_id,actor_id,expected_external_shop_id,verifier_algorithm,verifier_nonce,verifier_ciphertext,redirect_uri,expires_at,requested_scopes_json,created_at)
    VALUES(?,?,?,?,'AES-GCM-256',?,?,?,?,?,?)
  `).bind(canonicalDigest(state), input.tenantId, input.actorId, input.externalShopId, encrypted.nonce, encrypted.ciphertext, redirectUri, expiresAt, JSON.stringify(scopeModes[input.accessMode]), now.toISOString()).run();
  return buildEtsyAuthorizationUrl({ clientId: env.ETSY_CLIENT_ID, redirectUri, state, codeChallenge: await challenge(verifier), scopes: [...scopeModes[input.accessMode]] });
}

export async function finishEtsyOAuth(env: AppEnv, input: { state: string; code: string; actorId: string }): Promise<{ shopConnectionId: string }> {
  const digest = canonicalDigest(input.state);
  const row = await env.DB.prepare(`SELECT * FROM oauth_states WHERE state_digest=?`).bind(digest).first<OAuthStateRow>();
  const now = new Date();
  if (!row || row.actor_id !== input.actorId || row.consumed_at || Date.parse(row.expires_at) <= now.getTime()) throw new Error("oauth_state_invalid");
  const consumed = await env.DB.prepare(`UPDATE oauth_states SET consumed_at=? WHERE state_digest=? AND consumed_at IS NULL AND expires_at>?`)
    .bind(now.toISOString(), digest, now.toISOString()).run();
  if ((consumed.meta.changes ?? 0) !== 1) throw new Error("oauth_state_invalid");
  const vault = await CredentialVault.fromBase64Key(env.CREDENTIAL_ENCRYPTION_KEY);
  const verifier = await vault.decrypt({ algorithm: "AES-GCM-256", nonce: row.verifier_nonce, ciphertext: row.verifier_ciphertext }, { tenantId: row.tenant_id, shopId: "oauth-state", version: 1 });
  const token = await exchangeEtsyAuthorizationCode({ clientId: env.ETSY_CLIENT_ID, redirectUri: row.redirect_uri, code: input.code, codeVerifier: verifier });
  const scopes = parseScopes(row.requested_scopes_json);
  const etsy = new EtsyClient({ apiKey: env.ETSY_API_KEY, accessToken: token.accessToken, baseUrl: env.ETSY_BASE_URL });
  const authorizedShopIds = await etsy.getAuthorizedShopIds();
  if (!authorizedShopIds.includes(row.expected_external_shop_id)) throw new Error("oauth_shop_identity_mismatch");
  const repository = new OperationRepository(env.DB);
  const existing = await repository.findShopConnection(row.tenant_id, row.expected_external_shop_id);
  const shopConnectionId = existing?.id ?? crypto.randomUUID();
  const context = { tenantId: row.tenant_id, shopId: shopConnectionId, version: existing ? existing.tokenVersion + 1 : 1 };
  const [access, refresh] = await Promise.all([vault.encrypt(token.accessToken, context), vault.encrypt(token.refreshToken, context)]);
  const connection = {
    id: shopConnectionId, tenantId: row.tenant_id, actorId: row.actor_id, externalShopId: row.expected_external_shop_id,
    scopes, access, refresh, expiresAt: new Date(now.getTime() + token.expiresInSeconds * 1000).toISOString(), now: now.toISOString(),
  };
  if (existing) await repository.reauthorizeShopConnection({ ...connection, currentVersion: existing.tokenVersion });
  else await repository.createShopConnection(connection);
  return { shopConnectionId };
}

function parseScopes(raw: string): string[] {
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed) || !parsed.every((scope) => typeof scope === "string")) throw new Error("oauth_state_invalid");
  return [...new Set(parsed)];
}
