"""Flask routes that expose the SEO automation services."""

from __future__ import annotations

import json
import logging
import os
import sys
from datetime import date, datetime
from typing import Any, Dict, List, Optional, Tuple

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(CURRENT_DIR)
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from flask import Flask, jsonify, request
from flask_cors import CORS

from clients.etsy_client import EtsyClient
from config import settings
from repository.shop_data_repository import ShopDataRepository
from services.generate_experiment_service import GenerateExperimentService
from services.resolve_experiment_service import ResolveExperimentService
from services.evaluate_experiment_service import EvaluateExperimentService
from services.sync_service import SyncService

LOGGER = logging.getLogger(__name__)

app = Flask(__name__)
app.config["JSON_SORT_KEYS"] = False
CORS(app, resources={r"/*": {"origins": "*"}})

_COMPONENTS: Optional[Dict[str, Any]] = None


def _get_components() -> Dict[str, Any]:
    global _COMPONENTS
    if _COMPONENTS is None:
        repository = ShopDataRepository(base_data_path=settings.data_dir)
        etsy_client = EtsyClient(
            shop_id=settings.shop_id,
            key_path=settings.keys_path,
        )
        sync_service = SyncService(
            shop_id=settings.shop_id,
            repository=repository,
            etsy_client=etsy_client,
        )
        generate_service = GenerateExperimentService(
            shop_id=settings.shop_id,
            repository=repository,
        )
        resolve_service = ResolveExperimentService(
            shop_id=settings.shop_id,
            repository=repository,
            etsy_client=etsy_client,
            sync_service=sync_service,
        )
        evaluate_service = EvaluateExperimentService(
            shop_id=settings.shop_id,
            repository=repository,
        )
        _COMPONENTS = {
            "repository": repository,
            "etsy_client": etsy_client,
            "sync_service": sync_service,
            "generate_service": generate_service,
            "resolve_service": resolve_service,
            "evaluate_service": evaluate_service,
        }
    return _COMPONENTS


def _latest_performance_snapshot(repository: ShopDataRepository) -> Tuple[Optional[str], Dict[str, int]]:
    history = repository.load_performance_history(settings.shop_id)
    if not history:
        return None, {}
    latest_date = max(history.keys())
    snapshot = history.get(latest_date, {})
    normalized: Dict[str, int] = {}
    for listing_id, value in snapshot.items():
        try:
            normalized[listing_id] = int(value)
        except (TypeError, ValueError):
            normalized[listing_id] = 0
    return latest_date, normalized


def _parse_listing_ids(raw: Optional[Any]) -> Optional[List[int]]:
    if raw is None:
        return None
    if isinstance(raw, list):
        ids: List[int] = []
        for value in raw:
            try:
                ids.append(int(value))
            except (TypeError, ValueError):
                continue
        return ids or None
    if isinstance(raw, str):
        return _parse_listing_ids([part.strip() for part in raw.split(",")])
    try:
        return [int(raw)]
    except (TypeError, ValueError):
        return None




@app.route("/health", methods=["GET"])
def health_check():
    repository = _get_components()["repository"]
    has_listings = repository.load_listings(settings.shop_id) is not None
    return jsonify(
        {
            "status": "ok",
            "shop_id": settings.shop_id,
            "data_dir": settings.data_dir,
            "keys_path": settings.keys_path,
            "has_cached_listings": has_listings,
            "timestamp": datetime.utcnow().isoformat(),
        }
    )


