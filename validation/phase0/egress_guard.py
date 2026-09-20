"""Credential-free preflight for any future live validation request."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import hmac
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


class EgressGuard:
    """Fail-closed policy checked before constructing an HTTP request."""

    ETSY_ORIGIN = "https://openapi.etsy.com"

    def __init__(
        self,
        *,
        signing_key: bytes | None = None,
        approved_canary: ApprovedCanary | None = None,
    ) -> None:
        self._signing_key = signing_key
        self._approved_canary = approved_canary

    def authorize(self, method: str, url: str, permit: CanaryPermit | None) -> None:
        if permit is None:
            raise EgressDenied("live egress requires an exact canary permit")
        if self._signing_key is None:
            raise EgressDenied("live permit verification is not configured")
        if self._approved_canary is None:
            raise EgressDenied("no passed owner-controlled gate scope is loaded")
        if not self._approved_canary.matches(permit):
            raise EgressDenied("permit does not match the approved gate scope")
        if not self._approved_canary.is_current(datetime.now(timezone.utc)):
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
        expected = hmac.new(self._signing_key, permit.payload(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, permit.signature):
            raise EgressDenied("canary permit signature is invalid")


def sign_for_test(permit: CanaryPermit, key: bytes) -> str:
    """Fixture helper only; production signing belongs to an owner gate service."""

    return hmac.new(key, permit.payload(), hashlib.sha256).hexdigest()


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
