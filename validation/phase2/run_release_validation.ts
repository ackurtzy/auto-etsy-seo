import { performance } from "node:perf_hooks";
import { readFileSync } from "node:fs";

import {
  attainableResolution,
  createEvidenceManifest,
  evaluateRandomizedExperiment,
  freezeExperimentSpec,
  PRODUCTION_METHOD_PROFILE,
  type ExperimentSpecInput,
} from "../../packages/engine/src/index.ts";
import {
  exhaustiveSharpNullDiagnostic,
  runFixedPopulationScenario,
  type FixedPopulationScenario,
} from "../../packages/engine/src/simulation.ts";
import { parseSimulationScenario } from "../../packages/contracts/src/index.ts";

const scenarioFixture = JSON.parse(
  readFileSync(new URL("./fixtures/simulation-scenarios.json", import.meta.url), "utf8"),
) as { scenarios: unknown[] };
const scenarios: FixedPopulationScenario[] = scenarioFixture.scenarios.map(parseSimulationScenario);

function benchmarkMonteCarlo(): { clusters: number; simulations: number; elapsedMilliseconds: number; pValue: number } {
  const clusterRoster = Array.from({ length: 24 }, (_, index) => ({ clusterId: `c${index}`, listingIds: [`l${index}`] }));
  const input: ExperimentSpecInput = {
    schemaVersion: "experiment-spec-v1",
    hypothesis: "Production Monte Carlo benchmark",
    evidenceTier: "randomized_policy",
    clusterRoster,
    candidateHashes: Object.fromEntries(clusterRoster.map((cluster, index) => [cluster.clusterId, index.toString(16).padStart(64, "0")])),
    controlPolicy: "unchanged",
    primaryMetric: "synthetic_additive_outcome",
    methodProfileId: "balanced-cluster-v1",
    practicalEffect: 0.5,
    planningEffect: 2,
    baselineWindow: { start: "2026-01-01T00:00:00Z", end: "2026-01-02T00:00:00Z", exposureDays: 1 },
    measurementWindow: { start: "2026-02-01T00:00:00Z", end: "2026-02-02T00:00:00Z", exposureDays: 1 },
    allocationSeed: "phase2-production-monte-carlo-benchmark-v1",
    alpha: 0.05,
    errorBudgetFamily: "phase2-benchmark",
    guardrails: ["synthetic_complete"],
    contaminationRules: [],
    deploymentDeadline: "2026-01-31T00:00:00Z",
    authorityCaps: { mode: "human_review_only", expiresAt: "2026-02-03T00:00:00Z" },
    permittedConclusions: ["evidence_of_change", "inconclusive", "invalid_data", "protocol_deviation", "safety_stopped"],
    maturityWaitHours: 0,
    evidenceRequirements: ["synthetic_complete"],
  };
  const spec = freezeExperimentSpec(input);
  const evidence = createEvidenceManifest({
    specHash: spec.specHash,
    methodProfileId: PRODUCTION_METHOD_PROFILE.profileId,
    sourceRevisionHashes: ["e".repeat(64)],
    complete: true,
    maturitySatisfied: true,
    generatedAt: "2026-09-20T00:00:00Z",
  });
  const started = performance.now();
  const result = evaluateRandomizedExperiment(
    spec,
    clusterRoster.map((cluster, index) => ({
      clusterId: cluster.clusterId,
      baselineTotal: 20 + (index % 4),
      outcomeTotal: 20 + index,
      baselineComplete: true,
      outcomeComplete: true,
    })),
    PRODUCTION_METHOD_PROFILE,
    evidence,
  );
  return {
    clusters: 24,
    simulations: PRODUCTION_METHOD_PROFILE.monteCarloSamples,
    elapsedMilliseconds: Math.round((performance.now() - started) * 100) / 100,
    pValue: result.sharpNull.pValue,
  };
}

const scenarioResults = scenarios.map(runFixedPopulationScenario);
const output = {
  schema_version: "phase2-release-validation-v1",
  method_profile: PRODUCTION_METHOD_PROFILE,
  resolution_table: [6, 8, 10, 12, 20].map((clusters) => ({ clusters, ...attainableResolution(clusters, 0.05) })),
  exhaustive_sharp_null: [6, 8, 10, 12].map((clusters) => exhaustiveSharpNullDiagnostic(
    Array.from({ length: clusters }, (_, index) => (index + 1) ** 2 % 17),
    0.05,
  )),
  scenarios: scenarioResults,
  monte_carlo_benchmark: benchmarkMonteCarlo(),
  passed: scenarioResults.every((result) => result.passed),
};
process.stdout.write(`${JSON.stringify(output)}\n`);
