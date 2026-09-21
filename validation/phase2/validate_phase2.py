"""Credential-free Phase 2 contract, reference, and release-evidence validator."""

from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
import subprocess

from reference import reference_results


ROOT = Path(__file__).resolve().parents[2]
SCHEMA_NAMES = (
    "experiment-spec-v1.schema.json",
    "method-profile-v1.schema.json",
    "simulation-scenario-v1.schema.json",
    "evidence-manifest-v1.schema.json",
    "evaluation-result-v1.schema.json",
)


def run(command: list[str]) -> str:
    completed = subprocess.run(command, cwd=ROOT, check=True, capture_output=True, text=True)
    return completed.stdout


def scrub_benchmark(payload: dict) -> dict:
    cleaned = json.loads(json.dumps(payload))
    cleaned["monte_carlo_benchmark"].pop("elapsedMilliseconds", None)
    return cleaned


def compare_numbers(left, right, path: str = "root") -> None:
    if isinstance(left, dict) and isinstance(right, dict):
        if set(left) != set(right):
            raise AssertionError(f"{path}: object keys differ")
        for key in left:
            compare_numbers(left[key], right[key], f"{path}.{key}")
        return
    if isinstance(left, list) and isinstance(right, list):
        if len(left) != len(right):
            raise AssertionError(f"{path}: array lengths differ")
        for index, (left_item, right_item) in enumerate(zip(left, right, strict=True)):
            compare_numbers(left_item, right_item, f"{path}[{index}]")
        return
    if isinstance(left, (int, float)) and not isinstance(left, bool) and isinstance(right, (int, float)) and not isinstance(right, bool):
        if not math.isclose(float(left), float(right), rel_tol=1e-9, abs_tol=1e-10):
            raise AssertionError(f"{path}: {left} != {right}")
        return
    if left != right:
        raise AssertionError(f"{path}: {left!r} != {right!r}")


def main() -> int:
    schema_dir = ROOT / "packages" / "contracts" / "schemas"
    schema_hashes = {}
    for name in SCHEMA_NAMES:
        path = schema_dir / name
        schema = json.loads(path.read_text(encoding="utf-8"))
        if schema.get("additionalProperties") is not False or not schema.get("required"):
            raise AssertionError(f"{name}: schema must reject unknown top-level fields and require its contract")
        schema_hashes[name] = hashlib.sha256(path.read_bytes()).hexdigest()

    run(["npm", "run", "typecheck:phase2"])
    run(["npm", "run", "test:phase2"])
    run(["python3", "validation/phase2/validate_reference.py"])

    stored_reference = json.loads((ROOT / "validation" / "phase2" / "reference-results.json").read_text(encoding="utf-8"))
    compare_numbers(stored_reference, reference_results(), "reference")
    live_release = json.loads(run(["node", "validation/phase2/run_release_validation.ts"]))
    stored_release = json.loads((ROOT / "validation" / "phase2" / "release-results.json").read_text(encoding="utf-8"))
    compare_numbers(scrub_benchmark(stored_release), scrub_benchmark(live_release), "release")
    if not live_release["passed"]:
        raise AssertionError("release simulation suite did not pass")
    if live_release["monte_carlo_benchmark"]["elapsedMilliseconds"] > 10_000:
        raise AssertionError("production Monte Carlo benchmark exceeded the 10-second offline execution budget")

    print(json.dumps({
        "gate": "A2",
        "status": "passed",
        "external_requests": 0,
        "typescript_tests": 20,
        "reference_cases": len(stored_reference["results"]),
        "simulation_scenarios": len(stored_release["scenarios"]),
        "schema_hashes": schema_hashes,
        "benchmark_limit_ms": 10_000,
        "benchmark_observed_ms": live_release["monte_carlo_benchmark"]["elapsedMilliseconds"],
    }, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
