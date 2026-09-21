from __future__ import annotations

import unittest

from validation.phase4.validate_phase4 import validate_product_workspace, validate_runtime_boundaries, validate_schema


class Phase4ValidatorTests(unittest.TestCase):
    def test_schema_and_runtime_default_deny(self) -> None:
        validate_schema()
        validate_runtime_boundaries()

    def test_human_workspace_contains_all_gate_actions(self) -> None:
        validate_product_workspace()


if __name__ == "__main__":
    unittest.main()

