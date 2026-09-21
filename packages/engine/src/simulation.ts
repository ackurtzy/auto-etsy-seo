import {
  evaluateRandomizedExperiment,
  createEvidenceManifest,
  PRODUCTION_METHOD_PROFILE,
  sha256,
  type ExperimentSpecInput,
} from "./index.ts";
import { freezeExperimentSpecWithAssignment } from "./spec.ts";

export interface FixedPopulationScenario {
  scenarioId: string;
  seed: string;
  repetitions: number;
  alpha: number;
  practicalEffect: number;
  planningEffect: number;
  listingCounts: number[];
  baselineTotals: number[];
  controlOutcomes: number[];
  treatmentOutcomes: number[];
  evaluatePower: boolean;
  features?: string[];
}

export interface ScenarioResult {
  scenarioId: string;
  repetitions: number;
  trueEffectPerListingDay: number;
  nullRejectionRate: number | null;
  intervalSupported: boolean;
  intervalUndercoverageRate: number | null;
  powerSuccessRate: number | null;
  powerLower95: number | null;
  diagnosticCeiling: number;
  passed: boolean;
  failures: string[];
}

export interface ExhaustiveSharpNullResult {
  clusters: number;
  assignmentCount: number;
  rejectionRate: number;
  alpha: number;
  passed: boolean;
}

function balancedIndexSets(count: number): number[][] {
  const result: number[][] = [];
  const build = (start: number, selected: number[]): void => {
    if (selected.length === count / 2) {
      result.push([...selected]);
      return;
    }
    for (let index = start; index <= count - (count / 2 - selected.length); index += 1) {
      selected.push(index);
      build(index + 1, selected);
      selected.pop();
    }
  };
  build(0, []);
  return result;
}

export function exhaustiveSharpNullDiagnostic(adjustedOutcomes: number[], alpha: number): ExhaustiveSharpNullResult {
  const count = adjustedOutcomes.length;
  if (count < 2 || count % 2 !== 0 || adjustedOutcomes.some((value) => !Number.isFinite(value))) {
    throw new Error("sharp-null diagnostic requires finite outcomes for an even cluster count");
  }
  const assignments = balancedIndexSets(count);
  const armSize = count / 2;
  const absoluteStatistics = assignments.map((indices) => {
    const treated = new Set(indices);
    let treatmentTotal = 0;
    let controlTotal = 0;
    adjustedOutcomes.forEach((value, index) => {
      if (treated.has(index)) treatmentTotal += value;
      else controlTotal += value;
    });
    return Math.abs(treatmentTotal / armSize - controlTotal / armSize);
  });
  const sorted = [...absoluteStatistics].sort((left, right) => left - right);
  const lowerBound = (target: number): number => {
    let low = 0;
    let high = sorted.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      const value = sorted[middle];
      if (value === undefined) throw new Error("sorted statistic missing");
      if (value + 1e-12 < target) low = middle + 1;
      else high = middle;
    }
    return low;
  };
  const rejections = absoluteStatistics.filter((statistic) => (sorted.length - lowerBound(statistic)) / sorted.length <= alpha).length;
  const rejectionRate = rejections / assignments.length;
  return { clusters: count, assignmentCount: assignments.length, rejectionRate, alpha, passed: rejectionRate <= alpha + 1e-12 };
}

function seedToUint32(seed: string): number {
  return Number.parseInt(sha256(seed).slice(0, 8), 16) >>> 0;
}

function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function wilsonLowerBound(successes: number, trials: number, z = 1.6448536269514722): number {
  if (!Number.isInteger(successes) || !Number.isInteger(trials) || successes < 0 || successes > trials || trials <= 0) {
    throw new Error("invalid binomial counts");
  }
  const proportion = successes / trials;
  const denominator = 1 + z ** 2 / trials;
  const center = proportion + z ** 2 / (2 * trials);
  const margin = z * Math.sqrt((proportion * (1 - proportion) + z ** 2 / (4 * trials)) / trials);
  return Math.max(0, (center - margin) / denominator);
}

function inputForScenario(scenario: FixedPopulationScenario): ExperimentSpecInput {
  const clusterRoster = scenario.listingCounts.map((listingCount, index) => ({
    clusterId: `c${index}`,
    listingIds: Array.from({ length: listingCount }, (_, listingIndex) => `c${index}-l${listingIndex}`),
  }));
  return {
    schemaVersion: "experiment-spec-v1",
    hypothesis: `Predeclared simulation ${scenario.scenarioId}`,
    evidenceTier: "randomized_policy",
    clusterRoster,
    candidateHashes: Object.fromEntries(clusterRoster.map((cluster, index) => [cluster.clusterId, index.toString(16).padStart(64, "0")])),
    controlPolicy: "unchanged",
    primaryMetric: "synthetic_additive_outcome",
    methodProfileId: "balanced-cluster-v1",
    practicalEffect: scenario.practicalEffect,
    planningEffect: scenario.planningEffect,
    baselineWindow: { start: "2026-01-01T00:00:00Z", end: "2026-01-02T00:00:00Z", exposureDays: 1 },
    measurementWindow: { start: "2026-02-01T00:00:00Z", end: "2026-02-02T00:00:00Z", exposureDays: 1 },
    allocationSeed: scenario.seed,
    alpha: scenario.alpha,
    errorBudgetFamily: "phase2-release-validation-v1",
    guardrails: ["synthetic_complete_coverage"],
    contaminationRules: ["none_synthetic"],
    deploymentDeadline: "2026-01-31T00:00:00Z",
    authorityCaps: { mode: "human_review_only", expiresAt: "2026-02-03T00:00:00Z" },
    permittedConclusions: ["evidence_of_change", "inconclusive", "invalid_data", "protocol_deviation", "safety_stopped"],
    maturityWaitHours: 0,
    evidenceRequirements: ["synthetic_complete"],
  };
}

