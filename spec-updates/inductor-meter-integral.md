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

This upstream change does not adopt a downstream package or claim deployment.
The CUI consumer test and CLI documentation still describe the refusal at
their pinned earlier engine. Their update belongs in a later exact-pin lane.
General nonlinear/high-frequency integration certificates, RMS/bandwidth,
and physically qualified ideal-inductor parameter impulses remain separate.
