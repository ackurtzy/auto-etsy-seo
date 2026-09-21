import { readFileSync } from "node:fs";

import {
  evaluateRandomizedExperiment,
  createEvidenceManifest,
  PRODUCTION_METHOD_PROFILE,
  type ExperimentSpecInput,
} from "../../packages/engine/src/index.ts";
import { freezeExperimentSpecWithAssignment } from "../../packages/engine/src/spec.ts";

interface ReferenceCase {
  case_id: string;
  alpha: number;
  baseline_days: number;
  outcome_days: number;
  allocation_seed: string;
  clusters: Array<{
    cluster_id: string;
    listing_count: number;
    arm: "treatment" | "control";
    baseline_total: number;
    outcome_total: number;
  }>;
}

const fixtureUrl = new URL("./fixtures/reference-cases.json", import.meta.url);
const fixture = JSON.parse(readFileSync(fixtureUrl, "utf8")) as { cases: ReferenceCase[] };

const results = fixture.cases.map((item) => {
  const clusterRoster = item.clusters.map((cluster) => ({
    clusterId: cluster.cluster_id,
    listingIds: Array.from({ length: cluster.listing_count }, (_, index) => `${cluster.cluster_id}-${index}`),
  }));
  const input: ExperimentSpecInput = {
    schemaVersion: "experiment-spec-v1",
    hypothesis: "Reference fixture",
    evidenceTier: "randomized_policy",
    clusterRoster,
    candidateHashes: Object.fromEntries(clusterRoster.map((cluster) => [cluster.clusterId, cluster.clusterId.charCodeAt(0).toString(16).padStart(64, "0")])),
    controlPolicy: "unchanged",
    primaryMetric: "paid_units",
    methodProfileId: "balanced-cluster-v1",
    practicalEffect: 0.1,
    planningEffect: 0.2,
    baselineWindow: { start: "2026-01-01T00:00:00Z", end: "2026-01-02T00:00:00Z", exposureDays: item.baseline_days },
    measurementWindow: { start: "2026-02-01T00:00:00Z", end: "2026-02-02T00:00:00Z", exposureDays: item.outcome_days },
    allocationSeed: item.allocation_seed,
    alpha: item.alpha,
    errorBudgetFamily: "fixture",
    guardrails: [],
    contaminationRules: [],
    deploymentDeadline: "2026-01-31T00:00:00Z",
    authorityCaps: { mode: "human_review_only", expiresAt: "2026-02-03T00:00:00Z" },
    permittedConclusions: ["evidence_of_change", "inconclusive", "invalid_data", "protocol_deviation", "safety_stopped"],
    maturityWaitHours: 0,
    evidenceRequirements: ["complete"],
  };
  const assignment = Object.fromEntries(item.clusters.map((cluster) => [cluster.cluster_id, cluster.arm]));
  const frozen = freezeExperimentSpecWithAssignment(input, assignment);
  const evidence = createEvidenceManifest({
    specHash: frozen.specHash,
    methodProfileId: PRODUCTION_METHOD_PROFILE.profileId,
    sourceRevisionHashes: ["f".repeat(64)],
    complete: true,
    maturitySatisfied: true,
    generatedAt: "2026-09-20T00:00:00Z",
  });
  const evaluated = evaluateRandomizedExperiment(
    frozen,
    item.clusters.map((cluster) => ({
      clusterId: cluster.cluster_id,
      baselineTotal: cluster.baseline_total,
      outcomeTotal: cluster.outcome_total,
      baselineComplete: true,
      outcomeComplete: true,
    })),
    PRODUCTION_METHOD_PROFILE,
    evidence,
  );
  return {
    case_id: item.case_id,
    estimate: evaluated.estimatePerListingDay,
    p_value: evaluated.sharpNull.pValue,
    assignment_count: evaluated.sharpNull.assignmentCount,
    interval: evaluated.averageEffectInterval,
  };
});

process.stdout.write(`${JSON.stringify({ schema_version: "phase2-reference-results-v1", results })}\n`);
