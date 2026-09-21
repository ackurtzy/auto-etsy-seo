import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveGateStatus,
  gateDefinitions,
  selectRepresentativeListings,
  selectRepresentativeReceipts,
  type GateReviewSnapshot,
} from "../src/index.ts";
import { resolveLocalOwnerActor } from "../../../apps/worker/src/local-auth.ts";

function snapshot(overrides: Partial<GateReviewSnapshot> = {}): GateReviewSnapshot {
  return {
    gateId: "G1",
    evidenceRevision: "evidence-v1",
    automatedEvidencePassed: true,
    dependenciesApproved: true,
    requiredItems: ["listing-1", "listing-2"],
    responses: {},
    enabledOutcomeMetrics: ["transaction_units"],
    ...overrides,
  };
}

test("G1 remains reviewable but not approvable until every required comparison is resolved", () => {
  const pending = deriveGateStatus(snapshot({
    responses: { "listing-1": { outcome: "matched", evidenceRevision: "evidence-v1" } },
  }));
  assert.equal(pending.status, "ready_for_review");
  assert.equal(pending.completed, 1);
  assert.equal(pending.total, 2);
  assert.equal(pending.canApprove, false);
  assert.ok(pending.blockers.includes("required_comparisons_incomplete"));

  const resolved = deriveGateStatus(snapshot({
    responses: {
      "listing-1": { outcome: "matched", evidenceRevision: "evidence-v1" },
      "listing-2": { outcome: "unavailable_disabled", evidenceRevision: "evidence-v1" },
    },
  }));
  assert.equal(resolved.canApprove, true);
  assert.equal(resolved.status, "ready_for_review");
});

test("G1 representative sampling is deterministic and covers extremes and risky receipts", () => {
  const listings = selectRepresentativeListings([
    { listingId: "3", state: "inactive", views: 20 },
    { listingId: "1", state: "active", views: 100 },
    { listingId: "2", state: "active", views: 1 },
    { listingId: "4", state: "sold_out", views: 10 },
  ], 4);
  assert.deepEqual(listings.map((item) => item.listingId), ["1", "2", "3", "4"]);

  const receipts = selectRepresentativeReceipts([
    { receiptId: "1", createdTimestamp: 3, wasCanceled: false, transactions: [{ quantity: 1 }], refunds: [] },
    { receiptId: "2", createdTimestamp: 1, wasCanceled: false, transactions: [{ quantity: 2 }, { quantity: 1 }], refunds: [] },
    { receiptId: "3", createdTimestamp: 2, wasCanceled: true, transactions: [{ quantity: 1 }], refunds: [{}] },
  ], 2);
  assert.deepEqual(receipts.map((item) => item.receiptId), ["2", "3"]);
});

test("stale evidence invalidates responses instead of silently retaining approval readiness", () => {
  const result = deriveGateStatus(snapshot({
    evidenceRevision: "evidence-v2",
    responses: {
      "listing-1": { outcome: "matched", evidenceRevision: "evidence-v1" },
      "listing-2": { outcome: "matched", evidenceRevision: "evidence-v1" },
    },
  }));
  assert.equal(result.status, "stale");
  assert.equal(result.completed, 0);
  assert.equal(result.canApprove, false);
  assert.ok(result.blockers.includes("evidence_revision_changed"));
});

test("a difference blocks approval until it is explained or its metric is disabled", () => {
  const result = deriveGateStatus(snapshot({
    responses: {
      "listing-1": { outcome: "matched", evidenceRevision: "evidence-v1" },
      "listing-2": { outcome: "differs", evidenceRevision: "evidence-v1" },
    },
  }));
  assert.equal(result.status, "needs_attention");
  assert.equal(result.canApprove, false);
  assert.ok(result.blockers.includes("unresolved_difference"));
});

test("G1 requires at least one trustworthy enabled outcome metric", () => {
  const result = deriveGateStatus(snapshot({
    enabledOutcomeMetrics: [],
    responses: {
      "listing-1": { outcome: "matched", evidenceRevision: "evidence-v1" },
      "listing-2": { outcome: "matched", evidenceRevision: "evidence-v1" },
    },
  }));
  assert.equal(result.canApprove, false);
  assert.ok(result.blockers.includes("no_trustworthy_outcome_metric"));
});

test("G2 and G3 remain dependency locked and preserve the title-only boundary", () => {
  const g2 = deriveGateStatus(snapshot({ gateId: "G2", dependenciesApproved: false }));
  assert.equal(g2.status, "blocked");
  assert.ok(g2.blockers.includes("dependency_not_approved"));

  assert.deepEqual(gateDefinitions.G3.enabledCapabilities, ["title_T3"]);
  assert.ok(gateDefinitions.G3.explicitlyDisabledCapabilities.includes("tags_T3"));
  assert.ok(gateDefinitions.G3.explicitlyDisabledCapabilities.includes("general_etsy_egress"));
});

test("local owner mode is limited to an explicit local environment and loopback host", () => {
  const env = { ENVIRONMENT: "local", LOCAL_OWNER_MODE: "true" };
  assert.equal(resolveLocalOwnerActor(env as never, new Request("http://127.0.0.1:8787/api/v1/session")), "local-owner");
  assert.equal(resolveLocalOwnerActor(env as never, new Request("http://localhost:8787/api/v1/session")), "local-owner");
  assert.equal(resolveLocalOwnerActor({ ...env, ENVIRONMENT: "staging" } as never, new Request("https://seo.adesignsdenver.com/api/v1/session")), null);
  assert.equal(resolveLocalOwnerActor(env as never, new Request("https://seo.adesignsdenver.com/api/v1/session")), null);
  assert.equal(resolveLocalOwnerActor({ ...env, LOCAL_OWNER_MODE: "false" } as never, new Request("http://127.0.0.1:8787/api/v1/session")), null);
});
