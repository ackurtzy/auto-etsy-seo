"""Credential-free validator for the Phase 4 gate workspace."""

from __future__ import annotations

import json
from pathlib import Path
import sqlite3
import subprocess
import tempfile


ROOT = Path(__file__).resolve().parents[2]
EXPECTED_TABLES = {
    "gate_review_runs", "gate_evidence_items", "gate_review_responses", "gate_evidence_artifacts",
    "gate_fault_results", "gate_approvals", "etsy_read_budget_daily", "etsy_read_reservations",
}


def run(command: list[str]) -> str:
    return subprocess.run(command, cwd=ROOT, check=True, capture_output=True, text=True).stdout


def validate_schema() -> None:
    with tempfile.TemporaryDirectory(prefix="auto-etsy-seo-phase4-") as directory:
        connection = sqlite3.connect(Path(directory) / "phase4.sqlite3")
        try:
            for migration in sorted((ROOT / "migrations").glob("*.sql")):
                connection.executescript(migration.read_text(encoding="utf-8"))
            tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            if not EXPECTED_TABLES.issubset(tables):
                raise AssertionError("Phase 4 schema is incomplete")
            columns = {row[1] for row in connection.execute("PRAGMA table_info(oauth_states)")}
            if "requested_scopes_json" not in columns:
                raise AssertionError("OAuth state does not bind the requested scope mode")
            table_sql = connection.execute("SELECT sql FROM sqlite_master WHERE name='etsy_read_budget_daily'").fetchone()[0]
            if "BETWEEN 0 AND 12" not in table_sql:
                raise AssertionError("Etsy read budget lacks its database-enforced ceiling")
        finally:
            connection.close()


def validate_runtime_boundaries() -> None:
    config = json.loads((ROOT / "apps/worker/wrangler.jsonc").read_text(encoding="utf-8"))
    variables = config.get("vars", {})
    if variables.get("ETSY_READ_EGRESS_ENABLED") != "false":
        raise AssertionError("read egress must default disabled")
    if variables.get("ETSY_EGRESS_ENABLED") != "false" or variables.get("TITLE_WRITES_ENABLED") != "false":
        raise AssertionError("write egress and title writes must default disabled")
    index = (ROOT / "apps/worker/src/index.ts").read_text(encoding="utf-8")
    if 'gates/:gateId/runs"' in index:
        raise AssertionError("clients must not be able to submit authoritative gate runs")
    for required in ("/gates/G1/collect", "/gates/:gateId/prepare", "/artifacts"):
        if required not in index:
            raise AssertionError(f"Phase 4 route missing: {required}")
    collector = (ROOT / "apps/worker/src/g1-collector.ts").read_text(encoding="utf-8")
    for required in ("COLLECTION_REQUEST_LIMIT = 12", "MAX_PAGES_PER_COLLECTION = 3", "ETSY_READ_EGRESS_ENABLED", "transaction_units"):
        if required not in collector:
            raise AssertionError(f"G1 collector boundary missing: {required}")
    client = (ROOT / "packages/etsy/src/client.ts").read_text(encoding="utf-8")
    if 'redirect: "manual"' not in client or "description" in client.split("async getListingsByShop", 1)[1].split("async getShopReceipts", 1)[0]:
        raise AssertionError("read-only Etsy transport is not explicitly sanitized and redirect closed")


def validate_product_workspace() -> None:
    app = (ROOT / "apps/web/src/App.tsx").read_text(encoding="utf-8")
    domain = (ROOT / "packages/gates/src/index.ts").read_text(encoding="utf-8")
    for copy in ("Trust the data", "Directional studies only", "F01–F15", "No Etsy changes can be made from this screen", "Approve Gate 1", "Approve Gate 2", "Approve Gate 3"):
        if copy not in app and copy not in domain:
            raise AssertionError(f"human-readable gate workspace is missing: {copy}")
    if not (ROOT / "apps/web/public/assets/botanical-journal.png").is_file():
        raise AssertionError("the approved Phase 4 visual asset is missing")


def main() -> int:
    validate_schema()
    validate_runtime_boundaries()
    validate_product_workspace()
    run(["npm", "run", "typecheck:phase4"])
    run(["npm", "run", "test:phase4"])
    print(json.dumps({"phase": 4, "status": "passed", "external_requests": 0}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
