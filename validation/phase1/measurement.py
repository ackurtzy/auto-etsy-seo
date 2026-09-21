"""Pure Phase 1 contracts for sanitized, idempotent Etsy observations."""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from enum import Enum
import hashlib
import html
import json
import os
from pathlib import Path
import re
import sqlite3
import time
from typing import Any, Iterable, Mapping
import unicodedata


class PaginationError(ValueError):
    """A paginated source cannot be proven complete."""


class EtsyReadError(RuntimeError):
    """An Etsy read failed in a way that needs explicit handling."""


class ApiFailure(str, Enum):
    RATE_LIMITED = "rate_limited"
    EXPIRED_OR_REVOKED_GRANT = "expired_or_revoked_grant"
    FORBIDDEN_SCOPE = "forbidden_scope"
    UNAVAILABLE_RESOURCE = "unavailable_resource"


class CounterState(str, Enum):
    VALID = "valid"
    UNKNOWN_ZERO = "unknown_zero"
    RESET = "reset"
    EPOCH_CHANGED = "epoch_changed"
    UNAVAILABLE = "unavailable"


@dataclass(frozen=True)
class CanonicalPageSet:
    items: list[dict[str, Any]]
    complete: bool
    reported_count: int


@dataclass(frozen=True)
class ReceiptAllocation:
    units_by_listing: dict[str, int]
    item_money_by_listing: dict[str, Decimal]
    item_money_total: Decimal
    currency_code: str | None
    money_known: bool
    reason: str | None = None


@dataclass(frozen=True)
class ObservationResult:
    revision_id: int | None
    quarantined: bool


def _text(value: Any) -> str:
    return unicodedata.normalize("NFC", html.unescape(str(value)))


def _copy_fields(source: Mapping[str, Any], names: Iterable[str]) -> dict[str, Any]:
    return {name: source[name] for name in names if name in source}


def _sanitize_money(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, Mapping):
        return None
    return _copy_fields(value, ("amount", "divisor", "currency_code"))


def sanitize_listing(payload: Mapping[str, Any]) -> dict[str, Any]:
    """Whitelist non-buyer listing evidence and normalize text deterministically."""

    result = _copy_fields(
        payload,
        (
            "listing_id",
            "state",
            "views",
            "quantity",
            "created_timestamp",
            "updated_timestamp",
            "ending_timestamp",
            "should_auto_renew",
            "is_personalizable",
            "is_customizable",
        ),
    )
    if "title" in payload:
        result["title"] = _text(payload["title"])
    if isinstance(payload.get("tags"), list):
        result["tags"] = [_text(tag) for tag in payload["tags"]]
    money = _sanitize_money(payload.get("price"))
    if money is not None:
        result["price"] = money
    return result


def _sanitize_transaction(payload: Mapping[str, Any]) -> dict[str, Any]:
    result = _copy_fields(
        payload,
        (
            "transaction_id",
            "listing_id",
            "receipt_id",
            "quantity",
            "create_timestamp",
            "created_timestamp",
            "paid_timestamp",
            "shipped_timestamp",
        ),
    )
    money = _sanitize_money(payload.get("price"))
    if money is not None:
        result["price"] = money
    return result


def sanitize_receipt(payload: Mapping[str, Any]) -> dict[str, Any]:
    """Whitelist receipt facts; buyer identity, address and personalization never survive."""

    result = _copy_fields(
        payload,
        (
            "receipt_id",
            "create_timestamp",
            "created_timestamp",
            "update_timestamp",
            "updated_timestamp",
            "is_paid",
            "is_shipped",
            "was_paid",
            "was_shipped",
            "was_canceled",
        ),
    )
    transactions = payload.get("transactions")
    result["transactions"] = [
        _sanitize_transaction(item)
        for item in transactions or []
        if isinstance(item, Mapping)
    ]
    refunds = payload.get("refunds")
    if isinstance(refunds, list) and refunds:
        # Retain only non-identifying amount/timestamp evidence. Allocation is not inferred.
        result["refunds"] = [
            {
                **_copy_fields(item, ("created_timestamp", "status")),
                **({"amount": money} if (money := _sanitize_money(item.get("amount"))) else {}),
            }
            for item in refunds
            if isinstance(item, Mapping)
        ]
    return result


