import { createHash } from "node:crypto";

import {
  type EvaluationResult,
  type EvidenceManifest,
  type ExperimentArm,
  type ExperimentSpecInput,
  type FrozenExperimentSpec,
  type MethodProfile,
  validateExperimentSpecInput,
} from "../../contracts/src/index.ts";

export type { EvaluationResult, EvidenceManifest, ExperimentSpecInput, FrozenExperimentSpec, MethodProfile } from "../../contracts/src/index.ts";

export interface ClusterObservation {
  clusterId: string;
  baselineTotal: number;
  outcomeTotal: number;
  baselineComplete: boolean;
  outcomeComplete: boolean;
}

export const PRODUCTION_METHOD_PROFILE: MethodProfile = Object.freeze({
  schemaVersion: "method-profile-v1",
  profileId: "balanced-cluster-v1",
  minimumClusters: 8,
  maximumBaselineConcentration: 0.2,
  enumerationLimit: 200_000,
  monteCarloSamples: 99_999,
  intervalMinimumClusters: 8,
  intervalMinimumBaselineOutcomePerCluster: 5,
});

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalValue(item)]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

export function sha256(value: unknown): string {
  return createHash("sha256").update(typeof value === "string" ? value : canonicalJson(value)).digest("hex");
}

export function createEvidenceManifest(input: {
  specHash: string;
  methodProfileId: string;
  sourceRevisionHashes: string[];
  complete: boolean;
  maturitySatisfied: boolean;
  generatedAt: string;
}): EvidenceManifest {
  if (!/^[a-f0-9]{64}$/.test(input.specHash)) throw new Error("evidence spec hash must be SHA-256");
  if (!input.methodProfileId) throw new Error("evidence method profile is required");
  if (Number.isNaN(Date.parse(input.generatedAt))) throw new Error("evidence generation time must be an ISO timestamp");
  if (input.sourceRevisionHashes.length === 0 || input.sourceRevisionHashes.some((hash) => !/^[a-f0-9]{64}$/.test(hash))) {
    throw new Error("evidence source revisions must be SHA-256 values");
  }
  const uniqueHashes = [...new Set(input.sourceRevisionHashes)].sort();
  if (uniqueHashes.length !== input.sourceRevisionHashes.length) throw new Error("evidence source revisions must be unique");
  const withoutHash = {
    schemaVersion: "evidence-manifest-v1" as const,
    specHash: input.specHash,
    methodProfileId: input.methodProfileId,
    sourceRevisionHashes: uniqueHashes,
    complete: input.complete,
    maturitySatisfied: input.maturitySatisfied,
    generatedAt: input.generatedAt,
  };
  return Object.freeze({ ...withoutHash, manifestHash: sha256(withoutHash) });
}

function choose(n: number, k: number): number {
  if (!Number.isInteger(n) || !Number.isInteger(k) || n < 0 || k < 0 || k > n) return 0;
  const smaller = Math.min(k, n - k);
  let result = 1;
  for (let index = 1; index <= smaller; index += 1) result = (result * (n - smaller + index)) / index;
  return Math.round(result);
}

export function attainableResolution(clusterCount: number, alpha: number): {
  assignmentCount: number;
  optimisticMinimumTwoSidedP: number;
  attainable: boolean;
} {
  if (!Number.isInteger(clusterCount) || clusterCount < 2 || clusterCount % 2 !== 0) throw new Error("cluster count must be an even integer");
  const assignmentCount = choose(clusterCount, clusterCount / 2);
  const optimisticMinimumTwoSidedP = Math.min(1, 2 / assignmentCount);
  return { assignmentCount, optimisticMinimumTwoSidedP, attainable: optimisticMinimumTwoSidedP <= alpha };
}

function deterministicAssignment(clusterIds: string[], seed: string): Record<string, ExperimentArm> {
  const ordered = clusterIds
    .map((clusterId) => ({ clusterId, rank: sha256(`${seed}\0${clusterId}`) }))
    .sort((left, right) => left.rank.localeCompare(right.rank) || left.clusterId.localeCompare(right.clusterId));
  const treatment = new Set(ordered.slice(0, clusterIds.length / 2).map((item) => item.clusterId));
  return Object.fromEntries([...clusterIds].sort().map((clusterId) => [clusterId, treatment.has(clusterId) ? "treatment" : "control"]));
}

