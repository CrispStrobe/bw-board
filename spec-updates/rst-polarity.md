# RST pin polarity: engine hard-codes per part kind, not sidecar field

## Finding

bw-parts `fbfacf8`: STC12 RST is **active HIGH**, confirmed against
datasheet and `stc/docs/PINOUT.md`. The sidecar format has no polarity
field, so this fact exists in documentation but not in data the engine loads.

Unlike most 8051 parts, where RST is active HIGH is actually the standard —
but unlike AVR (active LOW) or ARM (active LOW). A multi-architecture
engine needs to know which.

## Decision

**The engine hard-codes polarity per part kind**, not per sidecar instance.

Rationale: polarity is a property of the chip, not the circuit. It does
not change per-project. A sidecar field would carry redundant data on
every instance and could be set wrong.

Implementation: when `mcu` kind is used, the engine reads polarity from
a per-chip-family table:
- STC12: RST active HIGH (datasheet Ch. 2.3, PINOUT.md)
- STC15: RST active HIGH (same family)
- AVR ATmega/ATtiny: RESET active LOW
- Default: active HIGH (8051 family convention)

## For bw-circuit-ui (when it returns from freeze)

The sidecar uses port names only (`P1.0`, not `ADC0`). The pin chooser's
alternate-function data (which pins have ADC, which have PCA) must come
from the pin table (`stc/docs/PINOUT.md`), not from the sidecar. A pin
chooser reading only sidecars will silently offer no analog inputs.
