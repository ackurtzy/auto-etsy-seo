import {
  canonicalJson,
  parseFrozenExperimentSpec,
  sha256,
  type ExperimentArm,
  type ExperimentSpecInput,
  type FrozenExperimentSpec,
  validateExperimentSpecInput,
} from "../../contracts/src/index.ts";

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

/** Internal test/simulation constructor. Production callers use freezeExperimentSpec. */
export function freezeExperimentSpecWithAssignment(
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
  return Object.freeze(parseFrozenExperimentSpec({ ...frozenWithoutHash, specHash: sha256(frozenWithoutHash) }));
}
