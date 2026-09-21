"""Independent standard-library reference for the Phase 2 estimator and exact test."""

from __future__ import annotations

from itertools import combinations
import json
import math
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
FIXTURES = Path(__file__).with_name("fixtures") / "reference-cases.json"


def mean(values: list[float]) -> float:
    return sum(values) / len(values)


def sample_variance(values: list[float]) -> float:
    center = mean(values)
    return sum((value - center) ** 2 for value in values) / (len(values) - 1)


def student_pdf(value: float, degrees: float) -> float:
    normalizer = math.gamma((degrees + 1) / 2) / (math.sqrt(degrees * math.pi) * math.gamma(degrees / 2))
    return normalizer * (1 + value * value / degrees) ** (-(degrees + 1) / 2)


def adaptive_simpson(function, left: float, right: float, tolerance: float = 1e-11) -> float:
    def simpson(a: float, b: float) -> float:
        middle = (a + b) / 2
        return (b - a) * (function(a) + 4 * function(middle) + function(b)) / 6

    whole = simpson(left, right)

    def refine(a: float, b: float, estimate: float, remaining: float, depth: int) -> float:
        middle = (a + b) / 2
        first = simpson(a, middle)
        second = simpson(middle, b)
        if depth <= 0 or abs(first + second - estimate) <= 15 * remaining:
            return first + second + (first + second - estimate) / 15
        return refine(a, middle, first, remaining / 2, depth - 1) + refine(middle, b, second, remaining / 2, depth - 1)

    return refine(left, right, whole, tolerance, 20)


def student_cdf(value: float, degrees: float) -> float:
    if value == 0:
        return 0.5
    area = adaptive_simpson(lambda point: student_pdf(point, degrees), 0, abs(value))
    return 0.5 + area if value > 0 else 0.5 - area


def student_critical(probability: float, degrees: float) -> float:
    low, high = 0.0, 1.0
    while student_cdf(high, degrees) < probability:
        high *= 2
    for _ in range(80):
        middle = (low + high) / 2
        if student_cdf(middle, degrees) < probability:
            low = middle
        else:
            high = middle
    return (low + high) / 2


def evaluate(case: dict[str, Any]) -> dict[str, Any]:
    clusters = case["clusters"]
    count = len(clusters)
    listings = sum(item["listing_count"] for item in clusters)
    baseline_days = case["baseline_days"]
    outcome_days = case["outcome_days"]
    adjusted = [item["outcome_total"] - outcome_days / baseline_days * item["baseline_total"] for item in clusters]
    treated = {index for index, item in enumerate(clusters) if item["arm"] == "treatment"}
    scale = count / (listings * outcome_days)

    def estimate(indices: set[int]) -> float:
        treatment_total = sum(value for index, value in enumerate(adjusted) if index in indices)
        control_total = sum(value for index, value in enumerate(adjusted) if index not in indices)
        arm_size = count / 2
        return scale * (treatment_total / arm_size - control_total / arm_size)

    observed = estimate(treated)
    assignments = list(combinations(range(count), count // 2))
    extreme = sum(abs(estimate(set(indices))) + 1e-12 >= abs(observed) for indices in assignments)
    treatment_values = [value for index, value in enumerate(adjusted) if index in treated]
    control_values = [value for index, value in enumerate(adjusted) if index not in treated]
    variance_treatment = sample_variance(treatment_values)
    variance_control = sample_variance(control_values)
    if variance_treatment + variance_control <= 0:
        interval: dict[str, Any] = {"status": "unavailable_degenerate_variance"}
    elif count < 8:
        interval = {"status": "unavailable_profile"}
    else:
        a = variance_treatment / len(treatment_values)
        b = variance_control / len(control_values)
        variance = scale * scale * (a + b)
        degrees = (a + b) ** 2 / (a * a / (len(treatment_values) - 1) + b * b / (len(control_values) - 1))
        standard_error = math.sqrt(variance)
        critical = student_critical(1 - case["alpha"] / 2, degrees)
        interval = {
            "status": "available",
            "lower": observed - critical * standard_error,
            "upper": observed + critical * standard_error,
            "standardError": standard_error,
            "degreesOfFreedom": degrees,
        }
    return {
        "case_id": case["case_id"],
        "estimate": observed,
        "p_value": extreme / len(assignments),
        "assignment_count": len(assignments),
        "interval": interval,
    }


def reference_results() -> dict[str, Any]:
    fixture = json.loads(FIXTURES.read_text(encoding="utf-8"))
    return {
        "schema_version": "phase2-reference-results-v1",
        "results": [evaluate(case) for case in fixture["cases"]],
    }


if __name__ == "__main__":
    print(json.dumps(reference_results(), sort_keys=True))
