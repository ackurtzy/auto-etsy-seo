"""Service to generate SEO experiments via OpenAI."""

from __future__ import annotations

import json
from dataclasses import asdict
from datetime import date, datetime
from typing import Any, Callable, Dict, List, Optional
from uuid import uuid4

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

DEFAULT_RUN_DURATION_DAYS = 14

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
        selection_strategy: Optional[Callable[[List[Dict[str, Any]]], int]] = None,
    ) -> Dict[str, Any]:
        """Generates and persists an experiment for the provided listing."""
        payload = self._prepare_generation_payload(
            listing_id,
            include_prior_experiments=include_prior_experiments,
            max_prior_experiments=max_prior_experiments,
        )
        experiment_payloads = payload["options"]
        if selection_strategy is not None:
            experiment_index = selection_strategy(experiment_payloads)
        else:
            experiment_index = self._prompt_user_for_experiment(experiment_payloads)
        chosen_payload = experiment_payloads[experiment_index]

        experiment = self._build_experiment_from_response(
            listing_id,
            payload["listing_snapshot"],
            payload["images_snapshot"],
            chosen_payload,
            today or date.today(),
        )

        experiment_record = self._serialize_experiment(experiment, payload["llm_response"])
        if not experiment_record.get("experiment_id"):
            experiment_record["experiment_id"] = uuid4().hex
        self.repository.add_untested_experiments(
            self.shop_id, listing_id, [experiment_record]
        )
        return experiment_record

    def propose_experiments(
        self,
        listing_id: int,
        include_prior_experiments: bool = True,
        max_prior_experiments: int = 5,
        run_duration_days: Optional[int] = None,
        model_used: Optional[str] = None,
        reasoning_level: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Generates proposals and persists the latest bundle for the listing."""
        if self.repository.get_testing_experiment(self.shop_id, listing_id):
            raise ValueError(
                f"Listing {listing_id} already has an experiment in testing. Finish it before creating new proposals."
            )
        untested = self.repository.load_untested_experiments(self.shop_id).get(
            str(listing_id)
        )
        if untested:
            raise ValueError(
                f"Listing {listing_id} has untested experiments. Promote those before generating a new proposal bundle."
            )
        payload = self._prepare_generation_payload(
            listing_id,
            include_prior_experiments=include_prior_experiments,
            max_prior_experiments=max_prior_experiments,
            model_used=model_used,
            reasoning_level=reasoning_level,
        )
        if run_duration_days is None:
            run_duration_days = DEFAULT_RUN_DURATION_DAYS
        payload["run_duration_days"] = run_duration_days
        if model_used:
            payload["model_used"] = model_used
        self._assign_option_ids(payload["options"])
        payload["generated_at"] = datetime.utcnow().isoformat()
        self.repository.save_proposal(self.shop_id, listing_id, payload)
        return payload

    def build_experiments_from_proposal(
        self,
        proposal: Dict[str, Any],
        start_date: Optional[date] = None,
    ) -> List[Dict[str, Any]]:
        """Expands a stored proposal into serialized experiment records."""
        options: List[Dict[str, Any]] = proposal.get("options") or []
        if not options:
            raise ValueError("Proposal missing experiment options.")

        listing_id = proposal.get("listing_id")
        if listing_id is None:
            raise ValueError("Proposal missing listing_id.")

        listing_snapshot = proposal.get("listing_snapshot")
        images_snapshot = proposal.get("images_snapshot")
        if not listing_snapshot or not images_snapshot:
            raise ValueError("Proposal missing cached listing data.")
        run_duration_days = proposal.get("run_duration_days") or DEFAULT_RUN_DURATION_DAYS
        model_used = proposal.get("model_used")

        experiments: List[Dict[str, Any]] = []
        for idx, option in enumerate(options):
            experiment = self._build_experiment_from_response(
                listing_id,
                listing_snapshot,
                images_snapshot,
                option,
                start_date or date.today(),
            )
            record = self._serialize_experiment(experiment, proposal.get("llm_response") or {})
            record["option_index"] = idx
            option_id = option.get("experiment_id")
            if option_id:
                record["experiment_id"] = str(option_id)
            if not record.get("experiment_id"):
                record["experiment_id"] = uuid4().hex
            record.setdefault("run_duration_days", run_duration_days)
            if model_used:
                record.setdefault("model_used", model_used)
            experiments.append(record)
        return experiments

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

    def _assign_option_ids(self, options: List[Dict[str, Any]]) -> None:
        for option in options:
            if not option.get("experiment_id"):
                option["experiment_id"] = uuid4().hex

    def _prepare_generation_payload(
        self,
        listing_id: int,
        include_prior_experiments: bool,
        max_prior_experiments: int,
        model_used: Optional[str] = None,
        reasoning_level: Optional[str] = None,
    ) -> Dict[str, Any]:
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
            experiments = self.repository.load_tested_experiments(self.shop_id)
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
            model=model_used,
            reasoning_level=reasoning_level,
        )
        experiment_payloads = response.get("experiments") or []
        if len(experiment_payloads) != 3:
            raise ValueError("Model response must contain exactly 3 experiment options.")

        return {
            "listing_id": listing_id,
            "options": experiment_payloads,
            "llm_response": response,
            "listing_snapshot": listing_snapshot,
            "images_snapshot": images_snapshot,
            "prior_experiments": prior_experiments,
            "generated_at": datetime.utcnow().isoformat(),
        }

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
