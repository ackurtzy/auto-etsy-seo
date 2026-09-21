# Phase 2 shop eligibility and route report

Observation date: 2026-09-21 UTC. Recommendation: **directional-only for the
current product route; randomized functionality remains disabled**.

## Permitted pre-treatment evidence

The bounded Phase 1 observation contains 46 active listings and 112 receipts in
the configured 30-day window. It recorded 137 paid units across 16 listing IDs.
Under a diagnostic that temporarily treats each listing as its own cluster, the
largest listing contributed 50.36% of observed units and the five largest
contributed 89.78%. The method profile's initial concentration ceiling is 20%.

These aggregates do not establish valid clusters. Closely substitutable
listings may need to share a cluster, which could increase rather than reduce
concentration. Thirty listings had no attributed units in this receipt window,
but absence from this bounded receipt dataset is not proof of zero views,
independence, or future inactivity.

## Blocking eligibility facts

- Owner-reviewed independent cluster definitions do not exist.
- G1/H1 has not yet established the primary metric's owner comparison and full
  source semantics.
- The seven-day views diagnostic is incomplete, and views are not sales.
- The available 30-day window is not a frozen compatible baseline plus
  prospective measurement window.
- The listing-as-cluster concentration diagnostic exceeds the profile ceiling.
- No shop-specific planning scenario has a lower 95% power bound of at least
  0.80 under the complete decision rule.

The correct result is `not_randomized_eligible`, not “low confidence” and not a
request to add algorithms until something passes.

## Supported route for H2 review

The owner may accept an explicitly directional product route:

- one listing and one reviewed field at a time;
- prospective before/after windows once a G1 metric passes;
- observed totals/rates, completeness, freshness, and confounder annotations;
- no causal confidence, p-value, automatic winner, or shop-wide lift claim;
- human keep, conditional revert, or leave-current-state decision.

Accepting this route completes G2 only with randomized functionality explicitly
disabled. It does not complete G1, enable Etsy writes, or waive the G3 safe
executor and canary gates.

## H2 owner check

Before G2 passes, the owner must review the deterministic fixture and this
report, confirm that six clusters cannot attain a two-sided 0.05 result, confirm
that eight clusters are only resolution-feasible, distinguish sharp-null
evidence from the approximate interval, and deliberately accept either a
qualified randomized route or the directional-only route above.