function validateAssignment(clusterIds: string[], assignment: Record<string, ExperimentArm>): void {
  const expected = [...clusterIds].sort();
  const actual = Object.keys(assignment).sort();
  if (canonicalJson(expected) !== canonicalJson(actual)) throw new Error("assignment must contain every frozen cluster exactly once");
  const treated = Object.values(assignment).filter((arm) => arm === "treatment").length;
  const controls = Object.values(assignment).filter((arm) => arm === "control").length;
  if (treated !== controls || treated + controls !== clusterIds.length) throw new Error("assignment must be balanced treatment and control");
}

export function freezeExperimentSpec(
  input: ExperimentSpecInput,
  suppliedAssignment?: Record<string, ExperimentArm>,
): FrozenExperimentSpec {
  validateExperimentSpecInput(input);
  const clusterIds = input.clusterRoster.map((item) => item.clusterId);
  const assignment = suppliedAssignment ?? deterministicAssignment(clusterIds, input.allocationSeed);
  validateAssignment(clusterIds, assignment);
  const frozenWithoutHash = {
    ...structuredClone(input),
    clusterRoster: structuredClone(input.clusterRoster).sort((a, b) => a.clusterId.localeCompare(b.clusterId)),
    candidateHashes: Object.fromEntries(Object.entries(input.candidateHashes).sort(([a], [b]) => a.localeCompare(b))),
    assignment: Object.fromEntries(Object.entries(assignment).sort(([a], [b]) => a.localeCompare(b))),
    estimatorVersion: "listing-weighted-adjusted-v1" as const,
    inferenceVersion: "balanced-sharp-null-v1" as const,
  };
  return Object.freeze({ ...frozenWithoutHash, specHash: sha256(frozenWithoutHash) });
}

function combinations(values: number[], size: number): number[][] {
  const result: number[][] = [];
  const build = (start: number, picked: number[]): void => {
    if (picked.length === size) {
      result.push([...picked]);
      return;
    }
    for (let index = start; index <= values.length - (size - picked.length); index += 1) {
      const value = values[index];
      if (value === undefined) throw new Error("combination index out of bounds");
      picked.push(value);
      build(index + 1, picked);
      picked.pop();
    }
  };
  build(0, []);
  return result;
}

function estimateFromTreatmentIndices(adjusted: number[], treatment: Set<number>, scale: number): number {
  let treatmentTotal = 0;
  let controlTotal = 0;
  for (let index = 0; index < adjusted.length; index += 1) {
    const value = adjusted[index];
    if (value === undefined) throw new Error("adjusted outcome index out of bounds");
    if (treatment.has(index)) treatmentTotal += value;
    else controlTotal += value;
  }
  const armSize = adjusted.length / 2;
  return scale * (treatmentTotal / armSize - controlTotal / armSize);
}

function sampleTreatmentIndices(clusterCount: number, seed: string, iteration: number): Set<number> {
  const ranked = Array.from({ length: clusterCount }, (_, index) => ({
    index,
    rank: sha256(`${seed}\0mc\0${iteration}\0${index}`),
  })).sort((left, right) => left.rank.localeCompare(right.rank) || left.index - right.index);
  return new Set(ranked.slice(0, clusterCount / 2).map((item) => item.index));
}

function mean(values: number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function sampleVariance(values: number[]): number {
  if (values.length < 2) return Number.NaN;
  const center = mean(values);
  return values.reduce((total, value) => total + (value - center) ** 2, 0) / (values.length - 1);
}

function logGamma(value: number): number {
  const coefficients = [
    676.5203681218851,
    -1259.1392167224028,
    771.3234287776531,
    -176.6150291621406,
    12.507343278686905,
    -0.13857109526572012,
    9.984369578019572e-6,
    1.5056327351493116e-7,
  ];
  if (value < 0.5) return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * value)) - logGamma(1 - value);
  let shifted = value - 1;
  let series = 0.9999999999998099;
  for (let index = 0; index < coefficients.length; index += 1) {
    const coefficient = coefficients[index];
    if (coefficient === undefined) throw new Error("gamma coefficient missing");
    series += coefficient / (shifted + index + 1);
  }
  const t = shifted + coefficients.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (shifted + 0.5) * Math.log(t) - t + Math.log(series);
}

function betaContinuedFraction(a: number, b: number, x: number): number {
  const maxIterations = 200;
  const epsilon = 3e-14;
  const floor = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < floor) d = floor;
  d = 1 / d;
  let result = d;
  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    const m2 = 2 * iteration;
    let term = (iteration * (b - iteration) * x) / ((qam + m2) * (a + m2));
    d = 1 + term * d;
    if (Math.abs(d) < floor) d = floor;
    c = 1 + term / c;
    if (Math.abs(c) < floor) c = floor;
    d = 1 / d;
    result *= d * c;
    term = (-(a + iteration) * (qab + iteration) * x) / ((a + m2) * (qap + m2));
    d = 1 + term * d;
    if (Math.abs(d) < floor) d = floor;
    c = 1 + term / c;
    if (Math.abs(c) < floor) c = floor;
    d = 1 / d;
    const delta = d * c;
    result *= delta;
    if (Math.abs(delta - 1) < epsilon) return result;
  }
  throw new Error("incomplete beta did not converge");
}

function regularizedBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const factor = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log1p(-x));
  if (x < (a + 1) / (a + b + 2)) return (factor * betaContinuedFraction(a, b, x)) / a;
  return 1 - (factor * betaContinuedFraction(b, a, 1 - x)) / b;
}

function studentTCdf(value: number, degreesOfFreedom: number): number {
  if (!(degreesOfFreedom > 0)) return Number.NaN;
  if (value === 0) return 0.5;
  const beta = regularizedBeta(degreesOfFreedom / (degreesOfFreedom + value ** 2), degreesOfFreedom / 2, 0.5);
  return value > 0 ? 1 - beta / 2 : beta / 2;
}

export function studentTCritical(probability: number, degreesOfFreedom: number): number {
  if (!(probability > 0.5 && probability < 1) || !(degreesOfFreedom > 0)) throw new Error("invalid t critical inputs");
  let low = 0;
  let high = 1;
  while (studentTCdf(high, degreesOfFreedom) < probability && high < 1e6) high *= 2;
  for (let iteration = 0; iteration < 100; iteration += 1) {
    const middle = (low + high) / 2;
    if (studentTCdf(middle, degreesOfFreedom) < probability) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

function assertFiniteNonnegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be finite and nonnegative`);
}

export function evaluateRandomizedExperiment(
  spec: FrozenExperimentSpec,
  observations: ClusterObservation[],
  profile: MethodProfile,
  evidence: EvidenceManifest,
): EvaluationResult {
  const { manifestHash, ...evidenceWithoutHash } = evidence;
  if (sha256(evidenceWithoutHash) !== manifestHash) throw new Error("evidence manifest hash mismatch");
  const { specHash, ...withoutHash } = spec;
  if (sha256(withoutHash) !== specHash) throw new Error("experiment spec hash mismatch");
  if (profile.profileId !== spec.methodProfileId) throw new Error("method profile mismatch");
  if (evidence.specHash !== specHash || evidence.methodProfileId !== profile.profileId) throw new Error("evidence manifest does not bind this specification and method");
  if (!evidence.complete) throw new Error("evidence manifest is incomplete");
  if (!evidence.maturitySatisfied) throw new Error("evidence has not reached declared maturity");
  const clusterIds = spec.clusterRoster.map((item) => item.clusterId).sort();
  const byId = new Map(observations.map((item) => [item.clusterId, item]));
  if (byId.size !== clusterIds.length || observations.length !== clusterIds.length || clusterIds.some((id) => !byId.has(id))) throw new Error("observations must contain each frozen cluster exactly once");
  const ordered = clusterIds.map((clusterId) => {
    const observation = byId.get(clusterId);
    if (!observation) throw new Error("observation missing");
    if (!observation.baselineComplete) throw new Error("incomplete baseline coverage");
    if (!observation.outcomeComplete) throw new Error("incomplete outcome coverage");
    assertFiniteNonnegative(observation.baselineTotal, "baseline total");
    assertFiniteNonnegative(observation.outcomeTotal, "outcome total");
    return observation;
  });
  const baselineDays = spec.baselineWindow.exposureDays;
  const outcomeDays = spec.measurementWindow.exposureDays;
  const listingCount = spec.clusterRoster.reduce((total, item) => total + item.listingIds.length, 0);
  const adjusted = ordered.map((item) => item.outcomeTotal - (outcomeDays / baselineDays) * item.baselineTotal);
  const treatmentIndices = new Set<number>();
  ordered.forEach((item, index) => {
    if (spec.assignment[item.clusterId] === "treatment") treatmentIndices.add(index);
  });
  const scale = ordered.length / (listingCount * outcomeDays);
  const estimate = estimateFromTreatmentIndices(adjusted, treatmentIndices, scale);
  const resolution = attainableResolution(ordered.length, spec.alpha);
  let pValue: number;
  let sharpNull: EvaluationResult["sharpNull"];
  if (resolution.assignmentCount <= profile.enumerationLimit) {
    const allocations = combinations(Array.from({ length: ordered.length }, (_, index) => index), ordered.length / 2);
    let extreme = 0;
    for (const allocation of allocations) {
      const candidate = Math.abs(estimateFromTreatmentIndices(adjusted, new Set(allocation), scale));
      if (candidate + 1e-12 >= Math.abs(estimate)) extreme += 1;
    }
    pValue = extreme / allocations.length;
    sharpNull = { method: "exact_enumeration", pValue, assignmentCount: allocations.length, simulations: null, seed: null, monteCarloStandardError: null };
  } else {
    let extreme = 0;
    for (let iteration = 0; iteration < profile.monteCarloSamples; iteration += 1) {
      const allocation = sampleTreatmentIndices(ordered.length, spec.allocationSeed, iteration);
      const candidate = Math.abs(estimateFromTreatmentIndices(adjusted, allocation, scale));
      if (candidate + 1e-12 >= Math.abs(estimate)) extreme += 1;
    }
    pValue = (extreme + 1) / (profile.monteCarloSamples + 1);
    sharpNull = {
      method: "monte_carlo",
      pValue,
      assignmentCount: null,
      simulations: profile.monteCarloSamples,
      seed: spec.allocationSeed,
      monteCarloStandardError: Math.sqrt((pValue * (1 - pValue)) / (profile.monteCarloSamples + 1)),
    };
  }

  const treatment = adjusted.filter((_, index) => treatmentIndices.has(index));
  const control = adjusted.filter((_, index) => !treatmentIndices.has(index));
  const varianceTreatment = sampleVariance(treatment);
  const varianceControl = sampleVariance(control);
  let interval: EvaluationResult["averageEffectInterval"];
  if (!Number.isFinite(varianceTreatment) || !Number.isFinite(varianceControl) || varianceTreatment + varianceControl <= 0) {
    interval = { status: "unavailable_degenerate_variance" };
  } else if (
    ordered.length < profile.intervalMinimumClusters
    || ordered.some((item) => item.baselineTotal < profile.intervalMinimumBaselineOutcomePerCluster)
  ) {
    interval = { status: "unavailable_profile" };
  } else {
    const a = varianceTreatment / treatment.length;
    const b = varianceControl / control.length;
    const variance = scale ** 2 * (a + b);
    const degreesOfFreedom = (a + b) ** 2 / (a ** 2 / (treatment.length - 1) + b ** 2 / (control.length - 1));
    if (!(variance > 0) || !Number.isFinite(degreesOfFreedom)) interval = { status: "unavailable_degenerate_variance" };
    else {
      const standardError = Math.sqrt(variance);
      const critical = studentTCritical(1 - spec.alpha / 2, degreesOfFreedom);
      interval = {
        status: "available",
        lower: estimate - critical * standardError,
        upper: estimate + critical * standardError,
        standardError,
        degreesOfFreedom,
      };
    }
  }

  const reasons: string[] = [];
  if (ordered.length < profile.minimumClusters) reasons.push(`requires_at_least_${profile.minimumClusters}_clusters`);
  if (!resolution.attainable) reasons.push("unattainable_two_sided_p_value_resolution");
  const baselineTotal = ordered.reduce((total, item) => total + item.baselineTotal, 0);
  if (baselineTotal === 0) reasons.push("zero_baseline_requires_absolute_threshold_and_separate_profile_review");
  else if (Math.max(...ordered.map((item) => item.baselineTotal)) / baselineTotal > profile.maximumBaselineConcentration) reasons.push("baseline_concentration_exceeds_profile");
  if (interval.status !== "available") reasons.push("average_effect_interval_unavailable");
  return {
    schemaVersion: "evaluation-result-v1",
    specHash,
    evidenceManifestHash: manifestHash,
    methodProfileId: profile.profileId,
    estimatePerListingDay: estimate,
    sharpNull,
    averageEffectInterval: interval,
    disposition: pValue <= spec.alpha ? "evidence_of_change" : "inconclusive",
    eligibility: { eligible: reasons.length === 0, reasons },
  };
}

export function directionalStudyResult(beforeTotal: number, afterTotal: number, scheduledDays: number): {
  workflow: "directional_change_study";
  observedDifference: number;
  differencePerScheduledDay: number;
  causalClaim: false;
  statisticalInference: null;
  decisionAuthority: "human_only";
} {
  assertFiniteNonnegative(beforeTotal, "before total");
  assertFiniteNonnegative(afterTotal, "after total");
  if (!(scheduledDays > 0) || !Number.isFinite(scheduledDays)) throw new Error("scheduled days must be positive");
  return {
    workflow: "directional_change_study",
    observedDifference: afterTotal - beforeTotal,
    differencePerScheduledDay: (afterTotal - beforeTotal) / scheduledDays,
    causalClaim: false,
    statisticalInference: null,
    decisionAuthority: "human_only",
  };
}