export function runFixedPopulationScenario(scenario: FixedPopulationScenario): ScenarioResult {
  const count = scenario.listingCounts.length;
  if (count < 8 || count % 2 !== 0) throw new Error("release scenarios require an even cluster count of at least eight");
  for (const values of [scenario.baselineTotals, scenario.controlOutcomes, scenario.treatmentOutcomes]) {
    if (values.length !== count || values.some((value) => !Number.isFinite(value) || value < 0)) throw new Error("scenario potential outcomes are invalid");
  }
  const input = inputForScenario(scenario);
  const allocations = balancedIndexSets(count);
  const totalListings = scenario.listingCounts.reduce((total, value) => total + value, 0);
  const trueEffect = scenario.treatmentOutcomes.reduce(
    (total, value, index) => total + value - (scenario.controlOutcomes[index] ?? 0),
    0,
  ) / totalListings;
  const outcomes = allocations.map((treatedIndices) => {
    const treated = new Set(treatedIndices);
    const assignment = Object.fromEntries(
      Array.from({ length: count }, (_, index) => [`c${index}`, treated.has(index) ? "treatment" as const : "control" as const]),
    );
    const spec = freezeExperimentSpecWithAssignment(input, assignment);
    const evidence = createEvidenceManifest({
      specHash: spec.specHash,
      methodProfileId: PRODUCTION_METHOD_PROFILE.profileId,
      sourceRevisionHashes: [sha256(`${scenario.scenarioId}\0${treatedIndices.join(",")}`)],
      complete: true,
      maturitySatisfied: true,
      generatedAt: "2026-09-20T00:00:00Z",
    });
    return evaluateRandomizedExperiment(
      spec,
      Array.from({ length: count }, (_, index) => ({
        clusterId: `c${index}`,
        baselineTotal: scenario.baselineTotals[index] ?? 0,
        outcomeTotal: treated.has(index) ? (scenario.treatmentOutcomes[index] ?? 0) : (scenario.controlOutcomes[index] ?? 0),
        baselineComplete: true,
        outcomeComplete: true,
      })),
      PRODUCTION_METHOD_PROFILE,
      evidence,
    );
  });
  const random = mulberry32(seedToUint32(scenario.seed));
  let rejections = 0;
  let intervalMisses = 0;
  let powerSuccesses = 0;
  for (let repetition = 0; repetition < scenario.repetitions; repetition += 1) {
    const result = outcomes[Math.floor(random() * outcomes.length)];
    if (!result) throw new Error("simulation allocation missing");
    if (result.sharpNull.pValue <= scenario.alpha) rejections += 1;
    if (
      result.averageEffectInterval.status !== "available"
      || result.averageEffectInterval.lower > trueEffect
      || result.averageEffectInterval.upper < trueEffect
    ) intervalMisses += 1;
    if (
      scenario.evaluatePower
      && result.sharpNull.pValue <= scenario.alpha
      && result.averageEffectInterval.status === "available"
      && result.averageEffectInterval.lower > scenario.practicalEffect
    ) powerSuccesses += 1;
  }
  const nullScenario = scenario.treatmentOutcomes.every((value, index) => value === scenario.controlOutcomes[index]);
  const diagnosticCeiling = scenario.alpha + 3 * Math.sqrt((scenario.alpha * (1 - scenario.alpha)) / scenario.repetitions);
  const rejectionRate = nullScenario ? rejections / scenario.repetitions : null;
  const failures: string[] = [];
  const intervalSupported = outcomes.every((result) => result.averageEffectInterval.status === "available");
  const consistentlyUnsupported = outcomes.every((result) => result.averageEffectInterval.status === "unavailable_profile");
  if (!intervalSupported && !consistentlyUnsupported) failures.push("interval_profile_varies_by_assignment");
  const undercoverage = intervalSupported ? intervalMisses / scenario.repetitions : null;
  const powerRate = scenario.evaluatePower ? powerSuccesses / scenario.repetitions : null;
  const powerLower = scenario.evaluatePower ? wilsonLowerBound(powerSuccesses, scenario.repetitions) : null;
  if (rejectionRate !== null && rejectionRate > diagnosticCeiling) failures.push("null_rejection_exceeds_diagnostic_ceiling");
  if (undercoverage !== null && undercoverage > diagnosticCeiling) failures.push("interval_undercoverage_exceeds_diagnostic_ceiling");
  if (powerLower !== null && powerLower < 0.8) failures.push("power_lower_bound_below_0.80");
  return {
    scenarioId: scenario.scenarioId,
    repetitions: scenario.repetitions,
    trueEffectPerListingDay: trueEffect,
    nullRejectionRate: rejectionRate,
    intervalSupported,
    intervalUndercoverageRate: undercoverage,
    powerSuccessRate: powerRate,
    powerLower95: powerLower,
    diagnosticCeiling,
    passed: failures.length === 0,
    failures,
  };
}