@app.route("/sync", methods=["POST"])
def sync_data():
    components = _get_components()
    sync_service: SyncService = components["sync_service"]
    repository: ShopDataRepository = components["repository"]
    payload = request.get_json(silent=True) or {}
    limit = int(payload.get("limit") or 100)
    sort_on = payload.get("sort_on", "created")
    sort_order = payload.get("sort_order", "desc")
    keywords = payload.get("keywords")
    sync_images = payload.get("sync_images", True)
    listing_filter = _parse_listing_ids(payload.get("listing_ids"))
    try:
        listings_payload = sync_service.sync_listings(
            limit=limit,
            sort_on=sort_on,
            sort_order=sort_order,
            keywords=keywords,
        )
        image_manifest = {}
        if sync_images:
            image_manifest = sync_service.sync_listing_images(listing_filter)
        latest_date, latest_views = _latest_performance_snapshot(repository)
        return jsonify(
            {
                "listings": {
                    "count": listings_payload.get("count"),
                    "synced_results": len(listings_payload.get("results", [])),
                },
                "images": {
                    "synced_listings": len(image_manifest),
                },
                "performance": {
                    "latest_date": latest_date,
                    "tracked_listings": len(latest_views),
                },
                "synced_at": datetime.utcnow().isoformat(),
            }
        )
    except Exception as exc:
        LOGGER.exception("Sync failed")
        return jsonify({"error": str(exc)}), 500


@app.route("/listings", methods=["GET"])
def list_listings():
    components = _get_components()
    repository: ShopDataRepository = components["repository"]
    payload = repository.load_listings(settings.shop_id) or {"results": []}
    proposals = repository.load_proposals(settings.shop_id)
    testing_manifest = repository.load_testing_experiments(settings.shop_id)
    untested_manifest = repository.load_untested_experiments(settings.shop_id)
    tested_manifest = repository.load_tested_experiments(settings.shop_id)
    latest_date, latest_views = _latest_performance_snapshot(repository)

    ids_param = request.args.get("ids")
    id_filter = _parse_listing_ids(ids_param)
    search_term = request.args.get("search", "").lower()
    state_filter = request.args.get("state")

    results: List[Dict[str, Any]] = []
    for record in payload.get("results", []):
        listing_id = record.get("listing_id")
        if listing_id is None:
            continue
        if id_filter is not None and listing_id not in id_filter:
            continue
        if search_term and search_term not in (record.get("title") or "").lower():
            continue
        if state_filter and record.get("state") != state_filter:
            continue
        listing_key = str(listing_id)
        listing_proposal = proposals.get(listing_key)
        listing_testing = testing_manifest.get(listing_key)
        listing_untested = untested_manifest.get(listing_key) or {}
        listing_tested = tested_manifest.get(listing_key) or []
        proposal_count = len((listing_proposal or {}).get("options", []))
        experiment_count = (
            proposal_count
            + len(listing_untested)
            + len(listing_tested)
            + (1 if listing_testing else 0)
        )
        entry = {
            "listing_id": listing_id,
            "title": record.get("title"),
            "state": record.get("state"),
            "experiment_count": experiment_count,
            "has_proposal": listing_proposal is not None,
            "proposal_option_count": proposal_count,
            "testing_experiment": listing_testing,
            "untested_count": len(listing_untested),
            "tested_count": len(listing_tested),
            "latest_views": {
                "date": latest_date,
                "views": latest_views.get(listing_key),
            }
            if latest_date
            else None,
        }
        results.append(entry)
    return jsonify({"results": results, "count": len(results)})


@app.route("/listings/<int:listing_id>", methods=["GET"])
def get_listing(listing_id: int):
    components = _get_components()
    repository: ShopDataRepository = components["repository"]
    listing_snapshot = repository.get_listing_snapshot(settings.shop_id, listing_id)
    if not listing_snapshot:
        return jsonify({"error": f"Listing {listing_id} not found in cache."}), 404

    images_snapshot = repository.get_listing_images_snapshot(settings.shop_id, listing_id)
    proposal = repository.get_proposal(settings.shop_id, listing_id)
    testing = repository.get_testing_experiment(settings.shop_id, listing_id)
    untested = repository.load_untested_experiments(settings.shop_id).get(str(listing_id), {})
    tested = repository.load_tested_experiments(settings.shop_id).get(str(listing_id), [])
    performance_history = repository.load_performance_history(settings.shop_id)
    listing_history = [
        {"date": date_key, "views": data.get(str(listing_id))}
        for date_key, data in sorted(performance_history.items())
        if data.get(str(listing_id)) is not None
    ]
    return jsonify(
        {
            "listing": listing_snapshot,
            "images": images_snapshot,
            "proposal": proposal,
            "testing_experiment": testing,
            "untested_experiments": untested,
            "tested_experiments": tested,
            "performance": listing_history,
        }
    )


