# Phase 2 method profile

Method profile: `balanced-cluster-v1`. Status: automated validation passed;
owner H2 interpretation is pending. This profile authorizes no Etsy writes.

## Target and design

The randomized unit is a frozen, owner-reviewed cluster of listings. The
initial method supports one candidate policy, unchanged control, balanced
complete cluster randomization, one additive primary outcome, and one fixed
final look. Listings, days, views, receipts, and transaction lines do not
become additional randomized units.

For cluster adjusted totals `A_c = Y_c - (H/B) X_c`, the estimator is:

`tau_hat = C/(N*H) * (mean(A_treatment) - mean(A_control))`.

It estimates the eligible-cohort outcome difference per scheduled listing-day.
It is not an equally weighted percentage lift, a visitor-level effect, a claim
about every listing, or an automatic extrapolation to the whole shop.

## Frozen contracts

- `ExperimentSpec` binds the roster, cluster partition, exact candidate hashes,
  unchanged control, windows, seed, assignment, effects, alpha, contamination
  rules, authority, maturity, and permitted conclusions.
- `EvidenceManifest` binds the complete mature source revisions to the exact
  specification and method profile.
- Canonical serialization and SHA-256 hashes make retries deterministic and
  reject altered specifications or evidence.
- `EvaluationResult` keeps the exact sharp-null result separate from the
  approximate average-effect interval.

All five contracts have versioned JSON schemas under `packages/contracts` and
runtime validation at the engine boundary.

## Inference

Balanced assignment spaces up to 200,000 are enumerated exactly. Larger spaces
use 99,999 deterministic Monte Carlo allocations and `(b+1)/(m+1)`, so a finite
simulation p-value cannot be zero. Ties count as equally or more extreme.

The exact p-value addresses the sharp null that assignment changes no cluster's
outcome. It is not an exact probability that average lift is positive. The
average-effect interval uses a predeclared Welch approximation and is reported
as a separate object.

The interval is unavailable when:

- fewer than eight clusters are present;
- a pre-treatment cluster has fewer than five primary-outcome units;
- arm variance/degrees of freedom are degenerate; or
- another method-profile requirement fails.

The five-unit baseline floor is an evidence-driven restriction: an initially
included sparse/unequal scenario produced 9.01% interval undercoverage, above
the 5.65% release diagnostic ceiling. The exact sharp-null result remains
available for that scenario; an average-benefit or automatic benefit conclusion
does not.

## Eligibility and labels

The initial profile also requires even `C >= 8`, attainable two-sided
resolution at the allocated alpha, complete compatible coverage, plausible
limited interference, feasible deployment, and no cluster above 20% of pooled
baseline primary outcome. A zero baseline requires an absolute threshold and a
separate profile review.

Allowed analytical labels are `evidence_of_change`, `inconclusive`,
`invalid_data`, `protocol_deviation`, and `safety_stopped`. Directional studies
emit observed differences only, state that cause is not established, and leave
the decision to a human. No p-value is translated into a winner probability.

## Validation evidence

- TypeScript and an independent standard-library Python reference agree within
  `1e-9` relative tolerance on unequal clusters, baseline exposure conversion,
  ties, and heterogeneous effects.
- Exact sharp-null size was exhaustively checked for 6, 8, 10, and 12 clusters.
- Two 10,000-repetition null scenarios stay below the predeclared diagnostic
  ceiling; the sparse scenario correctly withholds the interval.
- A 10,000-repetition heterogeneous/unequal interval scenario stayed within its
  coverage diagnostic.
- A 2,000-repetition strong-effect planning scenario had a one-sided 95% Wilson
  lower success bound above 0.99. This demonstrates the code path, not expected
  power for the A Designs shop.
- A 24-cluster, 99,999-draw production Monte Carlo evaluation runs as bounded
  offline work under the 10-second release budget on the validation machine.

Multi-arm, sequential, adaptive, post-launch matching, repeated inferential
looks, and automatic decisions are outside this method version.
