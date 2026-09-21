from __future__ import annotations

from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import json
import multiprocessing
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock

from validation.phase1.etsy_readonly import (
    AuthorizationDenied,
    CredentialStore,
    DailyRequestLedger,
    EtsyReadOnlyClient,
    NoRedirectRequestsTransport,
    Phase1Authorization,
    RequestBudget,
)


class FakeResponse:
    def __init__(self, status: int, payload: dict, headers: dict | None = None) -> None:
        self.status_code = status
        self._payload = payload
        self.headers = headers or {}

    def json(self) -> dict:
        return self._payload


class FakeTransport:
    def __init__(self, responses: list[FakeResponse]) -> None:
        self.responses = list(responses)
        self.calls: list[dict] = []

    def get(self, url: str, *, headers: dict, params: dict, timeout: int) -> FakeResponse:
        self.calls.append({"method": "GET", "url": url, "headers": headers, "params": params})
        return self.responses.pop(0)


class FakeSession:
    def __init__(self, response: FakeResponse) -> None:
        self.response = response
        self.calls: list[dict] = []

    def get(self, url: str, **kwargs: object) -> FakeResponse:
        self.calls.append({"url": url, **kwargs})
        return self.response


def consume_ledger(path: str, count: int) -> None:
    for _ in range(count):
        DailyRequestLedger(Path(path), daily_limit=100).consume()


def signed_authorization(directory: Path, *, capabilities: list[str]) -> tuple[Path, Path, Path]:
    key = b"owner-test-key-with-at-least-32-bytes"
    key_path = directory / "owner.key"
    key_path.write_bytes(key)
    record = {
        "gate_id": "G0",
        "status": "passed_with_explicitly_disabled_capabilities",
        "approved_scope": {
            "environment": "read-only-validation",
            "shop_id": "23574688",
            "listing_ids": ["11", "12"],
            "capabilities": capabilities,
        },
        "owner_approver": "owner",
        "approved_at": datetime.now(timezone.utc).isoformat(),
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat(),
        "evidence": [{"artifact_id": "test", "sha256": "0" * 64, "source_type": "owner_scope_record", "reviewed_at": datetime.now(timezone.utc).isoformat(), "result": "supports_scope"}],
    }
    canonical = json.dumps(record, sort_keys=True, separators=(",", ":")).encode()
    record["owner_signature"] = hmac.new(key, canonical, hashlib.sha256).hexdigest()
    record_path = directory / "G0.private.json"
    record_path.write_text(json.dumps(record))
    tracked_path = directory / "G0.json"
    tracked_path.write_text(json.dumps({
        "status": "passed_with_explicitly_disabled_capabilities",
        "scope": {"shop_id": f"sha256:{hashlib.sha256(b'23574688').hexdigest()}"},
        "canary_permit_reference": f"sha256:{hashlib.sha256(record_path.read_bytes()).hexdigest()}",
    }))
    return record_path, key_path, tracked_path


