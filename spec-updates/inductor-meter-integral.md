# Analytic inductor meter integrals

The existing direct topology remains exactly one ideal SPICE-SINE current
source, one ideal inductor, and ground across two nets. No loads, scopes,
devices, extra parts, other waveforms or solver equations are admitted here.
Endpoint current/voltage and unwatched zero-MNA work remain unchanged.

For active meters, each accepted advance now retains a frozen sine descriptor
alongside its history endpoint. Current area integrates the delayed,
phase-shifted, exponentially damped sine; voltage area integrates `L*dI/dt`.
Both are evaluated over the actual clipped interval, not endpoint trapezoids
or the complete interval when only its last 100 ms is requested. Stable
`expm1` and half-angle differences avoid cancellation on short intervals.
Existing signs (current OUT of a terminal), ground placement, first-read
instant, 2 s expiry, reset, power-off and 100,000-point limit are preserved.
Missing publication refuses instead of manufacturing a held endpoint mean.

## Constant-function history compaction

Caller endpoints of an unchanged exact function are redundant. Consecutive
analytic intervals now coalesce only when factor, integral kind and all six
sine parameters match, and the removed point has unchanged left/right values.
The start/support point is retained for first-read and partial 100 ms windows;
physical/static power edges and nonanalytic predecessors remain separate.
Adaptive numerical observations are not compacted by this rule. Retiring
redundant points precedes the unchanged capacity check; unmergeable histories
still refuse at the hard 100,000-point limit, and existing failures stay sticky.

Measured baseline for one current watch: 700 caller ticks retain 701 points,
with 493,500 actual numeric history reads. The identical compacted workload
retains two points and performs 4,200 indexed reads; current means agree to
floating-point roundoff (-0.0000909456817667973 versus
-0.00009094568176679739 A). The new regression asserts two
points per unchanged watch and at most eight indexed reads per watch/tick,
using identity-forwarding Proxy instrumentation only during the actual meter
read. Numerical means remain independently checked, including a dense 135 ms
watch, delayed/damped/phase-shifted sources and clipped windows. This is a
bounded history/access-work result, not a wall-time or arbitrary-circuit
simulator speedup claim. A real power-on at zero current proves the factor
comparison protects a different past function even without a visible jump.
Defensive descriptor fixtures separately protect every parameter/integral
kind and the static-left/right and nonanalytic boundaries; they do not claim
public parameter-jump support.

Source or inductor parameter edits during an active analytic watch refuse
with `source-constrained-inductor-parameter-edit-unqualified` until the watch
is recreated. An ideal-inductor parameter/current jump may imply an impulse;
this patch does not pretend to qualify that physical discontinuity. Frozen
past interval descriptors never acquire later parameter values.

Verification uses independently implemented Simpson integration and current
endpoint differences, both source polarities and both ground placements,
three caller schedules, delay/phase/damping, clipped partial windows, tiny
intervals, capacity, power-off, expiry, reset and missing-publication refusal.
A separate live ngspice ideal-current-source/inductor deck compares 6,001
points from 1 ms through 7 ms: 2 nV voltage and 1 nA current tolerances are
specific to that fixture, not a universal meter accuracy certificate.

The earlier integral implementation is adopted in CUI at `4abb34f` on exact
Board `928ecf7b`, with actual CLI batch/watch and live ngspice tests. This
compaction is a later upstream-only change; no downstream package or deployment
adoption is implied until a separate exact-pin lane qualifies it.
General nonlinear/high-frequency integration certificates, RMS/bandwidth,
and physically qualified ideal-inductor parameter impulses remain separate.
