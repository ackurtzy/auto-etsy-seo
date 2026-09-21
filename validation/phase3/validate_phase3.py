"""Credential-free Phase 3 foundation and evidence-lineage validator."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
import re
import sqlite3
import subprocess
import tempfile


ROOT = Path(__file__).resolve().parents[2]
SHA256 = re.compile(r"^[a-f0-9]{64}$")
COMMIT = re.compile(r"^[a-f0-9]{40}$")
EXPECTED_TABLES = {
    "tenants", "memberships", "shop_connections", "credential_versions", "capability_grants",
    "policies", "listing_revisions", "listing_current", "commands", "operations",
    "operation_attempts", "outbox", "jobs", "observations", "audit_events", "incidents",
    "deletion_tombstones", "restore_state", "quota_daily", "quota_reservations",
    "backup_manifests", "oauth_states",
}
EXPECTED_ARTIFACTS = {
    "apps/worker/wrangler.jsonc",
    "migrations/0001_phase3_foundation.sql",
    "migrations/0002_phase3_quota_recovery_oauth.sql",
    "validation/phase3/local-release-results.json",
}


def run(command: list[str]) -> str:
    return subprocess.run(command, cwd=ROOT, check=True, capture_output=True, text=True).stdout


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def validate_artifacts(a3: dict, root: Path = ROOT) -> None:
    artifacts = a3.get("artifacts")
    if not isinstance(artifacts, list):
        raise AssertionError("A3 artifacts must be a list")
    seen: set[str] = set()
    for item in artifacts:
        if not isinstance(item, dict) or set(item) != {"artifact", "sha256"}:
            raise AssertionError("A3 artifact entry has an unsupported shape")
        relative, digest = item["artifact"], item["sha256"]
        if not isinstance(relative, str) or relative.startswith("/") or "\\" in relative or ".." in Path(relative).parts:
            raise AssertionError("A3 artifact path must be repository-relative")
        if relative in seen or relative not in EXPECTED_ARTIFACTS:
            raise AssertionError(f"A3 artifact is duplicated or unexpected: {relative}")
        seen.add(relative)
        if not isinstance(digest, str) or not SHA256.fullmatch(digest):
            raise AssertionError(f"A3 artifact hash is malformed: {relative}")
        path = root / relative
        if path.is_symlink() or not path.is_file():
            raise AssertionError(f"A3 artifact must be a regular file: {relative}")
        current = root
        for part in Path(relative).parts[:-1]:
            current /= part
            if current.is_symlink():
                raise AssertionError(f"A3 artifact crosses a symlink: {relative}")
        if sha256(path) != digest:
            raise AssertionError(f"A3 artifact hash mismatch: {relative}")
    if seen != EXPECTED_ARTIFACTS:
        raise AssertionError("A3 artifact manifest is incomplete")


def validate_schema() -> None:
    with tempfile.TemporaryDirectory(prefix="auto-etsy-seo-phase3-") as directory:
        connection = sqlite3.connect(Path(directory) / "phase3.sqlite3")
        try:
            for migration in sorted((ROOT / "migrations").glob("*.sql")):
                connection.executescript(migration.read_text(encoding="utf-8"))
            tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            if not EXPECTED_TABLES.issubset(tables):
                raise AssertionError("Phase 3 schema is incomplete")
            restore = connection.execute("SELECT status,egress_enabled FROM restore_state WHERE singleton=1").fetchone()
            if restore != ("normal", 0):
                raise AssertionError("fresh and restored databases must default to egress disabled")
            indexes = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='index'")}
            if "one_unresolved_operation_per_shop" not in indexes:
                raise AssertionError("unresolved shop lane uniqueness is not enforced")
        finally:
            connection.close()


def validate_config() -> None:
    raw = (ROOT / "apps" / "worker" / "wrangler.jsonc").read_text(encoding="utf-8")
    config = json.loads(raw)
    if config.get("workers_dev") is not False:
        raise AssertionError("Worker must not publish to workers.dev")
    variables = config.get("vars", {})
    if variables.get("ETSY_EGRESS_ENABLED") != "false" or variables.get("TITLE_WRITES_ENABLED") != "false":
        raise AssertionError("Phase 3 write and egress gates must default off")
    if config.get("compatibility_date") != "2026-09-20" or "nodejs_compat" not in config.get("compatibility_flags", []):
        raise AssertionError("Worker runtime contract is not pinned")
    if not config.get("d1_databases") or not config.get("r2_buckets") or not config.get("durable_objects") or not config.get("workflows"):
        raise AssertionError("Phase 3 Cloudflare bindings are incomplete")
    forbidden = ("CLERK_SECRET_KEY", "CREDENTIAL_ENCRYPTION_KEY", "RESEND_API_KEY")
    if any(secret in variables for secret in forbidden):
        raise AssertionError("secrets must not be plaintext Wrangler variables")


def validate_dispatch_boundary() -> None:
    repository = (ROOT / "apps" / "worker" / "src" / "repository.ts").read_text(encoding="utf-8")
    required_guards = (
        "t.authority_epoch=c.tenant_epoch",
        "s.authority_epoch=c.shop_epoch",
        "g.authority_epoch=c.capability_epoch",
        "m.active=1",
        "s.write_lane_state='open'",
        "c.approval_expires_at>?",
        "p.application_kill_switch=0",
        "p.shop_kill_switch=0",
        "r.egress_enabled=1",
        "value='listings_w'",
        "g.canary_baseline_digest=c.baseline_digest",
        "g.canary_proposed_digest=c.proposed_digest",
    )
    missing = [guard for guard in required_guards if guard not in repository]
    if missing:
        raise AssertionError("dispatch claim is missing atomic authority guards: " + ", ".join(missing))


def main() -> int:
    validate_schema()
    validate_config()
    validate_dispatch_boundary()
    run(["npm", "run", "typecheck:phase3"])
    run(["npm", "run", "test:phase3"])
    live = json.loads(run(["node", "validation/phase3/run_a3_validation.ts"]))
    stored = json.loads((ROOT / "validation" / "phase3" / "local-release-results.json").read_text(encoding="utf-8"))
    if live != stored or not live["passed"] or live["external_requests"] != 0:
        raise AssertionError("stored Phase 3 local release results are stale")
    if [row["id"] for row in live["fault_matrix"]] != [f"F{index:02d}" for index in range(1, 16)]:
        raise AssertionError("F01-F15 evidence is incomplete")

    a3_path = ROOT / "validation" / "phase3" / "a3-results.json"
    a3 = json.loads(a3_path.read_text(encoding="utf-8"))
    g3 = json.loads((ROOT / "docs" / "gates" / "G3.json").read_text(encoding="utf-8"))
    validate_artifacts(a3)
    revision = a3.get("repository_commit")
    if not isinstance(revision, str) or not COMMIT.fullmatch(revision):
        raise AssertionError("A3 implementation revision is invalid")
    if subprocess.run(["git", "merge-base", "--is-ancestor", revision, "HEAD"], cwd=ROOT, check=False).returncode != 0:
        raise AssertionError("A3 implementation revision is not an ancestor of HEAD")
    if a3.get("status") != "passed_local_foundation_awaiting_deployed_G3a_and_H3" or g3.get("status") != "awaiting_G3a_deployment_and_H3":
        raise AssertionError("G3 must remain unpassed before deployed and owner evidence")
    if g3.get("repository_commit") != revision or g3["automated_evidence"][0].get("sha256") != sha256(a3_path):
        raise AssertionError("G3 and A3 evidence lineage is inconsistent")
    if g3.get("release_enablement_authorized") is not False:
        raise AssertionError("tracked G3 cannot enable writes before H3")
    if any(value != "disabled" for value in g3.get("capability_dispositions", {}).values()):
        raise AssertionError("all G3 capabilities must remain disabled before live gates")
    changed = set(run(["git", "diff", "--name-only", f"{revision}..HEAD"]).splitlines())
    evidence_only = {
        "docs/gates/G0.json", "docs/gates/G1.json", "docs/gates/G2.json", "docs/gates/G3.json",
        "validation/phase0/a0-results.json", "validation/phase1/a1-results.json",
        "validation/phase2/a2-results.json", "validation/phase3/a3-results.json",
    }
    if changed.difference(evidence_only):
        raise AssertionError("A3 evidence is stale for implementation changes")
    if run(["git", "status", "--porcelain", "--untracked-files=all"]).strip():
        raise AssertionError("A3 validation requires a clean reviewed worktree")
    print(json.dumps({"gate": "A3-local", "status": "passed", "external_requests": 0, "faults": 15}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
