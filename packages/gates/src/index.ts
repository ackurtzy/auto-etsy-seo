export type GateId = "G1" | "G2" | "G3";
export type GateStatus =
  | "not_started"
  | "collecting"
  | "ready_for_review"
  | "needs_attention"
  | "approved"
  | "blocked"
  | "stale"
  | "superseded";

export type ReviewOutcome = "matched" | "resolved_difference" | "unavailable_disabled" | "differs" | "cannot_verify";

export interface GateReviewResponse {
  outcome: ReviewOutcome;
  evidenceRevision: string;
}

export interface GateReviewSnapshot {
  gateId: GateId;
  evidenceRevision: string;
  automatedEvidencePassed: boolean;
  dependenciesApproved: boolean;
  requiredItems: string[];
  responses: Record<string, GateReviewResponse>;
  enabledOutcomeMetrics: string[];
  approvedEvidenceRevision?: string;
  superseded?: boolean;
  collecting?: boolean;
}

export interface GateReviewStatus {
  status: GateStatus;
  completed: number;
  total: number;
  canApprove: boolean;
  blockers: string[];
}

export interface GateDefinition {
  id: GateId;
  title: string;
  shortTitle: string;
  description: string;
  enabledCapabilities: string[];
  explicitlyDisabledCapabilities: string[];
}

export const gateDefinitions: Record<GateId, GateDefinition> = {
  G1: {
    id: "G1",
    title: "Trust the data",
    shortTitle: "Data",
    description: "Compare collected listing and receipt evidence with Etsy before using a metric.",
    enabledCapabilities: ["qualified_read_only_measurement"],
    explicitlyDisabledCapabilities: ["causal_claims", "etsy_writes"],
  },
  G2: {
    id: "G2",
    title: "Interpret results honestly",
    shortTitle: "Interpretation",
    description: "Confirm what directional and statistical results do—and do not—mean.",
    enabledCapabilities: ["directional_reporting_contract"],
    explicitlyDisabledCapabilities: ["randomized_inference", "automatic_winner_decisions"],
  },
  G3: {
    id: "G3",
    title: "Prove changes fail safely",
    shortTitle: "Safety",
    description: "Exercise the deployed failure matrix and one exact owner-authorized title canary.",
    enabledCapabilities: ["title_T3"],
    explicitlyDisabledCapabilities: ["tags_T3", "general_etsy_egress", "automation"],
  },
};

export interface ListingSampleCandidate {
  listingId: string;
  state: string;
  views: number;
}

export interface ReceiptSampleCandidate {
  receiptId: string;
  createdTimestamp: number;
  wasCanceled: boolean;
  transactions: Array<{ quantity: number }>;
  refunds: unknown[];
}

/** Deterministic diversity sample: extremes, every observed state, then stable fill. */
export function selectRepresentativeListings<T extends ListingSampleCandidate>(candidates: T[], limit = 10): T[] {
  const stable = [...candidates].sort((a, b) => a.listingId.localeCompare(b.listingId, "en", { numeric: true }));
  const byViews = [...stable].sort((a, b) => b.views - a.views || a.listingId.localeCompare(b.listingId, "en", { numeric: true }));
  const selected: T[] = [];
  const add = (candidate: T | undefined) => {
    if (candidate && selected.length < limit && !selected.some((item) => item.listingId === candidate.listingId)) selected.push(candidate);
  };
  add(byViews[0]);
  add(byViews.at(-1));
  for (const state of [...new Set(stable.map((item) => item.state))].sort()) add(byViews.find((item) => item.state === state));
  for (const candidate of byViews) add(candidate);
  return selected;
}

/** Deterministic receipt sample biased toward edge cases that commonly expose count mistakes. */
export function selectRepresentativeReceipts<T extends ReceiptSampleCandidate>(candidates: T[], limit = 10): T[] {
  return [...candidates]
    .sort((a, b) => receiptRisk(b) - receiptRisk(a) || b.createdTimestamp - a.createdTimestamp || a.receiptId.localeCompare(b.receiptId, "en", { numeric: true }))
    .slice(0, limit);
}

function receiptRisk(receipt: ReceiptSampleCandidate): number {
  return (receipt.transactions.length > 1 ? 8 : 0)
    + (receipt.transactions.some((transaction) => transaction.quantity > 1) ? 4 : 0)
    + (receipt.refunds.length > 0 ? 2 : 0)
    + (receipt.wasCanceled ? 1 : 0);
}

const resolvedOutcomes = new Set<ReviewOutcome>(["matched", "resolved_difference", "unavailable_disabled"]);

export function deriveGateStatus(snapshot: GateReviewSnapshot): GateReviewStatus {
  const blockers: string[] = [];
  const currentResponses = snapshot.requiredItems
    .map((id) => snapshot.responses[id])
    .filter((response): response is GateReviewResponse => response !== undefined && response.evidenceRevision === snapshot.evidenceRevision);
  const completed = currentResponses.filter((response) => resolvedOutcomes.has(response.outcome)).length;
  const hasStaleResponses = Object.values(snapshot.responses).some((response) => response.evidenceRevision !== snapshot.evidenceRevision);
  const hasDifference = currentResponses.some((response) => response.outcome === "differs");
  const hasUnknown = currentResponses.some((response) => response.outcome === "cannot_verify");

  if (snapshot.superseded) {
    return { status: "superseded", completed, total: snapshot.requiredItems.length, canApprove: false, blockers: ["run_superseded"] };
  }
  if (!snapshot.dependenciesApproved) blockers.push("dependency_not_approved");
  if (!snapshot.automatedEvidencePassed) blockers.push("automated_evidence_not_passed");
  if (hasStaleResponses || (snapshot.approvedEvidenceRevision !== undefined && snapshot.approvedEvidenceRevision !== snapshot.evidenceRevision)) {
    blockers.push("evidence_revision_changed");
  }
  if (completed < snapshot.requiredItems.length) blockers.push("required_comparisons_incomplete");
  if (hasDifference) blockers.push("unresolved_difference");
  if (hasUnknown) blockers.push("unverified_required_item");
  if (snapshot.gateId === "G1" && snapshot.enabledOutcomeMetrics.length === 0) blockers.push("no_trustworthy_outcome_metric");

  const uniqueBlockers = [...new Set(blockers)];
  const canApprove = uniqueBlockers.length === 0 && snapshot.requiredItems.length > 0;
  let status: GateStatus;
  if (snapshot.collecting) status = "collecting";
  else if (snapshot.approvedEvidenceRevision === snapshot.evidenceRevision && canApprove) status = "approved";
  else if (uniqueBlockers.includes("dependency_not_approved")) status = "blocked";
  else if (uniqueBlockers.includes("evidence_revision_changed")) status = "stale";
  else if (hasDifference || hasUnknown || !snapshot.automatedEvidencePassed) status = "needs_attention";
  else if (Object.keys(snapshot.responses).length > 0 || snapshot.requiredItems.length > 0) status = "ready_for_review";
  else status = "not_started";

  return { status, completed, total: snapshot.requiredItems.length, canApprove, blockers: uniqueBlockers };
}
