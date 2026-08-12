# BLOCKED.md — bw-board items waiting on external work

## ~~vsource current-limit (power supply CC mode)~~ RESOLVED

Implemented in `e060978`. `vsource` now accepts `params.iLimit` — CV→CC
transition iterates in the NR loop.

---

## Headless live end-to-end tests (engineering bar class 4)

**Blocked on:** Playwright browser install (hundreds of MB, violates fleet memory rule
while other agents run on this VPS — `free -m` shows <1.2GB available).

**What:** Drive the real UI, assert on a rendered voltage/brightness, assert no
`pageerror`. The 4th engineering bar test class from HANDOVER §8.

**Workaround:** None — this test class requires a browser. Defer until the fleet
shrinks or memory is available. Check `~/.cache/ms-playwright` before installing.

---

---

## Pull-down PinMode for rp2040js

**Blocked on:** MNA spec-update + hand-computed oracle tests (engine-level change).

**What:** RP2040's `InputPullDown` GPIOPinState has no boundary-A PinMode
equivalent. The rp2040js adapter maps it to plain `'input'`, losing the
pull-down. Circuits relying on pull-down (button to GND without external
resistor) will not behave correctly.

**Scope:** PinMode extension is shared with any future platform that has
pull-downs (STM32, ESP32). Requires MNA change to model the ~50 kΩ pull-down
Thévenin equivalent.

---

*Last updated: 2026-08-12*