def canonicalize_pages(
    pages: Iterable[Mapping[str, Any]], *, id_field: str
) -> CanonicalPageSet:
    unique_pages: dict[int, tuple[int, list[Mapping[str, Any]]]] = {}
    reported_counts: set[int] = set()
    for page in pages:
        offset = int(page.get("offset", 0))
        count = int(page["count"])
        results = page.get("results")
        if offset < 0 or count < 0 or not isinstance(results, list):
            raise PaginationError("malformed pagination envelope")
        reported_counts.add(count)
        existing = unique_pages.get(offset)
        candidate = (count, results)
        if existing is not None and existing != candidate:
            raise PaginationError("conflicting page at the same offset")
        unique_pages[offset] = candidate
    if len(reported_counts) != 1:
        raise PaginationError("source count changed during pagination")
    reported_count = next(iter(reported_counts), 0)
    expected_offset = 0
    canonical: dict[str, dict[str, Any]] = {}
    for offset in sorted(unique_pages):
        if offset != expected_offset:
            raise PaginationError("pagination has a missing page")
        _, results = unique_pages[offset]
        for result in results:
            if id_field not in result:
                raise PaginationError(f"item is missing {id_field}")
            key = str(result[id_field])
            value = dict(result)
            if key in canonical and canonical[key] != value:
                raise PaginationError("duplicate identity has conflicting payloads")
            canonical[key] = value
        expected_offset += len(results)
    if len(canonical) != reported_count or expected_offset < reported_count:
        raise PaginationError("pagination ended before the reported count")
    items = sorted(canonical.values(), key=lambda item: str(item[id_field]))
    return CanonicalPageSet(items=items, complete=True, reported_count=reported_count)


def _money_decimal(value: Any) -> tuple[Decimal, str] | None:
    if not isinstance(value, Mapping):
        return None
    try:
        amount = Decimal(str(value["amount"]))
        divisor = Decimal(str(value["divisor"]))
        currency = str(value["currency_code"])
    except (KeyError, InvalidOperation):
        return None
    if not amount.is_finite() or not divisor.is_finite() or amount < 0 or divisor <= 0 or not currency:
        return None
    try:
        result = amount / divisor
    except InvalidOperation:
        return None
    return (result, currency) if result.is_finite() else None


def receipt_allocation(receipt: Mapping[str, Any]) -> ReceiptAllocation:
    units: dict[str, int] = {}
    money: dict[str, Decimal] = {}
    currency: str | None = None
    has_unallocated_refund = bool(receipt.get("refunds"))
    transactions = receipt.get("transactions", [])
    if not transactions:
        return ReceiptAllocation(units, money, Decimal("0"), None, False, "transactions unavailable")
    seen: dict[str, str] = {}
    for transaction in transactions:
        raw_transaction_id = transaction.get("transaction_id")
        raw_listing_id = transaction.get("listing_id")
        transaction_id = "" if raw_transaction_id is None else str(raw_transaction_id)
        listing_id = "" if raw_listing_id is None else str(raw_listing_id)
        quantity = transaction.get("quantity")
        fingerprint = json.dumps(transaction, sort_keys=True, separators=(",", ":"))
        if transaction_id in seen:
            if seen[transaction_id] != fingerprint:
                return ReceiptAllocation(units, money, sum(money.values(), Decimal("0")), currency, False, "conflicting duplicate transaction")
            continue
        if not transaction_id or not listing_id:
            return ReceiptAllocation(units, money, sum(money.values(), Decimal("0")), currency, False, "transaction identity unavailable")
        seen[transaction_id] = fingerprint
        if not isinstance(quantity, int) or quantity < 1:
            return ReceiptAllocation(units, money, sum(money.values(), Decimal("0")), currency, False, "quantity unavailable")
        parsed = _money_decimal(transaction.get("price"))
        if parsed is None:
            return ReceiptAllocation(units, money, sum(money.values(), Decimal("0")), currency, False, "malformed money")
        unit_price, line_currency = parsed
        if currency is not None and currency != line_currency:
            return ReceiptAllocation(units, money, sum(money.values(), Decimal("0")), None, False, "mixed currencies")
        currency = line_currency
        units[listing_id] = units.get(listing_id, 0) + quantity
        money[listing_id] = money.get(listing_id, Decimal("0")) + unit_price * quantity
    total = sum(money.values(), Decimal("0"))
    if has_unallocated_refund:
        return ReceiptAllocation(units, money, total, currency, False, "refund allocation unavailable")
    return ReceiptAllocation(units, money, total, currency, True)


