import assert from "node:assert/strict";
import test from "node:test";

import { parseEvaluationResult, parseFrozenExperimentSpec } from "../../contracts/src/index.ts";

import {
  attainableResolution,
  createEvidenceManifest,
  directionalStudyResult,
  evaluateRandomizedExperiment,
  freezeExperimentSpec,
  PRODUCTION_METHOD_PROFILE,
  sha256,
  studentTCritical,
  type ClusterObservation,
  type ExperimentSpecInput,
} from "../src/index.ts";
import { freezeExperimentSpecWithAssignment } from "../src/spec.ts";

const baseSpec: ExperimentSpecInput = {
  schemaVersion: "experiment-spec-v1",
  hypothesis: "A frozen title policy changes paid units per scheduled listing-day.",
  evidenceTier: "randomized_policy",
  clusterRoster: [
    { clusterId: "a", listingIds: ["1"] },
    { clusterId: "b", listingIds: ["2", "3", "4"] },
    { clusterId: "c", listingIds: ["5", "6"] },
    { clusterId: "d", listingIds: ["7", "8", "9", "10"] },
  ],
  candidateHashes: { a: "a".repeat(64), b: "b".repeat(64), c: "c".repeat(64), d: "d".repeat(64) },
  controlPolicy: "unchanged",
  primaryMetric: "paid_units",
  methodProfileId: "balanced-cluster-v1",
  practicalEffect: 0.25,
  planningEffect: 0.5,
  baselineWindow: { start: "2026-01-01T00:00:00Z", end: "2026-01-02T00:00:00Z", exposureDays: 1 },
  measurementWindow: { start: "2026-02-01T00:00:00Z", end: "2026-02-02T00:00:00Z", exposureDays: 1 },
  allocationSeed: "fixture-seed",
  alpha: 0.05,
  errorBudgetFamily: "manual-single-primary-v1",
  guardrails: ["complete_receipt_coverage"],
  contaminationRules: ["no_differential_promotions"],
  deploymentDeadline: "2026-01-31T23:00:00Z",
  authorityCaps: { mode: "human_review_only", expiresAt: "2026-02-03T00:00:00Z" },
  permittedConclusions: ["evidence_of_change", "inconclusive", "invalid_data", "protocol_deviation", "safety_stopped"],
  maturityWaitHours: 48,
  evidenceRequirements: ["complete_baseline", "complete_primary_outcome"],
};

const evidenceFor = (specHash: string) => createEvidenceManifest({
  specHash,
  methodProfileId: "balanced-cluster-v1",
  sourceRevisionHashes: ["1".repeat(64), "2".repeat(64)],
  complete: true,
  maturitySatisfied: true,
  generatedAt: "2026-03-01T00:00:00Z",
});

test("balanced assignment resolution rejects six clusters and distinguishes eight", () => {
  assert.deepEqual(attainableResolution(6, 0.05), {
    assignmentCount: 20,
    optimisticMinimumTwoSidedP: 0.1,
    attainable: false,
  });
  const eight = attainableResolution(8, 0.05);
  assert.equal(eight.assignmentCount, 70);
  assert.equal(eight.attainable, true);
  assert.ok(Math.abs(eight.optimisticMinimumTwoSidedP - 2 / 70) < 1e-12);
});

test("odd cluster rosters are rejected instead of silently dropping a cluster", () => {
  const clusterRoster = Array.from({ length: 7 }, (_, index) => ({ clusterId: `c${index}`, listingIds: [`l${index}`] }));
  assert.throws(() => freezeExperimentSpec({
    ...baseSpec,
    clusterRoster,
    candidateHashes: Object.fromEntries(clusterRoster.map((cluster, index) => [cluster.clusterId, index.toString(16).padStart(64, "0")])),
  }), /even size/);
});

test("freezing is deterministic and binds exact proposals and assignment", () => {
  const first = freezeExperimentSpec(baseSpec);
  const second = freezeExperimentSpec(baseSpec);
  assert.equal(first.specHash, second.specHash);
  assert.deepEqual(first.assignment, second.assignment);
  assert.equal(Object.values(first.assignment).filter((arm) => arm === "treatment").length, 2);
});

