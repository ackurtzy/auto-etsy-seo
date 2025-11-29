"""Repository for managing local shop data."""

from __future__ import annotations

import os
from typing import Any, Dict, Optional

from utils import file_lib


class ShopDataRepository:
    """Caches and persists Etsy shop data."""

    def __init__(self, base_data_path: str = "data") -> None:
        """Initializes the repository.

        Args:
            base_data_path: Base folder used for data persistence.
        """
        self.base_data_path = base_data_path
        self._session_cache: Dict[int, Dict[str, Any]] = {}
        self._images_manifest_cache: Dict[int, Dict[str, Any]] = {}
        self._performance_cache: Dict[int, Dict[str, Any]] = {}

    def save_listings(self, shop_id: int, payload: Dict[str, Any]) -> str:
        """Persists listings payload and stores it in session cache.

        Args:
            shop_id: Unique identifier for the shop.
            payload: Listings payload returned from Etsy.

        Returns:
            Path to the saved listings file.
        """
        self._session_cache[shop_id] = payload
        folder_path = self._ensure_shop_folder(shop_id)
        listings_path = self._current_listings_path(shop_id)
        file_lib.save_to_json(listings_path, payload)
        legacy_path = self._legacy_listings_path(shop_id)
        if os.path.exists(legacy_path):
            os.remove(legacy_path)
        return listings_path

    def load_listings(self, shop_id: int) -> Optional[Dict[str, Any]]:
        """Retrieves listings payload from session cache or disk.

        Args:
            shop_id: Unique identifier for the shop.

        Returns:
            Cached or persisted payload, if it exists.
        """
        if shop_id in self._session_cache:
            return self._session_cache[shop_id]

        listings_path = self._current_listings_path(shop_id)
        if os.path.exists(listings_path):
            payload = file_lib.read_json(listings_path)
            self._session_cache[shop_id] = payload
            return payload
        legacy_path = self._legacy_listings_path(shop_id)
        if os.path.exists(legacy_path):
            payload = file_lib.read_json(legacy_path)
            self.save_listings(shop_id, payload)
            return payload
        return None

    def get_listing_snapshot(
        self,
        shop_id: int,
        listing_id: int,
    ) -> Optional[Dict[str, Any]]:
        """Gets a specific listing's metadata from the cached listings payload."""
        payload = self.load_listings(shop_id)
        if not payload:
            return None
        for result in payload.get("results", []):
            if result.get("listing_id") == listing_id:
                return result
        return None

    def get_listing_images_record(
        self,
        shop_id: int,
        listing_id: int,
    ) -> Optional[Dict[str, Any]]:
        """Gets the stored metadata for a listing's images.

        Args:
            shop_id: Unique identifier for the shop.
            listing_id: Etsy listing identifier.

        Returns:
            Stored manifest entry for the listing, if present.
        """
        return self.get_listing_images_snapshot(shop_id, listing_id)

    def get_listing_images_snapshot(
        self,
        shop_id: int,
        listing_id: int,
    ) -> Optional[Dict[str, Any]]:
        """Gets the stored image manifest entry for a listing."""
        manifest = self._load_images_manifest(shop_id)
        return manifest.get(str(listing_id))

    def save_listing_images_record(
        self,
        shop_id: int,
        listing_id: int,
        record: Dict[str, Any],
    ) -> str:
        """Persists image metadata for a listing.

        Args:
            shop_id: Unique identifier for the shop.
            listing_id: Etsy listing identifier.
            record: Record containing metadata and file paths.

        Returns:
            Path to the manifest on disk.
        """
        manifest = self._load_images_manifest(shop_id)
        manifest[str(listing_id)] = record
        return self._save_images_manifest(shop_id, manifest)

    def archive_listing_image_entry(
        self,
        shop_id: int,
        listing_id: int,
        listing_image_id: int,
    ) -> Optional[Dict[str, Any]]:
        """Moves an active image entry into the archive section."""
        manifest = self._load_images_manifest(shop_id)
        record = manifest.get(str(listing_id))
        if not record:
            return None

        files = record.get("files", [])
        archive = self._ensure_archived_dict(record)

        for index, file_entry in enumerate(files):
            if file_entry.get("listing_image_id") == listing_image_id:
                path = file_entry.get("path")
                if path and os.path.exists(path):
                    archive_dir = self.ensure_listing_images_archive_dir(
                        shop_id, listing_id
                    )
                    destination = os.path.join(
                        archive_dir, os.path.basename(path)
                    )
                    os.replace(path, destination)
                    file_entry = dict(file_entry)
                    file_entry["path"] = destination
                archive.setdefault("files", []).append(file_entry)
                del files[index]
                self._save_images_manifest(shop_id, manifest)
                return file_entry
        return None

    def restore_archived_image_entry(
        self,
        shop_id: int,
        listing_id: int,
        listing_image_id: int,
    ) -> Optional[Dict[str, Any]]:
        """Restores an archived image entry to the active files list."""
        manifest = self._load_images_manifest(shop_id)
        record = manifest.get(str(listing_id))
        if not record:
            return None

        archive = self._ensure_archived_dict(record).get("files", [])
        files = record.setdefault("files", [])

        for index, archived_entry in enumerate(archive):
            if archived_entry.get("listing_image_id") == listing_image_id:
                path = archived_entry.get("path")
                listing_dir = self.ensure_listing_images_dir(shop_id, listing_id)
                if path and os.path.exists(path):
                    destination = os.path.join(
                        listing_dir, os.path.basename(path)
                    )
                    os.replace(path, destination)
                    archived_entry = dict(archived_entry)
                    archived_entry["path"] = destination
        files.append(archived_entry)
        del archive[index]
        self._save_images_manifest(shop_id, manifest)
        return archived_entry
        return None

    def ensure_listing_images_dir(self, shop_id: int, listing_id: int) -> str:
        """Ensures the directory for a listing's images exists.

        Args:
            shop_id: Unique identifier for the shop.
            listing_id: Etsy listing identifier.

        Returns:
            Directory path for the listing's images.
        """
        folder_path = os.path.join(self.base_data_path, str(shop_id), "images", str(listing_id))
        file_lib.make_folder(folder_path)
        return folder_path

    def ensure_listing_images_archive_dir(self, shop_id: int, listing_id: int) -> str:
        """Ensures the archive directory for removed listing images exists."""
        archive_path = os.path.join(
            self.base_data_path, str(shop_id), "images", str(listing_id), "old"
        )
        file_lib.make_folder(archive_path)
        return archive_path

    def images_root(self, shop_id: int) -> str:
        """Returns the base folder for a shop's images.

        Args:
            shop_id: Unique identifier for the shop.

        Returns:
            Directory path containing all listing images.
        """
        folder_path = os.path.join(self.base_data_path, str(shop_id), "images")
        file_lib.make_folder(folder_path)
        return folder_path

    def save_performance_snapshot(
        self, shop_id: int, date_key: str, listing_views: Dict[str, int]
    ) -> str:
        """Saves aggregated performance data for a given date.

        Args:
            shop_id: Unique identifier for the shop.
            date_key: Date string that represents when the snapshot was taken.
            listing_views: Mapping of listing ids to view counts.

        Returns:
            Path to the persisted performance file.
        """
        performance = self._load_performance_manifest(shop_id)
        performance[date_key] = listing_views
        path = self._performance_manifest_path(shop_id)
        file_lib.save_to_json(path, performance)
        return path

    def load_performance_history(self, shop_id: int) -> Dict[str, Any]:
        """Loads the performance history for a shop."""
        return self._load_performance_manifest(shop_id)

    def _ensure_shop_folder(self, shop_id: int) -> str:
        """Ensures the data directory for a shop exists.

        Args:
            shop_id: Unique identifier for the shop.

        Returns:
            Path to the shop directory.
        """
        folder_path = os.path.join(self.base_data_path, str(shop_id))
        file_lib.make_folder(folder_path)
        return folder_path

    def _current_listings_path(self, shop_id: int) -> str:
        """Builds the listings path for a shop.

        Args:
            shop_id: Unique identifier for the shop.

        Returns:
            Absolute path to the listings file.
        """
        return os.path.join(self.base_data_path, str(shop_id), "current_listings.json")

    def _legacy_listings_path(self, shop_id: int) -> str:
        """Path to the legacy listings.json file."""
        return os.path.join(self.base_data_path, str(shop_id), "listings.json")

    def _images_manifest_path(self, shop_id: int) -> str:
        """Builds the path to the shop image manifest.

        Args:
            shop_id: Unique identifier for the shop.

        Returns:
            File path for images.json.
        """
        self.images_root(shop_id)
        return os.path.join(self.base_data_path, str(shop_id), "images", "images.json")

    def _load_images_manifest(self, shop_id: int) -> Dict[str, Any]:
        """Loads the JSON manifest for listing images.

        Args:
            shop_id: Unique identifier for the shop.

        Returns:
            Dictionary mapping listing ids to metadata/file paths.
        """
        if shop_id in self._images_manifest_cache:
            return self._images_manifest_cache[shop_id]

        manifest_path = self._images_manifest_path(shop_id)
        if os.path.exists(manifest_path):
            manifest = file_lib.read_json(manifest_path)
        else:
            manifest = {}
        self._images_manifest_cache[shop_id] = manifest
        return manifest

    def _save_images_manifest(self, shop_id: int, manifest: Dict[str, Any]) -> str:
        """Persists the in-memory manifest to disk."""
        self._images_manifest_cache[shop_id] = manifest
        manifest_path = self._images_manifest_path(shop_id)
        file_lib.save_to_json(manifest_path, manifest)
        return manifest_path

    def _ensure_archived_dict(self, record: Dict[str, Any]) -> Dict[str, Any]:
        archived = record.get("archived")
        if isinstance(archived, dict):
            archived.setdefault("files", [])
            return archived
        if isinstance(archived, list):
            record["archived"] = {"files": archived}
            return record["archived"]
        record["archived"] = {"files": []}
        return record["archived"]

    def _performance_manifest_path(self, shop_id: int) -> str:
        """Builds the path to the performance manifest."""
        folder_path = self._ensure_shop_folder(shop_id)
        return os.path.join(folder_path, "performance.json")

    def _load_performance_manifest(self, shop_id: int) -> Dict[str, Any]:
        """Loads saved performance metrics."""
        if shop_id in self._performance_cache:
            return self._performance_cache[shop_id]

        manifest_path = self._performance_manifest_path(shop_id)
        if os.path.exists(manifest_path):
            manifest = file_lib.read_json(manifest_path)
        else:
            manifest = {}
        self._performance_cache[shop_id] = manifest
        return manifest

    # Experiment persistence -------------------------------------------------

    def _experiments_path(self, shop_id: int) -> str:
        folder_path = self._ensure_shop_folder(shop_id)
        return os.path.join(folder_path, "experiments.json")

    def load_experiments(self, shop_id: int) -> Dict[str, Any]:
        path = self._experiments_path(shop_id)
        if os.path.exists(path):
            return file_lib.read_json(path)
        return {}

    def save_experiment(
        self,
        shop_id: int,
        listing_id: int,
        experiment_record: Dict[str, Any],
    ) -> Dict[str, Any]:
        experiments = self.load_experiments(shop_id)
        listing_key = str(listing_id)
        experiments.setdefault(listing_key, [])
        experiments[listing_key].append(experiment_record)
        path = self._experiments_path(shop_id)
        file_lib.save_to_json(path, experiments)
        return experiments

    def save_all_experiments(
        self, shop_id: int, experiments: Dict[str, Any]
    ) -> Dict[str, Any]:
        path = self._experiments_path(shop_id)
        file_lib.save_to_json(path, experiments)
        return experiments

    def upsert_listing_snapshot(
        self, shop_id: int, listing_record: Dict[str, Any]
    ) -> Dict[str, Any]:
        listing_id = listing_record.get("listing_id")
        if listing_id is None:
            raise ValueError("listing_record must include listing_id.")

        payload = self.load_listings(shop_id)
        if payload is None:
            payload = {"count": 1, "results": [listing_record]}
        else:
            results = payload.setdefault("results", [])
            updated = False
            for idx, entry in enumerate(results):
                if entry.get("listing_id") == listing_id:
                    results[idx] = listing_record
                    updated = True
                    break
            if not updated:
                results.append(listing_record)
            payload["count"] = len(results)

        listings_path = self._current_listings_path(shop_id)
        file_lib.save_to_json(listings_path, payload)
        self._session_cache[shop_id] = payload
        return payload
