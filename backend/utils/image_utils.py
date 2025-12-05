"""Utility helpers for preparing listing images for prompts."""

from __future__ import annotations

import base64
import io
from pathlib import Path
from typing import Dict, List, Optional

from PIL import Image


def resize_image_to_width(image_path: str, width: int = 400) -> Optional[bytes]:
    """Resizes an image to the specified width while preserving aspect ratio."""
    path = Path(image_path)
    if not path.exists():
        return None

    with Image.open(path) as img:
        original_width, original_height = img.size
        if original_width == 0:
            return None
        ratio = width / float(original_width)
        height = int(original_height * ratio)
        resized = img.resize((width, height), Image.LANCZOS)

        buffer = io.BytesIO()
        resized.convert("RGB").save(buffer, format="JPEG", optimize=True, quality=85)
        return buffer.getvalue()


def build_image_data_blocks(image_paths: List[str], max_images: int = 3) -> List[Dict[str, str]]:
    """Returns vision-compatible content blocks for the first N images."""
    blocks: List[Dict[str, str]] = []
    for image_path in image_paths[:max_images]:
        resized_bytes = resize_image_to_width(image_path)
        if not resized_bytes:
            continue
        encoded = base64.b64encode(resized_bytes).decode("utf-8")
        blocks.append(
            {
                "type": "input_image",
                "image_url": f"data:image/jpeg;base64,{encoded}",
                "detail": "auto",
            }
        )
    return blocks
