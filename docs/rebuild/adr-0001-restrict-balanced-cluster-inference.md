# ADR 0001: Restrict initial inference to one balanced cluster method

Status: Accepted for automated Phase 2 validation; product activation awaits H2.

## Context

The replacement plan requires a reproducible method before any grouped
experiment orchestration. The current shop evidence is concentrated and does
not establish independent clusters. Adding algorithms to make the present shop
appear eligible would weaken the evidence boundary.

## Decision

Implement only `balanced-cluster-v1`: one frozen candidate policy, unchanged
control, even complete balanced cluster randomization, one additive primary
outcome, and one final look. Use exact enumeration through 200,000 assignments
and deterministic 99,999-draw Monte Carlo above that. Keep exact sharp-null
evidence and approximate average-effect uncertainty separate.

Withhold the approximate interval when any cluster has fewer than five
pre-treatment primary-outcome units. This is a profile restriction discovered
by preregistered sparse-scenario validation, not a post-result adjustment.
Randomized functionality stays disabled for the current shop unless a future
prospective design passes the same profile and G5.

## Alternatives considered

- Treat listing-days or receipts as independent units: rejected because they
  are observations, not randomized units.
- Add matching, adaptive allocation, sequential looks, or multiple arms now:
  rejected because each changes assignment/inference and requires its own
  validation.
- Report the sparse Welch interval with a warning: rejected because measured
  undercoverage exceeded the release diagnostic.
- Abandon all statistical code and build only before/after reports: retained as
  the current product route, but the validated method remains useful for future
  genuinely eligible cohorts.

## Consequences

The method is narrow, deterministic, offline-testable, and honest about weak
shops. Some otherwise interesting cohorts will receive only directional
reporting. Future inference methods require a new version, independent
reference, simulation profile, and gate evidence rather than an in-place
extension.

## Validation and revisit conditions

Revisit only with a concrete eligible design need and predeclared validation
domain. Any change to estimator, assignment, interval support, alpha handling,
or stopping rules invalidates dependent G2/G5 evidence until revalidated.
