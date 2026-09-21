"""Strict read-only Etsy adapter for authorized Phase 1 validation."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
import fcntl
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import tempfile
from typing import Any, Mapping, Protocol

import requests

from validation.phase1.measurement import classify_http_failure, sanitize_listing, sanitize_receipt


class AuthorizationDenied(RuntimeError):
    """The requested read is not covered by the signed owner scope."""


class HttpResponse(Protocol):
    status_code: int
    headers: Mapping[str, str]

    def json(self) -> dict[str, Any]: ...


class HttpTransport(Protocol):
    def get(
        self,
        url: str,
        *,
        headers: dict[str, str],
        params: dict[str, Any],
        timeout: int,
    ) -> HttpResponse: ...


class NoRedirectRequestsTransport:
    """Production HTTP adapter that never follows an unapproved redirect hop."""

    def __init__(self, *, session: Any | None = None) -> None:
        self._session = session if session is not None else requests.Session()

    def get(
        self,
        url: str,
        *,
        headers: dict[str, str],
        params: dict[str, Any],
        timeout: int,
    ) -> HttpResponse:
        return self._session.get(
            url,
            headers=headers,
            params=params,
            timeout=timeout,
            allow_redirects=False,
        )


@dataclass
class RequestBudget:
    max_requests: int = 25
    used: int = 0
    daily_ledger: "DailyRequestLedger | None" = None

    def consume(self) -> None:
        if self.used >= self.max_requests:
            raise RuntimeError("Phase 1 Etsy request budget exhausted")
        if self.daily_ledger is not None:
            self.daily_ledger.consume()
        self.used += 1


@dataclass(frozen=True)
class DailyRequestLedger:
    path: Path
    daily_limit: int = 100

    def consume(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        lock_path = self.path.with_name(f".{self.path.name}.lock")
        with lock_path.open("a+", encoding="utf-8") as lock_handle:
            os.chmod(lock_path, 0o600)
            fcntl.flock(lock_handle.fileno(), fcntl.LOCK_EX)
            if self.path.is_symlink():
                raise RuntimeError("Phase 1 daily Etsy request ledger is malformed")
            try:
                raw = self.path.read_bytes() if self.path.exists() else b""
            except OSError as exc:
                raise RuntimeError("Phase 1 daily Etsy request ledger is unavailable") from exc
            if raw:
                try:
                    record = json.loads(raw)
                    if not isinstance(record, dict) or set(record) != {"utc_day", "used"}:
                        raise ValueError("unsupported ledger shape")
                    ledger_day = date.fromisoformat(record["utc_day"])
                    used_value = record["used"]
                    if isinstance(used_value, bool) or not isinstance(used_value, int) or used_value < 0:
                        raise ValueError("invalid ledger count")
                except (json.JSONDecodeError, TypeError, ValueError) as exc:
                    raise RuntimeError("Phase 1 daily Etsy request ledger is malformed") from exc
            else:
                record = {}
                ledger_day = None
                used_value = 0
            utc_day = datetime.now(timezone.utc).date().isoformat()
            used = used_value if ledger_day is not None and ledger_day.isoformat() == utc_day else 0
            if used >= self.daily_limit:
                raise RuntimeError("Phase 1 daily Etsy request budget exhausted")
            temporary_path: Path | None = None
            try:
                descriptor, temporary_name = tempfile.mkstemp(
                    prefix=f".{self.path.name}.", suffix=".tmp", dir=self.path.parent
                )
                temporary_path = Path(temporary_name)
                os.fchmod(descriptor, 0o600)
                with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
                    json.dump({"utc_day": utc_day, "used": used + 1}, handle, sort_keys=True)
                    handle.flush()
                    os.fsync(handle.fileno())
                os.replace(temporary_path, self.path)
                temporary_path = None
                directory_fd = os.open(self.path.parent, os.O_RDONLY)
                try:
                    os.fsync(directory_fd)
                finally:
                    os.close(directory_fd)
            except OSError as exc:
                raise RuntimeError("Phase 1 daily Etsy request ledger could not persist safely") from exc
            finally:
                if temporary_path is not None:
                    try:
                        temporary_path.unlink()
                    except FileNotFoundError:
                        pass


@dataclass(frozen=True)
class Phase1Authorization:
    shop_id: str
    listing_ids: frozenset[str]
    capabilities: frozenset[str]
    expires_at: datetime

    @classmethod
    def load(
        cls,
        record_path: Path,
        verification_key_path: Path,
        tracked_gate_path: Path,
    ) -> "Phase1Authorization":
        try:
            raw_record = record_path.read_bytes()
            record = json.loads(raw_record)
            signature = str(record.pop("owner_signature"))
            key = verification_key_path.read_bytes()
            tracked_gate = json.loads(tracked_gate_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError, KeyError, TypeError) as exc:
            raise AuthorizationDenied("owner authorization record is unavailable or malformed") from exc
        private_reference = f"sha256:{hashlib.sha256(raw_record).hexdigest()}"
        if tracked_gate.get("canary_permit_reference") != private_reference:
            raise AuthorizationDenied("private authorization is not bound to tracked G0")
        canonical = json.dumps(record, sort_keys=True, separators=(",", ":")).encode("utf-8")
        expected = hmac.new(key, canonical, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(signature, expected):
            raise AuthorizationDenied("owner authorization signature is invalid")
        if record.get("gate_id") != "G0" or not str(record.get("status", "")).startswith("passed"):
            raise AuthorizationDenied("G0 has not passed")
        scope = record.get("approved_scope")
        if not isinstance(scope, dict) or scope.get("environment") != "read-only-validation":
            raise AuthorizationDenied("authorization is not for read-only validation")
        try:
            expires_at = datetime.fromisoformat(str(record["expires_at"]).replace("Z", "+00:00"))
        except ValueError as exc:
            raise AuthorizationDenied("authorization expiry is invalid") from exc
        if expires_at <= datetime.now(timezone.utc):
            raise AuthorizationDenied("owner authorization has expired")
        shop_id = str(scope["shop_id"])
        listing_ids = frozenset(str(item) for item in scope["listing_ids"])
        if not re.fullmatch(r"[1-9]\d*", shop_id) or not listing_ids or any(
            not re.fullmatch(r"[1-9]\d*", item) for item in listing_ids
        ):
            raise AuthorizationDenied("authorization contains invalid Etsy identifiers")
        expected_shop_hash = f"sha256:{hashlib.sha256(shop_id.encode('utf-8')).hexdigest()}"
        if tracked_gate.get("scope", {}).get("shop_id") != expected_shop_hash:
            raise AuthorizationDenied("private shop scope does not match tracked G0")
        return cls(
            shop_id=shop_id,
            listing_ids=listing_ids,
            capabilities=frozenset(str(item) for item in scope["capabilities"]),
            expires_at=expires_at,
        )

    def authorize(self, method: str, path: str, capability: str) -> None:
        if method != "GET":
            raise AuthorizationDenied("Phase 1 permits GET only")
        if capability not in self.capabilities:
            raise AuthorizationDenied(f"capability is not approved: {capability}")
        escaped_shop = re.escape(self.shop_id)
        allowed = {
            "listing_read": [
                rf"^/shops/{escaped_shop}/listings/active$",
                rf"^/listings/({'|'.join(re.escape(item) for item in sorted(self.listing_ids))})$",
            ],
            "receipt_read": [rf"^/shops/{escaped_shop}/receipts$"],
        }
        if not any(re.fullmatch(pattern, path) for pattern in allowed.get(capability, [])):
            raise AuthorizationDenied("request path is outside the signed owner scope")


class CredentialStore:
    """Read the ignored legacy credential file without logging secret values."""

    def __init__(self, path: Path) -> None:
        self.path = path

    def read(self) -> dict[str, str]:
        try:
            payload = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise RuntimeError("Etsy credential file is unavailable or malformed") from exc
        required = ("keystring", "shared_secret", "access_token")
        if any(not isinstance(payload.get(name), str) or not payload[name] for name in required):
            raise RuntimeError("Etsy credential file is missing required values")
        return {name: payload[name] for name in required}


class EtsyReadOnlyClient:
    API_ORIGIN = "https://openapi.etsy.com/v3/application"

    def __init__(
        self,
        *,
        authorization: Phase1Authorization,
        credentials: CredentialStore,
        transport: HttpTransport,
        budget: RequestBudget,
        timeout: int = 30,
    ) -> None:
        self.authorization = authorization
        self.credentials = credentials
        self.transport = transport
        self.budget = budget
        self.timeout = timeout

    def _headers(self, *, oauth: bool) -> dict[str, str]:
        secrets = self.credentials.read()
        headers = {"x-api-key": f"{secrets['keystring']}:{secrets['shared_secret']}"}
        if oauth:
            headers["Authorization"] = f"Bearer {secrets['access_token']}"
        return headers

    def _get(
        self, path: str, capability: str, params: dict[str, Any], *, oauth: bool
    ) -> tuple[dict[str, Any], Mapping[str, str]]:
        self.authorization.authorize("GET", path, capability)
        self.budget.consume()
        response = self.transport.get(
            f"{self.API_ORIGIN}{path}",
            headers=self._headers(oauth=oauth),
            params=params,
            timeout=self.timeout,
        )
        if 300 <= response.status_code < 400:
            raise RuntimeError("Etsy read failed: redirect_disallowed")
        if response.status_code != 200:
            failure = classify_http_failure(response.status_code)
            retry_after = response.headers.get("retry-after") if response.status_code == 429 else None
            suffix = f" retry_after={retry_after}" if retry_after else ""
            raise RuntimeError(f"Etsy read failed: {failure.value}{suffix}")
        payload = response.json()
        if not isinstance(payload, dict):
            raise RuntimeError("Etsy response is not a JSON object")
        return payload, response.headers

    def fetch_active_listing_pages(self, *, limit: int = 100) -> list[dict[str, Any]]:
        if limit < 1 or limit > 100:
            raise ValueError("limit must be between 1 and 100")
        pages: list[dict[str, Any]] = []
        offset = 0
        while True:
            payload, _ = self._get(
                f"/shops/{self.authorization.shop_id}/listings/active",
                "listing_read",
                {"limit": limit, "offset": offset},
                oauth=False,
            )
            raw_results = payload.get("results")
            if not isinstance(raw_results, list):
                raise RuntimeError("Etsy listing page has no results array")
            count = int(payload.get("count", len(raw_results)))
            results = [sanitize_listing(item) for item in raw_results if isinstance(item, Mapping)]
            pages.append({"offset": offset, "count": count, "results": results})
            offset += len(raw_results)
            if offset >= count:
                break
            if not raw_results:
                raise RuntimeError("Etsy listing pagination ended before reported count")
        return pages

    def fetch_listing(self, listing_id: str) -> dict[str, Any]:
        payload, _ = self._get(
            f"/listings/{listing_id}",
            "listing_read",
            {},
            oauth=False,
        )
        return sanitize_listing(payload)

    def fetch_receipt_pages(
        self, *, limit: int = 100, min_created: int | None = None
    ) -> list[dict[str, Any]]:
        if limit < 1 or limit > 100:
            raise ValueError("limit must be between 1 and 100")
        now = datetime.now(timezone.utc)
        minimum_allowed = int((now - timedelta(days=90)).timestamp())
        if min_created is None or min_created < minimum_allowed or min_created > int(now.timestamp()):
            raise ValueError("receipt reads require a min_created bound within the last 90 days")
        pages: list[dict[str, Any]] = []
        offset = 0
        while True:
            params: dict[str, Any] = {"limit": limit, "offset": offset}
            if min_created is not None:
                params["min_created"] = min_created
            payload, _ = self._get(
                f"/shops/{self.authorization.shop_id}/receipts",
                "receipt_read",
                params,
                oauth=True,
            )
            raw_results = payload.get("results")
            if not isinstance(raw_results, list):
                raise RuntimeError("Etsy receipt page has no results array")
            count = int(payload.get("count", len(raw_results)))
            results = [sanitize_receipt(item) for item in raw_results if isinstance(item, Mapping)]
            pages.append({"offset": offset, "count": count, "results": results})
            offset += len(raw_results)
            if offset >= count:
                break
            if not raw_results:
                raise RuntimeError("Etsy receipt pagination ended before reported count")
        return pages
