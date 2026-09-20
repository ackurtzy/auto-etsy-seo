from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timedelta, timezone
import unittest

from validation.phase0.egress_guard import (
    CanaryPermit,
    EgressDenied,
    EgressGuard,
    GateRecordVerifier,
    GuardedReadClient,
    signed_gate_for_test,
    sign_for_test,
)


class EgressGuardTest(unittest.TestCase):
    def setUp(self) -> None:
        self.key = b"synthetic-test-key"
        self.owner_key = b"synthetic-owner-gate-key"
        gate_payload = {
            "status": "passed",
            "environment": "live-canary",
            "method": "GET",
            "shop_id": "synthetic-shop",
            "listing_id": "synthetic-listing",
            "capability": "listing.read",
            "expires_at": (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat(),
        }
        gate_reference, gate_record = signed_gate_for_test(gate_payload, self.owner_key)
        self.verifier = GateRecordVerifier(
            records={gate_reference: gate_record},
            owner_verification_key=self.owner_key,
        )
        unsigned = CanaryPermit(
            environment="live-canary",
            gate_reference=gate_reference,
            method="GET",
            shop_id="synthetic-shop",
            listing_id="synthetic-listing",
            capability="listing.read",
            signature="",
        )
        self.permit = replace(unsigned, signature=sign_for_test(unsigned, self.key))

    def guard(self) -> EgressGuard:
        return EgressGuard(
            permit_verification_key=self.key,
            gate_verifier=self.verifier,
        )

    def test_default_denies_before_network(self) -> None:
        with self.assertRaises(EgressDenied):
            EgressGuard().authorize("GET", "https://openapi.etsy.com/v3/application/listings/1", None)

    def test_nonallowlisted_listing_is_denied(self) -> None:
        changed = replace(self.permit, listing_id="another-listing")
        with self.assertRaises(EgressDenied):
            self.guard().authorize(
                "GET", "https://openapi.etsy.com/v3/application/listings/another-listing", changed
            )

    def test_wrong_destination_is_denied(self) -> None:
        with self.assertRaises(EgressDenied):
            self.guard().authorize(
                "GET", "https://example.com/v3/application/listings/synthetic-listing", self.permit
            )

    def test_write_method_is_denied(self) -> None:
        with self.assertRaises(EgressDenied):
            self.guard().authorize(
                "PATCH",
                "https://openapi.etsy.com/v3/application/listings/synthetic-listing",
                self.permit,
            )

    def test_exact_synthetic_permit_passes_preflight(self) -> None:
        self.guard().authorize(
            "GET",
            "https://openapi.etsy.com/v3/application/listings/synthetic-listing",
            self.permit,
        )

    def test_validly_signed_but_unapproved_scope_is_denied(self) -> None:
        unsigned = replace(self.permit, listing_id="arbitrary-listing", signature="")
        valid_signature = sign_for_test(unsigned, self.key)
        with self.assertRaises(EgressDenied):
            self.guard().authorize(
                "GET",
                "https://openapi.etsy.com/v3/application/listings/arbitrary-listing",
                replace(unsigned, signature=valid_signature),
            )

    def test_caller_supplied_passed_scope_without_owner_record_is_denied(self) -> None:
        arbitrary_payload = {
            "status": "passed",
            "environment": "live-canary",
            "method": "GET",
            "shop_id": "arbitrary-shop",
            "listing_id": "arbitrary-listing",
            "capability": "listing.read",
            "expires_at": (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat(),
        }
        reference, record = signed_gate_for_test(arbitrary_payload, b"attacker-key")
        verifier = GateRecordVerifier(
            records={reference: record},
            owner_verification_key=self.owner_key,
        )
        unsigned = CanaryPermit(
            environment="live-canary",
            gate_reference=reference,
            method="GET",
            shop_id="arbitrary-shop",
            listing_id="arbitrary-listing",
            capability="listing.read",
            signature="",
        )
        permit = replace(unsigned, signature=sign_for_test(unsigned, self.key))
        guard = EgressGuard(permit_verification_key=self.key, gate_verifier=verifier)
        with self.assertRaises(EgressDenied):
            guard.authorize(
                "GET",
                "https://openapi.etsy.com/v3/application/listings/arbitrary-listing",
                permit,
            )

    def test_production_like_client_denies_before_transport(self) -> None:
        class FakeTransport:
            calls = 0

            def request(self, method: str, url: str) -> object:
                self.calls += 1
                return {"method": method, "url": url}

        transport = FakeTransport()
        client = GuardedReadClient(EgressGuard(), transport)
        with self.assertRaises(EgressDenied):
            client.fetch_listing(None)
        self.assertEqual(transport.calls, 0)

        unapproved = replace(self.permit, listing_id="arbitrary-listing", signature="")
        unapproved = replace(unapproved, signature=sign_for_test(unapproved, self.key))
        client = GuardedReadClient(self.guard(), transport)
        with self.assertRaises(EgressDenied):
            client.fetch_listing(unapproved)
        self.assertEqual(transport.calls, 0)


if __name__ == "__main__":
    unittest.main()
