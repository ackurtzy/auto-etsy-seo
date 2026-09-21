import { z } from "zod";

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const listingSchema = z.object({
  listing_id: z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]),
  title: z.string(),
}).passthrough();

const shopListSchema = z.object({
  results: z.array(z.object({ shop_id: z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]) }).passthrough()),
}).passthrough();

const idSchema = z.union([z.number().int().nonnegative(), z.string().regex(/^\d+$/)]);
const moneySchema = z.object({
  amount: z.number().int(),
  divisor: z.number().int().positive(),
  currency_code: z.string().min(3).max(3),
}).passthrough();
const collectedListingSchema = z.object({
  listing_id: idSchema,
  title: z.string(),
  state: z.string(),
  views: z.number().int().nonnegative(),
  created_timestamp: z.number().int().nonnegative(),
  updated_timestamp: z.number().int().nonnegative(),
  tags: z.array(z.string()),
}).passthrough();
const collectedTransactionSchema = z.object({
  transaction_id: idSchema,
  listing_id: idSchema,
  quantity: z.number().int().positive(),
  price: moneySchema,
}).passthrough();
const collectedRefundSchema = z.object({
  amount: moneySchema.optional(),
  status: z.string().optional(),
  created_timestamp: z.number().int().nonnegative().optional(),
}).passthrough();
const collectedReceiptSchema = z.object({
  receipt_id: idSchema,
  created_timestamp: z.number().int().nonnegative(),
  updated_timestamp: z.number().int().nonnegative().optional(),
  was_paid: z.boolean(),
  was_canceled: z.boolean().optional(),
  transactions: z.array(collectedTransactionSchema),
  refunds: z.array(collectedRefundSchema).default([]),
}).passthrough();
const listingPageSchema = z.object({ count: z.number().int().nonnegative(), results: z.array(collectedListingSchema) }).passthrough();
const receiptPageSchema = z.object({ count: z.number().int().nonnegative(), results: z.array(collectedReceiptSchema) }).passthrough();

export interface SafeMoney { amount: number; divisor: number; currencyCode: string }
export interface SafeListing {
  listingId: string;
  title: string;
  state: string;
  views: number;
  createdTimestamp: number;
  updatedTimestamp: number;
  tags: string[];
}
export interface SafeReceipt {
  receiptId: string;
  createdTimestamp: number;
  updatedTimestamp?: number;
  wasPaid: boolean;
  wasCanceled: boolean;
  transactions: Array<{ transactionId: string; listingId: string; quantity: number; price: SafeMoney }>;
  refunds: Array<{ amount?: SafeMoney; status?: string; createdTimestamp?: number }>;
}
export interface EtsyPage<T> { count: number; results: T[] }

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

  async getListingsByShop(shopId: string, state: string, offset: number, limit: number): Promise<EtsyPage<SafeListing>> {
    assertPageBounds(offset, limit);
    if (!/^[a-z_]+$/.test(state)) throw new EtsyTransportError("collection_parameter_invalid");
    const query = new URLSearchParams({ state, offset: String(offset), limit: String(limit) });
    const payload = await this.request(`/application/shops/${encodeURIComponent(shopId)}/listings?${query.toString()}`, { method: "GET" });
    const parsed = listingPageSchema.safeParse(payload);
    if (!parsed.success) throw new EtsyTransportError("response_schema_invalid");
    return {
      count: parsed.data.count,
      results: parsed.data.results.map((listing) => ({
        listingId: String(listing.listing_id),
        title: decodeHtmlEntities(listing.title),
        state: listing.state,
        views: listing.views,
        createdTimestamp: listing.created_timestamp,
        updatedTimestamp: listing.updated_timestamp,
        tags: [...listing.tags],
      })),
    };
  }

  async getShopReceipts(shopId: string, minCreated: number, offset: number, limit: number): Promise<EtsyPage<SafeReceipt>> {
    assertPageBounds(offset, limit);
    if (!Number.isSafeInteger(minCreated) || minCreated < 0) throw new EtsyTransportError("collection_parameter_invalid");
    const query = new URLSearchParams({ min_created: String(minCreated), offset: String(offset), limit: String(limit) });
    const payload = await this.request(`/application/shops/${encodeURIComponent(shopId)}/receipts?${query.toString()}`, { method: "GET" });
    const parsed = receiptPageSchema.safeParse(payload);
    if (!parsed.success) throw new EtsyTransportError("response_schema_invalid");
    return {
      count: parsed.data.count,
      results: parsed.data.results.map((receipt) => ({
        receiptId: String(receipt.receipt_id),
        createdTimestamp: receipt.created_timestamp,
        ...(receipt.updated_timestamp === undefined ? {} : { updatedTimestamp: receipt.updated_timestamp }),
        wasPaid: receipt.was_paid,
        wasCanceled: receipt.was_canceled ?? false,
        transactions: receipt.transactions.map((transaction) => ({
          transactionId: String(transaction.transaction_id),
          listingId: String(transaction.listing_id),
          quantity: transaction.quantity,
          price: safeMoney(transaction.price),
        })),
        refunds: receipt.refunds.map((refund) => ({
          ...(refund.amount === undefined ? {} : { amount: safeMoney(refund.amount) }),
          ...(refund.status === undefined ? {} : { status: refund.status }),
          ...(refund.created_timestamp === undefined ? {} : { createdTimestamp: refund.created_timestamp }),
        })),
      })),
    };
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

function assertPageBounds(offset: number, limit: number): void {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new EtsyTransportError("collection_parameter_invalid");
  }
}

function safeMoney(value: z.infer<typeof moneySchema>): SafeMoney {
  return { amount: value.amount, divisor: value.divisor, currencyCode: value.currency_code };
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " " };
  return value.replace(/&(#\d+|#x[0-9a-f]+|amp|quot|apos|lt|gt|nbsp);/gi, (match, entity: string) => {
    if (entity[0] !== "#") return named[entity.toLowerCase()] ?? match;
    const codePoint = entity[1]?.toLowerCase() === "x" ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
    return Number.isSafeInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : match;
  });
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
