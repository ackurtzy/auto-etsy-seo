from __future__ import annotations

from decimal import Decimal
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from validation.phase1.measurement import (
    ApiFailure,
    CounterState,
    EtsyReadError,
    PaginationError,
    ValidationStore,
    canonicalize_pages,
    classify_counter,
    classify_http_failure,
    receipt_allocation,
    sanitize_listing,
    sanitize_receipt,
)


class SanitizationTests(unittest.TestCase):
    def test_listing_normalizes_unicode_and_entities(self) -> None:
        listing = sanitize_listing(
            {
                "listing_id": 10,
                "title": "Cafe\u0301 &amp; Tea",
                "tags": ["Paper &amp; ink", "Cafe\u0301"],
                "state": "active",
                "views": 4,
                "url": "https://example.invalid/listing/10",
                "user_id": 999,
            }
        )
        self.assertEqual(listing["title"], "Café & Tea")
        self.assertEqual(listing["tags"], ["Paper & ink", "Café"])
        self.assertNotIn("user_id", listing)
        self.assertNotIn("url", listing)

    def test_receipt_strips_buyer_and_address_data_before_persistence(self) -> None:
        receipt = sanitize_receipt(
            {
                "receipt_id": 20,
                "buyer_user_id": 123,
                "name": "Private Buyer",
                "first_line": "1 Private Street",
                "email": "buyer@example.invalid",
                "is_paid": True,
                "transactions": [
                    {
                        "transaction_id": 200,
                        "listing_id": 10,
                        "buyer_user_id": 123,
                        "quantity": 2,
                        "price": {"amount": 1250, "divisor": 100, "currency_code": "USD"},
                        "variations": [{"formatted_name": "Name", "formatted_value": "Private"}],
                    }
                ],
            }
        )
        encoded = json.dumps(receipt).lower()
        for forbidden in ("buyer", "address", "email", "private", "first_line"):
            self.assertNotIn(forbidden, encoded)
        self.assertEqual(receipt["transactions"][0]["quantity"], 2)


class PaginationTests(unittest.TestCase):
    def test_duplicate_and_reordered_pages_are_idempotent(self) -> None:
        a = {"offset": 0, "count": 3, "results": [{"listing_id": 1}, {"listing_id": 2}]}
        b = {"offset": 2, "count": 3, "results": [{"listing_id": 3}]}
        first = canonicalize_pages([a, b, a], id_field="listing_id")
        second = canonicalize_pages([b, a], id_field="listing_id")
        self.assertTrue(first.complete)
        self.assertEqual(first.items, second.items)

    def test_missing_final_page_cannot_be_complete(self) -> None:
        with self.assertRaises(PaginationError):
            canonicalize_pages(
                [{"offset": 0, "count": 3, "results": [{"listing_id": 1}, {"listing_id": 2}]}],
                id_field="listing_id",
            )


class MoneyTests(unittest.TestCase):
    def test_line_money_and_quantity_reconcile_without_receipt_duplication(self) -> None:
        receipt = sanitize_receipt(
            {
                "receipt_id": 99,
                "is_paid": True,
                "transactions": [
                    {
                        "transaction_id": 1,
                        "listing_id": 11,
                        "quantity": 2,
                        "price": {"amount": 500, "divisor": 100, "currency_code": "USD"},
                    },
                    {
                        "transaction_id": 2,
                        "listing_id": 12,
                        "quantity": 1,
                        "price": {"amount": 700, "divisor": 100, "currency_code": "USD"},
                    },
                ],
            }
        )
        allocation = receipt_allocation(receipt)
        self.assertEqual(allocation.units_by_listing, {"11": 2, "12": 1})
        self.assertEqual(allocation.item_money_by_listing, {"11": Decimal("10"), "12": Decimal("7")})
        self.assertEqual(allocation.item_money_total, Decimal("17"))

    def test_malformed_money_and_missing_refund_allocation_are_unknown(self) -> None:
        malformed = sanitize_receipt(
            {
                "receipt_id": 99,
                "transactions": [
                    {"transaction_id": 1, "listing_id": 11, "quantity": 1,
                     "price": {"amount": 500, "divisor": 0, "currency_code": "USD"}}
                ],
            }
        )
        self.assertFalse(receipt_allocation(malformed).money_known)

        refunded = sanitize_receipt(
            {
                "receipt_id": 100,
                "transactions": [
                    {"transaction_id": 2, "listing_id": 11, "quantity": 1,
                     "price": {"amount": 500, "divisor": 100, "currency_code": "USD"}}
                ],
                "refunds": [{"amount": {"amount": 100, "divisor": 100, "currency_code": "USD"}}],
            }
        )
        refunded_allocation = receipt_allocation(refunded)
        self.assertFalse(refunded_allocation.money_known)
        self.assertEqual(refunded_allocation.units_by_listing, {"11": 1})

    def test_nonfinite_negative_money_and_null_identity_are_unknown(self) -> None:
        for amount, divisor in (("NaN", 100), ("Infinity", 100), (-1, 100), (100, "NaN")):
            receipt = sanitize_receipt(
                {"receipt_id": 1, "transactions": [{
                    "transaction_id": 1, "listing_id": 11, "quantity": 1,
                    "price": {"amount": amount, "divisor": divisor, "currency_code": "USD"},
                }]}
            )
            self.assertFalse(receipt_allocation(receipt).money_known)
        missing_identity = sanitize_receipt(
            {"receipt_id": 2, "transactions": [{
                "transaction_id": None, "listing_id": None, "quantity": 1,
                "price": {"amount": 100, "divisor": 100, "currency_code": "USD"},
            }]}
        )
        self.assertFalse(receipt_allocation(missing_identity).money_known)

    def test_empty_or_conflicting_duplicate_transactions_are_unknown(self) -> None:
        self.assertFalse(receipt_allocation({"receipt_id": 1, "transactions": []}).money_known)
        duplicate = {
            "receipt_id": 2,
            "transactions": [
                {"transaction_id": 1, "listing_id": 11, "quantity": 1,
                 "price": {"amount": 500, "divisor": 100, "currency_code": "USD"}},
                {"transaction_id": 1, "listing_id": 12, "quantity": 1,
                 "price": {"amount": 700, "divisor": 100, "currency_code": "USD"}},
            ],
        }
        self.assertFalse(receipt_allocation(duplicate).money_known)


