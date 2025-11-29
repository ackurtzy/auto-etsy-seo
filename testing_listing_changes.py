"""Ad-hoc script to exercise listing experiment workflows."""

from __future__ import annotations

import json
import logging
from dataclasses import asdict
from datetime import date, timedelta
from pathlib import Path
from typing import Any, Dict, List

from clients.etsy_client import EtsyClient
from models.listing_change import (
    DescriptionChange,
    ExperimentState,
    ListingExperiment,
    TagChange,
    ThumbnailImageChange,
    TitleChange,
)
from repository.shop_data_repository import ShopDataRepository
from services.resolve_experiment_service import ResolveExperimentService
from services.sync_service import SyncService

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")

SHOP_ID = 23574688
LISTING_ID = 4332016634
KEYS_PATH = "keys.json"
DATA_DIR = "data"

TAG_EXPERIMENT = {
    "tags_to_remove": ["experimental tags"],
    "tags_to_add": ["experimental tag2"],
}
TITLE_EXPERIMENT = {
    "new_title": "Test Title For SEO Iteration",
}
THUMBNAIL_EXPERIMENT = {
    "new_ordering": [7050842893, 7050843655, 7050843245],
}
DESCRIPTION_EXPERIMENT = {
    "new_description": "Experimental description content for testing changes.",
}


def build_experiments(repository: ShopDataRepository) -> List[ListingExperiment]:
    today = date.today()
    end = today + timedelta(days=7)
    listing_snapshot = repository.get_listing_snapshot(SHOP_ID, LISTING_ID) or {}
    images_snapshot = repository.get_listing_images_snapshot(SHOP_ID, LISTING_ID) or {}
    if not listing_snapshot or not images_snapshot:
        raise RuntimeError(
            f"Missing cached data for listing {LISTING_ID}. Run testing.py first."
        )

    return [
        ListingExperiment(
            changes=[
                TagChange(
                    listing_id=LISTING_ID,
                    tags_to_remove=TAG_EXPERIMENT["tags_to_remove"],
                    tags_to_add=TAG_EXPERIMENT["tags_to_add"],
                )
            ],
            start_date=today,
            end_date=end,
            original_listing=listing_snapshot,
            original_listing_images=images_snapshot,
            state=ExperimentState.PROPOSED,
        ),
        ListingExperiment(
            changes=[
                TitleChange(
                    listing_id=LISTING_ID,
                    new_title=TITLE_EXPERIMENT["new_title"],
                ),
            ],
            start_date=today,
            end_date=end,
            original_listing=listing_snapshot,
            original_listing_images=images_snapshot,
        ),
        ListingExperiment(
            changes=[
                ThumbnailImageChange(
                    listing_id=LISTING_ID,
                    new_ordering=THUMBNAIL_EXPERIMENT["new_ordering"],
                ),
            ],
            start_date=today,
            end_date=end,
            original_listing=listing_snapshot,
            original_listing_images=images_snapshot,
        ),
        ListingExperiment(
            changes=[
                DescriptionChange(
                    listing_id=LISTING_ID,
                    new_description=DESCRIPTION_EXPERIMENT["new_description"],
                ),
            ],
            start_date=today,
            end_date=end,
            original_listing=listing_snapshot,
            original_listing_images=images_snapshot,
        ),
    ]


def serialize_experiment(experiment: ListingExperiment) -> Dict[str, Any]:
    record = asdict(experiment)
    record["state"] = experiment.state.value
    record["start_date"] = experiment.start_date.isoformat()
    record["end_date"] = (
        experiment.end_date.isoformat() if experiment.end_date else None
    )
    record["changes"] = [
        {**asdict(change), "change_type": change.change_type.value}
        for change in experiment.changes
    ]
    return record


def run_experiments(
    resolve_service: ResolveExperimentService,
    experiment_indices: List[int],
) -> None:
    for index in experiment_indices:
        logging.info("Applying experiment index %s for listing %s", index, LISTING_ID)
        response = resolve_service.accept_experiment(LISTING_ID, index)
        logging.info("Experiment applied. State: %s", response["state"])
        logging.debug("Response snapshot:\n%s", json.dumps(response, indent=2))

        _await_user_confirmation()
        logging.info("Reverting experiment index %s", index)
        reverted = resolve_service.revert_experiment(LISTING_ID, index)
        logging.info("Experiment reverted. State: %s", reverted["state"])


def _await_user_confirmation() -> None:
    while True:
        user_input = (
            input("Type 'c' or 'continue' to revert the changes: ").strip().lower()
        )
        if user_input in {"c", "continue"}:
            break


def main() -> int:
    keys_path = Path(KEYS_PATH).expanduser()
    data_dir = Path(DATA_DIR).expanduser()

    repository = ShopDataRepository(base_data_path=str(data_dir))
    etsy_client = EtsyClient(
        shop_id=SHOP_ID,
        key_path=str(keys_path),
    )
    sync_service = SyncService(SHOP_ID, repository, etsy_client)
    resolve_service = ResolveExperimentService(
        SHOP_ID, repository, etsy_client, sync_service
    )

    experiments = build_experiments(repository)
    print("Choose experiments to run:")
    for idx, experiment in enumerate(experiments):
        change_type = experiment.changes[0].change_type.value
        print(f"{idx}: {change_type}")

    selection = input(
        "Enter experiment indices separated by commas (default: 0): "
    ).strip()
    if selection:
        indices = [int(index.strip()) for index in selection.split(",")]
    else:
        indices = [0]

    chosen_experiments = [experiments[index] for index in indices]

    experiment_indices: List[int] = []
    for experiment in chosen_experiments:
        record = serialize_experiment(experiment)
        experiments_data = repository.save_experiment(SHOP_ID, LISTING_ID, record)
        listing_records = experiments_data[str(LISTING_ID)]
        experiment_indices.append(len(listing_records) - 1)

    run_experiments(resolve_service, experiment_indices)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