@app.route("/experiments", methods=["GET"])
def list_experiments():
    components = _get_components()
    repository: ShopDataRepository = components["repository"]
    state_filter = request.args.get("state")
    listing_filter = _parse_listing_ids(request.args.get("listing_id"))
    entries = _collect_all_experiments(repository)
    if listing_filter:
        entries = [entry for entry in entries if entry["listing_id"] in listing_filter]
    if state_filter:
        entries = [entry for entry in entries if entry.get("state") == state_filter]
    return jsonify({"results": entries, "count": len(entries)})


@app.route("/experiments/proposals", methods=["GET"])
def list_proposals():
    repository = _get_components()["repository"]
    proposals = repository.load_proposals(settings.shop_id)
    entries: List[Dict[str, Any]] = []
    listing_filter = _parse_listing_ids(request.args.get("listing_id"))
    for listing_id, record in proposals.items():
        numeric_listing_id = int(listing_id)
        if listing_filter and numeric_listing_id not in listing_filter:
            continue
        entries.append(
            {
                "listing_id": numeric_listing_id,
                "generated_at": record.get("generated_at"),
                "options": record.get("options"),
            }
        )
    return jsonify({"results": entries, "count": len(entries)})


@app.route("/experiments/proposals", methods=["POST"])
def create_proposals():
    components = _get_components()
    repository: ShopDataRepository = components["repository"]
    generate_service: GenerateExperimentService = components["generate_service"]
    payload = request.get_json(silent=True) or {}
    listing_ids = _parse_listing_ids(payload.get("listing_ids"))
    if not listing_ids:
        return jsonify({"error": "listing_ids is required."}), 400

    include_prior = payload.get(
        "include_prior_experiments", settings.include_prior_experiments
    )
    max_prior = int(payload.get("max_prior_experiments") or 5)

    results: List[Dict[str, Any]] = []
    errors: List[Dict[str, Any]] = []
    for listing_id in listing_ids:
        testing_record = repository.get_testing_experiment(settings.shop_id, listing_id)
        if testing_record:
            errors.append(
                {
                    "listing_id": listing_id,
                    "error": "Listing already has an experiment in testing.",
                }
            )
            continue
        untested = repository.load_untested_experiments(settings.shop_id).get(str(listing_id))
        if untested:
            errors.append(
                {
                    "listing_id": listing_id,
                    "error": "Listing has untested experiments; promote them before generating new proposals.",
                }
            )
            continue
        try:
            proposal = generate_service.propose_experiments(
                listing_id,
                include_prior_experiments=include_prior,
                max_prior_experiments=max_prior,
            )
            repository.save_proposal(settings.shop_id, listing_id, proposal)
            results.append(
                {
                    "listing_id": listing_id,
                    "generated_at": proposal.get("generated_at"),
                    "option_count": len(proposal.get("options") or []),
                    "options": proposal.get("options"),
                }
            )
        except Exception as exc:
            LOGGER.exception("Failed to generate proposal for listing %s", listing_id)
            errors.append({"listing_id": listing_id, "error": str(exc)})

    status_code = 207 if results and errors else (400 if errors else 200)
    return jsonify({"results": results, "errors": errors}), status_code


@app.route("/experiments/proposals/<int:listing_id>", methods=["DELETE"])
def delete_proposal(listing_id: int):
    repository = _get_components()["repository"]
    proposal = repository.get_proposal(settings.shop_id, listing_id)
    if not proposal:
        return jsonify({"error": f"No proposal found for listing {listing_id}."}), 404
    repository.delete_proposal(settings.shop_id, listing_id)
    return jsonify({"listing_id": listing_id, "deleted": True})


