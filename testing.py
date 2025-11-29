"""Manual entry point for exercising the Etsy client."""

from __future__ import annotations

import json
import logging
from pathlib import Path

from clients.etsy_client import EtsyClient
from repository.shop_data_repository import ShopDataRepository
from services.sync_service import SyncService

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")

# --- Configure these values before running the script. ---
SHOP_ID = 23574688  # Replace with your Etsy shop id.
KEYS_PATH = "keys.json"  # Path to keys.json with keystring/access/refresh tokens.
DATA_DIR = "data"  # Folder where listing payloads will be saved.
LIMIT = 100  # Listings requested per API call.
KEYWORDS = None  # Optional keyword filter, e.g., "wedding invitations".


def main() -> int:
    """Entrypoint for running an Etsy listings fetch."""
    keys_path = Path(KEYS_PATH).expanduser()
    data_dir = Path(DATA_DIR).expanduser()

    repository = ShopDataRepository(base_data_path=str(data_dir))
    client = EtsyClient(
        shop_id=SHOP_ID,
        key_path=str(keys_path),
    )
    sync_service = SyncService(
        shop_id=SHOP_ID,
        repository=repository,
        etsy_client=client,
    )

    payload = sync_service.sync_listings(limit=LIMIT, keywords=KEYWORDS)
    image_manifest = sync_service.sync_listing_images()

    preview = json.dumps(
        {
            "count": payload.get("count"),
            "sample_results": payload.get("results", [])[:1],
        },
        indent=2,
    )
    logging.info("Fetched %s listings.", payload.get("count"))
    # logging.info("Sample payload:\n%s", preview)
    logging.info("Synced images for %s listings.", len(image_manifest))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
