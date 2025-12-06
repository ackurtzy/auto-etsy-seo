"""Flask routes that expose the SEO automation services."""

from __future__ import annotations

import json
import logging
import os
import sys
from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(CURRENT_DIR)
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS

from clients.etsy_client import EtsyClient
from config import settings
from repository.shop_data_repository import ShopDataRepository
from models.listing_change import ExperimentState
from services.generate_experiment_service import GenerateExperimentService
from services.resolve_experiment_service import ResolveExperimentService
from services.evaluate_experiment_service import EvaluateExperimentService
from services.report_service import ReportService
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
        report_service = ReportService(
            shop_id=settings.shop_id,
            repository=repository,
            evaluate_service=evaluate_service,
        )
        _COMPONENTS = {
            "repository": repository,
            "etsy_client": etsy_client,
            "sync_service": sync_service,
            "generate_service": generate_service,
            "resolve_service": resolve_service,
            "evaluate_service": evaluate_service,
            "report_service": report_service,
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


def _load_listing_map(repository: ShopDataRepository) -> Dict[int, Dict[str, Any]]:
    payload = repository.load_listings(settings.shop_id) or {"results": []}
    listing_map: Dict[int, Dict[str, Any]] = {}
    for record in payload.get("results", []):
        listing_id = record.get("listing_id")
        if listing_id is None:
            continue
        listing_map[int(listing_id)] = record
    return listing_map


def _primary_image_url(
    listing_id: int, images_snapshot: Optional[Dict[str, Any]]
) -> Optional[str]:
    if not images_snapshot:
        return None

    def sort_key(entry: Dict[str, Any]) -> int:
        rank = entry.get("rank")
        return int(rank) if rank is not None else 9999

    files = sorted(images_snapshot.get("files") or [], key=sort_key)
    results = sorted(images_snapshot.get("results") or [], key=sort_key)

    if files:
        path = files[0].get("path")
        if path:
            filename = os.path.basename(path)
            return f"/images/{listing_id}/{filename}"
    if results:
        return results[0].get("url_fullxfull") or results[0].get("url_570xN")
    return None


def _listing_preview(
    repository: ShopDataRepository,
    listing_id: int,
    listing_record: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    record = listing_record or repository.get_listing_snapshot(
        settings.shop_id, listing_id
    )
    images_snapshot = repository.get_listing_images_snapshot(settings.shop_id, listing_id)
    title = (record or {}).get("title") or ""
    return {
        "listing_id": listing_id,
        "title": title,
        "title_30": title[:30],
        "state": (record or {}).get("state"),
        "primary_image_url": _primary_image_url(listing_id, images_snapshot),
    }


def _extract_normalized_delta(record: Dict[str, Any]) -> Optional[float]:
    performance = record.get("performance") or {}
    latest = performance.get("latest") or {}
    if not isinstance(latest, dict):
        return None
    return latest.get("normalized_delta")


def _planned_end_date_from_record(record: Dict[str, Any]) -> Optional[str]:
    if record.get("planned_end_date"):
        return record.get("planned_end_date")
    start_value = record.get("start_date")
    run_duration = record.get("run_duration_days")
    if not start_value or not run_duration:
        return None
    try:
        start_dt = date.fromisoformat(start_value)
        return (start_dt + timedelta(days=int(run_duration))).isoformat()
    except Exception:
        return None


def _is_finished_record(record: Dict[str, Any]) -> bool:
    planned_end = _planned_end_date_from_record(record)
    if not planned_end:
        return False
    try:
        planned_dt = date.fromisoformat(planned_end)
    except Exception:
        return False
    return planned_dt <= date.today()




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


@app.route("/images/<int:listing_id>/<path:filename>", methods=["GET"])
def serve_listing_image(listing_id: int, filename: str):
    base_dir = os.path.join(
        settings.data_dir, str(settings.shop_id), "images", str(listing_id)
    )
    file_path = os.path.join(base_dir, filename)
    if not os.path.exists(file_path):
        return jsonify({"error": "Image not found."}), 404
    return send_from_directory(base_dir, filename)


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
    evaluate_service: EvaluateExperimentService = components["evaluate_service"]
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
            "preview": _listing_preview(repository, listing_id, record),
        }
        lifetime_delta = 0.0
        for tested_record in listing_tested:
            if tested_record.get("state") != ExperimentState.KEPT.value:
                continue
            try:
                evaluate_service.evaluate_experiment(
                    listing_id, str(tested_record.get("experiment_id"))
                )
            except Exception:
                pass
            delta = _extract_normalized_delta(tested_record)
            if delta is not None:
                lifetime_delta += float(delta)
        entry["lifetime_kept_normalized_delta"] = lifetime_delta
        results.append(entry)
    return jsonify({"results": results, "count": len(results)})


@app.route("/overview", methods=["GET"])
def overview():
    components = _get_components()
    repository: ShopDataRepository = components["repository"]
    evaluate_service: EvaluateExperimentService = components["evaluate_service"]
    listing_map = _load_listing_map(repository)

    proposals = repository.load_proposals(settings.shop_id)
    testing_manifest = repository.load_testing_experiments(settings.shop_id)
    tested_manifest = repository.load_tested_experiments(settings.shop_id)
    active_insights = repository.load_active_insights(settings.shop_id)

    finished_records: List[Tuple[int, Dict[str, Any]]] = []
    active_records: List[Tuple[int, Dict[str, Any]]] = []
    for listing_id_str, record in testing_manifest.items():
        listing_id = int(listing_id_str)
        record["planned_end_date"] = _planned_end_date_from_record(record)
        if record.get("state") == ExperimentState.FINISHED.value or _is_finished_record(record):
            record["state"] = ExperimentState.FINISHED.value
            repository.save_testing_experiment(settings.shop_id, listing_id, record)
            finished_records.append((listing_id, record))
        else:
            active_records.append((listing_id, record))

    def _ensure_eval(listing_id: int, record: Dict[str, Any]) -> None:
        experiment_id = record.get("experiment_id")
        if not experiment_id:
            return
        try:
            evaluate_service.evaluate_experiment(listing_id, str(experiment_id))
        except Exception:
            return

    for listing_id, record in active_records + finished_records:
        _ensure_eval(listing_id, record)

    def _pick_best_and_worst(records: List[Tuple[int, Dict[str, Any]]]) -> Tuple[Optional[Dict[str, Any]], Optional[Dict[str, Any]]]:
        scored = []
        for listing_id, record in records:
            delta = _extract_normalized_delta(record)
            if delta is None:
                continue
            scored.append(
                {
                    "listing_id": listing_id,
                    "experiment_id": record.get("experiment_id"),
                    "normalized_delta": delta,
                    "preview": _listing_preview(
                        repository, listing_id, listing_map.get(listing_id)
                    ),
                }
            )
        if not scored:
            return None, None
        scored_sorted = sorted(scored, key=lambda item: item["normalized_delta"])
        return scored_sorted[-1], scored_sorted[0]

    active_best, active_worst = _pick_best_and_worst(active_records)
    finished_best, finished_worst = _pick_best_and_worst(finished_records)

    total_tested = sum(len(records) for records in tested_manifest.values())
    kept_records: List[Dict[str, Any]] = []
    kept_deltas: List[float] = []
    for listing_id, records in tested_manifest.items():
        for record in records:
            if record.get("state") == ExperimentState.KEPT.value:
                kept_records.append(record)
                delta = _extract_normalized_delta(record)
                if delta is not None:
                    kept_deltas.append(delta)

    percent_kept = (
        (len(kept_records) / total_tested) * 100 if total_tested else None
    )
    avg_delta_kept = (
        sum(kept_deltas) / len(kept_deltas) if kept_deltas else None
    )

    return jsonify(
        {
            "active_experiments": {
                "count": len(active_records),
                "best": active_best,
                "worst": active_worst,
            },
            "finished_experiments": {
                "count": len(finished_records),
                "best": finished_best,
                "worst": finished_worst,
            },
            "proposals": {"count": len(proposals)},
            "insights": {"active_count": len(active_insights)},
            "completed": {
                "count": total_tested,
                "percent_kept": percent_kept,
                "avg_normalized_delta_kept": avg_delta_kept,
            },
        }
    )


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


@app.route("/experiments/board", methods=["GET"])
def experiments_board():
    components = _get_components()
    repository: ShopDataRepository = components["repository"]
    evaluate_service: EvaluateExperimentService = components["evaluate_service"]
    listing_map = _load_listing_map(repository)
    search_term = (request.args.get("search") or "").lower()

    proposals = repository.load_proposals(settings.shop_id)
    untested = repository.load_untested_experiments(settings.shop_id)
    testing = repository.load_testing_experiments(settings.shop_id)
    tested = repository.load_tested_experiments(settings.shop_id)

    def matches_search(listing_id: int) -> bool:
        if not search_term:
            return True
        title = (listing_map.get(listing_id) or {}).get("title", "").lower()
        return search_term in title

    finished_records: Dict[int, Dict[str, Any]] = {}
    active_testing: Dict[int, Dict[str, Any]] = {}
    for listing_id_str, record in testing.items():
        listing_id = int(listing_id_str)
        record["planned_end_date"] = _planned_end_date_from_record(record)
        if record.get("state") == ExperimentState.FINISHED.value or _is_finished_record(record):
            record["state"] = ExperimentState.FINISHED.value
            repository.save_testing_experiment(settings.shop_id, listing_id, record)
            finished_records[listing_id] = record
        else:
            active_testing[listing_id] = record

    def _evaluate_record(listing_id: int, record: Dict[str, Any]) -> None:
        experiment_id = record.get("experiment_id")
        if not experiment_id:
            return
        try:
            evaluate_service.evaluate_experiment(listing_id, str(experiment_id))
        except Exception:
            return

    inactive_results: List[Dict[str, Any]] = []
    for listing_id, record in listing_map.items():
        if not matches_search(listing_id):
            continue
        if str(listing_id) in proposals or str(listing_id) in testing or str(listing_id) in untested:
            continue
        inactive_results.append(_listing_preview(repository, listing_id, record))

    proposal_results: List[Dict[str, Any]] = []
    for listing_id_str, proposal in proposals.items():
        listing_id = int(listing_id_str)
        if not matches_search(listing_id):
            continue
        proposal_results.append(
            {
                "listing_id": listing_id,
                "generated_at": proposal.get("generated_at"),
                "option_count": len(proposal.get("options") or []),
                "run_duration_days": proposal.get("run_duration_days"),
                "model_used": proposal.get("model_used"),
                "preview": _listing_preview(
                    repository, listing_id, listing_map.get(listing_id)
                ),
            }
        )
    proposal_results = sorted(
        proposal_results,
        key=lambda item: item.get("generated_at") or "",
        reverse=True,
    )

    active_results: List[Dict[str, Any]] = []
    for listing_id, record in active_testing.items():
        if not matches_search(listing_id):
            continue
        _evaluate_record(listing_id, record)
        active_results.append(
            {
                "listing_id": listing_id,
                "experiment_id": record.get("experiment_id"),
                "state": record.get("state"),
                "start_date": record.get("start_date"),
                "planned_end_date": record.get("planned_end_date"),
                "run_duration_days": record.get("run_duration_days"),
                "model_used": record.get("model_used"),
                "performance": record.get("performance"),
                "preview": _listing_preview(
                    repository, listing_id, listing_map.get(listing_id)
                ),
            }
        )
    active_results = sorted(
        active_results, key=lambda item: item.get("planned_end_date") or "", reverse=False
    )

    finished_results: List[Dict[str, Any]] = []
    for listing_id, record in finished_records.items():
        if not matches_search(listing_id):
            continue
        _evaluate_record(listing_id, record)
        finished_results.append(
            {
                "listing_id": listing_id,
                "experiment_id": record.get("experiment_id"),
                "state": record.get("state"),
                "start_date": record.get("start_date"),
                "planned_end_date": record.get("planned_end_date"),
                "run_duration_days": record.get("run_duration_days"),
                "model_used": record.get("model_used"),
                "performance": record.get("performance"),
                "preview": _listing_preview(
                    repository, listing_id, listing_map.get(listing_id)
                ),
            }
        )
    finished_results = sorted(
        finished_results, key=lambda item: item.get("planned_end_date") or "", reverse=False
    )

    completed_results: List[Dict[str, Any]] = []
    for listing_id_str, records in tested.items():
        listing_id = int(listing_id_str)
        if not matches_search(listing_id):
            continue
        for record in records:
            completed_results.append(
                {
                    "listing_id": listing_id,
                    "experiment_id": record.get("experiment_id"),
                    "state": record.get("state"),
                    "end_date": record.get("end_date"),
                    "performance": record.get("performance"),
                    "preview": _listing_preview(
                        repository, listing_id, listing_map.get(listing_id)
                    ),
                }
            )
    completed_results = sorted(
        completed_results, key=lambda item: item.get("end_date") or "", reverse=True
    )

    return jsonify(
        {
            "inactive": {"count": len(inactive_results), "results": inactive_results},
            "proposals": {"count": len(proposal_results), "results": proposal_results},
            "active": {"count": len(active_results), "results": active_results},
            "finished": {"count": len(finished_results), "results": finished_results},
            "completed": {"count": len(completed_results), "results": completed_results},
        }
    )



@app.route("/experiments/proposals", methods=["GET"])
def list_proposals():
    repository = _get_components()["repository"]
    proposals = repository.load_proposals(settings.shop_id)
    listing_map = _load_listing_map(repository)
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
                "run_duration_days": record.get("run_duration_days"),
                "model_used": record.get("model_used"),
                "preview": _listing_preview(
                    repository, numeric_listing_id, listing_map.get(numeric_listing_id)
                ),
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
    settings_payload = repository.get_experiment_settings(settings.shop_id)
    run_duration_days = int(
        payload.get("run_duration_days")
        or payload.get("experiment_duration_days")
        or settings_payload.get("run_duration_days")
        or 0
    )
    model_used = (
        payload.get("generation_model")
        or payload.get("model_used")
        or settings_payload.get("generation_model")
    )

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
                run_duration_days=run_duration_days or None,
                model_used=model_used,
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


@app.route("/experiments/proposals/<int:listing_id>/regenerate", methods=["POST"])
def regenerate_proposal(listing_id: int):
    components = _get_components()
    repository: ShopDataRepository = components["repository"]
    generate_service: GenerateExperimentService = components["generate_service"]
    payload = request.get_json(silent=True) or {}
    include_prior = payload.get(
        "include_prior_experiments", settings.include_prior_experiments
    )
    max_prior = int(payload.get("max_prior_experiments") or 5)
    settings_payload = repository.get_experiment_settings(settings.shop_id)
    run_duration_days = int(
        payload.get("run_duration_days")
        or payload.get("experiment_duration_days")
        or settings_payload.get("run_duration_days")
        or 0
    )
    model_used = (
        payload.get("generation_model")
        or payload.get("model_used")
        or settings_payload.get("generation_model")
    )

    testing_record = repository.get_testing_experiment(settings.shop_id, listing_id)
    if testing_record:
        return jsonify(
            {"error": f"Listing {listing_id} already has an experiment in testing."}
        ), 400
    untested = repository.load_untested_experiments(settings.shop_id).get(str(listing_id))
    if untested:
        return jsonify(
            {
                "error": "Listing has untested experiments; promote them before generating new proposals."
            }
        ), 400

    try:
        repository.delete_proposal(settings.shop_id, listing_id)
    except Exception:
        pass

    try:
        proposal = generate_service.propose_experiments(
            listing_id,
            include_prior_experiments=include_prior,
            max_prior_experiments=max_prior,
            run_duration_days=run_duration_days or None,
            model_used=model_used,
        )
        repository.save_proposal(settings.shop_id, listing_id, proposal)
        return jsonify(
            {
                "listing_id": listing_id,
                "generated_at": proposal.get("generated_at"),
                "option_count": len(proposal.get("options") or []),
                "options": proposal.get("options"),
            }
        )
    except Exception as exc:
        LOGGER.exception("Failed to regenerate proposal for listing %s", listing_id)
        return jsonify({"error": str(exc)}), 400

@app.route("/experiments/settings", methods=["GET", "POST"])
def experiment_settings():
    repository = _get_components()["repository"]
    if request.method == "GET":
        return jsonify(repository.get_experiment_settings(settings.shop_id))

    payload = request.get_json(silent=True) or {}
    current = repository.get_experiment_settings(settings.shop_id)
    if "run_duration_days" in payload:
        try:
            current["run_duration_days"] = int(payload.get("run_duration_days"))
        except Exception:
            return jsonify({"error": "run_duration_days must be an integer."}), 400
    if "generation_model" in payload:
        current["generation_model"] = payload.get("generation_model")
    if "tolerance" in payload:
        try:
            current["tolerance"] = float(payload.get("tolerance") or 0)
        except Exception:
            return jsonify({"error": "tolerance must be numeric."}), 400

    saved = repository.save_experiment_settings(settings.shop_id, current)
    return jsonify(saved)

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
        return jsonify(
            {
                "listing_id": listing_id,
                "experiment_id": selected_record["experiment_id"],
                "state": accepted_record.get("state"),
                "planned_end_date": accepted_record.get("planned_end_date"),
            }
        )
    except Exception as exc:
        # Selected experiment remains in untested backlog for manual retry.
        return jsonify({"error": str(exc)}), 400



@app.route("/experiments/testing", methods=["GET"])
def list_testing_experiments():
    components = _get_components()
    repository: ShopDataRepository = components["repository"]
    listing_map = _load_listing_map(repository)
    manifest = repository.load_testing_experiments(settings.shop_id)
    results = [
        {
            "listing_id": int(listing_id),
            "experiment": {
                **record,
                "planned_end_date": _planned_end_date_from_record(record),
                "preview": _listing_preview(
                    repository, int(listing_id), listing_map.get(int(listing_id))
                ),
            },
        }
        for listing_id, record in manifest.items()
    ]
    return jsonify({"results": results, "count": len(results)})


@app.route("/experiments/finished", methods=["GET"])
def list_finished_experiments():
    components = _get_components()
    repository: ShopDataRepository = components["repository"]
    evaluate_service: EvaluateExperimentService = components["evaluate_service"]
    listing_map = _load_listing_map(repository)
    search_term = (request.args.get("search") or "").lower()
    testing = repository.load_testing_experiments(settings.shop_id)
    results: List[Dict[str, Any]] = []
    for listing_id_str, record in testing.items():
        listing_id = int(listing_id_str)
        title = (listing_map.get(listing_id) or {}).get("title", "").lower()
        if search_term and search_term not in title:
            continue
        record["planned_end_date"] = _planned_end_date_from_record(record)
        if record.get("state") != ExperimentState.FINISHED.value and not _is_finished_record(record):
            continue
        record["state"] = ExperimentState.FINISHED.value
        repository.save_testing_experiment(settings.shop_id, listing_id, record)
        try:
            evaluate_service.evaluate_experiment(listing_id, str(record.get("experiment_id")))
        except Exception:
            pass
        results.append(
            {
                "listing_id": listing_id,
                "experiment_id": record.get("experiment_id"),
                "state": record.get("state"),
                "start_date": record.get("start_date"),
                "planned_end_date": record.get("planned_end_date"),
                "performance": record.get("performance"),
                "preview": _listing_preview(
                    repository, listing_id, listing_map.get(listing_id)
                ),
            }
        )
    results = sorted(results, key=lambda item: item.get("planned_end_date") or "", reverse=False)
    return jsonify({"results": results, "count": len(results)})


@app.route("/experiments/untested", methods=["GET"])
def list_untested_experiments():
    components = _get_components()
    repository: ShopDataRepository = components["repository"]
    listing_map = _load_listing_map(repository)
    manifest = repository.load_untested_experiments(settings.shop_id)
    results = [
        {
            "listing_id": int(listing_id),
            "experiments": records,
            "preview": _listing_preview(
                repository, int(listing_id), listing_map.get(int(listing_id))
            ),
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


@app.route("/experiments/<int:listing_id>/<experiment_id>/extend", methods=["POST"])
def extend_experiment(listing_id: int, experiment_id: str):
    resolve_service: ResolveExperimentService = _get_components()["resolve_service"]
    payload = request.get_json(silent=True) or {}
    additional_days = int(payload.get("additional_days") or payload.get("extend_days") or 0)
    if additional_days <= 0:
        return jsonify({"error": "additional_days must be greater than 0."}), 400
    try:
        record = resolve_service.extend_experiment(listing_id, experiment_id, additional_days)
        return jsonify(
            {
                "listing_id": listing_id,
                "experiment_id": experiment_id,
                "planned_end_date": record.get("planned_end_date"),
                "run_duration_days": record.get("run_duration_days"),
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


@app.route("/experiments/<int:listing_id>/<experiment_id>/summary", methods=["GET"])
def experiment_summary(listing_id: int, experiment_id: str):
    components = _get_components()
    repository: ShopDataRepository = components["repository"]
    evaluate_service: EvaluateExperimentService = components["evaluate_service"]
    record = repository.get_testing_experiment(settings.shop_id, listing_id)
    source = "testing"
    if not record:
        record = repository.get_untested_experiment(settings.shop_id, listing_id, experiment_id)
        source = "untested"
    if not record:
        tested_manifest = repository.load_tested_experiments(settings.shop_id)
        for entry in tested_manifest.get(str(listing_id), []):
            if str(entry.get("experiment_id")) == str(experiment_id):
                record = entry
                source = "tested"
                break
    if not record:
        return jsonify({"error": "Experiment not found."}), 404

    evaluation = None
    try:
        evaluation = evaluate_service.evaluate_experiment(listing_id, experiment_id)
    except Exception:
        evaluation = None

    if source == "testing":
        record["planned_end_date"] = _planned_end_date_from_record(record)
    return jsonify(
        {
            "listing_id": listing_id,
            "experiment_id": experiment_id,
            "record": record,
            "evaluation": evaluation,
            "preview": _listing_preview(
                repository, listing_id, repository.get_listing_snapshot(settings.shop_id, listing_id)
            ),
        }
    )


@app.route("/reports", methods=["GET"])
def list_reports():
    repository = _get_components()["repository"]
    reports = repository.load_reports(settings.shop_id)
    return jsonify({"results": reports, "count": len(reports)})


@app.route("/reports/<report_id>", methods=["GET"])
def get_report(report_id: str):
    repository = _get_components()["repository"]
    report = repository.get_report(settings.shop_id, report_id)
    if not report:
        return jsonify({"error": "Report not found."}), 404
    return jsonify(report)


@app.route("/reports", methods=["POST"])
def generate_experiment_report():
    components = _get_components()
    report_service: ReportService = components["report_service"]
    payload = request.get_json(silent=True) or {}
    days_back = int(payload.get("days_back") or 30)
    try:
        report = report_service.generate_report(days_back=days_back)
        return jsonify(report)
    except Exception as exc:
        LOGGER.exception("Failed to generate experiment report.")
        return jsonify({"error": str(exc)}), 400


@app.route("/reports/<report_id>/activate_insights", methods=["POST"])
def activate_insights(report_id: str):
    components = _get_components()
    report_service: ReportService = components["report_service"]
    payload = request.get_json(silent=True) or {}
    insight_ids = payload.get("insight_ids") or []
    if not insight_ids:
        return jsonify({"error": "insight_ids is required."}), 400
    try:
        updated = report_service.activate_insights(report_id, insight_ids)
        return jsonify({"active_insights": updated})
    except Exception as exc:
        return jsonify({"error": str(exc)}), 400


@app.route("/insights/active", methods=["GET"])
def list_active_insights():
    repository = _get_components()["repository"]
    insights = repository.load_active_insights(settings.shop_id)
    return jsonify({"results": insights, "count": len(insights)})


@app.route("/insights/active/<insight_id>", methods=["DELETE"])
def delete_active_insight(insight_id: str):
    repository = _get_components()["repository"]
    insights = repository.load_active_insights(settings.shop_id)
    if not any(ins.get("insight_id") == insight_id for ins in insights):
        return jsonify({"error": "Insight not found."}), 404
    updated = repository.remove_active_insight(settings.shop_id, insight_id)
    return jsonify({"deleted": True, "remaining": updated})


@app.route("/insights/active/deactivate", methods=["POST"])
def deactivate_active_insights():
    repository = _get_components()["repository"]
    payload = request.get_json(silent=True) or {}
    insight_ids = payload.get("insight_ids")
    if isinstance(insight_ids, str):
        insight_ids = [insight_ids]
    if not insight_ids or not isinstance(insight_ids, list):
        return jsonify({"error": "insight_ids array is required."}), 400
    normalized_ids: List[str] = []
    for raw_id in insight_ids:
        if raw_id is None:
            continue
        text_id = str(raw_id).strip()
        if text_id:
            normalized_ids.append(text_id)
    if not normalized_ids:
        return jsonify({"error": "insight_ids array is required."}), 400
    insights = repository.load_active_insights(settings.shop_id)
    existing_ids = {
        str(insight.get("insight_id"))
        for insight in insights
        if insight.get("insight_id")
    }
    found_ids = [ins_id for ins_id in normalized_ids if ins_id in existing_ids]
    missing_ids = [ins_id for ins_id in normalized_ids if ins_id not in existing_ids]
    if not found_ids:
        return jsonify({"error": "No matching insights found."}), 404
    updated = repository.remove_active_insights(settings.shop_id, found_ids)
    return jsonify(
        {
            "removed": found_ids,
            "missing": missing_ids,
            "remaining": updated,
        }
    )


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
        "planned_end_date": _planned_end_date_from_record(record),
        "run_duration_days": record.get("run_duration_days"),
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
