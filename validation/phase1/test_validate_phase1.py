from __future__ import annotations

import unittest

from validation.phase1.validate_phase1 import assert_no_private_values


class TrackedEvidencePrivacyTests(unittest.TestCase):
    def test_redacted_aggregate_evidence_is_accepted(self) -> None:
        assert_no_private_values({"receipt_count": 12, "buyer_data_persisted": False, "sha256": "0" * 64})

    def test_private_fields_and_email_values_are_rejected(self) -> None:
        for payload in (
            {"access_token": "secret"},
            {"nested": [{"buyer_email": "redacted"}]},
            {"note": "buyer@example.com"},
        ):
            with self.subTest(payload=payload), self.assertRaises(AssertionError):
                assert_no_private_values(payload)


if __name__ == "__main__":
    unittest.main()
