"""Lightweight OpenAI API client."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Dict, List

import requests

from config import settings


@dataclass
class OpenAIClient:
    """Wrapper around the OpenAI responses API."""

    api_key: str = settings.openai.api_key
    model: str = settings.openai.model
    reasoning_level: str = settings.openai.reasoning_level
    api_base: str = "https://api.openai.com/v1"
    timeout: int = 180

    def generate_json_response(
        self,
        system_prompt: str,
        user_content: List[Dict[str, Any]],
        *,
        model: str | None = None,
        reasoning_level: str | None = None,
    ) -> Dict[str, Any]:
        """Sends a request to the responses endpoint enforcing JSON output."""
        if not self.api_key:
            raise ValueError("OPENAI_API_KEY is not configured.")

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        effective_model = model or self.model
        effective_reasoning = reasoning_level or self.reasoning_level

        body: Dict[str, Any] = {
            "model": effective_model,
            "input": [
                {
                    "role": "system",
                    "content": [{"type": "input_text", "text": system_prompt}],
                },
                {"role": "user", "content": user_content},
            ],
        }
        if effective_reasoning and effective_reasoning.lower() != "none":
            body["reasoning"] = {"effort": effective_reasoning}
        body["text"] = {"format": {"type": "text"}}

        response = requests.post(
            f"{self.api_base}/responses",
            headers=headers,
            data=json.dumps(body),
            timeout=self.timeout,
        )
        try:
            response.raise_for_status()
        except requests.HTTPError as exc:
            raise RuntimeError(f"OpenAI API error: {exc} - {response.text}") from exc

        payload = response.json()
        return self._extract_json_result(payload)

    def _extract_json_result(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Pulls the JSON object out of the responses payload."""
        outputs: List[Dict[str, Any]] = payload.get("output", [])
        for output in outputs:
            if output.get("type") == "message":
                message = output.get("content", [])
                for block in message:
                    if block.get("type") == "output_text":
                        text = block.get("text", "")
                        return json.loads(text)
        # Fallback for legacy field names
        if "output_text" in payload:
            try:
                return json.loads(payload["output_text"][0])
            except (ValueError, KeyError, IndexError):
                pass
        raise ValueError("Unable to parse JSON output from OpenAI payload.")
