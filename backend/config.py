"""Project configuration settings."""

from __future__ import annotations

import os
from dataclasses import dataclass, field


@dataclass
class OpenAISettings:
    """Holds OpenAI client configuration."""

    api_key: str = os.getenv("OPENAI_API_KEY", "")
    model: str = os.getenv("OPENAI_MODEL", "gpt-5.1-2025-11-13")
    reasoning_level: str = os.getenv("OPENAI_REASONING_LEVEL", "None")


BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_DATA_DIR = os.path.join(BASE_DIR, "data")
DEFAULT_KEYS_PATH = os.path.join(BASE_DIR, "keys.json")


@dataclass
class Settings:
    """Application-level settings."""

    shop_id: int = int(os.getenv("SHOP_ID", "23574688"))
    data_dir: str = os.getenv("DATA_DIR", DEFAULT_DATA_DIR)
    keys_path: str = os.getenv("KEYS_PATH", DEFAULT_KEYS_PATH)
    include_prior_experiments: bool = os.getenv(
        "INCLUDE_PRIOR_EXPERIMENTS", "false"
    ).lower() in {"1", "true", "yes"}
    openai: OpenAISettings = field(default_factory=OpenAISettings)


settings = Settings()
