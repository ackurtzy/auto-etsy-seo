"""Run one bounded, sanitized Phase 1 Etsy observation."""

from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
from decimal import Decimal
import hashlib
import json
from pathlib import Path
from typing import Any

import requests

from validation.phase1.etsy_readonly import (
    CredentialStore,
    DailyRequestLedger,
    EtsyReadOnlyClient,
    Phase1Authorization,
    RequestBudget,
)
from validation.phase1.measurement import (
    PaginationError,
    ValidationStore,
    canonicalize_pages,
    receipt_allocation,
)


def decimal_strings(values: dict[str, Decimal]) -> dict[str, str]:
    return {key: str(value) for key, value in sorted(values.items())}


def run(args: argparse.Namespace) -> dict[str, Any]:
    authorization = Phase1Authorization.load(
        args.authorization, args.verification_key, args.tracked_gate
    )
    session = requests.Session()
    budget = RequestBudget(
        max_requests=args.max_requests,
        daily_ledger=DailyRequestLedger(args.daily_ledger, daily_limit=100),
    )
    client = EtsyReadOnlyClient(
        authorization=authorization,
        credentials=CredentialStore(args.credentials),
        transport=session,
        budget=budget,
    )
    listing_pages = client.fetch_active_listing_pages(limit=100)
    listings = canonicalize_pages(listing_pages, id_field="listing_id")
    selected_by_id = {
        str(item["listing_id"]): item
        for item in listings.items
        if str(item["listing_id"]) in authorization.listing_ids
    }
    selected_statuses: list[dict[str, Any]] = []
    for listing_id in sorted(authorization.listing_ids):
        listing = selected_by_id.get(listing_id)
        if listing is not None:
            selected_statuses.append({"listing_id": listing_id, "availability": "active"})
            continue
        try:
            listing = client.fetch_listing(listing_id)
        except RuntimeError as exc:
            selected_statuses.append(
                {"listing_id": listing_id, "availability": "unavailable", "reason": str(exc).split(":", 1)[-1].strip()}
            )
            continue
        selected_by_id[listing_id] = listing
        selected_statuses.append(
            {"listing_id": listing_id, "availability": str(listing.get("state") or "available_nonactive")}
        )

    min_created = int((datetime.now(timezone.utc) - timedelta(days=args.receipt_days)).timestamp())
    receipt_error: str | None = None
    receipt_pages: list[dict[str, Any]] | None = None
    try:
        receipt_pages = client.fetch_receipt_pages(limit=100, min_created=min_created)
    except RuntimeError as exc:
        receipt_error = str(exc).split(":", 1)[-1].strip()
    receipts = canonicalize_pages(receipt_pages, id_field="receipt_id") if receipt_pages is not None else None

    observed_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    store = ValidationStore(args.store)
    store.purge_older_than(days=7)
    for listing in listings.items:
        source_version = f"observed:{observed_at}"
        store.observe("listing", str(listing["listing_id"]), source_version, listing)
    allocations: list[dict[str, Any]] = []
    known_money_receipts = 0
    for receipt in receipts.items if receipts is not None else []:
        provider_version = receipt.get("updated_timestamp") or receipt.get("update_timestamp") or receipt.get("created_timestamp") or receipt.get("create_timestamp")
        source_version = f"provider:{provider_version}" if provider_version is not None else f"observed:{observed_at}"
        store.observe("receipt", str(receipt["receipt_id"]), source_version, receipt)
        allocation = receipt_allocation(receipt)
        if allocation.money_known:
            known_money_receipts += 1
        allocations.append(
            {
                "receipt_id": receipt["receipt_id"],
                "units_by_listing": allocation.units_by_listing,
                "item_money_by_listing": decimal_strings(allocation.item_money_by_listing),
                "item_money_total": str(allocation.item_money_total),
                "currency_code": allocation.currency_code,
                "money_known": allocation.money_known,
                "reason": allocation.reason,
            }
        )
    selected = [selected_by_id[key] for key in sorted(selected_by_id)]
    report = {
        "schema_version": "phase1-reconciliation-v1",
        "observed_at": observed_at,
        "shop_id": authorization.shop_id,
        "request_count": budget.used,
        "listing_coverage": {"complete": listings.complete, "count": listings.reported_count},
        "receipt_coverage": {
            "complete": receipts.complete if receipts is not None else False,
            "count": receipts.reported_count if receipts is not None else None,
            "min_created": min_created,
            "window_days": args.receipt_days,
            "unavailable_reason": receipt_error,
        },
        "selected_listings": selected,
        "selected_listing_statuses": selected_statuses,
        "receipt_allocations": allocations,
        "quality": {
            "selected_listing_count": len(selected_statuses),
            "receipt_count": len(receipts.items) if receipts is not None else None,
            "known_money_receipt_count": known_money_receipts,
            "buyer_data_persisted": False,
            "views_semantics": "unresolved_pending_seven_day_boundary_observation_and_owner_comparison",
            "refund_allocation": "unknown_when_source_has_receipts_refunds_without_line_allocation",
        },
    }
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    args.report.chmod(0o600)
    return {
        "status": "observation_recorded" if receipts is not None else "partial_observation_recorded",
        "request_count": budget.used,
        "listing_count": listings.reported_count,
        "selected_listing_count": len(selected_statuses),
        "receipt_count": receipts.reported_count if receipts is not None else None,
        "known_money_receipt_count": known_money_receipts,
        "report_sha256": hashlib.sha256(args.report.read_bytes()).hexdigest(),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--authorization", type=Path, default=Path("docs/gates/private/G0.json"))
    parser.add_argument("--verification-key", type=Path, default=Path("docs/gates/private/owner-verification.key"))
    parser.add_argument("--tracked-gate", type=Path, default=Path("docs/gates/G0.json"))
    parser.add_argument("--credentials", type=Path, default=Path("backend/keys.json"))
    parser.add_argument("--store", type=Path, default=Path("docs/gates/private/phase1.sqlite3"))
    parser.add_argument("--report", type=Path, default=Path("docs/gates/private/phase1-reconciliation.json"))
    parser.add_argument("--daily-ledger", type=Path, default=Path("docs/gates/private/phase1-request-budget.json"))
    parser.add_argument("--receipt-days", type=int, default=30)
    parser.add_argument("--max-requests", type=int, default=20)
    args = parser.parse_args()
    if not 1 <= args.receipt_days <= 90:
        parser.error("receipt-days must be between 1 and 90")
    if not 2 <= args.max_requests <= 25:
        parser.error("max-requests must be between 2 and 25")
    try:
        summary = run(args)
    except PaginationError as exc:
        raise SystemExit(f"incomplete source coverage: {exc}") from exc
    print(json.dumps(summary, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
