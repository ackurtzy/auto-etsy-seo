from __future__ import annotations

import copy
import hashlib
from pathlib import Path
import tempfile
import unittest

from validation.phase2.validate_phase2 import EXPECTED_A2_ARTIFACTS, validate_artifact_manifest


class ArtifactManifestTests(unittest.TestCase):
    def fixture(self, root: Path) -> dict:
        artifacts = []
        for relative in sorted(EXPECTED_A2_ARTIFACTS):
            path = root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(f"fixture:{relative}\n", encoding="utf-8")
            artifacts.append({"artifact": relative, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()})
        return {"artifacts": artifacts}

    def test_exact_manifest_is_accepted(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            validate_artifact_manifest(self.fixture(root), root=root)

    def test_tampered_artifact_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest = self.fixture(root)
            (root / manifest["artifacts"][0]["artifact"]).write_text("tampered\n", encoding="utf-8")
            with self.assertRaisesRegex(AssertionError, "hash mismatch"):
                validate_artifact_manifest(manifest, root=root)

    def test_unexpected_traversal_duplicate_and_missing_entries_are_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            valid = self.fixture(root)
            cases = []
            unexpected = copy.deepcopy(valid)
            unexpected["artifacts"].append({"artifact": "validation/phase2/extra.json", "sha256": "0" * 64})
            cases.append(unexpected)
            traversal = copy.deepcopy(valid)
            traversal["artifacts"][0]["artifact"] = "../private.json"
            cases.append(traversal)
            duplicate = copy.deepcopy(valid)
            duplicate["artifacts"].append(copy.deepcopy(duplicate["artifacts"][0]))
            cases.append(duplicate)
            missing = copy.deepcopy(valid)
            missing["artifacts"].pop()
            cases.append(missing)
            for manifest in cases:
                with self.subTest(manifest=manifest), self.assertRaises(AssertionError):
                    validate_artifact_manifest(manifest, root=root)

    def test_symlink_artifact_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest = self.fixture(root)
            relative = manifest["artifacts"][0]["artifact"]
            path = root / relative
            target = root / "target.json"
            target.write_bytes(path.read_bytes())
            path.unlink()
            path.symlink_to(target)
            with self.assertRaisesRegex(AssertionError, "regular file"):
                validate_artifact_manifest(manifest, root=root)


if __name__ == "__main__":
    unittest.main()
