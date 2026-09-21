"""Validate the Phase 0 gate without credentials or external traffic."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[2]
REQUIRED_RECORDS = (
    "plan-source.json",
    "permission-matrix.json",
    "retention-matrix.json",
    "capability-matrix.json",
    "initial-policy.json",
    "legacy-cutover.json",
    "sample-inventory.json",
)
DOCUMENT_SCAN_ROOTS = (
    "docs/rebuild",
    "docs/gates",
)
PROHIBITED_FIXTURE_PATTERNS = {
    "OpenAI-style secret": re.compile(r"\bsk-[A-Za-z0-9_-]{20,}\b"),
    "literal bearer credential": re.compile(r"Bearer\s+[A-Za-z0-9._~-]{20,}"),
    "private key material": re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    "email-like PII": re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE),
    "JWT-like credential": re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b"),
    "assigned access secret": re.compile(
        r'"(?:access_token|refresh_token|api_key|keystring|secret)"\s*:\s*"(?!synthetic|redacted|placeholder)[^"\n]{12,}"',
        re.IGNORECASE,
    ),
}


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def require_exact_keys(payload: dict, required: set[str], label: str) -> None:
    missing = required.difference(payload)
    if missing:
        raise AssertionError(f"{label}: missing required keys {sorted(missing)}")


def scan_text_file(path: Path) -> None:
    if path.is_symlink():
        raise AssertionError(f"fixture safety scan rejects symlink: {path.relative_to(ROOT)}")
    try:
        content = path.read_text(encoding="utf-8")
    except UnicodeDecodeError as exc:
        raise AssertionError(f"fixture safety scan rejects binary file: {path.relative_to(ROOT)}") from exc
    for label, pattern in PROHIBITED_FIXTURE_PATTERNS.items():
        if pattern.search(content):
            raise AssertionError(f"fixture safety scan found {label} in {path.relative_to(ROOT)}")


def git_binary() -> str:
    bundled = (
        Path.home()
        / ".cache"
        / "codex-runtimes"
        / "codex-primary-runtime"
        / "dependencies"
        / "bin"
        / "fallback"
        / "git"
    )
    if bundled.is_file():
        return str(bundled)
    executable = shutil.which("git")
    if executable is None:
        raise AssertionError("Git is required to bind A0 evidence to a revision")
    return executable


def main() -> int:
    records_dir = ROOT / "docs" / "rebuild"
    artifact_evidence: list[dict[str, str]] = []
    for name in REQUIRED_RECORDS:
        path = records_dir / name
        payload = load_json(path)
        if payload.get("schema_version") != "1.0":
            raise AssertionError(f"{name}: unsupported schema_version")
        artifact_evidence.append(
            {
                "artifact": str(path.relative_to(ROOT)),
                "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            }
        )

    permission = load_json(records_dir / "permission-matrix.json")
    g0 = load_json(ROOT / "docs" / "gates" / "G0.json")
    h0_passed = str(g0.get("status", "")).startswith("passed")
    require_exact_keys(permission, {"schema_version", "status", "rule", "activities"}, "permission matrix")
    allowed_permission_statuses = {"unresolved", "retired"}
    if h0_passed:
        allowed_permission_statuses.update({"approved_for_phase1_validation", "explicitly_disabled"})
    if not permission["activities"]:
        raise AssertionError("permission matrix is empty")
    for cell in permission["activities"]:
        require_exact_keys(cell, {"activity", "status", "enabled", "required_evidence"}, "permission activity")
        if cell["status"] not in allowed_permission_statuses:
            raise AssertionError(f"permission activity has invalid status for the current H0 state: {cell['status']}")
        if not cell["required_evidence"]:
            raise AssertionError("permission activity lacks required evidence")
    enabled_activities = {cell["activity"] for cell in permission["activities"] if cell["enabled"]}
    if not h0_passed and enabled_activities:
        raise AssertionError("live processing must remain disabled before H0")
    if enabled_activities.difference({"own_shop_listing_reads", "own_shop_outcome_reads"}):
        raise AssertionError("G0 may enable only own-shop Phase 1 read validation")

    policy = load_json(records_dir / "initial-policy.json")
    required_false_flags = (
        "production_egress_enabled",
        "production_mutations_enabled",
        "external_shop_onboarding_enabled",
        "ai_generation_enabled",
        "legacy_runtime_enabled",
    )
    if any(policy.get(flag) is not False for flag in required_false_flags):
        raise AssertionError("every Phase 0 runtime and vendor flag must be explicitly false")

    retention = load_json(records_dir / "retention-matrix.json")
    require_exact_keys(retention, {"schema_version", "status", "rule", "classes", "deletion_target_hours", "backup_restore_rule"}, "retention matrix")
    if not retention["classes"]:
        raise AssertionError("retention matrix is empty")
    enabled_retention = {
        item["data_class"] for item in retention["classes"] if item.get("live_processing_enabled") is True
    }
    if not h0_passed and enabled_retention:
        raise AssertionError("all retention classes must explicitly disable live processing before H0")
    if enabled_retention.difference({"redacted_diagnostics", "operational_logs", "oauth_tokens"}):
        raise AssertionError("G0 enabled an unsupported retention class")

    capability = load_json(records_dir / "capability-matrix.json")
    if not capability["capabilities"]:
        raise AssertionError("capability matrix is empty")
    if any(item["runtime_enabled"] for item in capability["capabilities"]):
        raise AssertionError("no runtime capability may be enabled at G0")

    legacy = load_json(records_dir / "legacy-cutover.json")
    for relative in legacy["retired_entrypoints"]:
        text = (ROOT / relative).read_text(encoding="utf-8")
        if "assert_legacy_runtime_disabled" not in text:
            raise AssertionError(f"legacy entrypoint is not quarantined: {relative}")
    for boundary in legacy["retired_client_boundaries"]:
        relative, _, _symbol = boundary.partition(":")
        text = (ROOT / relative).read_text(encoding="utf-8")
        if "assert_legacy_runtime_disabled" not in text:
            raise AssertionError(f"legacy client boundary is not quarantined: {boundary}")

    scanned_files = 0
    scan_paths: list[Path] = []
    private_evidence_root = (ROOT / "docs" / "gates" / "private").resolve()
    for relative_root in DOCUMENT_SCAN_ROOTS:
        for path in (ROOT / relative_root).rglob("*"):
            if path.is_file() and private_evidence_root not in path.resolve().parents:
                scan_paths.append(path)
    inventory = load_json(records_dir / "sample-inventory.json")
    for fixture in inventory["synthetic_samples"]:
        if fixture.get("contains_buyer_data") is not False:
            raise AssertionError("synthetic fixture must explicitly exclude buyer data")
        path = (ROOT / fixture["path"]).resolve()
        fixture_root = (ROOT / "validation" / "phase0" / "fixtures").resolve()
        if fixture_root not in path.parents or not path.is_file():
            raise AssertionError(f"fixture is outside approved root or missing: {path}")
        scan_paths.append(path)
    for path in sorted(set(scan_paths)):
        scan_text_file(path)
        scanned_files += 1

    a0_path = ROOT / "validation" / "phase0" / "a0-results.json"
    a0 = load_json(a0_path)
    require_exact_keys(
        a0,
        {"schema_version", "gate", "status", "method_version", "fixture_version", "repository_baseline", "implementation_revision", "scope", "external_requests", "credentials_required", "assertions", "failures", "limitations"},
        "A0 result",
    )
    if a0["status"] != "passed" or a0["failures"] or a0["external_requests"] != 0:
        raise AssertionError("checked-in A0 result does not describe a clean credential-free pass")
    if g0.get("repository_commit") != a0["implementation_revision"]:
        raise AssertionError("G0 and A0 do not identify the same implementation revision")
    if not re.fullmatch(r"[a-f0-9]{40}", a0["implementation_revision"]):
        raise AssertionError("A0 implementation revision is not a full commit SHA")
    revision_check = subprocess.run(
        [git_binary(), "merge-base", "--is-ancestor", a0["implementation_revision"], "HEAD"],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    if revision_check.returncode != 0:
        raise AssertionError("A0 implementation revision is not an ancestor of the checked-out commit")
    changed_since_evidence = subprocess.run(
        [git_binary(), "diff", "--name-only", f"{a0['implementation_revision']}..HEAD"],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.splitlines()
    evidence_only_paths = {
        "docs/gates/G0.json",
        "docs/gates/G1.json",
        "docs/gates/G2.json",
        "docs/gates/G3.json",
        "validation/phase0/a0-results.json",
        "validation/phase1/a1-results.json",
        "validation/phase2/a2-results.json",
        "validation/phase3/a3-results.json",
    }
    unexpected_changes = set(changed_since_evidence).difference(evidence_only_paths)
    if unexpected_changes:
        raise AssertionError(
            "A0 evidence is stale for implementation changes: "
            + ", ".join(sorted(unexpected_changes))
        )
    worktree_status = subprocess.run(
        [git_binary(), "status", "--porcelain", "--untracked-files=all"],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    if worktree_status:
        raise AssertionError("A0 evidence validation requires a clean reviewed worktree")
    g0_evidence = next((item for item in g0["automated_evidence"] if item["test_id"] == "A0"), None)
    if g0_evidence is None:
        raise AssertionError("G0 does not reference A0 evidence")
    actual_a0_hash = hashlib.sha256(a0_path.read_bytes()).hexdigest()
    if g0_evidence["sha256"] != actual_a0_hash:
        raise AssertionError("G0 A0 evidence hash does not match the checked-in artifact")

    private_schema = load_json(ROOT / "docs" / "gates" / "private-evidence-schema.json")
    evidence_schema = private_schema["properties"]["evidence"]["items"]
    required_private_evidence = {
        "artifact_id",
        "sha256",
        "source_type",
        "reviewed_at",
        "result",
    }
    if evidence_schema.get("additionalProperties") is not False:
        raise AssertionError("private gate evidence must reject unknown fields")
    if set(evidence_schema.get("required", [])) != required_private_evidence:
        raise AssertionError("private gate evidence schema is missing hashed review fields")

    completed = subprocess.run(
        [sys.executable, "-m", "unittest", "discover", "-s", "validation/phase0", "-p", "test_*.py"],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    if completed.returncode != 0:
        raise AssertionError(completed.stdout + completed.stderr)

    result = {
        "gate": "A0",
        "status": "passed",
        "scope": "credential-free fixtures and default-deny egress only",
        "external_requests": 0,
        "credentials_required": False,
        "fixture_files_scanned": scanned_files,
        "artifacts": artifact_evidence,
        "limitations": [
            "No Etsy, model-provider, Clerk, Resend, or Cloudflare integration was contacted.",
            "This validator proves the local Phase 0 boundary only; any Phase 1 reads require separate signed G0 evidence.",
        ],
    }
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
