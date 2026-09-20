"""Hard stop for the retired v1 runtime.

The legacy Flask application can issue live Etsy and OpenAI requests without the
authority, intent, or reconciliation contracts required by the replacement
plan.  It is preserved in Git history and by the legacy-v1-2026-09-20 tag, but
is deliberately not executable from the rebuild branch.
"""

from __future__ import annotations


class LegacyRuntimeDisabled(RuntimeError):
    """Raised whenever retired code is invoked from the rebuild branch."""


def assert_legacy_runtime_disabled(component: str) -> None:
    """Fail closed before credentials are read or a network client is built."""

    raise LegacyRuntimeDisabled(
        f"{component} belongs to the retired v1 runtime and is disabled. "
        "Use the credential-free rebuild validation harness instead."
    )
