export type EvidenceTier = "directional" | "randomized_policy";
export type ExperimentArm = "treatment" | "control";
export type RandomizedOutcome =
  | "evidence_of_change"
  | "inconclusive"
  | "invalid_data"
  | "protocol_deviation"
  | "safety_stopped";

export interface ClusterSpec {
  clusterId: string;
  listingIds: string[];
}

export interface ExposureWindow {
  start: string;
  end: string;
  exposureDays: number;
}

export interface ExperimentSpecInput {
  schemaVersion: "experiment-spec-v1";
  hypothesis: string;
  evidenceTier: "randomized_policy";
  clusterRoster: ClusterSpec[];
  candidateHashes: Record<string, string>;
  controlPolicy: "unchanged";
  primaryMetric: string;
  methodProfileId: "balanced-cluster-v1";
  practicalEffect: number;
  planningEffect: number;
  baselineWindow: ExposureWindow;
  measurementWindow: ExposureWindow;
  allocationSeed: string;
  alpha: number;
  errorBudgetFamily: string;
  guardrails: string[];
  contaminationRules: string[];
  deploymentDeadline: string;
  authorityCaps: { mode: "human_review_only"; expiresAt: string };
  permittedConclusions: RandomizedOutcome[];
  maturityWaitHours: number;
  evidenceRequirements: string[];
}

export interface FrozenExperimentSpec extends ExperimentSpecInput {
  assignment: Record<string, ExperimentArm>;
  estimatorVersion: "listing-weighted-adjusted-v1";
  inferenceVersion: "balanced-sharp-null-v1";
  specHash: string;
}

export interface MethodProfile {
  schemaVersion: "method-profile-v1";
  profileId: "balanced-cluster-v1";
  minimumClusters: number;
  maximumBaselineConcentration: number;
  enumerationLimit: number;
  monteCarloSamples: number;
  intervalMinimumClusters: number;
  intervalMinimumBaselineOutcomePerCluster: number;
}

export interface SimulationScenario {
  schemaVersion: "simulation-scenario-v1";
  scenarioId: string;
  repetitions: number;
  alpha: number;
  practicalEffect: number;
  planningEffect: number;
  seed: string;
  features: string[];
  listingCounts: number[];
  baselineTotals: number[];
  controlOutcomes: number[];
  treatmentOutcomes: number[];
  evaluatePower: boolean;
}

export interface EvidenceManifest {
  schemaVersion: "evidence-manifest-v1";
  specHash: string;
  methodProfileId: string;
  sourceRevisionHashes: string[];
  complete: boolean;
  maturitySatisfied: boolean;
  generatedAt: string;
  manifestHash: string;
}

export interface EvaluationResult {
  schemaVersion: "evaluation-result-v1";
  specHash: string;
  evidenceManifestHash: string;
  methodProfileId: string;
  estimatePerListingDay: number;
  sharpNull: {
    method: "exact_enumeration" | "monte_carlo";
    pValue: number;
    assignmentCount: number | null;
    simulations: number | null;
    seed: string | null;
    monteCarloStandardError: number | null;
  };
  averageEffectInterval:
    | { status: "available"; lower: number; upper: number; standardError: number; degreesOfFreedom: number }
    | { status: "unavailable_degenerate_variance" | "unavailable_profile" };
  disposition: "evidence_of_change" | "inconclusive";
  eligibility: { eligible: boolean; reasons: string[] };
}

function requireIso(value: string, label: string): void {
  if (!value || Number.isNaN(Date.parse(value))) throw new Error(`${label} must be an ISO timestamp`);
}

export function validateExperimentSpecInput(spec: ExperimentSpecInput): void {
  if (spec.schemaVersion !== "experiment-spec-v1") throw new Error("unsupported experiment spec version");
  if (spec.evidenceTier !== "randomized_policy") throw new Error("randomized evaluator requires randomized_policy evidence tier");
  if (spec.controlPolicy !== "unchanged") throw new Error("control policy must remain unchanged");
  if (!spec.hypothesis.trim() || !spec.primaryMetric.trim()) throw new Error("hypothesis and primary metric are required");
  if (!Number.isFinite(spec.alpha) || spec.alpha <= 0 || spec.alpha >= 1) throw new Error("alpha must be between zero and one");
  if (!Number.isFinite(spec.practicalEffect) || spec.practicalEffect < 0) throw new Error("practical effect must be nonnegative");
  if (!Number.isFinite(spec.planningEffect) || spec.planningEffect <= spec.practicalEffect) throw new Error("planning effect must exceed practical effect");
  if (!spec.allocationSeed) throw new Error("allocation seed is required");
  if (spec.clusterRoster.length < 2 || spec.clusterRoster.length % 2 !== 0) throw new Error("cluster roster must have an even size");
  const ids = spec.clusterRoster.map((item) => item.clusterId);
  if (new Set(ids).size !== ids.length) throw new Error("cluster IDs must be unique");
  const listings = spec.clusterRoster.flatMap((item) => item.listingIds);
  if (listings.some((item) => !item) || new Set(listings).size !== listings.length) throw new Error("listing IDs must be nonempty and belong to one cluster");
  if (Object.keys(spec.candidateHashes).sort().join("\0") !== [...ids].sort().join("\0")) throw new Error("every cluster must have exactly one frozen candidate hash");
  if (Object.values(spec.candidateHashes).some((hash) => !/^[a-f0-9]{64}$/.test(hash))) throw new Error("candidate hashes must be lowercase SHA-256 values");
  for (const [label, window] of [["baseline", spec.baselineWindow], ["measurement", spec.measurementWindow]] as const) {
    requireIso(window.start, `${label} start`);
    requireIso(window.end, `${label} end`);
    if (!(window.exposureDays > 0) || Date.parse(window.end) <= Date.parse(window.start)) throw new Error(`${label} window must have positive exposure`);
  }
  requireIso(spec.deploymentDeadline, "deployment deadline");
  requireIso(spec.authorityCaps.expiresAt, "authority expiry");
  if (!Number.isFinite(spec.maturityWaitHours) || spec.maturityWaitHours < 0) throw new Error("maturity wait must be nonnegative");
}
