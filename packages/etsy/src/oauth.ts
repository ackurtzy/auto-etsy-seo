import { z } from "zod";
import { EtsyTransportError, type FetchLike } from "./client.ts";

const tokenSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string().min(1),
  expires_in: z.number().int().positive(),
  refresh_token: z.string().min(1),
});

export interface RefreshedToken {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
}

export interface AuthorizationCodeToken extends RefreshedToken {}

export function buildEtsyAuthorizationUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  scopes: string[];
}): string {
  const url = new URL("https://www.etsy.com/oauth/connect");
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    scope: input.scopes.join(" "),
    state: input.state,
    code_challenge: input.codeChallenge,
    code_challenge_method: "S256",
  }).toString();
  return url.toString();
}

export async function exchangeEtsyAuthorizationCode(input: {
  clientId: string;
  redirectUri: string;
  code: string;
  codeVerifier: string;
  fetcher?: FetchLike;
}): Promise<AuthorizationCodeToken> {
  return requestToken(new URLSearchParams({
    grant_type: "authorization_code",
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    code: input.code,
    code_verifier: input.codeVerifier,
  }), input.fetcher ?? fetch);
}

export async function refreshEtsyToken(clientId: string, refreshToken: string, fetcher: FetchLike = fetch): Promise<RefreshedToken> {
  return requestToken(new URLSearchParams({ grant_type: "refresh_token", client_id: clientId, refresh_token: refreshToken }), fetcher);
}

async function requestToken(body: URLSearchParams, fetcher: FetchLike): Promise<RefreshedToken> {
  let response: Response;
  try {
    response = await fetcher("https://api.etsy.com/v3/public/oauth/token", {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: body.toString(),
    });
  } catch {
    throw new EtsyTransportError("oauth_refresh_transport_failed");
  }
  if (response.status >= 300 && response.status < 400) throw new EtsyTransportError("redirect_disallowed", response.status);
  if (!response.ok) throw new EtsyTransportError("oauth_refresh_rejected", response.status);
  const parsed = tokenSchema.safeParse(await response.json());
  if (!parsed.success) throw new EtsyTransportError("oauth_refresh_schema_invalid", response.status);
  return {
    accessToken: parsed.data.access_token,
    refreshToken: parsed.data.refresh_token,
    expiresInSeconds: parsed.data.expires_in,
  };
}