test("listing-weighted estimator handles unequal cluster sizes", () => {
  const frozen = freezeExperimentSpecWithAssignment(baseSpec, { a: "treatment", b: "treatment", c: "control", d: "control" });
  const observations: ClusterObservation[] = [
    { clusterId: "a", baselineTotal: 10, outcomeTotal: 12, baselineComplete: true, outcomeComplete: true },
    { clusterId: "b", baselineTotal: 30, outcomeTotal: 33, baselineComplete: true, outcomeComplete: true },
    { clusterId: "c", baselineTotal: 20, outcomeTotal: 19, baselineComplete: true, outcomeComplete: true },
    { clusterId: "d", baselineTotal: 40, outcomeTotal: 38, baselineComplete: true, outcomeComplete: true },
  ];
  const result = evaluateRandomizedExperiment(frozen, observations, PRODUCTION_METHOD_PROFILE, evidenceFor(frozen.specHash));
  assert.equal(result.estimatePerListingDay, 1.6);
  assert.equal(result.sharpNull.method, "exact_enumeration");
  assert.equal(result.sharpNull.assignmentCount, 6);
});

test("ties are included in the exact sharp-null p-value", () => {
  const frozen = freezeExperimentSpecWithAssignment(baseSpec, { a: "treatment", b: "treatment", c: "control", d: "control" });
  const observations = ["a", "b", "c", "d"].map((clusterId) => ({
    clusterId,
    baselineTotal: 5,
    outcomeTotal: 5,
    baselineComplete: true,
    outcomeComplete: true,
  }));
  const result = evaluateRandomizedExperiment(frozen, observations, PRODUCTION_METHOD_PROFILE, evidenceFor(frozen.specHash));
  assert.equal(result.sharpNull.pValue, 1);
  assert.equal(result.averageEffectInterval.status, "unavailable_degenerate_variance");
});

test("missing outcomes invalidate inference instead of becoming zero", () => {
  const frozen = freezeExperimentSpec(baseSpec);
  const observations = ["a", "b", "c", "d"].map((clusterId) => ({
    clusterId,
    baselineTotal: 5,
    outcomeTotal: 5,
    baselineComplete: true,
    outcomeComplete: clusterId !== "d",
  }));
  assert.throws(() => evaluateRandomizedExperiment(frozen, observations, PRODUCTION_METHOD_PROFILE, evidenceFor(frozen.specHash)), /incomplete outcome coverage/);
});

test("directional studies never emit causal inference", () => {
  assert.deepEqual(directionalStudyResult(10, 14, 7), {
    workflow: "directional_change_study",
    observedDifference: 4,
    differencePerScheduledDay: 4 / 7,
    causalClaim: false,
    statisticalInference: null,
    decisionAuthority: "human_only",
  });
});

test("Welch interval uses validated Student t critical values", () => {
  assert.ok(Math.abs(studentTCritical(0.975, 1) - 12.706204736) < 1e-6);
  assert.ok(Math.abs(studentTCritical(0.975, 10) - 2.228138852) < 1e-6);
});

test("an altered frozen specification is rejected", () => {
  const frozen = freezeExperimentSpec(baseSpec);
  const altered = { ...frozen, practicalEffect: frozen.practicalEffect + 1 };
  const observations = ["a", "b", "c", "d"].map((clusterId) => ({
    clusterId,
    baselineTotal: 5,
    outcomeTotal: 6,
    baselineComplete: true,
    outcomeComplete: true,
  }));
  assert.throws(() => evaluateRandomizedExperiment(altered, observations, PRODUCTION_METHOD_PROFILE, evidenceFor(frozen.specHash)), /HASH_MISMATCH/);
});

test("a self-hashed impossible assignment is rejected before inference", () => {
  const valid = freezeExperimentSpec({
    ...baseSpec,
    clusterRoster: Array.from({ length: 8 }, (_, index) => ({ clusterId: `c${index}`, listingIds: [`l${index}`] })),
    candidateHashes: Object.fromEntries(Array.from({ length: 8 }, (_, index) => [`c${index}`, index.toString(16).padStart(64, "0")])),
  });
  const { specHash: _ignored, ...withoutHash } = valid;
  const forgedWithoutHash = {
    ...withoutHash,
    assignment: Object.fromEntries(Object.keys(valid.assignment).map((clusterId) => [clusterId, "treatment" as const])),
  };
  const forged = { ...forgedWithoutHash, specHash: sha256(forgedWithoutHash) };
  const observations = forged.clusterRoster.map((cluster, index) => ({
    clusterId: cluster.clusterId,
    baselineTotal: 10,
    outcomeTotal: 10 + index,
    baselineComplete: true,
    outcomeComplete: true,
  }));
  assert.throws(
    () => evaluateRandomizedExperiment(forged, observations, PRODUCTION_METHOD_PROFILE, evidenceFor(forged.specHash)),
    /assignment/i,
  );

  const forgeAssignment = (assignment: Record<string, unknown>): unknown => {
    const { specHash: _hash, ...content } = valid;
    const forgedContent = { ...content, assignment };
    return { ...forgedContent, specHash: sha256(forgedContent) };
  };
  const missing = { ...valid.assignment } as Record<string, unknown>;
  delete missing.c0;
  assert.throws(() => parseFrozenExperimentSpec(forgeAssignment(missing)), /ASSIGNMENT_KEYS_MISMATCH/);
  assert.throws(
    () => parseFrozenExperimentSpec(forgeAssignment({ ...valid.assignment, c0: "candidate" })),
    /SCHEMA_INVALID/,
  );
  assert.throws(
    () => parseFrozenExperimentSpec(forgeAssignment({ ...valid.assignment, unexpected: "control" })),
    /ASSIGNMENT_KEYS_MISMATCH/,
  );
});

