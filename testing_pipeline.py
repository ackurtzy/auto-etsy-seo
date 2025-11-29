"""Integration test that runs sync + LLM experiment generation + apply/revert."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import List

from clients.etsy_client import EtsyClient
from repository.shop_data_repository import ShopDataRepository
from services.generate_experiment_service import GenerateExperimentService
from services.resolve_experiment_service import ResolveExperimentService
from services.sync_service import SyncService
from config import settings

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")

SHOP_ID = settings.shop_id
LISTING_IDS: List[int] = [1113839816]
KEYS_PATH = "keys.json"
DATA_DIR = settings.data_dir
LIMIT = 100
KEYWORDS = None
INCLUDE_PRIOR_EXPERIMENTS = settings.include_prior_experiments


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
    generate_service = GenerateExperimentService(
        shop_id=SHOP_ID,
        repository=repository,
    )

    logging.info("Running listing + image sync...")
    sync_service.sync_listings(limit=LIMIT, keywords=KEYWORDS)
    sync_service.sync_listing_images()

    for listing_id in LISTING_IDS:
        logging.info("Generating experiment for listing %s", listing_id)
        record = generate_service.generate_for_listing(
            listing_id,
            include_prior_experiments=INCLUDE_PRIOR_EXPERIMENTS,
        )
        logging.info(
            "Experiment generated: %s", json.dumps(record["changes"][0], indent=2)
        )

        experiments = repository.load_experiments(SHOP_ID)
        listing_records = experiments[str(listing_id)]
        experiment_index = len(listing_records) - 1

        logging.info("Applying generated experiment...")
        resolve_service.accept_experiment(listing_id, experiment_index)

        input("Change applied. Check listing on Etsy, then press Enter to revert...")
        logging.info("Reverting generated experiment...")
        resolve_service.revert_experiment(listing_id, experiment_index)

    logging.info("Pipeline completed successfully.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