class AuthorizationTests(unittest.TestCase):
    def test_signed_exact_scope_is_required(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            record, key, tracked = signed_authorization(root, capabilities=["listing_read"])
            authorization = Phase1Authorization.load(record, key, tracked)
            authorization.authorize("GET", "/shops/23574688/listings/active", "listing_read")
            with self.assertRaises(AuthorizationDenied):
                authorization.authorize("PATCH", "/shops/23574688/listings/11", "listing_read")
            with self.assertRaises(AuthorizationDenied):
                authorization.authorize("GET", "/shops/999/listings/active", "listing_read")
            with self.assertRaises(AuthorizationDenied):
                authorization.authorize("GET", "/shops/23574688/receipts", "receipt_read")

    def test_bad_signature_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            record, key, tracked = signed_authorization(root, capabilities=["listing_read"])
            payload = json.loads(record.read_text())
            payload["approved_scope"]["shop_id"] = "1"
            record.write_text(json.dumps(payload))
            with self.assertRaises(AuthorizationDenied):
                Phase1Authorization.load(record, key, tracked)

    def test_private_record_must_match_tracked_g0_hash(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            record, key, tracked = signed_authorization(root, capabilities=["listing_read"])
            payload = json.loads(tracked.read_text())
            payload["canary_permit_reference"] = "sha256:" + "0" * 64
            tracked.write_text(json.dumps(payload))
            with self.assertRaisesRegex(AuthorizationDenied, "not bound"):
                Phase1Authorization.load(record, key, tracked)


class ClientTests(unittest.TestCase):
    def test_production_transport_never_follows_redirects(self) -> None:
        for location in (
            "https://example.com/collect",
            "https://openapi.etsy.com/v3/application/listings/other",
        ):
            session = FakeSession(FakeResponse(302, {}, {"location": location}))
            transport = NoRedirectRequestsTransport(session=session)
            response = transport.get(
                "https://openapi.etsy.com/v3/application/listings/11",
                headers={"x-api-key": "secret", "Authorization": "Bearer secret"},
                params={},
                timeout=30,
            )
            self.assertEqual(response.status_code, 302)
            self.assertEqual(len(session.calls), 1)
            self.assertIs(session.calls[0]["allow_redirects"], False)

    def test_redirect_response_is_explicitly_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            record, key, tracked = signed_authorization(root, capabilities=["listing_read"])
            credentials = root / "keys.json"
            credentials.write_text(json.dumps({"keystring": "k", "shared_secret": "s", "access_token": "a"}))
            client = EtsyReadOnlyClient(
                authorization=Phase1Authorization.load(record, key, tracked),
                credentials=CredentialStore(credentials),
                transport=FakeTransport([FakeResponse(302, {}, {"location": "https://example.com/collect"})]),
                budget=RequestBudget(max_requests=1),
            )
            with self.assertRaisesRegex(RuntimeError, "redirect_disallowed"):
                client.fetch_listing("11")
    def test_listing_pages_are_bounded_and_sanitized(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            record, key, tracked = signed_authorization(root, capabilities=["listing_read"])
            credentials = root / "keys.json"
            credentials.write_text(json.dumps({"keystring": "k", "shared_secret": "s", "access_token": "a", "refresh_token": "r"}))
            transport = FakeTransport([
                FakeResponse(200, {"count": 2, "results": [
                    {"listing_id": 11, "title": "One", "buyer_user_id": 9},
                    {"listing_id": 12, "title": "Two", "url": "private"},
                ]}, {"x-remaining-today": "4999"})
            ])
            client = EtsyReadOnlyClient(
                authorization=Phase1Authorization.load(record, key, tracked),
                credentials=CredentialStore(credentials),
                transport=transport,
                budget=RequestBudget(max_requests=2),
            )
            pages = client.fetch_active_listing_pages(limit=100)
            self.assertEqual([row["listing_id"] for row in pages[0]["results"]], [11, 12])
            self.assertNotIn("buyer_user_id", pages[0]["results"][0])
            self.assertNotIn("url", pages[0]["results"][1])
            self.assertNotIn("Authorization", transport.calls[0]["headers"])

    def test_rate_limit_is_not_retried_and_budget_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            record, key, tracked = signed_authorization(root, capabilities=["listing_read"])
            credentials = root / "keys.json"
            credentials.write_text(json.dumps({"keystring": "k", "shared_secret": "s", "access_token": "a", "refresh_token": "r"}))
            transport = FakeTransport([FakeResponse(429, {"error": "slow"}, {"retry-after": "4"})])
            client = EtsyReadOnlyClient(
                authorization=Phase1Authorization.load(record, key, tracked),
                credentials=CredentialStore(credentials),
                transport=transport,
                budget=RequestBudget(max_requests=1),
            )
            with self.assertRaisesRegex(RuntimeError, "rate_limited"):
                client.fetch_active_listing_pages(limit=100)
            self.assertEqual(len(transport.calls), 1)
            with self.assertRaisesRegex(RuntimeError, "request budget exhausted"):
                client.fetch_active_listing_pages(limit=100)

    def test_single_listing_requires_signed_sample_id(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            record, key, tracked = signed_authorization(root, capabilities=["listing_read"])
            credentials = root / "keys.json"
            credentials.write_text(json.dumps({"keystring": "k", "shared_secret": "s", "access_token": "a", "refresh_token": "r"}))
            transport = FakeTransport([FakeResponse(200, {"listing_id": 11, "state": "inactive"})])
            client = EtsyReadOnlyClient(
                authorization=Phase1Authorization.load(record, key, tracked),
                credentials=CredentialStore(credentials),
                transport=transport,
                budget=RequestBudget(max_requests=2),
            )
            self.assertEqual(client.fetch_listing("11")["state"], "inactive")
            with self.assertRaises(AuthorizationDenied):
                client.fetch_listing("999")

    def test_receipt_window_is_mandatory_and_bounded(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            record, key, tracked = signed_authorization(root, capabilities=["receipt_read"])
            credentials = root / "keys.json"
            credentials.write_text(json.dumps({"keystring": "k", "shared_secret": "s", "access_token": "a"}))
            client = EtsyReadOnlyClient(
                authorization=Phase1Authorization.load(record, key, tracked),
                credentials=CredentialStore(credentials),
                transport=FakeTransport([]),
                budget=RequestBudget(max_requests=2),
            )
            with self.assertRaisesRegex(ValueError, "within the last 90 days"):
                client.fetch_receipt_pages(min_created=None)
            too_old = int((datetime.now(timezone.utc) - timedelta(days=91)).timestamp())
            with self.assertRaisesRegex(ValueError, "within the last 90 days"):
                client.fetch_receipt_pages(min_created=too_old)


class DailyBudgetTests(unittest.TestCase):
    def test_empty_and_prior_day_ledgers_initialize_current_day(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            empty = root / "empty.json"
            empty.touch()
            DailyRequestLedger(empty, daily_limit=2).consume()
            self.assertEqual(json.loads(empty.read_text())["used"], 1)
            stale = root / "stale.json"
            stale.write_text(json.dumps({"utc_day": "2020-01-01", "used": 99}))
            DailyRequestLedger(stale, daily_limit=2).consume()
            self.assertEqual(json.loads(stale.read_text())["used"], 1)

    def test_daily_budget_persists_across_instances(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "ledger.json"
            DailyRequestLedger(path, daily_limit=2).consume()
            DailyRequestLedger(path, daily_limit=2).consume()
            with self.assertRaisesRegex(RuntimeError, "daily Etsy request budget exhausted"):
                DailyRequestLedger(path, daily_limit=2).consume()
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    def test_nonempty_malformed_ledger_fails_closed_without_rewrite(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "ledger.json"
            original = b'{"utc_day":'
            path.write_bytes(original)
            with self.assertRaisesRegex(RuntimeError, "malformed"):
                DailyRequestLedger(path, daily_limit=2).consume()
            self.assertEqual(path.read_bytes(), original)

    def test_invalid_ledger_shape_fails_closed(self) -> None:
        invalid_records = [
            {"utc_day": "not-a-date", "used": 1},
            {"utc_day": datetime.now(timezone.utc).date().isoformat(), "used": -1},
            {"utc_day": datetime.now(timezone.utc).date().isoformat(), "used": True},
            {"utc_day": datetime.now(timezone.utc).date().isoformat(), "used": 1, "extra": 2},
        ]
        for record in invalid_records:
            with self.subTest(record=record), tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / "ledger.json"
                path.write_text(json.dumps(record))
                with self.assertRaisesRegex(RuntimeError, "malformed"):
                    DailyRequestLedger(path, daily_limit=2).consume()

    def test_atomic_replace_failure_preserves_previous_ledger(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "ledger.json"
            DailyRequestLedger(path, daily_limit=3).consume()
            previous = path.read_bytes()
            with mock.patch.object(os, "replace", side_effect=OSError("synthetic interruption")):
                with self.assertRaisesRegex(RuntimeError, "persist"):
                    DailyRequestLedger(path, daily_limit=3).consume()
            self.assertEqual(path.read_bytes(), previous)
            self.assertEqual(list(path.parent.glob(f".{path.name}.*.tmp")), [])

    def test_concurrent_processes_do_not_lose_increments(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "ledger.json"
            processes = [multiprocessing.Process(target=consume_ledger, args=(str(path), 10)) for _ in range(4)]
            for process in processes:
                process.start()
            for process in processes:
                process.join(timeout=10)
                self.assertEqual(process.exitcode, 0)
            self.assertEqual(json.loads(path.read_text())["used"], 40)


if __name__ == "__main__":
    unittest.main()