@app.route("/experiments/proposals/<int:listing_id>/select", methods=["POST"])
def select_proposal_option(listing_id: int):
    components = _get_components()
    repository: ShopDataRepository = components["repository"]
    generate_service: GenerateExperimentService = components["generate_service"]
    resolve_service: ResolveExperimentService = components["resolve_service"]
    payload = request.get_json(silent=True) or {}
    target_experiment_id = payload.get("experiment_id")
    start_date_value = payload.get("start_date")
    start_date_obj: Optional[date] = None
    if start_date_value:
        try:
            start_date_obj = date.fromisoformat(start_date_value)
        except ValueError:
            return jsonify({"error": f"Invalid start_date {start_date_value}."}), 400

    if not target_experiment_id:
        return jsonify({"error": "experiment_id is required."}), 400
    testing_record = repository.get_testing_experiment(settings.shop_id, listing_id)
    if testing_record:
        return jsonify(
            {"error": f"Listing {listing_id} already has an experiment in testing."}
        ), 400

    proposal = repository.get_proposal(settings.shop_id, listing_id)
    if not proposal:
        return jsonify({"error": f"No proposal found for listing {listing_id}."}), 404

    try:
        experiments = generate_service.build_experiments_from_proposal(
            proposal,
            start_date=None,
        )
    except Exception as exc:
        return jsonify({"error": str(exc)}), 400

    selected_record: Optional[Dict[str, Any]] = None
    remaining_records: List[Dict[str, Any]] = []
    for record in experiments:
        record["start_date"] = None
        if str(record.get("experiment_id")) == str(target_experiment_id):
            selected_record = record
        else:
            remaining_records.append(record)

    if selected_record is None:
        return jsonify(
            {"error": f"Experiment {target_experiment_id} not found in proposal."}
        ), 404

    if start_date_obj:
        selected_record["start_date"] = start_date_obj.isoformat()

    if remaining_records:
        repository.add_untested_experiments(
            settings.shop_id, listing_id, remaining_records
        )
    repository.delete_proposal(settings.shop_id, listing_id)

    try:
        repository.add_untested_experiments(
            settings.shop_id, listing_id, [selected_record]
        )
        accepted_record = resolve_service.accept_experiment(
            listing_id, selected_record["experiment_id"]
        )
    except Exception as exc:
        # Selected experiment remains in untested backlog for manual retry.
        return jsonify({"error": str(exc)}), 400

    return jsonify(
        {
            "listing_id": listing_id,
            "experiment_id": accepted_record["experiment_id"],
            "state": accepted_record.get("state"),
            "untested_experiments": [
                record["experiment_id"] for record in untested_records
            ],
        }
    )


@app.route("/experiments/testing", methods=["GET"])
def list_testing_experiments():
    repository = _get_components()["repository"]
    manifest = repository.load_testing_experiments(settings.shop_id)
    results = [
        {"listing_id": int(listing_id), "experiment": record}
        for listing_id, record in manifest.items()
    ]
    return jsonify({"results": results, "count": len(results)})


@app.route("/experiments/untested", methods=["GET"])
def list_untested_experiments():
    repository = _get_components()["repository"]
    manifest = repository.load_untested_experiments(settings.shop_id)
    results = [
        {
            "listing_id": int(listing_id),
            "experiments": records,
        }
        for listing_id, records in manifest.items()
    ]
    return jsonify({"results": results, "count": len(results)})


@app.route("/experiments/<int:listing_id>/<experiment_id>/accept", methods=["POST"])
def accept_experiment(listing_id: int, experiment_id: str):
    components = _get_components()
    repository: ShopDataRepository = components["repository"]
    generate_service: GenerateExperimentService = components["generate_service"]
    resolve_service: ResolveExperimentService = components["resolve_service"]
    _ensure_experiment_materialized(
        repository=repository,
        generate_service=generate_service,
        listing_id=listing_id,
        experiment_id=experiment_id,
    )
    try:
        record = resolve_service.accept_experiment(listing_id, experiment_id)
        return jsonify(
            {
                "listing_id": listing_id,
                "experiment_id": experiment_id,
                "state": record.get("state"),
            }
        )
    except Exception as exc:
        return jsonify({"error": str(exc)}), 400


