"""Credential-free preflight for any future live validation request."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import hmac
import json
from typing import Mapping
from urllib.parse import urlparse


class EgressDenied(RuntimeError):
    """The requested external operation was not authorized by a live gate."""


@dataclass(frozen=True)
class CanaryPermit:
    environment: str
    gate_reference: str
    method: str
    shop_id: str
    listing_id: str
    capability: str
    signature: str

    def payload(self) -> bytes:
        return "\n".join(
            (
                self.environment,
                self.gate_reference,
                self.method,
                self.shop_id,
                self.listing_id,
                self.capability,
            )
        ).encode("utf-8")


@dataclass(frozen=True)
class ApprovedCanary:
    """Exact scope loaded from a separate owner-controlled passed gate."""

    status: str
    environment: str
    gate_reference: str
    method: str
    shop_id: str
    listing_id: str
    capability: str
    expires_at: str

    def matches(self, permit: CanaryPermit) -> bool:
        return (
            self.status == "passed"
            and self.environment == permit.environment
            and self.gate_reference == permit.gate_reference
            and self.method == permit.method
            and self.shop_id == permit.shop_id
            and self.listing_id == permit.listing_id
            and self.capability == permit.capability
        )

    def is_current(self, now: datetime) -> bool:
        expiry = datetime.fromisoformat(self.expires_at.replace("Z", "+00:00"))
        return expiry > now.astimezone(timezone.utc)


class GateRecordVerifier:
    """Resolve immutable gate records and verify their separate owner signature."""

    def __init__(self, *, records: Mapping[str, bytes], owner_verification_key: bytes) -> None:
        self._records = records
        self._owner_verification_key = owner_verification_key

    @staticmethod
    def canonical_payload(payload: dict[str, str]) -> bytes:
        return json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")

    def resolve(self, gate_reference: str) -> ApprovedCanary:
        raw = self._records.get(gate_reference)
        if raw is None:
            raise EgressDenied("gate reference does not resolve in the owner-controlled repository")
        try:
            record = json.loads(raw)
            signature = record.pop("owner_signature")
        except (json.JSONDecodeError, KeyError, TypeError) as exc:
            raise EgressDenied("owner gate record is malformed") from exc
        canonical = self.canonical_payload(record)
        expected_reference = f"sha256:{hashlib.sha256(canonical).hexdigest()}"
        if not hmac.compare_digest(expected_reference, gate_reference):
            raise EgressDenied("gate reference does not match the immutable record")
        expected_signature = hmac.new(
            self._owner_verification_key, canonical, hashlib.sha256
        ).hexdigest()
        if not hmac.compare_digest(expected_signature, str(signature)):
            raise EgressDenied("owner gate signature is invalid")
        required = {
            "status",
            "environment",
            "method",
            "shop_id",
            "listing_id",
            "capability",
            "expires_at",
        }
        if set(record) != required or not all(isinstance(record[key], str) for key in required):
            raise EgressDenied("owner gate record has an unsupported schema")
        return ApprovedCanary(gate_reference=expected_reference, **record)


class EgressGuard:
    """Fail-closed policy checked before constructing an HTTP request."""

    ETSY_ORIGIN = "https://openapi.etsy.com"

    def __init__(
        self,
        *,
        permit_verification_key: bytes | None = None,
        gate_verifier: GateRecordVerifier | None = None,
    ) -> None:
        self._permit_verification_key = permit_verification_key
        self._gate_verifier = gate_verifier

    def authorize(self, method: str, url: str, permit: CanaryPermit | None) -> None:
        if permit is None:
            raise EgressDenied("live egress requires an exact canary permit")
        if self._permit_verification_key is None:
            raise EgressDenied("live permit verification is not configured")
        if self._gate_verifier is None:
            raise EgressDenied("owner-controlled gate verification is not configured")
        approved_canary = self._gate_verifier.resolve(permit.gate_reference)
        if not approved_canary.matches(permit):
            raise EgressDenied("permit does not match the approved gate scope")
        if not approved_canary.is_current(datetime.now(timezone.utc)):
            raise EgressDenied("approved canary scope has expired")
        if permit.environment != "live-canary":
            raise EgressDenied("only the isolated live-canary environment may use egress")
        if not all(
            (
                permit.gate_reference,
                permit.shop_id,
                permit.listing_id,
                permit.capability,
            )
        ):
            raise EgressDenied("permit scope must name gate, shop, listing, and capability")
        parsed = urlparse(url)
        origin = f"{parsed.scheme}://{parsed.netloc}"
        if origin != self.ETSY_ORIGIN:
            raise EgressDenied("destination is not the approved Etsy API origin")
        expected_path = f"/v3/application/listings/{permit.listing_id}"
        if (
            method.upper() != permit.method
            or method.upper() != "GET"
            or parsed.path != expected_path
            or parsed.query
        ):
            raise EgressDenied("request is outside the exact read-only listing allowlist")
        expected = hmac.new(
            self._permit_verification_key, permit.payload(), hashlib.sha256
        ).hexdigest()
        if not hmac.compare_digest(expected, permit.signature):
            raise EgressDenied("canary permit signature is invalid")


def sign_for_test(permit: CanaryPermit, key: bytes) -> str:
    """Fixture helper only; production signing belongs to an owner gate service."""

    return hmac.new(key, permit.payload(), hashlib.sha256).hexdigest()


def signed_gate_for_test(payload: dict[str, str], key: bytes) -> tuple[str, bytes]:
    """Fixture helper that creates an immutable, owner-signed gate record."""

    canonical = GateRecordVerifier.canonical_payload(payload)
    reference = f"sha256:{hashlib.sha256(canonical).hexdigest()}"
    record = {
        **payload,
        "owner_signature": hmac.new(key, canonical, hashlib.sha256).hexdigest(),
    }
    return reference, json.dumps(record, sort_keys=True).encode("utf-8")


class GuardedReadClient:
    """Minimal strict adapter used to prove denial occurs before transport."""

    def __init__(self, guard: EgressGuard, transport: object) -> None:
        self._guard = guard
        self._transport = transport

    def fetch_listing(self, permit: CanaryPermit | None) -> object:
        listing_id = permit.listing_id if permit else "missing"
        url = f"{EgressGuard.ETSY_ORIGIN}/v3/application/listings/{listing_id}"
        self._guard.authorize("GET", url, permit)
        return self._transport.request("GET", url)
