import type { AppEnv } from "./env.ts";

export async function sendIncidentNotification(
  env: AppEnv,
  incident: { operationId: string; code: string },
): Promise<boolean> {
  if (!env.RESEND_API_KEY || !env.INCIDENT_EMAIL) return false;
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      redirect: "manual",
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: "Auto Etsy SEO incidents <incidents@notifications.adesignsdenver.com>",
        to: [env.INCIDENT_EMAIL],
        subject: `Auto Etsy SEO operation requires attention: ${incident.operationId}`,
        text: `Operation ${incident.operationId} requires attention (${incident.code}). Open the authenticated recovery inbox; no mutation will be retried automatically.`,
      }),
    });
    return response.ok && !(response.status >= 300 && response.status < 400);
  } catch {
    return false;
  }
}
