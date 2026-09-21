import type { EtsyTitleService, ListingSnapshot } from "./types.ts";

export class FakeEtsyTitleService implements EtsyTitleService {
  listing: ListingSnapshot;
  mutationCount = 0;
  readCount = 0;
  readonly requests: Array<{ method: "GET" | "PATCH"; listingId: string; body?: Record<string, string> }> = [];
  readonly failures = {
    loseResponseAfterCommit: false,
    crashBeforeSend: false,
    rateLimited: false,
    readbackDifferent: false,
    unavailable: false,
  };

  constructor(listing: ListingSnapshot) {
    this.listing = structuredClone(listing);
  }

  async getListing(_shopId: string, listingId: string): Promise<ListingSnapshot> {
    this.requests.push({ method: "GET", listingId });
    this.readCount += 1;
    if (this.failures.unavailable) throw new Error("etsy_unavailable");
    if (this.failures.readbackDifferent && this.mutationCount > 0) {
      return { ...structuredClone(this.listing), title: "Unexpected external title" };
    }
    return structuredClone(this.listing);
  }

  async patchTitle(_shopId: string, listingId: string, title: string): Promise<{ status: number }> {
    this.requests.push({ method: "PATCH", listingId, body: { title } });
    if (this.failures.crashBeforeSend) throw new Error("transport_ambiguous_before_send_proof_unavailable");
    if (this.failures.rateLimited) throw new Error("etsy_rate_limited");
    this.mutationCount += 1;
    this.listing.title = title;
    this.listing.revision = `fake-${this.mutationCount}`;
    if (this.failures.loseResponseAfterCommit) throw new Error("response_lost_after_commit");
    return { status: 200 };
  }

  ownerEdit(changes: Partial<ListingSnapshot>): void {
    this.listing = { ...this.listing, ...structuredClone(changes) };
  }
}
