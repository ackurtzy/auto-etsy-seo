"""Service to generate SEO experiments via OpenAI."""

from __future__ import annotations

import json
from dataclasses import asdict
from datetime import date
from typing import Any, Dict, List, Optional

from clients.openai_client import OpenAIClient
from models.listing_change import (
    DescriptionChange,
    ExperimentState,
    ListingChangeType,
    ListingExperiment,
    TagChange,
    ThumbnailImageChange,
    TitleChange,
)
from repository.shop_data_repository import ShopDataRepository
from utils import file_lib
from utils.image_utils import build_image_data_blocks


class GenerateExperimentService:
    """Coordinates fetching listing data, calling OpenAI, and saving experiments."""

    def __init__(
        self,
        shop_id: int,
        repository: ShopDataRepository,
        openai_client: Optional[OpenAIClient] = None,
        system_prompt_path: str = "prompts/experiment_generation_system.txt",
        user_prompt_template_path: str = "prompts/experiment_generation_user_template.txt",
    ) -> None:
        self.shop_id = shop_id
        self.repository = repository
        self.openai_client = openai_client or OpenAIClient()
        self.system_prompt = file_lib.read_txt_file(system_prompt_path).strip()
        self.user_prompt_template = file_lib.read_txt_file(
            user_prompt_template_path
        ).strip()

    def generate_for_listing(
        self,
        listing_id: int,
        today: Optional[date] = None,
        include_prior_experiments: bool = True,
        max_prior_experiments: int = 5,
    ) -> Dict[str, Any]:
        """Generates and persists an experiment for the provided listing."""
        listing_snapshot = self.repository.get_listing_snapshot(self.shop_id, listing_id)
        if not listing_snapshot:
            raise ValueError(f"Listing {listing_id} has not been synced yet.")

        images_snapshot = self.repository.get_listing_images_snapshot(
            self.shop_id, listing_id
        )
        if not images_snapshot:
            raise ValueError(
                f"Listing {listing_id} is missing image metadata. Run the sync process first."
            )

        prior_experiments = []
        if include_prior_experiments:
            experiments = self.repository.load_experiments(self.shop_id)
            prior_experiments = experiments.get(str(listing_id), [])[-max_prior_experiments:]
        listing_image_ids = [
            str(result.get("listing_image_id"))
            for result in (images_snapshot.get("results") or [])[:3]
            if result.get("listing_image_id") is not None
        ]
        if not listing_image_ids:
            listing_image_ids = [
                str(entry.get("listing_image_id"))
                for entry in (images_snapshot.get("files") or [])[:3]
                if entry.get("listing_image_id") is not None
            ]
        text_prompt = self.user_prompt_template.format(
            title=listing_snapshot.get("title", ""),
            description=listing_snapshot.get("description", ""),
            tags=", ".join(listing_snapshot.get("tags", []) or []),
            listing_image_ids=", ".join(listing_image_ids[:3]),
            prior_experiments_json=json.dumps(prior_experiments, indent=2),
        )
        image_blocks = self._prepare_image_blocks(images_snapshot)

        response = self.openai_client.generate_json_response(
            system_prompt=self.system_prompt,
            user_content=[
                {"type": "input_text", "text": text_prompt},
                *image_blocks,
            ],
        )
        experiment_payloads = response.get("experiments") or []
        if len(experiment_payloads) != 3:
            raise ValueError("Model response must contain exactly 3 experiment options.")

        experiment_index = self._prompt_user_for_experiment(experiment_payloads)
        chosen_payload = experiment_payloads[experiment_index]

        experiment = self._build_experiment_from_response(
            listing_id,
            listing_snapshot,
            images_snapshot,
            chosen_payload,
            today or date.today(),
        )

        experiment_record = self._serialize_experiment(experiment, response)
        self.repository.save_experiment(
            self.shop_id, listing_id, experiment_record
        )
        return experiment_record

    def _prepare_image_blocks(self, images_snapshot: Dict[str, Any]) -> List[Dict[str, str]]:
        """Formats the first three images into OpenAI vision content blocks."""
        files = images_snapshot.get("files", [])[:3]
        paths = [entry.get("path") for entry in files if entry.get("path")]
        return build_image_data_blocks(paths, max_images=3)

    def _build_experiment_from_response(
        self,
        listing_id: int,
        listing_snapshot: Dict[str, Any],
        images_snapshot: Dict[str, Any],
        response: Dict[str, Any],
        start_date: date,
    ) -> ListingExperiment:
        """Instantiates a ListingExperiment based on the model output."""
        change_type_str = response.get("change_type")
        if not change_type_str:
            raise ValueError("Model response missing change_type.")

        change_type = ListingChangeType(change_type_str)
        payload = response.get("payload", {})

        if change_type == ListingChangeType.TAGS:
            change = TagChange(
                listing_id=listing_id,
                tags_to_add=[tag for tag in (payload.get("tags_to_add") or [])[:4]],
                tags_to_remove=[
                    tag for tag in (payload.get("tags_to_remove") or [])[:4]
                ],
            )
        elif change_type == ListingChangeType.TITLE:
            change = TitleChange(
                listing_id=listing_id,
                new_title=payload.get("new_title", ""),
            )
        elif change_type == ListingChangeType.DESCRIPTION:
            change = DescriptionChange(
                listing_id=listing_id,
                new_description=payload.get("new_description", ""),
            )
        elif change_type == ListingChangeType.THUMBNAILS:
            ordering = [
                int(image_id)
                for image_id in (payload.get("new_ordering") or [])
                if image_id is not None
            ]
            change = ThumbnailImageChange(
                listing_id=listing_id,
                new_ordering=ordering[:3],
            )
        else:
            raise ValueError(f"Unsupported change_type: {change_type_str}")

        return ListingExperiment(
            changes=[change],
            start_date=start_date,
            notes=response.get("hypothesis"),
            original_listing=listing_snapshot,
            original_listing_images=images_snapshot,
            state=ExperimentState.PROPOSED,
        )

    def _serialize_experiment(
        self, experiment: ListingExperiment, response: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Converts the experiment dataclass into a JSON-friendly dict."""
        record = asdict(experiment)
        record["start_date"] = experiment.start_date.isoformat()
        record["end_date"] = (
            experiment.end_date.isoformat() if experiment.end_date else None
        )
        record["state"] = experiment.state.value
        record["changes"] = [
            self._serialize_change(change) for change in experiment.changes
        ]
        record["llm_response"] = response
        return record

    def _serialize_change(self, change) -> Dict[str, Any]:
        """Serializes specific ListingChange subclasses."""
        payload = asdict(change)
        payload["change_type"] = change.change_type.value
        return payload

    def _prompt_user_for_experiment(self, experiment_options: List[Dict[str, Any]]) -> int:
        """Prompts the user to choose one of the provided experiment options."""
        print("Generated experiment options:\n")
        for idx, option in enumerate(experiment_options):
            print(f"Option {idx}:")
            print(json.dumps(option, indent=2))
            print()

        while True:
            value = input("Enter the option number to select: ").strip()
            try:
                index = int(value)
                if 0 <= index < len(experiment_options):
                    return index
            except ValueError:
                pass
            print("Invalid selection. Please enter a valid option number.")
