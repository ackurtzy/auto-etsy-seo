import type { AppEnv } from "./env.ts";

export function resolveLocalOwnerActor(env: AppEnv, request: Request): string | null {
  if (String(env.ENVIRONMENT) !== "local" || String(env.LOCAL_OWNER_MODE) !== "true") return null;
  const hostname = new URL(request.url).hostname;
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]"
    ? "local-owner"
    : null;
}
