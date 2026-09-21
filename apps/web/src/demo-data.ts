import type { GateWorkspace, SessionResponse } from "./api.ts";

export const demoSession: SessionResponse = {
  tenants: [{ id: "demo-tenant", name: "A Designs Denver", role: "owner", shops: [{ id: "demo-shop", externalShopId: "12345678", status: "active" }] }],
};

const listings = [
  ["Pressed flower notebook", "Pressed Flower Notebook — Lined Journal A5", "active", "118", "3"],
  ["Floral correspondence set", "Floral Correspondence Cards — Set of 12", "active", "84", "2"],
  ["Botanical notepad", "Botanical Desk Notepad — 50 Sheets", "active", "63", "1"],
  ["Monogram note cards", "Personalized Monogram Note Cards", "active", "144", "5"],
  ["Wildflower enclosure cards", "Wildflower Gift Enclosure Cards", "active", "42", "1"],
  ["Garden thank-you cards", "Garden Thank You Cards — Set of 10", "active", "91", "4"],
  ["Linen stationery set", "Linen Stationery Set with Envelopes", "active", "57", "2"],
  ["Archive floral notes", "Archive Floral Folded Notes", "inactive", "310", "0"],
  ["Minimal memo pad", "Minimal Memo Pad — Warm White", "active", "28", "0"],
  ["Sold-out botanical cards", "Botanical Flat Cards — Limited Edition", "sold_out", "206", "7"],
];

const responses = ["matched", "matched", "matched", "matched", "matched", "matched", "matched", null, null, null] as const;

export const demoGates: GateWorkspace[] = [
  {
    gate: { id: "G1", title: "Trust the data", shortTitle: "Data", description: "Compare collected listing and receipt evidence with Etsy before using a metric.", enabledCapabilities: ["qualified_read_only_measurement"], explicitlyDisabledCapabilities: ["causal_claims", "etsy_writes"] },
    run: { id: "demo-g1", protocolVersion: "measurement-profile-draft-1", buildVersion: "demo-build", evidenceRevision: "revision-4", evidenceSha256: "0".repeat(64) },
    review: { status: "ready_for_review", completed: 7, total: 10, canApprove: false, blockers: ["required_comparisons_incomplete"] },
    items: listings.map(([label, title, status, views], index) => ({
      id: `listing-${index + 1}`,
      category: "listing",
      label,
      instructions: "Open Etsy Shop Manager → Listings and Stats. Confirm the exact listing, status, and the same date range.",
      metricKey: "listing_state_and_views",
      required: true,
      comparison: { title, status, views, createdAtUtc: "2025-03-18T14:22:00.000Z", updatedAtUtc: "2026-09-20T16:08:00.000Z", tags: ["botanical", "stationery", "gift"], listingId: String(1234567890 + index) },
      sourceReference: null,
      response: responses[index] ? { id: `response-${index}`, outcome: responses[index], note: "", evidence_revision: "revision-4", created_at: "2026-09-20T12:00:00Z" } : null,
    })),
  },
  {
    gate: { id: "G2", title: "Interpret results honestly", shortTitle: "Interpretation", description: "Confirm what directional and statistical results do—and do not—mean.", enabledCapabilities: ["directional_reporting_contract"], explicitlyDisabledCapabilities: ["randomized_inference", "automatic_winner_decisions"] },
    run: null,
    review: { status: "blocked", completed: 0, total: 6, canApprove: false, blockers: ["dependency_not_approved"] },
    items: [],
  },
  {
    gate: { id: "G3", title: "Prove changes fail safely", shortTitle: "Safety", description: "Exercise the deployed failure matrix and one exact owner-authorized title canary.", enabledCapabilities: ["title_T3"], explicitlyDisabledCapabilities: ["tags_T3", "general_etsy_egress", "automation"] },
    run: null,
    review: { status: "blocked", completed: 0, total: 24, canApprove: false, blockers: ["dependency_not_approved"] },
    items: [],
  },
];
