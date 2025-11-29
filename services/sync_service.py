"""Service responsible for syncing listing and image data."""

from __future__ import annotations

import logging
import os
from typing import Any, Dict, List, Optional

from clients.etsy_client import EtsyClient
from repository.shop_data_repository import ShopDataRepository
from utils import file_lib

LOGGER = logging.getLogger(__name__)


class SyncService:
    """Coordinates EtsyClient calls and repository writes."""

    def __init__(
        self,
        shop_id: int,
        repository: ShopDataRepository,
        etsy_client: EtsyClient,
    ) -> None:
        self.shop_id = shop_id
        self.repository = repository
        self.client = etsy_client

    # ------------------------------------------------------------------ #
    # Listing sync

    def sync_listings(
        self,
        limit: int = 100,
        sort_on: str = "created",
        sort_order: str = "desc",
        keywords: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Fetches all listings from Etsy and persists them."""
        payload = self.client.get_all_listings(
            limit=limit,
            sort_on=sort_on,
            sort_order=sort_order,
            keywords=keywords,
        )
        self.repository.save_listings(self.shop_id, payload)
        self._record_performance_snapshot(payload)
        return payload

    def _record_performance_snapshot(self, payload: Dict[str, Any]) -> None:
        date_key = file_lib.current_date_string()
        listing_views: Dict[str, int] = {}
        for result in payload.get("results", []):
            listing_id = result.get("listing_id")
            if listing_id is None:
                continue
            views_value = result.get("views", 0)
            try:
                views_count = int(views_value)
            except (TypeError, ValueError):
                views_count = 0
            listing_views[str(listing_id)] = views_count

        if listing_views:
            self.repository.save_performance_snapshot(
                self.shop_id, date_key, listing_views
            )

    # ------------------------------------------------------------------ #
    # Image sync

    def sync_listing_images(
        self, listing_ids: Optional[List[int]] = None
    ) -> Dict[str, Any]:
        """Ensures listing images are synced locally."""
        if listing_ids is None:
            listings_payload = self.repository.load_listings(self.shop_id)
            if listings_payload is None:
                raise ValueError(
                    "Listing data not found. Run sync_listings() before syncing images."
                )
            listing_ids = [
                item["listing_id"]
                for item in listings_payload.get("results", [])
                if item.get("listing_id") is not None
            ]

        manifest_updates: Dict[str, Any] = {}
        for listing_id in listing_ids:
            record = self._sync_listing_images_for_listing(listing_id)
            if record is not None:
                manifest_updates[str(listing_id)] = record
        return manifest_updates

    def _sync_listing_images_for_listing(
        self, listing_id: int
    ) -> Optional[Dict[str, Any]]:
        remote = self.client.get_listing_images(listing_id)
        remote_results = remote.get("results", [])
        stored = self.repository.get_listing_images_snapshot(self.shop_id, listing_id)

        if not self._images_need_sync(remote_results, stored):
            LOGGER.info("Listing %s images already synced.", listing_id)
            return stored

        listing_dir = self.repository.ensure_listing_images_dir(
            self.shop_id, listing_id
        )
        archive_dir = self.repository.ensure_listing_images_archive_dir(
            self.shop_id, listing_id
        )
        archived_metadata = self._archive_removed_images(
            stored, remote_results, listing_dir, archive_dir
        )
        self._clear_directory(listing_dir)

        downloaded_files = []
        for result in sorted(remote_results, key=lambda item: item.get("rank") or 0):
            image_id = result.get("listing_image_id")
            if image_id is None:
                continue

            detail = self.client.get_listing_image(listing_id, image_id)
            image_url = self._select_image_url(detail)
            if not image_url:
                LOGGER.warning(
                    "Skipping listing %s image %s due to missing URL.",
                    listing_id,
                    image_id,
                )
                continue

            filename = self._determine_image_filename(detail, image_url)
            local_path = os.path.join(listing_dir, filename)
            self._download_image(image_url, local_path)

            downloaded_files.append(
                {
                    "listing_image_id": detail.get("listing_image_id"),
                    "rank": detail.get("rank"),
                    "path": local_path,
                    "url": image_url,
                }
            )

        record = {
            "results": remote_results,
            "files": downloaded_files,
            "archived": archived_metadata,
        }
        self.repository.save_listing_images_record(self.shop_id, listing_id, record)
        LOGGER.info(
            "Synced %s images for listing %s.", len(downloaded_files), listing_id
        )
        return record

    def _images_need_sync(
        self,
        remote_results: List[Dict[str, Any]],
        stored: Optional[Dict[str, Any]],
    ) -> bool:
        if stored is None:
            return True

        stored_results = stored.get("results", [])
        if len(remote_results) != len(stored_results):
            return True

        def build_signature(results: List[Dict[str, Any]]) -> List[tuple]:
            signature = []
            for item in results:
                signature.append(
                    (
                        item.get("listing_image_id"),
                        item.get("rank"),
                        item.get("updated_timestamp"),
                    )
                )
            return sorted(signature)

        if build_signature(remote_results) != build_signature(stored_results):
            return True

        for file_entry in stored.get("files", []):
            path = file_entry.get("path")
            if not path or not os.path.exists(path):
                return True
        return False

    def _archive_removed_images(
        self,
        stored: Optional[Dict[str, Any]],
        remote_results: List[Dict[str, Any]],
        listing_dir: str,
        archive_dir: str,
    ) -> Dict[str, Any]:
        archived_metadata: Dict[str, Any] = {}
        if stored and isinstance(stored.get("archived"), dict):
            archived_metadata = {
                "files": list(stored["archived"].get("files", [])),
            }
        else:
            archived_metadata = {"files": []}

        if not stored or "files" not in stored:
            return archived_metadata

        remote_ids = {
            item.get("listing_image_id")
            for item in remote_results
            if item.get("listing_image_id") is not None
        }

        files = stored.get("files", [])
        remaining_files = []
        for file_entry in files:
            listing_image_id = file_entry.get("listing_image_id")
            if listing_image_id in remote_ids:
                remaining_files.append(file_entry)
                continue

            path = file_entry.get("path")
            destination = None
            if path and os.path.exists(path):
                destination = os.path.join(archive_dir, os.path.basename(path))
                LOGGER.info("Archiving removed image %s -> %s", path, destination)
                os.replace(path, destination)
            archived_entry = dict(file_entry)
            if destination:
                archived_entry["path"] = destination
            archived_metadata["files"].append(archived_entry)

        stored["files"] = remaining_files
        return archived_metadata

    def _select_image_url(self, image_payload: Dict[str, Any]) -> Optional[str]:
        return (
            image_payload.get("url_fullxfull")
            or image_payload.get("url_570xN")
            or image_payload.get("url_170x135")
            or image_payload.get("url_75x75")
        )

    def _determine_image_filename(
        self, image_payload: Dict[str, Any], image_url: str
    ) -> str:
        rank = image_payload.get("rank")
        image_id = image_payload.get("listing_image_id") or "image"
        suffix = os.path.splitext(image_url.split("?")[0])[1] or ".jpg"
        try:
            prefix = f"{int(rank):02d}" if rank is not None else "00"
        except (TypeError, ValueError):
            prefix = "00"
        return f"{prefix}_{image_id}{suffix}"

    def _download_image(self, url: str, destination: str) -> None:
        response = self.client.session.get(
            url, timeout=self.client.timeout, stream=True
        )
        response.raise_for_status()
        with open(destination, "wb") as file:
            for chunk in response.iter_content(chunk_size=8192):
                if chunk:
                    file.write(chunk)

    def _clear_directory(self, directory: str) -> None:
        for filename in os.listdir(directory):
            path = os.path.join(directory, filename)
            if os.path.isfile(path):
                os.remove(path)
