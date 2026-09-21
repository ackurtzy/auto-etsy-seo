import { canonicalDigest } from "../../../packages/operations/src/index.ts";
import { EtsyClient, type EtsyPage, type SafeListing, type SafeReceipt } from "../../../packages/etsy/src/index.ts";
import { selectRepresentativeListings, selectRepresentativeReceipts } from "../../../packages/gates/src/index.ts";
import type { AppEnv } from "./env.ts";
import { GateRepository, type GateEvidenceItemInput } from "./gate-repository.ts";
import { OperationRepository } from "./repository.ts";
import { loadAccessToken } from "./runtime.ts";

const PAGE_SIZE = 100;
const MAX_PAGES_PER_COLLECTION = 3;
const COLLECTION_REQUEST_LIMIT = 12;
const LISTING_STATES = ["active", "inactive", "sold_out"] as const;
const PROTOCOL_VERSION = "g1-human-comparison-v1";
const BUILD_VERSION = "phase4-gates-v1";

interface Scope { tenantId: string; shopId: string; actorId: string }

export async function collectGate1Evidence(env: AppEnv, scope: Scope, now: Date): Promise<Awaited<ReturnType<GateRepository["getRun"]>>> {
  if (String(env.ETSY_READ_EGRESS_ENABLED) !== "true") throw new Error("runtime_read_egress_gate_disabled");
  const gates = new GateRepository(env.DB);
  const authority = await gates.loadCollectionAuthority(scope);
  await gates.reserveCollectionReads(scope, COLLECTION_REQUEST_LIMIT, now.toISOString());

  const operations = new OperationRepository(env.DB);
  const credential = await operations.loadCredential(scope.shopId);
  const accessToken = await loadAccessToken(env, operations, credential, now);
  const etsy = new EtsyClient({ apiKey: env.ETSY_API_KEY, accessToken, baseUrl: env.ETSY_BASE_URL });

  const listings: SafeListing[] = [];
  for (const state of LISTING_STATES) listings.push(...await collectCompletePageSet((offset) => etsy.getListingsByShop(authority.externalShopId, state, offset, PAGE_SIZE)));
  const minCreated = Math.floor((now.getTime() - 30 * 86_400_000) / 1000);
  const receipts = await collectCompletePageSet((offset) => etsy.getShopReceipts(authority.externalShopId, minCreated, offset, PAGE_SIZE));
  if (listings.length === 0 || receipts.length === 0) throw new Error("collection_evidence_empty");

  const windowLabel = `${new Date(minCreated * 1000).toISOString().slice(0, 10)} through ${now.toISOString().slice(0, 10)} UTC`;
  const items = buildEvidenceItems(listings, receipts, windowLabel);
  const packet = {
    protocolVersion: PROTOCOL_VERSION,
    collectedAt: now.toISOString(),
    window: { minCreated, through: Math.floor(now.getTime() / 1000) },
    listingCounts: Object.fromEntries(LISTING_STATES.map((state) => [state, listings.filter((listing) => listing.state === state).length])),
    receiptCount: receipts.length,
    items,
  };
  const evidenceSha256 = canonicalDigest(JSON.stringify(packet));
  const evidenceRevision = `g1:${now.toISOString()}:${evidenceSha256.slice(0, 12)}`;
  const runId = await gates.startRun(scope, {
    gateId: "G1",
    protocolVersion: PROTOCOL_VERSION,
    buildVersion: BUILD_VERSION,
    evidenceRevision,
    evidenceSha256,
    automatedEvidencePassed: true,
    enabledOutcomeMetrics: ["transaction_units"],
    items,
  }, now.toISOString());
  return gates.getRun(scope, runId);
}

async function collectCompletePageSet<T>(fetchPage: (offset: number) => Promise<EtsyPage<T>>): Promise<T[]> {
  const results: T[] = [];
  for (let page = 0; page < MAX_PAGES_PER_COLLECTION; page += 1) {
    const response = await fetchPage(page * PAGE_SIZE);
    results.push(...response.results);
    if (results.length >= response.count || response.results.length < PAGE_SIZE) return results;
  }
  throw new Error("collection_pagination_limit_exceeded");
}

function buildEvidenceItems(listings: SafeListing[], receipts: SafeReceipt[], windowLabel: string): GateEvidenceItemInput[] {
  const listingItems = selectRepresentativeListings(listings).map((listing, index): GateEvidenceItemInput => ({
    itemId: `listing-${listing.listingId}`,
    category: "listing",
    label: `Listing ${index + 1}`,
    instructions: "In Etsy Shop Manager, open this exact listing and compare the title, current state, and lifetime view count shown below.",
    required: true,
    comparison: {
      listingId: listing.listingId,
      title: listing.title,
      status: listing.state,
      views: listing.views,
      createdAtUtc: new Date(listing.createdTimestamp * 1000).toISOString(),
      updatedAtUtc: new Date(listing.updatedTimestamp * 1000).toISOString(),
      tags: listing.tags,
    },
    sourceReference: "https://www.etsy.com/your/shops/me/tools/listings",
  }));
  const receiptItems = selectRepresentativeReceipts(receipts).map((receipt, index): GateEvidenceItemInput => {
    const units = receipt.transactions.reduce((sum, transaction) => sum + transaction.quantity, 0);
    return {
      itemId: `receipt-${receipt.receiptId}`,
      category: "receipt",
      label: `Order sample ${index + 1}`,
      instructions: "In Etsy Shop Manager, open Orders & Shipping and compare this receipt ID, order date, transaction count, unit quantity, cancellation, and refund indicators. Buyer details are intentionally not collected.",
      metricKey: "transaction_units",
      required: true,
      comparison: {
        receiptId: receipt.receiptId,
        dateRange: windowLabel,
        createdAtUtc: new Date(receipt.createdTimestamp * 1000).toISOString(),
        transactions: receipt.transactions.length,
        units,
        wasPaid: receipt.wasPaid,
        wasCanceled: receipt.wasCanceled,
        refundRecords: receipt.refunds.length,
      },
      sourceReference: "https://www.etsy.com/your/shops/me/tools/orders",
    };
  });
  return [...listingItems, ...receiptItems];
}
