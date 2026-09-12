# Device advancement: observable contract

Optimization must preserve the existing instruction-boundary model. This is
not a claim of silicon/sub-instruction accuracy.

1. At every completed `_advanceChips(n)`, all attached device state is current,
   including public PIT `ce`, `out`, gate/latch state, `_frac`, and CGA cycles.
2. Chip insertion order precedes attached-device insertion order. A callback
   observes devices already advanced and devices not yet advanced in precisely
   that order. Do not fuse, reorder, or defer calls across instruction boundaries.
3. Callbacks may reprogram other counters, change gates/CRTC geometry, replace
   public advance methods, or attach devices. Attachment invalidates the cached
   schedule for the next advancement; it does not restart the current traversal.
4. Clock conversion preserves the original floating-point operation order and
   fractional carry. Millisecond devices and CPU-cycle devices stay distinct.
   A dynamically changed machine/device clock takes effect as before.
5. A deadline names an output event, not the next observable state change.
   Even strictly before that deadline, direct counter reads and instruction
   observers can distinguish deferred advancement from ordinary execution.

Consequently, general event-driven deferral is NOT enabled. It would require a
different opt-in device interface with mandatory materialization on every
read/observer/interrupt/snapshot boundary, inaccessible stale public fields,
and explicit handling of unknown devices. Current project devices do not meet
that contract. Local arithmetic shortcuts within one call remain eligible;
tick coalescing across an output callback is not.

`test/i8086-advance-observability.test.mjs` checks each instruction and callback
against the original traversal and conversion order, including live clock,
gate, geometry and attachment changes. Its negative fixture demonstrates why
an output deadline is insufficient. The counter-mode/tick oracle and existing
deadline tests remain separate, stronger checks of individual device behavior.
