"""Service that evaluates experiment performance trends."""

from __future__ import annotations

import math
from typing import Any, Dict, Optional, Tuple

from repository.shop_data_repository import ShopDataRepository


class EvaluateExperimentService:
    """Calculates experiment performance deltas with seasonality adjustments."""

    def __init__(self, shop_id: int, repository: ShopDataRepository) -> None:
        self.shop_id = shop_id
        self.repository = repository

    def evaluate_experiment(
        self,
        listing_id: int,
        experiment_id: str,
        comparison_date: Optional[str] = None,
        tolerance: float = 0.0,
    ) -> Dict[str, Any]:
        record, source = self._find_experiment_record(listing_id, experiment_id)

        performance_meta = record.setdefault("performance", {})
        baseline = performance_meta.get("baseline")
        if not baseline:
            raise ValueError("Experiment lacks baseline performance data.")

        history = self.repository.load_performance_history(self.shop_id)
        if not history:
            raise ValueError("No performance history found.")

        if comparison_date:
            comparison_snapshot = history.get(comparison_date)
            if not comparison_snapshot:
                raise ValueError(f"No performance data for {comparison_date}.")
            latest_date = comparison_date
        else:
            latest_date = max(history.keys())
            comparison_snapshot = history[latest_date]

        listing_key = str(listing_id)
        current_views_raw = comparison_snapshot.get(listing_key)
        if current_views_raw is None:
            raise ValueError(f"No views recorded for listing {listing_id}.")
        try:
            current_views = int(current_views_raw)
        except (TypeError, ValueError):
            current_views = 0

        baseline_views = int(baseline.get("views") or 0)
        delta = current_views - baseline_views
        pct_change = (delta / baseline_views) * 100 if baseline_views else None

        baseline_snapshot = history.get(baseline["date"], {})
        baseline_total = sum(self._int_or_zero(value) for value in baseline_snapshot.values())
        comparison_total = sum(self._int_or_zero(value) for value in comparison_snapshot.values())
        seasonality_factor = (comparison_total / baseline_total) if baseline_total else 1.0
        normalized_current = (
            current_views / seasonality_factor if seasonality_factor else current_views
        )
        normalized_delta = normalized_current - baseline_views

        std_dev = math.sqrt(max(baseline_views, 1))
        z_score = (normalized_current - baseline_views) / std_dev
        confidence = math.erf(abs(z_score) / math.sqrt(2))

        recommended_action = "keep" if normalized_delta >= tolerance else "revert"
        if abs(normalized_delta) <= tolerance:
            recommended_action = "inconclusive"

        performance_meta["latest"] = {
            "date": latest_date,
            "views": current_views,
            "delta": delta,
            "pct_change": pct_change,
            "seasonality_factor": seasonality_factor,
            "normalized_delta": normalized_delta,
            "confidence": confidence,
        }
        if source == "testing":
            self.repository.save_testing_experiment(self.shop_id, listing_id, record)
        else:
            manifest = self.repository.load_tested_experiments(self.shop_id)
            listing_records = manifest.get(str(listing_id), [])
            for idx, entry in enumerate(listing_records):
                if entry.get("experiment_id") == experiment_id:
                    listing_records[idx] = record
                    break
            self.repository.save_tested_experiments(self.shop_id, manifest)

        return {
            "listing_id": listing_id,
            "experiment_id": experiment_id,
            "baseline": baseline,
            "latest": performance_meta["latest"],
            "recommended_action": recommended_action,
        }

    def _find_experiment_record(
        self, listing_id: int, experiment_id: str
    ) -> Tuple[Dict[str, Any], str]:
        testing = self.repository.get_testing_experiment(self.shop_id, listing_id)
        if testing and str(testing.get("experiment_id")) == str(experiment_id):
            return testing, "testing"

        manifest = self.repository.load_tested_experiments(self.shop_id)
        listing_records = manifest.get(str(listing_id)) or []
        for record in listing_records:
            if str(record.get("experiment_id")) == str(experiment_id):
                return record, "tested"
        raise ValueError(
            f"Experiment {experiment_id} does not exist for listing {listing_id}."
        )

    @staticmethod
    def _int_or_zero(value: Optional[Any]) -> int:
        try:
            return int(value or 0)
        except (TypeError, ValueError):
            return 0
