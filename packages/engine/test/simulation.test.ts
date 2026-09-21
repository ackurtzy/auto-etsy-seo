import assert from "node:assert/strict";
import test from "node:test";

import { exhaustiveSharpNullDiagnostic, runFixedPopulationScenario, wilsonLowerBound } from "../src/simulation.ts";

test("binomial power lower bound is conservative", () => {
  assert.ok(wilsonLowerBound(2_000, 2_000) > 0.99);
  assert.ok(wilsonLowerBound(1_600, 2_000) < 0.8);
});

test("sharp-null size is exhaustively bounded over feasible assignments", () => {
  for (const count of [6, 8, 10, 12]) {
    const result = exhaustiveSharpNullDiagnostic(
      Array.from({ length: count }, (_, index) => (index + 1) ** 2 % 17),
      0.05,
    );
    assert.equal(result.passed, true);
    assert.ok(result.rejectionRate <= 0.05);
  }
});

test("a fixed sharp-null scenario stays below the release diagnostic ceiling", () => {
  const result = runFixedPopulationScenario({
    scenarioId: "test-null",
    seed: "test-null-seed",
    repetitions: 10_000,
    alpha: 0.05,
    practicalEffect: 0.25,
    planningEffect: 1,
    listingCounts: [1, 1, 1, 1, 1, 1, 1, 1],
    baselineTotals: [10, 11, 9, 12, 8, 13, 7, 14],
    controlOutcomes: [6, 8, 9, 11, 13, 16, 19, 23],
    treatmentOutcomes: [6, 8, 9, 11, 13, 16, 19, 23],
    evaluatePower: false,
  });
  assert.equal(result.passed, true);
  assert.ok(result.nullRejectionRate !== null && result.nullRejectionRate <= result.diagnosticCeiling);
});

test("a predeclared strong-effect scenario clears the full decision power gate", () => {
  const result = runFixedPopulationScenario({
    scenarioId: "test-power",
    seed: "test-power-seed",
    repetitions: 2_000,
    alpha: 0.05,
    practicalEffect: 1,
    planningEffect: 20,
    listingCounts: [1, 1, 1, 1, 1, 1, 1, 1],
    baselineTotals: [10, 11, 9, 12, 8, 13, 7, 14],
    controlOutcomes: [6, 8, 9, 11, 13, 16, 19, 23],
    treatmentOutcomes: [26, 28, 29, 31, 33, 36, 39, 43],
    evaluatePower: true,
  });
  assert.equal(result.passed, true);
  assert.ok(result.powerLower95 !== null && result.powerLower95 >= 0.8);
});
