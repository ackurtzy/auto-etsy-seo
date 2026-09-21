import { z } from "zod";

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const listingSchema = z.object({
  listing_id: z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]),
  title: z.string(),
}).passthrough();

const shopListSchema = z.object({
  results: z.array(z.object({ shop_id: z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]) }).passthrough()),
}).passthrough();

export class EtsyTransportError extends Error {
  readonly code: string;
  readonly status?: number;

  constructor(code: string, status?: number) {
    super(status === undefined ? code : `${code}:${status}`);
    this.name = "EtsyTransportError";
    this.code = code;
    if (status !== undefined) this.status = status;
  }
}

export interface EtsyClientOptions {
  apiKey: string;
  accessToken: string;
  fetcher?: FetchLike;
  baseUrl?: string;
}

export class EtsyClient {
  private readonly apiKey: string;
  private readonly accessToken: string;
  private readonly fetcher: FetchLike;
  private readonly baseUrl: string;

  constructor(options: EtsyClientOptions) {
    this.apiKey = options.apiKey;
    this.accessToken = options.accessToken;
    this.fetcher = options.fetcher ?? fetch;
    this.baseUrl = options.baseUrl ?? "https://openapi.etsy.com/v3";
  }

  async getListing(listingId: string): Promise<{ listingId: string; title: string }> {
    const payload = await this.request(`/application/listings/${encodeURIComponent(listingId)}`, { method: "GET" });
    const parsed = listingSchema.safeParse(payload);
    if (!parsed.success) throw new EtsyTransportError("response_schema_invalid");
    return { listingId: String(parsed.data.listing_id), title: parsed.data.title };
  }

  async patchTitle(shopId: string, listingId: string, title: string): Promise<{ status: number }> {
    const body = new URLSearchParams({ title }).toString();
    const response = await this.rawRequest(
      `/application/shops/${encodeURIComponent(shopId)}/listings/${encodeURIComponent(listingId)}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
      },
      true,
    );
    const payload = await boundedJson(response);
    const parsed = listingSchema.safeParse(payload);
    if (!parsed.success) throw new EtsyTransportError("response_schema_invalid", response.status);
    return { status: response.status };
  }

  async getAuthorizedShopIds(): Promise<string[]> {
    const userId = this.accessToken.split(".", 1)[0];
    if (!userId || !/^\d+$/.test(userId)) throw new EtsyTransportError("access_token_subject_invalid");
    const payload = await this.request(`/application/users/${encodeURIComponent(userId)}/shops?limit=100`, { method: "GET" });
    const parsed = shopListSchema.safeParse(payload);
    if (!parsed.success) throw new EtsyTransportError("response_schema_invalid");
    return parsed.data.results.map((shop) => String(shop.shop_id));
  }

  private async request(path: string, init: RequestInit): Promise<unknown> {
    return boundedJson(await this.rawRequest(path, init, false));
  }

  private async rawRequest(path: string, init: RequestInit, mutation: boolean): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}${path}`, {
        ...init,
        redirect: "manual",
        headers: {
          "x-api-key": this.apiKey,
          authorization: `Bearer ${this.accessToken}`,
          accept: "application/json",
          ...init.headers,
        },
      });
    } catch {
      throw new EtsyTransportError(mutation ? "transport_ambiguous" : "transport_failed");
    }
    if (response.status >= 300 && response.status < 400) throw new EtsyTransportError("redirect_disallowed", response.status);
    if (!response.ok) {
      const code = mutation && (response.status === 408 || response.status === 429 || response.status >= 500)
        ? "mutation_outcome_ambiguous"
        : "etsy_request_rejected";
      throw new EtsyTransportError(code, response.status);
    }
    return response;
  }
}

async function boundedJson(response: Response): Promise<unknown> {
  const length = response.headers.get("content-length");
  if (length && Number(length) > 1_000_000) throw new EtsyTransportError("response_too_large", response.status);
  const text = await response.text();
  if (text.length > 1_000_000) throw new EtsyTransportError("response_too_large", response.status);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new EtsyTransportError("response_json_invalid", response.status);
  }
}
