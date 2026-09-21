import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { Ajv2020, type ValidateFunction, type ErrorObject } from "ajv/dist/2020.js";

import { sha256 } from "./canonical.ts";
import type { EvaluationResult, EvidenceManifest, FrozenExperimentSpec, MethodProfile, SimulationScenario } from "./index.ts";

export type ContractName = "FrozenExperimentSpec" | "EvidenceManifest" | "EvaluationResult" | "MethodProfile" | "SimulationScenario";

export class ContractValidationError extends Error {
  readonly contract: ContractName;
  readonly code: string;
  readonly issues: readonly string[];

  constructor(contract: ContractName, code: string, issues: readonly string[] = []) {
    super(`${contract} validation failed: ${code}`);
    this.name = "ContractValidationError";
    this.contract = contract;
    this.code = code;
    this.issues = Object.freeze([...issues]);
  }
}

function schema(name: string): object {
  return JSON.parse(readFileSync(new URL(`../schemas/${name}`, import.meta.url), "utf8")) as object;
}

const ajv = new Ajv2020({ allErrors: true, strict: true });
const require = createRequire(import.meta.url);
const addFormats = require("ajv-formats") as typeof import("ajv-formats").default;
addFormats(ajv);
const validators = {
  FrozenExperimentSpec: ajv.compile(schema("experiment-spec-v1.schema.json")),
  EvidenceManifest: ajv.compile(schema("evidence-manifest-v1.schema.json")),
  EvaluationResult: ajv.compile(schema("evaluation-result-v1.schema.json")),
  MethodProfile: ajv.compile(schema("method-profile-v1.schema.json")),
  SimulationScenario: ajv.compile(schema("simulation-scenario-v1.schema.json")),
} satisfies Record<ContractName, ValidateFunction>;

function assertShape(contract: ContractName, value: unknown): void {
  const validator = validators[contract];
  if (!validator(value)) {
    const issues = (validator.errors ?? []).map((error: ErrorObject) => `${error.keyword}:${error.instancePath || "/"}`);
    throw new ContractValidationError(contract, "SCHEMA_INVALID", issues);
  }
}

function assertExactKeys(contract: ContractName, actual: string[], expected: string[], code: string): void {
  if (actual.slice().sort().join("\0") !== expected.slice().sort().join("\0")) {
    throw new ContractValidationError(contract, code);
  }
}

export function parseFrozenExperimentSpec(value: unknown): FrozenExperimentSpec {
  assertShape("FrozenExperimentSpec", value);
  const spec = value as FrozenExperimentSpec;
  const { specHash, ...withoutHash } = spec;
  if (sha256(withoutHash) !== specHash) throw new ContractValidationError("FrozenExperimentSpec", "HASH_MISMATCH");
  if (spec.clusterRoster.length % 2 !== 0) throw new ContractValidationError("FrozenExperimentSpec", "ODD_CLUSTER_COUNT");
  const clusterIds = spec.clusterRoster.map((cluster) => cluster.clusterId);
  if (new Set(clusterIds).size !== clusterIds.length) throw new ContractValidationError("FrozenExperimentSpec", "DUPLICATE_CLUSTER_ID");
  const listingIds = spec.clusterRoster.flatMap((cluster) => cluster.listingIds);
  if (new Set(listingIds).size !== listingIds.length) throw new ContractValidationError("FrozenExperimentSpec", "DUPLICATE_LISTING_ID");
  assertExactKeys("FrozenExperimentSpec", Object.keys(spec.candidateHashes), clusterIds, "CANDIDATE_KEYS_MISMATCH");
  assertExactKeys("FrozenExperimentSpec", Object.keys(spec.assignment), clusterIds, "ASSIGNMENT_KEYS_MISMATCH");
  const arms = Object.values(spec.assignment);
  const treated = arms.filter((arm) => arm === "treatment").length;
  const controls = arms.filter((arm) => arm === "control").length;
  if (treated !== controls || treated + controls !== clusterIds.length) {
    throw new ContractValidationError("FrozenExperimentSpec", "ASSIGNMENT_NOT_BALANCED");
  }
  if (!(spec.planningEffect > spec.practicalEffect)) throw new ContractValidationError("FrozenExperimentSpec", "EFFECT_ORDER_INVALID");
  for (const window of [spec.baselineWindow, spec.measurementWindow]) {
    if (Date.parse(window.end) <= Date.parse(window.start)) throw new ContractValidationError("FrozenExperimentSpec", "WINDOW_ORDER_INVALID");
  }
  return spec;
}

export function parseEvidenceManifest(value: unknown): EvidenceManifest {
  assertShape("EvidenceManifest", value);
  const manifest = value as EvidenceManifest;
  const { manifestHash, ...withoutHash } = manifest;
  if (sha256(withoutHash) !== manifestHash) throw new ContractValidationError("EvidenceManifest", "HASH_MISMATCH");
  return manifest;
}

export function parseMethodProfile(value: unknown): MethodProfile {
  assertShape("MethodProfile", value);
  return value as MethodProfile;
}

export function parseEvaluationResult(value: unknown): EvaluationResult {
  assertShape("EvaluationResult", value);
  const result = value as EvaluationResult;
  if (result.averageEffectInterval.status === "available" && result.averageEffectInterval.lower > result.averageEffectInterval.upper) {
    throw new ContractValidationError("EvaluationResult", "INTERVAL_ORDER_INVALID");
  }
  return result;
}

export function parseSimulationScenario(value: unknown): SimulationScenario {
  assertShape("SimulationScenario", value);
  const scenario = value as SimulationScenario;
  const lengths = [scenario.listingCounts, scenario.baselineTotals, scenario.controlOutcomes, scenario.treatmentOutcomes].map((items) => items.length);
  if (new Set(lengths).size !== 1 || lengths[0] === undefined || lengths[0] % 2 !== 0) {
    throw new ContractValidationError("SimulationScenario", "ARRAY_LENGTH_MISMATCH");
  }
  if (!(scenario.planningEffect > scenario.practicalEffect)) {
    throw new ContractValidationError("SimulationScenario", "EFFECT_ORDER_INVALID");
  }
  return scenario;
}
