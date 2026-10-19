# Current of an aliased ideal supply rail

Several `vcc` symbols on one net describe the same ideal supply rail. The
solver retains one voltage-constraint row, avoiding a singular matrix. Its
current is **total rail delivery**, not a uniquely determined current of the
symbol arbitrarily chosen to own that row.

Raw solve results now expose `railCurrents`, keyed by solver net ID with amperes
positive out of the supply into the net. Every participant in a duplicated
rail is listed in `indeterminateBranchCurrents`, including the row owner.
The existing internal owner-current entry remains for numerical compatibility;
it must not be interpreted as an individual-symbol measurement when marked.
No equal-current split or physical parallel-supply sharing model is invented.

`BoardImpl.railCurrent(netId)` returns the finite total rail current independent
of alias count/order. Unknown rails, failed solves, conflicting supplies and
missing/nonfinite aggregates refuse. Known powered-off rails return zero.
This is the existing solver's aggregate, including retained numerical
regularization: an otherwise unloaded 5 V rail presently carries the 5 pA
from its 1 pS numerical node shunt. It is not physical supply noise or an
exact-zero-load-current certificate, and no shunt is changed or hidden here.
`branchCurrent`/`meterCurrent` refuse an aliased symbol's `vcc` current; single
symbols, unrelated legacy fallbacks and powered-off readings remain unchanged.
Existing watch-history failure and reset contracts apply to alias currents.
Current scope sampling likewise throws the named indeterminate-current error
before writing that channel's sample; its buffer stays unwritten, not zero.
Voltage acquisition continues independently. Remove the unavailable current
channel before sampling other current channels: this preserves the existing
fail-fast sampling contract, rather than introducing per-channel error states.

Operating-point `railCurrents` use the same positive-into-supply convention as
OP terminal currents; adopting OP state converts the sign for the live cache.
Current-availability metadata survives that adoption. The OP remains
observational and does not change the live solve or time.

No voltage stamp, convergence rule, physical sharing, tolerance, waveform,
current-limit or downstream package/CLI/GUI adoption change is made here.
