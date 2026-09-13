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

## What already exists — surveyed 2026-09-13 against bw-circuit-ui `origin/master`

**Correction to the first draft of this document.** It proposed building modular
translators and a CLI/GUI path for them. That was written against a checkout
**207 commits behind** on a feature branch, which showed a 126-line SPICE
exporter, no SPICE importer and no PCB. All three readings were wrong. What is
actually there:

| surface | present |
|---|---|
| importers (16) | detect, eagle, easyeda, easyeda-pcb, easyeda-pro-pcb, fritzing, kicad-common, kicad-legacy, kicad-netlist, **kicad-pcb**, kicad-sch, sexpr, **spice**, wokwi, zip |
| exporters (12) | circuitikz, download, eagle, easyeda, easyeda-pcb, easyeda-schematic, **gerber**, kicad, **kicad-pcb**, kicad-sch, **spice**, registry |
| PCB | `footprints.js`, `pcb-drc.js`, `pcb-geometry.js`, import + export both ways, Gerber out |
| schematic | `schematic-projection.js`, `schematic-symbols.js`, headless `schematic-svg.js`, `SchematicPanel.jsx`, CircuiTikZ export |
| CLI `bwc` | info, convert, render, roundtrip, audit, batch |

And both sides are already REGISTRIES with reachability gates:
`exporters/registry.js`, `importers/index.js` (`IMPORTERS` + `IMPORT_FORMATS`),
enforced by `test/export-reachability.test.js`,
`test/import-reachability.test.js` and `test/engine-kind-registry.test.js`.

The registry's own header states the rule this programme must obey:

> An export nobody can invoke is not a feature, it is a defect that looks like a
> feature: it has tests, it has a golden file, and it has never once run for a
> user.

Seven writers were in exactly that state before it existed. **Menus render FROM
the registry, so an entry is the only way to add a format and a format cannot
exist without an entry.** New work joins that structure; it does not build
beside it.

## So the programme is narrower than it looked

Not "build translators" — they exist. The real gaps:

1. **One parts authority.** The 10 / 2 / 5 split above is real and unfixed.
2. **Part cards** for named devices, read by the solver AND the exporter AND the
   importer's part-number resolution.
3. **Designer sidecars + faces** for each new placeable part
   (`<kind>.json` + `<kind>.svg`, joining the 250 already there).
4. **`solve` as a first-class verb** in CLI and GUI, beside convert/render —
   the engine is already reachable from both, but solving is not offered.
5. **Examples** using the new parts, which double as the end-to-end proof.

## Architecture

    bw-board/src/parts-library.js      ← ONE authority: part number -> parameters
              |                    |
              |                    +-- exporters/spice.js emits its .model line
              |                    +-- importers/spice.js resolves part numbers
              |                    +-- parts-data sidecars reference it by name
              +-- mna.js resolves params from it

bw-board owns it because bw-board is the engine and is now a package
bw-circuit-ui depends on.

**Invariant, held by a test rather than a convention:** for every card, the
parameters the solver uses and the `.model` line the exporter emits describe the
SAME DEVICE — emit the card, run ngspice, run our solver, compare. That is the
gate the LED's 10/2/5 split fails today.

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
