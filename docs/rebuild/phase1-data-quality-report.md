# Phase 1 data-quality report

Observation: 2026-09-21 UTC. Status: partial; G1 remains open.

| Dimension | Evidence | Analytical risk / disposition |
| --- | --- | --- |
| Completeness | Active listing pagination reconciled a stable reported count of 46. Ten signed samples resolved to nine active and one inactive. Receipt pagination did not begin because the OAuth grant was rejected. | Listing catalog coverage passed this observation. Receipt outcomes are unavailable, not zero. |
| Uniqueness | Listing IDs are unique after duplicate-page collapse. Synthetic receipt tests deduplicate transaction IDs and never repeat a whole receipt total per listing. | Live transaction uniqueness is unverified until receipt access is restored. |
| Validity | Listing state/title/tag/view shapes passed the whitelist. Money requires amount, positive divisor, currency, and integer quantity. | Views have no validated temporal meaning. Refund-adjusted money is disabled without line allocation. |
| Consistency | Duplicate/reordered pages are invariant. Same-version conflicts quarantine; late older revisions cannot move the canonical pointer backwards. | Cross-source comparison with Shop Manager is still required in H1. |
| Timeliness | One current listing observation exists. The report records observation time and the receipt query lower bound. | A single view observation cannot establish daily cadence, latency, reset behavior, or maturity. Seven day boundaries are required. |
| Shape/privacy | Persistence uses field whitelists. A post-run scan found none of the prohibited buyer/address field names in the private report. | Raw provider JSON exists transiently in memory; detailed sanitized evidence is local, ignored, and capped at seven days. |

No primary outcome metric is enabled. The current evidence is sufficient to
continue the listing-side diagnostic, but not to start experimentation or claim
sales/revenue reconciliation.