def classify_counter(
    previous: int | None,
    current: int | None,
    epoch: str,
    *,
    previous_epoch: str | None = None,
) -> CounterState:
    if current is None:
        return CounterState.UNAVAILABLE
    if previous_epoch is not None and epoch != previous_epoch:
        return CounterState.EPOCH_CHANGED
    if current == 0 and previous is None:
        return CounterState.UNKNOWN_ZERO
    if previous is not None and current < previous:
        return CounterState.RESET
    return CounterState.VALID


def classify_http_failure(status: int) -> ApiFailure:
    mapping = {
        429: ApiFailure.RATE_LIMITED,
        401: ApiFailure.EXPIRED_OR_REVOKED_GRANT,
        403: ApiFailure.FORBIDDEN_SCOPE,
        404: ApiFailure.UNAVAILABLE_RESOURCE,
    }
    if status not in mapping:
        raise EtsyReadError(f"unclassified Etsy read failure: HTTP {status}")
    return mapping[status]


class ValidationStore:
    """Disposable SQLite store for immutable sanitized observations."""

    def __init__(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self._connection = sqlite3.connect(path)
        os.chmod(path, 0o600)
        self._connection.executescript(
            """
            PRAGMA foreign_keys = ON;
            CREATE TABLE IF NOT EXISTS revisions (
              revision_id INTEGER PRIMARY KEY,
              entity_kind TEXT NOT NULL,
              entity_id TEXT NOT NULL,
              source_version TEXT NOT NULL,
              payload_sha256 TEXT NOT NULL,
              payload_json TEXT NOT NULL,
              recorded_at INTEGER NOT NULL,
              UNIQUE(entity_kind, entity_id, source_version, payload_sha256)
            );
            CREATE TABLE IF NOT EXISTS canonical_pointers (
              entity_kind TEXT NOT NULL,
              entity_id TEXT NOT NULL,
              revision_id INTEGER NOT NULL REFERENCES revisions(revision_id),
              PRIMARY KEY(entity_kind, entity_id)
            );
            CREATE TABLE IF NOT EXISTS quarantines (
              quarantine_id INTEGER PRIMARY KEY,
              entity_kind TEXT NOT NULL,
              entity_id TEXT NOT NULL,
              source_version TEXT NOT NULL,
              payload_sha256 TEXT NOT NULL,
              reason TEXT NOT NULL,
              recorded_at INTEGER NOT NULL
            );
            """
        )
        for table in ("revisions", "quarantines"):
            columns = {
                str(row[1]) for row in self._connection.execute(f"PRAGMA table_info({table})")
            }
            if "recorded_at" not in columns:
                self._connection.execute(f"ALTER TABLE {table} ADD COLUMN recorded_at INTEGER")
                self._connection.execute(
                    f"UPDATE {table} SET recorded_at=? WHERE recorded_at IS NULL", (int(time.time()),)
                )
        self._connection.commit()

    @staticmethod
    def _canonical_json(payload: Mapping[str, Any]) -> str:
        return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)

    @staticmethod
    def _version_key(source_version: str) -> tuple[str, int | str]:
        match = re.fullmatch(r"v?(\d+)", source_version)
        if match:
            return ("test", int(match.group(1)))
        provider = re.fullmatch(r"provider:(\d+)", source_version)
        if provider:
            return ("provider", int(provider.group(1)))
        if source_version.startswith("observed:"):
            return ("observed", source_version.removeprefix("observed:"))
        raise ValueError("unsupported source version format")

    def observe(
        self, entity_kind: str, entity_id: str, source_version: str, payload: Mapping[str, Any]
    ) -> ObservationResult:
        encoded = self._canonical_json(payload)
        incoming_key = self._version_key(source_version)
        digest = hashlib.sha256(encoded.encode("utf-8")).hexdigest()
        existing = self._connection.execute(
            "SELECT revision_id, payload_sha256 FROM revisions WHERE entity_kind=? AND entity_id=? AND source_version=?",
            (entity_kind, entity_id, source_version),
        ).fetchall()
        if existing and all(row[1] != digest for row in existing):
            self._connection.execute(
                "INSERT INTO quarantines(entity_kind, entity_id, source_version, payload_sha256, reason, recorded_at) VALUES(?,?,?,?,?,?)",
                (entity_kind, entity_id, source_version, digest, "conflicting_same_version_payload", int(time.time())),
            )
            self._connection.commit()
            return ObservationResult(revision_id=None, quarantined=True)
        current = self._connection.execute(
            "SELECT r.source_version FROM canonical_pointers p JOIN revisions r ON r.revision_id=p.revision_id "
            "WHERE p.entity_kind=? AND p.entity_id=?",
            (entity_kind, entity_id),
        ).fetchone()
        current_key = self._version_key(str(current[0])) if current is not None else None
        if current_key is not None and current_key[0] != incoming_key[0]:
            self._connection.execute(
                "INSERT INTO quarantines(entity_kind, entity_id, source_version, payload_sha256, reason, recorded_at) VALUES(?,?,?,?,?,?)",
                (entity_kind, entity_id, source_version, digest, "incomparable_source_version", int(time.time())),
            )
            self._connection.commit()
            return ObservationResult(revision_id=None, quarantined=True)
        self._connection.execute(
            "INSERT OR IGNORE INTO revisions(entity_kind, entity_id, source_version, payload_sha256, payload_json, recorded_at) VALUES(?,?,?,?,?,?)",
            (entity_kind, entity_id, source_version, digest, encoded, int(time.time())),
        )
        revision_id = self._connection.execute(
            "SELECT revision_id FROM revisions WHERE entity_kind=? AND entity_id=? AND source_version=? AND payload_sha256=?",
            (entity_kind, entity_id, source_version, digest),
        ).fetchone()[0]
        if current_key is None or incoming_key >= current_key:
            self._connection.execute(
                "INSERT INTO canonical_pointers(entity_kind, entity_id, revision_id) VALUES(?,?,?) "
                "ON CONFLICT(entity_kind, entity_id) DO UPDATE SET revision_id=excluded.revision_id",
                (entity_kind, entity_id, revision_id),
            )
        self._connection.commit()
        return ObservationResult(revision_id=revision_id, quarantined=False)

    def canonical(self, entity_kind: str, entity_id: str) -> dict[str, Any]:
        row = self._connection.execute(
            "SELECT r.payload_json FROM canonical_pointers p JOIN revisions r ON r.revision_id=p.revision_id "
            "WHERE p.entity_kind=? AND p.entity_id=?",
            (entity_kind, entity_id),
        ).fetchone()
        if row is None:
            raise KeyError((entity_kind, entity_id))
        return json.loads(row[0])

    def revision_count(self, entity_kind: str, entity_id: str) -> int:
        return int(
            self._connection.execute(
                "SELECT COUNT(*) FROM revisions WHERE entity_kind=? AND entity_id=?",
                (entity_kind, entity_id),
            ).fetchone()[0]
        )

    def purge_older_than(self, *, days: int) -> int:
        if days < 1:
            raise ValueError("retention days must be positive")
        cutoff = int(time.time()) - days * 24 * 60 * 60
        old_ids = [
            row[0]
            for row in self._connection.execute(
                "SELECT revision_id FROM revisions WHERE recorded_at < ?", (cutoff,)
            ).fetchall()
        ]
        if old_ids:
            placeholders = ",".join("?" for _ in old_ids)
            self._connection.execute(
                f"DELETE FROM canonical_pointers WHERE revision_id IN ({placeholders})", old_ids
            )
            self._connection.execute(
                f"DELETE FROM revisions WHERE revision_id IN ({placeholders})", old_ids
            )
        self._connection.execute("DELETE FROM quarantines WHERE recorded_at < ?", (cutoff,))
        self._connection.commit()
        return len(old_ids)
