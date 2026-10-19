# Ground fallback: a battery's negative pole is the bench reference

**Status: adopted 2026-08-10 (coordinator). Amends the MNA ground-selection
rule in `src/mna.js`.**

## The hole

`solveMNA` picks its reference node as *the net containing a part of kind
`gnd`* — and otherwise has **no ground at all**. MCU pin drives are Thevenin
sources stamped against the implicit reference (node −1). On a bench built
the way a real bench is built — a battery feeding the rails, no abstract
`gnd` symbol anywhere — pin current therefore has no return path: the
solver's reference is a node no real net maps to, the loop
`battery+ → R → LED → pin` never closes, and every LED driven by a pin reads
brightness 0 while the emulator dutifully toggles it.

Found 2026-08-10: the derived seated bench (battery `vsource`, no `gnd`
part) reproduced "Blink does not blink" at the engine level, two layers
below the runner/netlist identity bug fixed the same day.

## The rule

Reference selection, in order:

1. The net containing a part of kind `gnd` (unchanged, wins as before).
2. Else: the net containing the **`neg` terminal of the first `vsource`**
   (in netlist order). On a single-supply bench the battery minus IS the
   reference — this is not a convenience, it is what the physical bench
   does when you clip the scope ground to the battery minus.
3. Else: no ground, as today (pure two-terminal loops still solve as
   potential differences).

`powerOff` resistance measurement (`testNodeB` reference) is unchanged and
still takes precedence.

## Oracle

Battery 5 V (pos → 1 kΩ → LED vf 2.0 → MCU pin `quasi` driven low,
R_STRONG = 25 Ω), battery neg otherwise unconnected to the LED chain:

    I = (5 − 2) / (1000 + 25) = 2.927 mA

LED brightness = I / 20 mA = **0.1463**. Before this rule: 0 exactly.
With the pin driven high (quasi): the LED chain sees no sink — brightness 0.

Test: `test/ground-fallback.test.js`, hand-computed, both directions.