test("supported eight-cluster profile reports an average-effect interval", () => {
  const clusterRoster = Array.from({ length: 8 }, (_, index) => ({ clusterId: `c${index}`, listingIds: [`l${index}`] }));
  const spec = freezeExperimentSpec({
    ...baseSpec,
    clusterRoster,
    candidateHashes: Object.fromEntries(clusterRoster.map((cluster, index) => [cluster.clusterId, index.toString(16).padStart(64, "0")])),
  });
  const observations = clusterRoster.map((cluster, index) => ({
    clusterId: cluster.clusterId,
    baselineTotal: 10 + (index % 3),
    outcomeTotal: 9 + index,
    baselineComplete: true,
    outcomeComplete: true,
  }));
  const result = evaluateRandomizedExperiment(spec, observations, PRODUCTION_METHOD_PROFILE, evidenceFor(spec.specHash));
  assert.equal(result.averageEffectInterval.status, "available");
  assert.equal(result.sharpNull.assignmentCount, 70);
});

test("sparse pre-treatment outcomes disable the average-effect interval profile", () => {
  const clusterRoster = Array.from({ length: 8 }, (_, index) => ({ clusterId: `c${index}`, listingIds: [`l${index}`] }));
  const spec = freezeExperimentSpec({
    ...baseSpec,
    clusterRoster,
    candidateHashes: Object.fromEntries(clusterRoster.map((cluster, index) => [cluster.clusterId, index.toString(16).padStart(64, "0")])),
  });
  const observations = clusterRoster.map((cluster, index) => ({
    clusterId: cluster.clusterId,
    baselineTotal: 1 + (index % 4),
    outcomeTotal: 2 + index,
    baselineComplete: true,
    outcomeComplete: true,
  }));
  const result = evaluateRandomizedExperiment(spec, observations, PRODUCTION_METHOD_PROFILE, evidenceFor(spec.specHash));
  assert.deepEqual(result.averageEffectInterval, { status: "unavailable_profile" });
  assert.ok(result.eligibility.reasons.includes("average_effect_interval_unavailable"));
});

test("eligibility rejects zero baselines, dominant clusters, and unattainable allocated alpha", () => {
  const clusterRoster = Array.from({ length: 8 }, (_, index) => ({ clusterId: `c${index}`, listingIds: [`l${index}`] }));
  const input = {
    ...baseSpec,
    alpha: 0.01,
    clusterRoster,
    candidateHashes: Object.fromEntries(clusterRoster.map((cluster, index) => [cluster.clusterId, index.toString(16).padStart(64, "0")])),
  } satisfies ExperimentSpecInput;
  const zeroSpec = freezeExperimentSpec(input);
  const zero = evaluateRandomizedExperiment(
    zeroSpec,
    clusterRoster.map((cluster, index) => ({ clusterId: cluster.clusterId, baselineTotal: 0, outcomeTotal: index, baselineComplete: true, outcomeComplete: true })),
    PRODUCTION_METHOD_PROFILE,
    evidenceFor(zeroSpec.specHash),
  );
  assert.ok(zero.eligibility.reasons.includes("zero_baseline_requires_absolute_threshold_and_separate_profile_review"));
  assert.ok(zero.eligibility.reasons.includes("unattainable_two_sided_p_value_resolution"));

  const dominantSpec = freezeExperimentSpec({ ...input, alpha: 0.05 });
  const dominant = evaluateRandomizedExperiment(
    dominantSpec,
    clusterRoster.map((cluster, index) => ({ clusterId: cluster.clusterId, baselineTotal: index === 0 ? 100 : 5, outcomeTotal: 20 + index, baselineComplete: true, outcomeComplete: true })),
    PRODUCTION_METHOD_PROFILE,
    evidenceFor(dominantSpec.specHash),
  );
  assert.ok(dominant.eligibility.reasons.includes("baseline_concentration_exceeds_profile"));
});

