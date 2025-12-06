"""Service for activating or reverting experiments."""

from __future__ import annotations

import logging
import os
from datetime import date, timedelta
from typing import Any, Dict, List, Optional

import requests

from clients.etsy_client import EtsyClient
from models.listing_change import ExperimentState, ListingChangeType
from repository.shop_data_repository import ShopDataRepository
from services.sync_service import SyncService

LOGGER = logging.getLogger(__name__)


class ResolveExperimentService:
    """Handles applying or reverting listing experiments."""

    def __init__(
        self,
        shop_id: int,
        repository: ShopDataRepository,
        etsy_client: EtsyClient,
        sync_service: SyncService,
    ) -> None:
        self.shop_id = shop_id
        self.repository = repository
        self.client = etsy_client
        self.sync_service = sync_service

    def accept_experiment(self, listing_id: int, experiment_id: str) -> Dict[str, Any]:
        existing_testing = self.repository.get_testing_experiment(self.shop_id, listing_id)
        if existing_testing:
            raise ValueError(
                f"Listing {listing_id} already has an experiment in testing. Finish it before accepting another."
            )
        record = self.repository.get_untested_experiment(
            self.shop_id, listing_id, experiment_id
        )
        if not record:
            raise ValueError(
                f"Experiment {experiment_id} is not queued for listing {listing_id}."
            )
        change = self._extract_change(record)
        listing_snapshot = self.repository.get_listing_snapshot(self.shop_id, listing_id)
        if not listing_snapshot:
            raise ValueError(
                f"Listing {listing_id} snapshot missing. Sync listings before accepting experiments."
            )

        images_snapshot = self.repository.get_listing_images_snapshot(self.shop_id, listing_id)
        if not images_snapshot:
            raise ValueError("Listing image snapshot missing. Run image sync before accepting experiments.")

        payload = self._build_change_payload(change, listing_snapshot, images_snapshot)
        if not payload:
            raise ValueError("Experiment payload is empty.")
        baseline_snapshot = self._capture_baseline_performance(listing_id)
        self.client.update_listing(listing_id, payload)
        self.sync_service.sync_listing_images([listing_id])

        if baseline_snapshot:
            performance_meta = record.setdefault("performance", {})
            performance_meta["baseline"] = baseline_snapshot

        if not record.get("start_date"):
            record["start_date"] = date.today().isoformat()
        self._ensure_planned_end_date(record)
        record["state"] = ExperimentState.TESTING.value
        self.repository.save_testing_experiment(self.shop_id, listing_id, record)
        self.repository.remove_untested_experiment(self.shop_id, listing_id, experiment_id)
        return record

    def keep_experiment(self, listing_id: int, experiment_id: str) -> Dict[str, Any]:
        record = self.repository.get_testing_experiment(self.shop_id, listing_id)
        if not record or str(record.get("experiment_id")) != str(experiment_id):
            raise ValueError(
                f"Experiment {experiment_id} is not currently testing for listing {listing_id}."
            )
        record["state"] = ExperimentState.KEPT.value
        record["end_date"] = date.today().isoformat()
        self.repository.append_tested_experiment(self.shop_id, listing_id, record)
        self.repository.clear_testing_experiment(self.shop_id, listing_id)
        return record

    def revert_experiment(self, listing_id: int, experiment_id: str) -> Dict[str, Any]:
        record = self.repository.get_testing_experiment(self.shop_id, listing_id)
        if not record or str(record.get("experiment_id")) != str(experiment_id):
            raise ValueError(
                f"Experiment {experiment_id} is not currently testing for listing {listing_id}."
            )
        original_listing = record.get("original_listing")
        original_images = record.get("original_listing_images")
        if not original_listing or not original_images:
            raise ValueError("Experiment is missing original listing snapshots.")

        self.sync_service.sync_listing_images([listing_id])
        self._ensure_images_match_snapshot(listing_id, original_images)
        self.sync_service.sync_listing_images([listing_id])

        payload = self._build_revert_payload(original_listing, original_images, record)
        if payload:
            self.client.update_listing(listing_id, payload)
        self.sync_service.sync_listing_images([listing_id])
        self.repository.upsert_listing_snapshot(self.shop_id, original_listing)

        record["state"] = ExperimentState.REVERTED.value
        record["end_date"] = date.today().isoformat()
        self.repository.append_tested_experiment(self.shop_id, listing_id, record)
        self.repository.clear_testing_experiment(self.shop_id, listing_id)
        return record

    def extend_experiment(
        self, listing_id: int, experiment_id: str, additional_days: int
    ) -> Dict[str, Any]:
        """Pushes the planned end date forward for a testing/finished experiment."""
        record = self.repository.get_testing_experiment(self.shop_id, listing_id)
        if not record or str(record.get("experiment_id")) != str(experiment_id):
            raise ValueError(
                f"Experiment {experiment_id} is not currently testing for listing {listing_id}."
            )
        planned = record.get("planned_end_date")
        if not planned:
            self._ensure_planned_end_date(record)
            planned = record.get("planned_end_date")
        try:
            end_date = date.fromisoformat(planned)
        except Exception:
            end_date = date.today()
        record["planned_end_date"] = (end_date + timedelta(days=additional_days)).isoformat()
        self.repository.save_testing_experiment(self.shop_id, listing_id, record)
        return record

    # ------------------------------------------------------------------ #
    # Experiment helpers

    def _extract_change(self, record: Dict[str, Any]) -> Dict[str, Any]:
        changes = record.get("changes") or []
        if not changes:
            raise ValueError("Experiment lacks change data.")
        return changes[0]

    def _ensure_planned_end_date(self, record: Dict[str, Any]) -> None:
        """Derives planned_end_date if missing."""
        if record.get("planned_end_date"):
            return
        start_value = record.get("start_date")
        run_duration_days = record.get("run_duration_days") or 0
        if not start_value or not run_duration_days:
            return
        try:
            start_dt = date.fromisoformat(start_value)
        except Exception:
            return
        record["planned_end_date"] = (start_dt + timedelta(days=int(run_duration_days))).isoformat()

    def _build_change_payload(
        self,
        change: Dict[str, Any],
        listing_snapshot: Dict[str, Any],
        images_snapshot: Dict[str, Any],
    ) -> Dict[str, Any]:
        change_type = ListingChangeType(change.get("change_type"))
        if change_type == ListingChangeType.TAGS:
            return {
                "tags": ",".join(
                    self._prepare_tags_payload(
                        listing_snapshot,
                        change.get("tags_to_add") or [],
                        change.get("tags_to_remove") or [],
                    )
                )
            }
        if change_type == ListingChangeType.TITLE:
            new_title = change.get("new_title", "")
            if not new_title:
                raise ValueError("Title change missing new_title.")
            return {"title": new_title}
        if change_type == ListingChangeType.DESCRIPTION:
            new_description = change.get("new_description", "")
            if not new_description:
                raise ValueError("Description change missing new_description.")
            return {"description": new_description}
        if change_type == ListingChangeType.THUMBNAILS:
            ordering: List[int] = []
            for raw_id in (change.get("new_ordering") or [])[:3]:
                try:
                    ordering.append(int(str(raw_id)))
                except (TypeError, ValueError):
                    continue
            if not ordering:
                raise ValueError("Thumbnail change requires new_ordering values.")

            existing_ids = self._extract_image_ids_from_manifest(images_snapshot)
            if not existing_ids:
                raise ValueError("Listing image snapshot lacked image_ids.")

            ordered_ids: List[int] = []
            for image_id in ordering:
                if image_id in existing_ids and image_id not in ordered_ids:
                    ordered_ids.append(image_id)
            for image_id in existing_ids:
                if image_id not in ordered_ids:
                    ordered_ids.append(image_id)
            return {"image_ids": ",".join(str(image_id) for image_id in ordered_ids)}
        raise ValueError(f"Unsupported change type: {change_type}")

    def _prepare_tags_payload(
        self,
        listing_snapshot: Dict[str, Any],
        tags_to_add: List[str],
        tags_to_remove: List[str],
    ) -> List[str]:
        existing_tags: List[str] = list(listing_snapshot.get("tags") or [])
        remove_lower = {tag.lower() for tag in tags_to_remove}
        filtered = [tag for tag in existing_tags if tag.lower() not in remove_lower]

        def is_duplicate(candidate: str) -> bool:
            clower = candidate.lower()
            return any(tag.lower() == clower for tag in filtered)

        for tag in tags_to_add:
            if tag and len(tag) > 20:
                raise ValueError(
                    f"Tag '{tag}' exceeds Etsy's 20-character limit; shorten it."
                )
            if tag and not is_duplicate(tag):
                filtered.append(tag)

        if len(filtered) > 13:
            raise ValueError(
                "Tag change would exceed 13 tags. Adjust tags_to_add/tags_to_remove."
            )
        return filtered

    def _build_revert_payload(
        self,
        original_listing: Dict[str, Any],
        original_images: Dict[str, Any],
        record: Dict[str, Any],
    ) -> Dict[str, Any]:
        payload: Dict[str, Any] = {}
        for change in record.get("changes", []):
            change_type = ListingChangeType(change.get("change_type"))
            if change_type == ListingChangeType.TAGS and "tags" not in payload:
                payload["tags"] = ",".join(self._normalize_tags(original_listing.get("tags")))
            elif change_type == ListingChangeType.TITLE and "title" not in payload:
                payload["title"] = original_listing.get("title", "")
            elif change_type == ListingChangeType.DESCRIPTION and "description" not in payload:
                payload["description"] = original_listing.get("description", "")
            elif change_type == ListingChangeType.THUMBNAILS and "image_ids" not in payload:
                image_ids = self._extract_image_ids_from_manifest(original_images)
                payload["image_ids"] = ",".join(str(image_id) for image_id in image_ids)
        return payload

    # ------------------------------------------------------------------ #
    # Image reconciliation helpers

    def _ensure_images_match_snapshot(
        self, listing_id: int, snapshot_manifest: Dict[str, Any]
    ) -> None:
        desired_ids = set(self._extract_image_ids_from_manifest(snapshot_manifest))
        if not desired_ids:
            return

        current_manifest = self.repository.get_listing_images_snapshot(
            self.shop_id, listing_id
        )
        current_ids = set(
            self._extract_image_ids_from_manifest(current_manifest or {})
        )

        extra_ids = current_ids - desired_ids
        for image_id in extra_ids:
            self.repository.archive_listing_image_entry(
                self.shop_id, listing_id, image_id
            )
            try:
                self.client.delete_listing_image(listing_id, image_id)
            except requests.HTTPError as exc:  # type: ignore[name-defined]
                LOGGER.warning(
                    "Failed to delete image %s for listing %s: %s",
                    image_id,
                    listing_id,
                    exc,
                )

        rank_map = self._build_image_rank_map(snapshot_manifest)
        missing_ids = desired_ids - current_ids
        id_mapping: Dict[int, int] = {}
        for image_id in missing_ids:
            restored_id = self._restore_listing_image_from_archive(
                listing_id, image_id, rank_map.get(image_id)
            )
            current_ids.add(restored_id)
            if image_id != restored_id:
                id_mapping[int(image_id)] = int(restored_id)
                if image_id in rank_map:
                    rank_map[int(restored_id)] = rank_map.pop(image_id)

        if id_mapping:
            self._apply_image_id_mapping(snapshot_manifest, id_mapping)

    def _restore_listing_image_from_archive(
        self, listing_id: int, listing_image_id: int, rank: Optional[int]
    ) -> int:
        restored_entry = self.repository.restore_archived_image_entry(
            self.shop_id, listing_id, listing_image_id
        )
        if not restored_entry:
            raise ValueError(
                f"Archived image {listing_image_id} for listing {listing_id} not found."
            )
        try:
            self.client.upload_listing_image(
                listing_id,
                listing_image_id=listing_image_id,
                rank=rank,
                overwrite=True,
            )
            return listing_image_id
        except requests.HTTPError:
            path = restored_entry.get("path")
            if not path or not os.path.exists(path):  # type: ignore[name-defined]
                raise
            response = self.client.upload_listing_image(
                listing_id,
                image_path=path,
                rank=rank,
                overwrite=True,
                alt_text=restored_entry.get("alt_text"),
            )
            new_payload = self._extract_listing_image_payload(response)
            new_id = int(new_payload["listing_image_id"])
            restored_entry["listing_image_id"] = new_id
            return new_id

    def _extract_listing_image_payload(
        self, response: Dict[str, Any]
    ) -> Dict[str, Any]:
        if "listing_image_id" in response:
            return response
        if "results" in response:
            results = response.get("results") or []
            if results:
                return results[0]
        raise ValueError("Etsy did not return listing image metadata.")

    def _normalize_tags(self, tags_value: Optional[Any]) -> List[str]:
        if tags_value is None:
            return []
        if isinstance(tags_value, list):
            return [str(tag) for tag in tags_value if str(tag).strip()]
        if isinstance(tags_value, str):
            return [tag.strip() for tag in tags_value.split(",") if tag.strip()]
        raise ValueError(f"Unsupported tags representation: {tags_value}")

    def _extract_image_ids_from_manifest(self, manifest: Dict[str, Any]) -> List[int]:
        image_ids: List[int] = []
        results = manifest.get("results") or []
        for item in sorted(results, key=lambda img: img.get("rank") or 0):
            listing_image_id = item.get("listing_image_id")
            if listing_image_id:
                image_ids.append(int(listing_image_id))
        if image_ids:
            return image_ids

        files = manifest.get("files") or []
        for entry in sorted(files, key=lambda img: img.get("rank") or 0):
            listing_image_id = entry.get("listing_image_id")
            if listing_image_id:
                image_ids.append(int(listing_image_id))
        return image_ids

    def _build_image_rank_map(self, manifest: Dict[str, Any]) -> Dict[int, int]:
        rank_map: Dict[int, int] = {}
        for entry in manifest.get("results", []) or []:
            listing_image_id = entry.get("listing_image_id")
            rank = entry.get("rank")
            if listing_image_id is not None and rank is not None:
                rank_map[int(listing_image_id)] = int(rank)
        if not rank_map:
            for entry in manifest.get("files", []) or []:
                listing_image_id = entry.get("listing_image_id")
                rank = entry.get("rank")
                if listing_image_id is not None and rank is not None:
                    rank_map[int(listing_image_id)] = int(rank)
        return rank_map

    def _apply_image_id_mapping(
        self, manifest: Dict[str, Any], id_mapping: Dict[int, int]
    ) -> None:
        def remap(entries: Optional[List[Dict[str, Any]]]) -> None:
            if not isinstance(entries, list):
                return
            for entry in entries:
                listing_image_id = entry.get("listing_image_id")
                if listing_image_id in id_mapping:
                    entry["listing_image_id"] = id_mapping[listing_image_id]

        remap(manifest.get("results"))
        remap(manifest.get("files"))

    def _capture_baseline_performance(self, listing_id: int) -> Optional[Dict[str, Any]]:
        """Fetches the latest recorded performance snapshot for a listing."""
        history = self.repository.load_performance_history(self.shop_id)
        if not history:
            return None
        latest_date = max(history.keys())
        listing_views = history.get(latest_date, {}).get(str(listing_id))
        if listing_views is None:
            return None
        try:
            views = int(listing_views)
        except (TypeError, ValueError):
            views = 0
        return {"date": latest_date, "views": views}
