from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from validation.phase3.validate_phase3 import EXPECTED_ARTIFACTS, validate_artifacts, validate_dispatch_boundary, validate_schema


ROOT = Path(__file__).resolve().parents[2]


class Phase3ValidatorTests(unittest.TestCase):
    def test_schema_migrations_apply_with_safety_defaults(self) -> None:
        validate_schema()
        validate_dispatch_boundary()

    def test_artifact_manifest_rejects_tamper_and_traversal(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            artifacts = []
            for relative in EXPECTED_ARTIFACTS:
                path = root / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(relative, encoding="utf-8")
                artifacts.append({"artifact": relative, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()})
            payload = {"artifacts": artifacts}
            validate_artifacts(payload, root)
            tampered = copy.deepcopy(payload)
            (root / tampered["artifacts"][0]["artifact"]).write_text("tampered", encoding="utf-8")
            with self.assertRaises(AssertionError):
                validate_artifacts(tampered, root)
            traversal = copy.deepcopy(payload)
            traversal["artifacts"][0]["artifact"] = "../outside"
            with self.assertRaises(AssertionError):
                validate_artifacts(traversal, root)


if __name__ == "__main__":
    unittest.main()
