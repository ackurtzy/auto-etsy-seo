# Phase 1 data-quality report

Observation: 2026-09-21 UTC. Status: live source coverage complete for the
configured 30-day window; G1 remains open.

| Dimension | Evidence | Analytical risk / disposition |
| --- | --- | --- |
| Completeness | Active listing pagination reconciled a stable reported count of 46. Ten signed samples resolved to nine active and one inactive. The bounded 30-day receipt window completed with 112 receipts in one page. | Source coverage passed for this observation and configured window; it does not establish all-time coverage. |
| Uniqueness | Listing and receipt IDs are unique after duplicate-page collapse. Transaction IDs are deduplicated before allocation, and whole receipt totals are never copied to every listing. | H1 still needs to compare the aggregates with the owner-visible source. |
| Validity | Listing state/title/tag/view shapes passed the whitelist. Money requires amount, positive divisor, currency, and integer quantity. Item money was known for 108 of 112 receipts, all USD. | Four refunded receipts remain unknown because the source does not allocate refunds to transaction lines. Views have no validated temporal meaning. |
| Consistency | Duplicate/reordered pages are invariant. Same-version conflicts quarantine; late older revisions cannot move the canonical pointer backwards. | Cross-source comparison with Shop Manager is still required in H1. |
| Timeliness | One current listing observation exists. The report records observation time and the receipt query lower bound. | A single view observation cannot establish daily cadence, latency, reset behavior, or maturity. Seven day boundaries are required. |
| Shape/privacy | Persistence uses field whitelists. A post-run scan found none of the prohibited buyer/address field names in the private report. | Raw provider JSON exists transiently in memory; detailed sanitized evidence is local, ignored, and capped at seven days. |

No primary outcome metric is enabled. The current evidence is sufficient to
perform the H1 owner comparison and continue the views diagnostic, but not to
start experimentation or claim sales/revenue reconciliation.
