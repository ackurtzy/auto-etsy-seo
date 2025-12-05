"""HTTP client for interacting with the Etsy API."""

from __future__ import annotations

import logging
import os
from typing import Any, Dict, Optional, List

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from utils import file_lib

LOGGER = logging.getLogger(__name__)


class EtsyKeyStore:
    """Handles reading and refreshing Etsy API keys."""

    REFRESH_URL = "https://api.etsy.com/v3/public/oauth/token"

    def __init__(self, key_path: str, timeout: int = 100) -> None:
        self.key_path = key_path
        self.timeout = timeout
        self._keys: Optional[Dict[str, Any]] = None

    @property
    def keystring(self) -> str:
        return self._require_keys()["keystring"]

    def update_tokens(self, access_token: str, refresh_token: str) -> None:
        keys = self._require_keys()
        keys["access_token"] = access_token
        keys["refresh_token"] = refresh_token
        file_lib.save_to_json(self.key_path, keys)

    def refresh(self, session: requests.Session) -> Dict[str, Any]:
        keys = self._require_keys()
        headers = {"Content-Type": "application/x-www-form-urlencoded"}
        data = {
            "grant_type": "refresh_token",
            "client_id": keys["keystring"],
            "refresh_token": keys["refresh_token"],
        }
        response = session.post(
            self.REFRESH_URL, headers=headers, data=data, timeout=self.timeout
        )
        response.raise_for_status()
        payload = response.json()
        self.update_tokens(payload["access_token"], payload["refresh_token"])
        self._keys = file_lib.read_json(self.key_path)
        LOGGER.info("Refreshed Etsy access token.")
        return self._keys

    def _require_keys(self) -> Dict[str, Any]:
        if self._keys is None:
            self._keys = file_lib.read_json(self.key_path)
        return self._keys


