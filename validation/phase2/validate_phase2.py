"""Credential-free Phase 2 contract, reference, and release-evidence validator."""

from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
import subprocess

try:
    from validation.phase2.reference import reference_results
except ModuleNotFoundError:  # Direct script execution places this directory on sys.path.
    from reference import reference_results


ROOT = Path(__file__).resolve().parents[2]
SCHEMA_NAMES = (
    "experiment-spec-v1.schema.json",
    "method-profile-v1.schema.json",
    "simulation-scenario-v1.schema.json",
    "evidence-manifest-v1.schema.json",
    "evaluation-result-v1.schema.json",
)
EXPECTED_A2_ARTIFACTS = {
    "validation/phase2/reference-results.json",
    "validation/phase2/release-results.json",
    "validation/phase2/fixtures/reference-cases.json",
    "validation/phase2/fixtures/simulation-scenarios.json",
}


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


def validate_artifact_manifest(a2: dict, *, root: Path = ROOT) -> None:
    artifacts = a2.get("artifacts")
    if not isinstance(artifacts, list):
        raise AssertionError("A2 artifacts must be a list")
    seen: set[str] = set()
    for item in artifacts:
        if not isinstance(item, dict) or set(item) != {"artifact", "sha256"}:
            raise AssertionError("A2 artifact entry has an unsupported shape")
        relative = item["artifact"]
        digest = item["sha256"]
        if not isinstance(relative, str) or relative.startswith("/") or "\\" in relative or ".." in Path(relative).parts:
            raise AssertionError("A2 artifact path must be a safe repository-relative path")
        if relative in seen:
            raise AssertionError(f"A2 artifact is duplicated: {relative}")
        seen.add(relative)
        if relative not in EXPECTED_A2_ARTIFACTS:
            raise AssertionError(f"A2 artifact is not approved: {relative}")
        if not isinstance(digest, str) or len(digest) != 64 or any(character not in "0123456789abcdef" for character in digest):
            raise AssertionError(f"A2 artifact hash is malformed: {relative}")
        path = root / relative
        if path.is_symlink() or not path.is_file():
            raise AssertionError(f"A2 artifact must be a regular file: {relative}")
        current = root
        for part in Path(relative).parts[:-1]:
            current /= part
            if current.is_symlink():
                raise AssertionError(f"A2 artifact path crosses a symlink: {relative}")
        if hashlib.sha256(path.read_bytes()).hexdigest() != digest:
            raise AssertionError(f"A2 artifact hash mismatch: {relative}")
    if seen != EXPECTED_A2_ARTIFACTS:
        missing = sorted(EXPECTED_A2_ARTIFACTS.difference(seen))
        raise AssertionError("A2 artifact manifest is incomplete: " + ", ".join(missing))


def main() -> int:
    schema_dir = ROOT / "packages" / "contracts" / "schemas"
    schema_hashes = {}
    for name in SCHEMA_NAMES:
        path = schema_dir / name
        schema = json.loads(path.read_text(encoding="utf-8"))
        if schema.get("additionalProperties") is not False or not schema.get("required"):
            raise AssertionError(f"{name}: schema must reject unknown top-level fields and require its contract")
        schema_hashes[name] = hashlib.sha256(path.read_bytes()).hexdigest()

    scenario_fixture = json.loads((ROOT / "validation" / "phase2" / "fixtures" / "simulation-scenarios.json").read_text(encoding="utf-8"))
    for scenario in scenario_fixture["scenarios"]:
        lengths = {len(scenario[field]) for field in ("listingCounts", "baselineTotals", "controlOutcomes", "treatmentOutcomes")}
        if len(lengths) != 1 or next(iter(lengths)) < 8:
            raise AssertionError(f"{scenario['scenarioId']}: scenario arrays must align with at least eight clusters")
        if scenario["repetitions"] < (2_000 if scenario["evaluatePower"] else 10_000):
            raise AssertionError(f"{scenario['scenarioId']}: insufficient release repetitions")

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

    a2_path = ROOT / "validation" / "phase2" / "a2-results.json"
    a2 = json.loads(a2_path.read_text(encoding="utf-8"))
    validate_artifact_manifest(a2)
    g2 = json.loads((ROOT / "docs" / "gates" / "G2.json").read_text(encoding="utf-8"))
    if a2["status"] != "passed_automated_awaiting_H2" or a2["external_requests"] != 0:
        raise AssertionError("A2 must remain credential-free and awaiting H2")
    if g2["status"] != "awaiting_H2_owner_disposition" or g2["recommended_product_disposition"] != "directional_only_randomized_disabled":
        raise AssertionError("G2 must keep randomized functionality disabled before H2")
    if g2["repository_commit"] != a2["repository_commit"]:
        raise AssertionError("G2 and A2 do not bind the same implementation revision")
    actual_a2_hash = hashlib.sha256(a2_path.read_bytes()).hexdigest()
    if g2["automated_evidence"][0]["sha256"] != actual_a2_hash:
        raise AssertionError("G2 A2 evidence hash mismatch")
    ancestor = subprocess.run(
        ["git", "merge-base", "--is-ancestor", a2["repository_commit"], "HEAD"],
        cwd=ROOT,
        check=False,
    )
    if ancestor.returncode != 0:
        raise AssertionError("A2 implementation revision is not an ancestor of HEAD")
    changed = set(run(["git", "diff", "--name-only", f"{a2['repository_commit']}..HEAD"]).splitlines())
    evidence_only = {
        "docs/gates/G0.json",
        "docs/gates/G1.json",
        "docs/gates/G2.json",
        "validation/phase0/a0-results.json",
        "validation/phase1/a1-results.json",
        "validation/phase2/a2-results.json",
    }
    unexpected = changed.difference(evidence_only)
    if unexpected:
        raise AssertionError("A2 evidence is stale for implementation changes: " + ", ".join(sorted(unexpected)))
    if run(["git", "status", "--porcelain", "--untracked-files=all"]).strip():
        raise AssertionError("A2 evidence validation requires a clean reviewed worktree")

    print(json.dumps({
        "gate": "A2",
        "status": "passed",
        "external_requests": 0,
        "typescript_tests": 22,
        "reference_cases": len(stored_reference["results"]),
        "simulation_scenarios": len(stored_release["scenarios"]),
        "schema_hashes": schema_hashes,
        "benchmark_limit_ms": 10_000,
        "benchmark_observed_ms": live_release["monte_carlo_benchmark"]["elapsedMilliseconds"],
    }, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
