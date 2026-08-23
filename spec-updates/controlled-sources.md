# Spec-update: controlled sources — vcvs and vccs (E3.5, first half)

## Problem

The engine has no controlled-source kinds. The op-amp macromodel (E3.1)
needs a transconductance stage and a buffer; the SPICE-netlist importer
needs E/G elements to read real decks; two-port lessons need them as
first-class parts. The op-amp's private VCVS row machinery already proves
the row mechanics — it is just not reusable.

## Adopted (this landing)

Two kinds, four terminals each: `outp, outn, inp, inn`. The control pins
are ideal (no loading — infinite input impedance, like the op-amp's).

- **vcvs** (`params.gain`): one extra MNA row,
  `V(outp) − V(outn) − gain·(V(inp) − V(inn)) = 0`, branch current in the
  row variable. Optional `params.railLow`/`railHigh`: the output clamps at
  the rail via the same region FSM the op-amp uses (linear/high/low with
  the ideal-value leave test) — needed so the macromodel's buffer can
  carry the saturation behaviour.
- **vccs** (`params.gm`): current `gm·(V(inp) − V(inn))` from outn to
  outp — pure conductance-quadrant stamps, no extra row. Optional
  `params.iMax`: output current clamps at ±iMax via an NR region flag —
  this clamp IS the op-amp macromodel's slew limit, and it is a
  **DYNAMIC limit: transient solves only**. At DC a slew clamp has no
  physical meaning, and enforcing it there makes an integrator-loop
  operating point a clamp± ping-pong through the rails (measured before
  this rule existed). DC and AC answer unclamped.

## Deferred (second half, unchanged in ROADMAP E3.5)

`cccs`/`ccvs` sense a BRANCH CURRENT, which needs a zero-volt sense row
(SPICE senses through a named V source). Straightforward, but nothing
downstream needs them yet; they land with the SPICE importer that reads
them.

## Acceptance (hand oracles, same commit)

1. vcvs gain 10: divider input 0.5 V → output 5.000 V into a load, with
   the load current carried by the source row.
2. vcvs rails 0/5 with gain 1e6 and 1 V input: output sits AT 5.000 V
   (railed), leaves the rail when the input reverses.
3. vccs gm 1 mS: 2 V control → 2.000 mA into a 1 kΩ load (2.000 V).
4. vccs iMax 1 mA with 5 V control (would demand 5 mA): output pins at
   1.000 mA exactly; back under the clamp when the control drops.
5. Control pins draw no current (nets behind 1 MΩ read undisturbed).