test("duplicate cluster rows cannot inflate independent unit count", () => {
  const frozen = freezeExperimentSpec(baseSpec);
  const observations = ["a", "b", "c", "c"].map((clusterId) => ({
    clusterId,
    baselineTotal: 5,
    outcomeTotal: 6,
    baselineComplete: true,
    outcomeComplete: true,
  }));
  assert.throws(() => evaluateRandomizedExperiment(frozen, observations, PRODUCTION_METHOD_PROFILE, evidenceFor(frozen.specHash)), /each frozen cluster exactly once/);
});

test("an unavailable method profile cannot evaluate a frozen specification", () => {
  const frozen = freezeExperimentSpec(baseSpec);
  const observations = ["a", "b", "c", "d"].map((clusterId) => ({
    clusterId,
    baselineTotal: 5,
    outcomeTotal: 6,
    baselineComplete: true,
    outcomeComplete: true,
  }));
  assert.throws(
    () => evaluateRandomizedExperiment(frozen, observations, { ...PRODUCTION_METHOD_PROFILE, profileId: "missing" as never }, evidenceFor(frozen.specHash)),
    /MethodProfile.*SCHEMA_INVALID/,
  );
});

test("Monte Carlo inference is reproducible and cannot return zero", () => {
  const clusterRoster = Array.from({ length: 24 }, (_, index) => ({ clusterId: `c${index}`, listingIds: [`l${index}`] }));
  const spec = freezeExperimentSpec({
    ...baseSpec,
    clusterRoster,
    candidateHashes: Object.fromEntries(clusterRoster.map((cluster, index) => [cluster.clusterId, index.toString(16).padStart(64, "0")])),
  });
  const observations = clusterRoster.map((cluster, index) => ({
    clusterId: cluster.clusterId,
    baselineTotal: 20 + (index % 5),
    outcomeTotal: 20 + index,
    baselineComplete: true,
    outcomeComplete: true,
  }));
  const testProfile = PRODUCTION_METHOD_PROFILE;
  const evidence = evidenceFor(spec.specHash);
  const first = evaluateRandomizedExperiment(spec, observations, testProfile, evidence);
  const second = evaluateRandomizedExperiment(spec, observations, testProfile, evidence);
  assert.equal(first.sharpNull.method, "monte_carlo");
  assert.equal(first.sharpNull.pValue, second.sharpNull.pValue);
  assert.ok(first.sharpNull.pValue >= 1 / 100_000);
});

test("evidence manifests are canonical and material changes invalidate them", () => {
  const frozen = freezeExperimentSpec(baseSpec);
  const first = evidenceFor(frozen.specHash);
  const second = createEvidenceManifest({
    ...first,
    sourceRevisionHashes: [...first.sourceRevisionHashes].reverse(),
  });
  assert.equal(first.manifestHash, second.manifestHash);
  const altered = { ...first, complete: false };
  const observations = ["a", "b", "c", "d"].map((clusterId) => ({
    clusterId,
    baselineTotal: 5,
    outcomeTotal: 6,
    baselineComplete: true,
    outcomeComplete: true,
  }));
  assert.throws(() => evaluateRandomizedExperiment(frozen, observations, PRODUCTION_METHOD_PROFILE, altered), /HASH_MISMATCH/);
});

test("runtime contract parsers accept serialized valid values and reject malformed nested results", () => {
  const frozen = freezeExperimentSpec(baseSpec);
  assert.deepEqual(parseFrozenExperimentSpec(JSON.parse(JSON.stringify(frozen))), frozen);
  const observations = ["a", "b", "c", "d"].map((clusterId) => ({
    clusterId,
    baselineTotal: 5,
    outcomeTotal: 6,
    baselineComplete: true,
    outcomeComplete: true,
  }));
  const result = evaluateRandomizedExperiment(frozen, observations, PRODUCTION_METHOD_PROFILE, evidenceFor(frozen.specHash));
  assert.deepEqual(parseEvaluationResult(JSON.parse(JSON.stringify(result))), result);
  assert.throws(
    () => parseEvaluationResult({ ...result, sharpNull: {} }),
    /EvaluationResult.*SCHEMA_INVALID/,
  );
  assert.throws(
    () => parseEvaluationResult({ ...result, averageEffectInterval: { status: "available" } }),
    /EvaluationResult.*SCHEMA_INVALID/,
  );
});
