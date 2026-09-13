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

## The corpus is an acceptance instrument, in evidence layers

A part card is a claim about a device. A small discriminating characterization
is enough for a bounded first landing; a broader, resumable corpus sweep then
raises that card from provisional to full coverage. Thousands of circuits are
not a prerequisite for every card, and generated volume must not inflate the
denominator.

Every case has one of these evidence classes:

| class | treatment | claim supported |
|---|---|---|
| `original-direct` | original values, models and analysis | numerical agreement for the supported original deck |
| `original-adapted` | named model or analysis adapter | agreement only for that explicit interpretation |
| `transformed-topology` | deterministic seeded values/models/excitation | differential coverage of the source topology |
| `import-only` | syntax/connectivity preserved | importer coverage, not numerical agreement |
| `unsupported` | required model/equation unavailable | an explicit gap, never silent coverage |

The private `CrispStrobe/circuit-oracle-corpora` repository owns manifests,
ingestion, transformations, oracle execution and result records. It consumes
the public importer/engine APIs and does not copy their implementations. Current
source inventories are leads, not fixed coverage numbers: nine of 23 locally
sampled cktformer files ran directly after a suitable analysis was supplied, so
the old “about 12,200” extrapolation is retired; ADI2005 contains valued decks
but a local sample is not a corpus-wide ratio; Masala contains numeric, mixed
and symbolic rows; and topology-only sources remain useful after a labelled,
seeded transformation.

### Measured corpus checkpoint — 2026-09-13

The private corpus repository now has a dated discovery snapshot of 93 unique
Hugging Face repositories found through eight circuit/EDA-related tags (162 tag
memberships). That is an indexed lead set, not 93 acquired or runnable corpora:
each row records its inspection depth, and acquisition, engine support and
publication eligibility remain independent states. Dataset-card licence badges
are recorded as publisher metadata rather than treated as blanket clearance of
mixed upstream material.

A separate date-bounded reconstruction pins twelve documented repositories at
their latest commits no later than 2026-08-20. It contains 81 modern KiCad and
seven legacy KiCad schematics, matching the old recorded counts; because the
deleted collection had no preserved file hashes, this is not a claim of
historical byte identity. Four additional pinned repositories provide a new
replacement set of five EAGLE schematics and seven matching boards. They do not
count as recovery of the missing 266-file EAGLE corpus. No external source
payload is shipped from this public engine repository.

The first hosted broad numerical qualification is also fixed rather than
extrapolated. From the 12,471-row ADI v3 denominator, strict classification
found 680 eligible E/R/V rows representing 85 exact projected bodies and 595
duplicates; it found no eligible G body. The 85 bodies were each run at original
zero bias and deterministic positive/negative DC stimuli, for 255/255 passing
cases and 1,785/1,785 finite numeric comparisons (1,110 nonzero, 675 zero), plus
765/765 KCL and 595/595 linearity checks. This is private analysis-derived DC
controlled-E harness evidence, not dataset-wide coverage and not evidence that
the public operating-point API accepts controlled sources. GitHub's artifact
quota prevented retention of the full per-case JSON; the private log, aggregate
summary and result hash remain, while the raw per-case artifact is unavailable.

The public `BoardImpl.operatingPoint()` boundary is narrower: grounded static
native R/C/V/I networks with GND/VCC, with ideal capacitors treated as DC opens
and explicit refusals for declared unsupported domains. It is non-mutating and
separately tested. Controlled-E projection evidence stays in the private
harness until the public model and API intentionally support that class.

### Model and rights boundaries

A standard card unlocks only parameters and equations that the importer and
solver preserve. In particular, a LEVEL=1-like MOS claim requires `KP`, `W/L`
and `VTO` to survive import. Extra temperature, capacitance, Gummel-Poon, BSIM
and vendor macro-model fields remain explicit unsupported fields or named
adapters; a familiar model name is not an implementation.

Externally visible data is not automatically redistributable. Record a compact
source manifest with repository/config/revision, input hash, current licence or
terms reference, access restrictions and intended use. Unknown or restrictive
source bytes/models stay external offline/private test inputs and out of public
packages, examples, goldens, logs and CI artifacts. This does not prevent an
independently written harness from testing a lawfully obtained external input;
nor does substituting synthetic values automatically clear rights in a source.

### Per-case contract and acceptance

Each manifest fixes: input hash; evidence class; transformation/version/seed;
models and unsupported fields; analysis and its parameters; temperature;
boundary and initial conditions; requested node/branch observables; oracle
version/options; engine head; tolerances; and expected comparison count. Results
record complete finite observations plus one outcome such as `agree`,
`disagree`, `oracle-error`, `engine-error`, `import-error`, `non-convergent`,
`missing-observable`, `non-finite`, or `unsupported-model`.

Parser success and ngspice exit zero are not agreement. Zero comparisons,
missing observables and non-finite readings fail. Preserve a source deck's
analysis when supported instead of forcing `.op`; label every transformed deck.
Report selected, attempted, compared, agreed and each refusal category against a
fixed manifest. Long sweeps write results durably per case.

For pure linear DC, add an analytical or KCL residual spot-check so shared
emission/parsing bugs cannot make ngspice and our solver agree falsely. Other
engines are optional, justified adapters rather than an upfront framework. A
small per-card characterization should cross the applicable operating regions;
the broader sweep records its exact denominator and promotes coverage later.

### Bounded landing sequence

1. Start with a private fixed manifest of self-contained R/V DC decks: original
   inputs, real ngspice and engine executions through existing APIs, requested
   voltage/current observations, analytical/KCL checks and classified results.
2. Add small original-direct manifests from valued decks whose terms and model
   subset are understood. Add parser/process code upstream only if an actual
   production seam is missing.
3. Reuse the existing deterministic topology bridge for symbolic sources and
   record every generated value and seed. Add device classes only when their
   parameter boundary is explicit.
4. Characterize each new card narrowly, then run the broader resumable sweep.
   Solver disagreements become separate semantic-risk changes, not tolerance
   edits inside a card landing.
5. Keep gallery MCU/digital freezing separate. It needs a runtime snapshot of
   supply, time, drive mode/value and high-Z/unknown/contention state, and proves
   only the analog DC solve conditional on that boundary—not digital or
   transient correctness.

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