@app.route("/experiments/<int:listing_id>/<experiment_id>/keep", methods=["POST"])
def keep_experiment(listing_id: int, experiment_id: str):
    resolve_service: ResolveExperimentService = _get_components()["resolve_service"]
    try:
        record = resolve_service.keep_experiment(listing_id, experiment_id)
        return jsonify(
            {
                "listing_id": listing_id,
                "experiment_id": experiment_id,
                "state": record.get("state"),
            }
        )
    except Exception as exc:
        return jsonify({"error": str(exc)}), 400


@app.route("/experiments/<int:listing_id>/<experiment_id>/revert", methods=["POST"])
def revert_experiment(listing_id: int, experiment_id: str):
    resolve_service: ResolveExperimentService = _get_components()["resolve_service"]
    try:
        record = resolve_service.revert_experiment(listing_id, experiment_id)
        return jsonify(
            {
                "listing_id": listing_id,
                "experiment_id": experiment_id,
                "state": record.get("state"),
            }
        )
    except Exception as exc:
        return jsonify({"error": str(exc)}), 400


@app.route("/experiments/<int:listing_id>/<experiment_id>/evaluate", methods=["POST"])
def evaluate_experiment(listing_id: int, experiment_id: str):
    components = _get_components()
    evaluate_service: EvaluateExperimentService = components["evaluate_service"]
    payload = request.get_json(silent=True) or {}
    comparison_date = payload.get("comparison_date")
    tolerance = float(payload.get("tolerance") or 0)

    try:
        result = evaluate_service.evaluate_experiment(
            listing_id,
            experiment_id,
            comparison_date=comparison_date,
            tolerance=tolerance,
        )
        return jsonify(result)
    except ValueError as exc:
        message = str(exc)
        status = 400
        if "No experiments" in message or "does not exist" in message or "No views recorded" in message:
            status = 404
        return jsonify({"error": message}), status
    except Exception as exc:
        LOGGER.exception("Failed to evaluate experiment %s for listing %s", experiment_id, listing_id)
        return jsonify({"error": str(exc)}), 500


@app.route("/reports/experiments", methods=["POST"])
def generate_experiment_report():
    components = _get_components()
    repository: ShopDataRepository = components["repository"]
    generate_service: GenerateExperimentService = components["generate_service"]
    payload = request.get_json(silent=True) or {}
    listing_filter = _parse_listing_ids(payload.get("listing_ids"))
    use_llm = payload.get("use_llm", True)

    experiments = repository.load_tested_experiments(settings.shop_id)
    report_rows: List[Dict[str, Any]] = []
    for listing_id, records in experiments.items():
        numeric_listing_id = int(listing_id)
        if listing_filter and numeric_listing_id not in listing_filter:
            continue
        for record in records:
            entry = {
                "listing_id": numeric_listing_id,
                "experiment_id": record.get("experiment_id"),
                "state": record.get("state"),
                "change_types": [change.get("change_type") for change in record.get("changes", [])],
                "baseline": (record.get("performance") or {}).get("baseline"),
                "latest": (record.get("performance") or {}).get("latest"),
                "notes": record.get("notes"),
            }
            report_rows.append(entry)

    if not use_llm:
        return jsonify({"experiments": report_rows})

    if not report_rows:
        return jsonify({"error": "No experiments found to summarize."}), 400

    system_prompt = (
        "You are an analytics assistant that summarizes Etsy SEO experiments. "
        "Given JSON data describing experiments, highlight wins, losses, and recommend next actions. "
        "Respond with JSON containing keys 'report' (markdown string) and 'actions' (list)."
    )
    user_payload = json.dumps({"experiments": report_rows}, indent=2)
    try:
        response = generate_service.openai_client.generate_json_response(
            system_prompt=system_prompt,
            user_content=[{"type": "input_text", "text": user_payload}],
        )
        return jsonify({"experiments": report_rows, "llm_report": response})
    except Exception as exc:
        LOGGER.exception("Failed to generate LLM report, returning fallback text.")
        fallback = _build_fallback_report(report_rows)
        return jsonify({"experiments": report_rows, "llm_report": fallback, "error": str(exc)}), 207