class EtsyClient:
    """HTTP client wrapper that only handles API requests."""

    API_BASE_URL = "https://openapi.etsy.com/v3/application"

    def __init__(self, shop_id: int, key_path: str, timeout: int = 100) -> None:
        self.shop_id = shop_id
        self.timeout = timeout
        self.session = requests.Session()
        retry_strategy = Retry(
            total=3,
            backoff_factor=0.5,
            status_forcelist=(500, 502, 503, 504),
            allowed_methods=("GET", "POST", "PATCH", "DELETE"),
        )
        adapter = HTTPAdapter(max_retries=retry_strategy)
        self.session.mount("https://", adapter)
        self.session.mount("http://", adapter)
        self.key_store = EtsyKeyStore(key_path, timeout=timeout)

    def get_all_listings(
        self,
        limit: int = 100,
        sort_on: str = "created",
        sort_order: str = "desc",
        keywords: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Fetches all active listings for the shop."""
        offset = 0
        aggregated_results = []
        reported_count = 0

        while True:
            page = self._fetch_listings_page(
                limit=limit,
                offset=offset,
                sort_on=sort_on,
                sort_order=sort_order,
                keywords=keywords,
            )
            page_count = page.get("count")
            if page_count is not None:
                try:
                    reported_count = max(reported_count, int(page_count))
                except (TypeError, ValueError):
                    LOGGER.warning("Unable to parse listing count: %s", page_count)
            page_results = page.get("results", [])
            if not page_results:
                break

            aggregated_results.extend(page_results)
            offset += len(page_results)

            if len(page_results) < limit:
                break

        return {
            "count": reported_count or len(aggregated_results),
            "results": aggregated_results,
        }

    def _fetch_listings_page(
        self,
        limit: int,
        offset: int,
        sort_on: str,
        sort_order: str,
        keywords: Optional[str],
    ) -> Dict[str, Any]:
        params: Dict[str, Any] = {
            "limit": limit,
            "offset": offset,
            "sort_on": sort_on,
            "sort_order": sort_order,
        }
        if keywords:
            params["keywords"] = keywords

        endpoint = f"/shops/{self.shop_id}/listings/active"
        return self._request("get", endpoint, params=params)

    def get_listing_images(self, listing_id: int) -> Dict[str, Any]:
        endpoint = f"/listings/{listing_id}/images"
        return self._request("get", endpoint)

    def get_listing_image(self, listing_id: int, listing_image_id: int) -> Dict[str, Any]:
        endpoint = f"/listings/{listing_id}/images/{listing_image_id}"
        return self._request("get", endpoint)

    def update_listing(self, listing_id: int, data: Dict[str, Any]) -> Dict[str, Any]:
        endpoint = f"/shops/{self.shop_id}/listings/{listing_id}"
        normalized = self._normalize_data(data)
        response = self._request("patch", endpoint, data=normalized)
        return response

    def upload_listing_image(
        self,
        listing_id: int,
        image_path: Optional[str] = None,
        listing_image_id: Optional[int] = None,
        rank: Optional[int] = None,
        overwrite: bool = False,
        is_watermarked: bool = False,
        alt_text: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Uploads or reassigns a listing image."""
        data: Dict[str, Any] = {}
        if listing_image_id:
            data["listing_image_id"] = listing_image_id
        if rank is not None:
            data["rank"] = rank
        if overwrite:
            data["overwrite"] = "true"
        if is_watermarked:
            data["is_watermarked"] = "true"
        if alt_text:
            data["alt_text"] = alt_text

        files = None
        if image_path:
            with open(image_path, "rb") as file_handle:
                file_bytes = file_handle.read()
            files = {
                "image": (os.path.basename(image_path), file_bytes),
            }

        def send(headers: Dict[str, str]) -> requests.Response:
            endpoint = f"/shops/{self.shop_id}/listings/{listing_id}/images"
            return self.session.post(
                f"{self.API_BASE_URL}{endpoint}",
                data=data,
                files=files,
                timeout=self.timeout,
                headers=headers,
            )

        response = self._send_with_refresh(send)
        response.raise_for_status()
        return response.json()

    def delete_listing_image(self, listing_id: int, listing_image_id: int) -> None:
        """Deletes a listing image."""
        def send(headers: Dict[str, str]) -> requests.Response:
            endpoint = (
                f"/shops/{self.shop_id}/listings/{listing_id}/images/{listing_image_id}"
            )
            return self.session.delete(
                f"{self.API_BASE_URL}{endpoint}",
                headers=headers,
                timeout=self.timeout,
            )

        response = self._send_with_refresh(send)
        response.raise_for_status()

    # ------------------------------------------------------------------ #
    # Internal helpers

    def _send_with_refresh(
        self, sender: callable
    ) -> requests.Response:
        headers = self._build_headers()
        response = sender(headers)
        if response.status_code == 401:
            LOGGER.info("Access token expired, refreshing.")
            self.key_store.refresh(self.session)
            headers = self._build_headers()
            response = sender(headers)
        return response

    def _request(
        self,
        method: str,
        endpoint: str,
        params: Optional[Dict[str, Any]] = None,
        data: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        url = f"{self.API_BASE_URL}{endpoint}"
        headers = self._build_headers()
        response = self.session.request(
            method=method,
            url=url,
            headers=headers,
            params=params,
            data=data,
            timeout=self.timeout,
        )

        if response.status_code == 401:
            LOGGER.info("Access token expired, refreshing.")
            self.key_store.refresh(self.session)
            headers = self._build_headers()
            response = self.session.request(
                method=method,
                url=url,
                headers=headers,
                params=params,
                data=data,
                timeout=self.timeout,
            )

        response.raise_for_status()
        return response.json()

    def _build_headers(self) -> Dict[str, str]:
        keys = self.key_store._require_keys()
        return {
            "Authorization": f"Bearer {keys['access_token']}",
            "x-api-key": keys["keystring"],
        }

    def _normalize_data(self, data: Dict[str, Any]) -> Any:
        """Converts dict payload into list of tuples to support repeated fields."""
        normalized: List[tuple] = []
        for key, value in data.items():
            if isinstance(value, list):
                for item in value:
                    normalized.append((key, str(item)))
            else:
                normalized.append((key, value))
        return normalized
