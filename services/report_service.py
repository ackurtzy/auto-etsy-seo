"""Service to generate experiment reports and manage insights."""

from __future__ import annotations

import json
from datetime import datetime, timedelta, date
from typing import Any, Dict, List, Optional
from uuid import uuid4

from clients.openai_client import OpenAIClient
from repository.shop_data_repository import ShopDataRepository
from services.evaluate_experiment_service import EvaluateExperimentService


class ReportService:
    """Generates LLM-backed experiment reports and manages insights."""

    def __init__(
        self,
        shop_id: int,
        repository: ShopDataRepository,
        evaluate_service: EvaluateExperimentService,
        openai_client: Optional[OpenAIClient] = None,
        system_prompt_path: str = "prompts/report_system.txt",
    ) -> None:
        self.shop_id = shop_id
        self.repository = repository
        self.evaluate_service = evaluate_service
        self.openai_client = openai_client or OpenAIClient()
        from utils import file_lib  # local import to avoid circulars at module import

        self.system_prompt = file_lib.read_txt_file(system_prompt_path).strip()

    def generate_report(self, days_back: int = 30) -> Dict[str, Any]:
        """Builds a report for experiments ending within the window."""
        window_end = date.today()
        window_start = window_end - timedelta(days=days_back)

        tested = self.repository.load_tested_experiments(self.shop_id)
        experiments_payload: List[Dict[str, Any]] = []

        for listing_id, records in tested.items():
            for record in records:
                end_date = record.get("end_date")
                if not end_date:
                    continue
                try:
                    end_dt = date.fromisoformat(end_date)
                except ValueError:
                    continue
                if not (window_start <= end_dt <= window_end):
                    continue

                experiment_id = record.get("experiment_id")
                if not experiment_id:
                    continue

                evaluation: Optional[Dict[str, Any]] = None
                try:
                    evaluation = self.evaluate_service.evaluate_experiment(
                        int(listing_id),
                        str(experiment_id),
                        comparison_date=end_date,
                    )
                except Exception:
                    evaluation = None

                experiments_payload.append(
                    self._summarize_experiment(record, evaluation, end_date)
                )

        if not experiments_payload:
            raise ValueError("No experiments ended in the requested window.")

        response = self.openai_client.generate_json_response(
            system_prompt=self.system_prompt,
            user_content=[
                {
                    "type": "input_text",
                    "text": json.dumps(
                        {
                            "schema_example": REPORT_SCHEMA_EXAMPLE,
                            **{
                                "window": {
                                    "start": window_start.isoformat(),
                                    "end": window_end.isoformat(),
                                    "days_back": days_back,
                                },
                                "experiments": experiments_payload,
                            },
                        },
                        indent=2,
                    ),
                },
            ],
        )

        raw_insights = response.get("insights") or []
        insights_with_ids: List[Dict[str, Any]] = []
        for insight in raw_insights:
            if isinstance(insight, dict):
                text = insight.get("summary") or insight.get("text")
                reasoning = insight.get("reasoning")
            else:
                text = str(insight)
                reasoning = None
            insights_with_ids.append(
                {
                    "insight_id": uuid4().hex,
                    "text": text,
                    "reasoning": reasoning,
                }
            )

        report_record = {
            "report_id": uuid4().hex,
            "generated_at": datetime.utcnow().isoformat(),
            "window": {
                "start": window_start.isoformat(),
                "end": window_end.isoformat(),
                "days_back": days_back,
            },
            "experiments": experiments_payload,
            "llm_report": response.get("report"),
            "insights": insights_with_ids,
            "raw_llm_response": response,
        }
        self.repository.append_report(self.shop_id, report_record)
        return report_record

    def activate_insights(
        self, report_id: str, insight_ids: List[str]
    ) -> List[Dict[str, Any]]:
        report = self.repository.get_report(self.shop_id, report_id)
        if not report:
            raise ValueError(f"Report {report_id} not found.")
        insights = report.get("insights") or []
        selected = [
            {
                "insight_id": ins.get("insight_id"),
                "text": ins.get("text"),
                "report_id": report_id,
            }
            for ins in insights
            if ins.get("insight_id") in insight_ids
        ]
        if not selected:
            raise ValueError("No matching insights found in report.")
        return self.repository.add_active_insights(self.shop_id, selected)

    def _summarize_experiment(
        self,
        record: Dict[str, Any],
        evaluation: Optional[Dict[str, Any]],
        end_date: str,
    ) -> Dict[str, Any]:
        """Normalize an experiment record for the report prompt."""
        original = record.get("original_listing") or {}
        performance = record.get("performance") or {}
        return {
            "listing_id": record.get("listing_id") or original.get("listing_id"),
            "experiment_id": record.get("experiment_id"),
            "state": record.get("state"),
            "end_date": end_date,
            "before": {
                "title": original.get("title"),
                "tags": original.get("tags"),
                "description": original.get("description"),
            },
            "changes": record.get("changes") or [],
            "evaluation": evaluation,
            "notes": record.get("notes"),
            "insightful_details": {
                "baseline": performance.get("baseline"),
                "latest": performance.get("latest"),
            },
        }


REPORT_SCHEMA_EXAMPLE = {
    "report": {
        "report_markdown": "### Summary\n- Quick bullet on wins\n- Quick bullet on losses\n- Meta strategies here",
    },
    "insights": [
        {
            "insight_id": "example-insight-1",
            "summary": "Concise phrasing of what strategy worked or failed.",
            "reasoning": "Why this likely occurred (data-driven, avoid fluff).",
        }
    ],
}