def _build_fallback_report(rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    wins = [row for row in rows if (row.get("latest") or {}).get("normalized_delta", 0) > 0]
    losses = [row for row in rows if (row.get("latest") or {}).get("normalized_delta", 0) < 0]
    summary = [
        f"{len(rows)} experiments reviewed.",
        f"{len(wins)} trending positively, {len(losses)} trending negatively.",
    ]
    return {
        "report": "\n".join(summary),
        "actions": [
            "Prioritize reverting experiments marked as revert by /experiments/*/evaluate.",
            "Queue fresh proposals for listings without active tests or backlog.",
        ],
    }


def _collect_all_experiments(repository: ShopDataRepository) -> List[Dict[str, Any]]:
    results: List[Dict[str, Any]] = []
    proposals = repository.load_proposals(settings.shop_id)
    for listing_id, record in proposals.items():
        options = record.get("options") or []
        for idx, option in enumerate(options):
            entry = {
                "listing_id": int(listing_id),
                "experiment_id": option.get("experiment_id"),
                "state": "proposed",
                "source": "proposal",
                "change_types": [option.get("change_type")],
                "start_date": None,
                "end_date": None,
                "option_index": option.get("option_index", idx),
            }
            results.append(entry)

    untested = repository.load_untested_experiments(settings.shop_id)
    for listing_id, records in untested.items():
        for record in records.values():
            results.append(_summarize_experiment_record(listing_id, record, "untested"))

    testing = repository.load_testing_experiments(settings.shop_id)
    for listing_id, record in testing.items():
        results.append(_summarize_experiment_record(listing_id, record, "testing"))

    tested = repository.load_tested_experiments(settings.shop_id)
    for listing_id, records in tested.items():
        for record in records:
            results.append(_summarize_experiment_record(listing_id, record, "tested"))
    return results


def _summarize_experiment_record(
    listing_id: Any, record: Dict[str, Any], source: str
) -> Dict[str, Any]:
    change_types = [
        change.get("change_type") for change in record.get("changes", [])
    ]
    return {
        "listing_id": int(listing_id),
        "experiment_id": record.get("experiment_id"),
        "state": record.get("state"),
        "source": source,
        "change_types": change_types,
        "start_date": record.get("start_date"),
        "end_date": record.get("end_date"),
    }


def _ensure_experiment_materialized(
    repository: ShopDataRepository,
    generate_service: GenerateExperimentService,
    listing_id: int,
    experiment_id: str,
) -> None:
    if repository.get_untested_experiment(settings.shop_id, listing_id, experiment_id):
        return
    testing = repository.get_testing_experiment(settings.shop_id, listing_id)
    if testing and str(testing.get("experiment_id")) == str(experiment_id):
        return

    proposal = repository.get_proposal(settings.shop_id, listing_id)
    if not proposal:
        return

    try:
        experiments_from_proposal = generate_service.build_experiments_from_proposal(
            proposal,
            start_date=None,
        )
    except Exception:
        return

    selected_record: Optional[Dict[str, Any]] = None
    remaining: List[Dict[str, Any]] = []
    for record in experiments_from_proposal:
        record["start_date"] = None
        if str(record.get("experiment_id")) == str(experiment_id):
            selected_record = record
        else:
            remaining.append(record)

    if not selected_record:
        return

    if remaining:
        repository.add_untested_experiments(
            settings.shop_id, listing_id, remaining
        )

    repository.add_untested_experiments(
        settings.shop_id, listing_id, [selected_record]
    )

    repository.delete_proposal(settings.shop_id, listing_id)


def create_app() -> Flask:
    """WSGI factory for external servers."""
    return app


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000, debug=True)
