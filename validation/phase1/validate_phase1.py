"""Validate tracked Phase 1 evidence without credentials or external traffic."""

from __future__ import annotations

import hashlib
import io
import json
from pathlib import Path
import re
import subprocess
import unittest


ROOT = Path(__file__).resolve().parents[2]
SHA256 = re.compile(r"^[a-f0-9]{64}$")
COMMIT = re.compile(r"^[a-f0-9]{40}$")
EMAIL = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE)
FORBIDDEN_PRIVATE_KEYS = {
    "access_token",
    "refresh_token",
    "buyer_user_id",
    "buyer_email",
    "first_line",
    "second_line",
    "postal_code",
}
EVIDENCE_ONLY_PATHS = {
    "docs/gates/G0.json",
    "docs/gates/G1.json",
    "docs/gates/G2.json",
    "docs/gates/G3.json",
    "validation/phase0/a0-results.json",
    "validation/phase1/a1-results.json",
    "validation/phase2/a2-results.json",
    "validation/phase3/a3-results.json",
}


def assert_no_private_values(value: object) -> None:
    if isinstance(value, dict):
        forbidden = FORBIDDEN_PRIVATE_KEYS.intersection(value)
        if forbidden:
            raise AssertionError("tracked Phase 1 evidence contains private fields")
        for item in value.values():
            assert_no_private_values(item)
    elif isinstance(value, list):
        for item in value:
            assert_no_private_values(item)
    elif isinstance(value, str) and EMAIL.search(value):
        raise AssertionError("tracked Phase 1 evidence contains an email-like value")


def main() -> int:
    a1_path = ROOT / "validation" / "phase1" / "a1-results.json"
    g1_path = ROOT / "docs" / "gates" / "G1.json"
    a1 = json.loads(a1_path.read_text(encoding="utf-8"))
    g1 = json.loads(g1_path.read_text(encoding="utf-8"))
    assert_no_private_values(a1)
    if not str(a1.get("status", "")).startswith("partial_pass") or g1.get("status") != "in_progress":
        raise AssertionError("Phase 1 and G1 must remain incomplete pending H1")
    implementation_revision = a1.get("repository_commit")
    observation_revision = a1.get("live_observation", {}).get("observed_with_revision")
    if not isinstance(implementation_revision, str) or not COMMIT.fullmatch(implementation_revision):
        raise AssertionError("A1 implementation revision is invalid")
    if not isinstance(observation_revision, str) or not COMMIT.fullmatch(observation_revision):
        raise AssertionError("A1 live observation revision is invalid")
    for revision in (implementation_revision, observation_revision):
        if subprocess.run(["git", "merge-base", "--is-ancestor", revision, "HEAD"], cwd=ROOT, check=False).returncode != 0:
            raise AssertionError("A1 evidence revision is not an ancestor of HEAD")
    changed = set(
        subprocess.run(
            ["git", "diff", "--name-only", f"{implementation_revision}..HEAD"],
            cwd=ROOT,
            check=True,
            capture_output=True,
            text=True,
        ).stdout.splitlines()
    )
    unexpected = changed.difference(EVIDENCE_ONLY_PATHS)
    if unexpected:
        raise AssertionError("A1 evidence is stale for implementation changes: " + ", ".join(sorted(unexpected)))
    evidence = next((item for item in g1.get("automated_evidence", []) if item.get("test_id") == "A1"), None)
    if evidence is None or evidence.get("sha256") != hashlib.sha256(a1_path.read_bytes()).hexdigest():
        raise AssertionError("G1 A1 evidence hash mismatch")
    if g1.get("repository_commit") != implementation_revision:
        raise AssertionError("G1 and A1 do not bind the same implementation revision")
    if not SHA256.fullmatch(str(a1.get("live_observation", {}).get("private_report_sha256", ""))):
        raise AssertionError("A1 private report reference is invalid")
    suite = unittest.defaultTestLoader.discover(
        str(ROOT / "validation" / "phase1"),
        pattern="test_*.py",
        top_level_dir=str(ROOT),
    )
    result = unittest.TextTestRunner(stream=io.StringIO(), verbosity=0).run(suite)
    if not result.wasSuccessful():
        raise AssertionError("Phase 1 unit tests failed")
    automated = a1.get("automated_tests", {})
    if automated.get("result") != "passed" or automated.get("external_requests") != 0 or automated.get("count") != result.testsRun:
        raise AssertionError("A1 automated test evidence is stale")
    status = subprocess.run(
        ["git", "status", "--porcelain", "--untracked-files=all"],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    if status:
        raise AssertionError("A1 evidence validation requires a clean reviewed worktree")
    print(json.dumps({"gate": "A1", "status": "passed_tracked_validation", "external_requests": 0, "tests": result.testsRun}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
