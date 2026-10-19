# Indeterminate ideal-source current

A zero-volt ideal source whose terminals share the same solver-local net
does not constrain its individual branch current. The solver omits that row
without changing the valid voltage solution and reports its part ID in
`indeterminateBranchCurrents`, a set included in static, transient and
all-ground solve results. Powered-off and finite-positive-resistance sources
are not marked: their known zero or solvable current remains observable.

`branchCurrent` and `meterCurrent` refuse the marked source's `pos`/`neg`
current with a named error instead of inventing zero amperes. Other missing
part/terminal fallbacks are unchanged; this is not a universal current
availability classifier. Strict operating-point results and adopted initial
state caches preserve the same metadata for actual independent sources.

A refused first meter read does not register an empty watch. If a valid watch
later encounters indeterminate current, the interval becomes unqualified and
future mean reads refuse even if resistance is restored. Recording that
failure does not interrupt valid voltage/load observations or parameter edits;
unrelated exceptions still propagate. Resetting the netlist starts new watches.

No generic ideal-loop, current-limited ideal short, bandwidth, tolerance,
source convention, integration or downstream package-adoption claim is made.