class CounterAndFailureTests(unittest.TestCase):
    def test_zero_reset_epoch_change_and_unavailable_are_unknown(self) -> None:
        self.assertEqual(classify_counter(None, 0, "a"), CounterState.UNKNOWN_ZERO)
        self.assertEqual(classify_counter(10, 9, "a"), CounterState.RESET)
        self.assertEqual(classify_counter(10, 11, "b", previous_epoch="a"), CounterState.EPOCH_CHANGED)
        self.assertEqual(classify_counter(10, None, "a"), CounterState.UNAVAILABLE)
        self.assertEqual(classify_counter(10, 11, "a", previous_epoch="a"), CounterState.VALID)

    def test_http_failures_are_explicit(self) -> None:
        self.assertEqual(classify_http_failure(429), ApiFailure.RATE_LIMITED)
        self.assertEqual(classify_http_failure(401), ApiFailure.EXPIRED_OR_REVOKED_GRANT)
        self.assertEqual(classify_http_failure(403), ApiFailure.FORBIDDEN_SCOPE)
        self.assertEqual(classify_http_failure(404), ApiFailure.UNAVAILABLE_RESOURCE)
        with self.assertRaises(EtsyReadError):
            classify_http_failure(500)


class StoreTests(unittest.TestCase):
    def test_corrections_append_revisions_and_move_pointer(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = ValidationStore(Path(directory) / "phase1.sqlite3")
            first = store.observe("listing", "1", "v1", {"views": 4})
            second = store.observe("listing", "1", "v2", {"views": 5})
            self.assertNotEqual(first.revision_id, second.revision_id)
            self.assertEqual(store.canonical("listing", "1")["views"], 5)
            self.assertEqual(store.revision_count("listing", "1"), 2)

    def test_conflicting_same_version_is_quarantined(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = ValidationStore(Path(directory) / "phase1.sqlite3")
            store.observe("listing", "1", "v1", {"views": 4})
            conflict = store.observe("listing", "1", "v1", {"views": 5})
            self.assertTrue(conflict.quarantined)
            self.assertEqual(store.canonical("listing", "1")["views"], 4)

    def test_out_of_order_revision_does_not_move_pointer_backwards(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = ValidationStore(Path(directory) / "phase1.sqlite3")
            store.observe("listing", "1", "v2", {"views": 5})
            store.observe("listing", "1", "v1", {"views": 4})
            self.assertEqual(store.canonical("listing", "1")["views"], 5)
            self.assertEqual(store.revision_count("listing", "1"), 2)

    def test_same_day_observation_versions_are_distinct_and_mixed_namespaces_quarantine(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = ValidationStore(Path(directory) / "phase1.sqlite3")
            store.observe("listing", "1", "observed:2026-09-21T00:00:00Z", {"views": 4})
            later = store.observe("listing", "1", "observed:2026-09-21T12:00:00Z", {"views": 5})
            self.assertFalse(later.quarantined)
            self.assertEqual(store.canonical("listing", "1")["views"], 5)
            mixed = store.observe("listing", "1", "provider:123", {"views": 6})
            self.assertTrue(mixed.quarantined)
            self.assertEqual(store.canonical("listing", "1")["views"], 5)

    def test_store_is_private_and_purges_expired_diagnostics(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "phase1.sqlite3"
            store = ValidationStore(path)
            with patch("validation.phase1.measurement.time.time", return_value=1_000_000):
                store.observe("listing", "1", "v1", {"views": 4})
            with patch("validation.phase1.measurement.time.time", return_value=1_000_000 + 8 * 86400):
                self.assertEqual(store.purge_older_than(days=7), 1)
            self.assertEqual(store.revision_count("listing", "1"), 0)
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)


if __name__ == "__main__":
    unittest.main()
