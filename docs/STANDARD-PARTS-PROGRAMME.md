# Standard parts: one library, every surface

**Scope.** Real named parts (1N4148, 2N2222, BC547, 1N4001, …) usable end to end:
in the solver, in the designer with a face, through every translator, in the CLI
and the GUI, and in shipped examples — each addition recorded and tested.

## The finding that sets the shape

A part's electrical parameters currently live in **three places that disagree**.
For an LED's series resistance:

| path | value |
|---|---|
| `board.js` LED_RD / `mna.js` JUNCTION_RD (piecewise) | **10** |
| `mna.js` junctionOpts (exponential) | **2** |
| bw-circuit-ui `exporters/spice.js` `.model LED` | **5** |

Three homes, one quantity, no authority. The 1N4148 agrees at 0.568 across the
solver and the exporter, but only because that was reconciled on 2026-09-13 —
by hand, in one direction, for one part.

**This is the vf-convention defect one layer up.** The lesson from that: a
parameter with several homes drifts, and the drift is invisible because every
home is individually plausible. Adding twenty parts to three unsynchronised
tables would multiply the problem by twenty.

So the first deliverable is not a part. It is the **authority**.

## Architecture

    bw-board/src/parts-library.js      ← ONE authority: part number -> parameters
              |                    |
              |                    +-- exporters/spice.js reads it (no hardcoded .model)
              |                    +-- importers/spice.js resolves part numbers through it
              |                    +-- parts-data sidecars reference it by name
              +-- mna.js resolves params from it

bw-board owns it because bw-board is the engine and is now a package
bw-circuit-ui depends on. A card is the SINGLE source for: the solver's
parameters, the emitted `.model` line, and what an importer recognises.

**Invariant, held by a test rather than a convention:** for every card, the
parameters the solver uses and the `.model` line the exporter emits describe the
SAME DEVICE. That is checkable — emit the card, run ngspice, run our solver,
compare — and it is the gate the LED's 10/2/5 split would have failed.

## Order, and why

1. **The library + the reconciliation.** Cards for the parts already implicitly
   present (1N4148, 1N4733A, 2N2222, 2N2907, TIP120, LED, D_DEFAULT, Q_DEFAULT),
   the three-way `rs` split resolved to one number per part, and the
   same-device gate. Nothing new is added until existing parts agree.
2. **The MNA path.** `params.part: '2N2222'` resolves through the library;
   explicit params still override. No behaviour change for parts that set
   values directly.
3. **Translators, modular.** One neutral form (the `test/lcapy/circuits.mjs`
   shape already proven) with emitters per target. SPICE in/out first, then
   KiCad/EAGLE/EasyEDA/Wokwi importers already in bw-circuit-ui get the same
   library for part resolution.
4. **Designer faces.** `<kind>.json` sidecar + `<kind>.svg` per new part. This
   is bw-circuit-ui's surface and lego-38's call.
5. **CLI + GUI.** import / export / convert / solve on both. The CLI comes
   first because it is testable without a browser.
6. **Examples.** Shipped circuits using the new parts, which is also the
   coverage proof that a part is really wired end to end.

## What "recorded" means here

Every part addition lands with: the card, its provenance (datasheet or the
reference deck the parameters came from), a same-device test against ngspice,
a designer sidecar if it is placeable, and a row in this document. A part that
solves but cannot be placed, or can be placed but exports wrong, is not done —
that is the `files present != device registered` rule already in the tree.

## Open decisions

- **Which `rs` for the LED.** 10, 2 and 5 are all in use. It must become one
  number per part, chosen against the oracle rather than by majority.
- **Part-number granularity.** `kind: 'npn', params: {part: '2N2222'}` versus a
  distinct `kind: '2n2222'`. The first keeps the solver's device classes small
  and is the recommendation; the second is what parts-data's 250 sidecars do.
  These can coexist — a sidecar names a kind, a card names parameters — but the
  mapping must be explicit.
