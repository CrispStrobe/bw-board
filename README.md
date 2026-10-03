# bw-board

The circuit simulation and emulated-board engine for Brickwright. It connects
firmware pin activity to a netlist, solves electrical behavior, updates device
models and exposes readings for a circuit editor or command-line instruments.

Runs in browsers and Node.js as an ES-module package. The UI lives in
[bw-circuit-ui](https://github.com/CrispStrobe/bw-circuit-ui); this repository
owns shared engine behavior, component models and emulator/debugger integration.

## Install and use

Use Node.js 20 or newer. Consumers install the package at an exact Git revision:

```json
{
  "dependencies": {
    "bw-board": "github:CrispStrobe/bw-board#<full-commit-sha>"
  }
}
```

Replace the placeholder with a full commit SHA and commit your npm lockfile.
The package has no JavaScript build step. Its runtime dependencies are
`avr8js` and `rp2040js`; some backends require separately supplied artifacts.

```js
import { BoardImpl, inferNetlist } from 'bw-board';

const { parts, nets } = inferNetlist({
  pins: [
    { name: 'led1', port: 1, bit: 0, direction: 'output', activeLow: true },
  ],
});

const board = new BoardImpl(5.0);
board.setNetlist(parts, nets);
board.setPin('P1.0', 'quasi', false);
board.advanceTo(25_000_000n); // Simulation time in nanoseconds, not wall time.

console.log(board.getRenderState().leds);
```

The inferred circuit is a starting point; applications can instead supply an
explicit netlist. Register optional device models with `registerAllDevices()`
or the individual registration functions before using those kinds.

See [public exports](src/index.js), [netlist types](src/types.js),
[netlist builder](src/builder.js) and [Board API](src/board.js).
Documented package subpaths provide access to adapters and other modules;
Node-only tooling is separate from the browser entry.

## Circuit capabilities

- Modified nodal analysis and specialized solution paths for supported circuits.
- Resistors, capacitors, inductors, independent and controlled sources,
  supported semiconductor models, op-amps and regulator models.
- Registered logic, displays, sensors, controls, motors and other device models.
- MCU pin drive/pull-up behavior, wiring checks and current-budget diagnostics.
- Simulation-clock advancement, oscilloscope sampling, signed terminal currents
  and meter histories, plus supported DC operating-point and AC/sweep APIs.

Model capabilities are not uniform. A display's protocol model, an op-amp's
electrical model and a controller's instruction core have different contracts.
Consult the [device census](DEVICE-CENSUS.md), [parts notes](PARTS-TARGET.md)
and the relevant [device implementation](src/devices).

For graphical instruments, import/export and CLI measurement/reference
comparison, use [bw-circuit-ui](https://github.com/CrispStrobe/bw-circuit-ui).
The engine itself does not provide that application's file-format or UI layer.

## Firmware and debugging

Adapters and composable machines cover 8051, AVR, RP2040, Z80, 6502, RISC-V,
8086/8088 and 80286 use cases. The 80386 AT path is experimental.
Additional ARM/other targets depend on the selected backend and available
artifacts; they are not all included by installing this package.

Debugger integrations provide target-specific execution control, breakpoints,
inspection and, where supported, recording/replay. Features and peripheral
coverage vary by target. See the [target factory](src/debug-target-factory.js),
[debug session](src/debug-session.js) and
[replay surface](docs/DEBUG-TARGET-REPLAY-SURFACE.md).
The [experimental 80386 guide](docs/I80386-EXPERIMENTAL.md) documents that
target's boundaries.
The [bounded native 386 gate](docs/I80386-NATIVE-COMBINED-PAGING-RAM-ACTUAL-BOARD.md)
now combines paging, executable RAM updates, A20 aliases, REP retries and actual
PIT/PIC delivery. Its receipts qualify this free fixture; a general native backend remains WIP.
The [separate native clock-batching candidate](docs/I80386-NATIVE-OWNED-CLOCK-WIP.md)
preserves the full CPU/device chronology with fewer clock crossings, but measured
9.3% more process CPU cost than H4 and failed its adoption gate. Broader guest/backend
integration and the 10× goal remain WIP.
[Source-only snapshot transport comparisons](docs/I80386-NATIVE-OWNED-DTO-COST-WIP.md)
also rejected object and packed replies before native integration.
The [closed fresh-child main-thread diagnostic](docs/I80386-NATIVE-OWNED-MAIN-WIP.md) matches full fixture chronology and passes 13 lifecycle controls;
its fixed-fixture paired CPU gate used 26.33% less process CPU than H4, with all seven measured pairs favorable. Broader guest qualification remains WIP.

The [fixed PIC IMR native fixture](docs/I80386-NATIVE-OWNED-PIC-IMR-RESULTS.md) passes actual capture-OFF/ON state and chronology checks. This bounded compatibility proof is not a speed or general AT result.

The [private per-word dispatch experiment](docs/I80386-OWNED-DISPATCH-SOURCE-WIP.md) passes 14 source controls and [three native parity cells](docs/I80386-OWNED-DISPATCH-PARITY-RESULTS.md) for the fixed free fixture; [its paired CPU gate failed](docs/I80386-OWNED-DISPATCH-CPU-RESULTS.md): 1.72% nominal mean reduction and four of seven favorable pairs, below the ≥10%/all-seven requirement. Keep `fe1`; no adoption.

The [private span paired CPU gate](docs/I80386-OWNED-SPAN-CPU-RESULTS.md) failed its ≥10%/all-seven criterion despite full fixed-fixture parity in all 18 children; the candidate is not adopted.

## LabWired WASM performance (2026-10-01)

These results use the selected 64 MHz micro:bit motion guest in Node.js, not
browser/UI qualification or a universal chip-speed claim. The guarded cached
T16 scalar optimization landed on core `main` as `c05e8de3` after all 19 enabled
final-head checks passed. Three independent exact-artifact A/B/B/A runs measured
**+6.94%, +1.23% and +4.85%** median gains, with matching cycle-indexed guest
observations. One repeat's candidate minimum worsened, so this is not an
every-window improvement.

The exact final-head fresh qualification still failed every 1× window:
**0.704710× median / 0.690863× minimum**, EPYC 7763. Determinism and all 101
actual WASM integration tests passed with zero skips; publication stayed blocked.
App engine pins remain unchanged and CP13 remains open. Hardware content
acknowledgements were explicitly approved with their existing expiry and
capture evidence preserved; live re-capture remains owed.

Interpreter outlining was rejected after two negative paired runs (−7.68% and
−4.37%). See the [scalar results and raw receipts](docs/receipts/2026-10-01-wasm-cached-scalar/README.md),
[rejected outlining evidence](docs/receipts/2026-10-01-wasm-outline/README.md) and
[profiling/tier-validation guide](docs/LABWIRED-WASM-PROFILING.md).

The bounded cached-run optimization landed on core `main` as
[`43b2d62f`](https://github.com/CrispStrobe/labwired-core/pull/146) after all 19
enabled final-head checks passed; the app artifact remains unpromoted. It measured
**+8.24%, +7.15% and +9.65%** in three exact-artifact paired comparisons against
the landed scalar baseline, with identical cycle-indexed guest observations.
The earlier exact fixed-artifact fresh qualification was
**0.834235× median / 0.808772× minimum**: still below the
unchanged every-window 1× floor. Both builds, determinism and 101 actual WASM
integration tests passed; the fixed-head local core suite passed 4,234 tests
with three existing ignored tests. Host rates are not interchangeable. App pins
remain unchanged. Two ordinary VPS repeats measured +9.20% and +10.06%, also
below 1× in every window. See
[bounded-run results and raw receipts](docs/receipts/2026-10-01-wasm-cached-runs/README.md)
for exact source references, final CI and hardware-drift approval status.

A fresh rebuild of landed `43b2d62f` measured **0.775416× median / 0.769654×
minimum** on EPYC 7763, with the same module bytes and every window below 1×.
The unmerged literal-load follow-up passed correctness but was rejected for
landing after hosted paired results of **−0.66% and −16.30%**. Its separate
Xeon 6973P-C qualification passed 1×, which is not a same-host speedup claim.
The compile-time-specialized variant was also rejected (**−2.23%, −3.09%**).
See [literal-load evidence and compiler-policy follow-up](docs/receipts/2026-10-01-wasm-literal-loads/README.md).
App pins remain unchanged; the all-host/all-target goal is not yet met.

The new active **STM32F0 48 MHz** fixture separates RAM/ALU from GPIO polling.
On two hosted main-artifact runs, RAM cleared every window (**3.01× / 2.87×
medians**), but GPIO failed every window (**0.594× / 0.659× medians**).
These are distinct workloads/hosts, not an optimization A/B or universal F0
rating. See [raw F0 results and main profiling](docs/receipts/2026-10-02-f0-main/README.md)
and the [timing guide](docs/LABWIRED-F0-TIMING.md). Runtime and app pins are
unchanged. A follow-up [GPIO edge-metadata experiment](docs/receipts/2026-10-02-gpio-edge-metadata/README.md)
measured **+17.46%, +14.21%, +11.08% and +16.17%** F0 GPIO median gains in
four ordinary same-runner A/B/B/A comparisons. Motion was mixed (−3.07% to
+3.43%) and RAM roughly flat to −2.39%; neither is a claimed speedup. On the
EPYC 7763 repeat, GPIO rose **0.648× → 0.752×**, still below 1× in every window.
One faster host passed both artifacts, which is not universal qualification.
The lint-fixed rebuilt artifact then measured **+10.20%, +33.28% and +30.57%**
GPIO gains with matching observations. Its first two comparisons pass all GPIO
windows, but the third still fails (**0.796× median / 0.781× minimum**).
Motion remains roughly flat, and latest-head fresh motion is **0.817× median**,
below 1× in every window. **The cache-wrapper version was rejected for landing**
after five ordinary VPS motion comparisons were negative (−0.9% to −19.1%).
All 18 final core correctness checks passed, but that does not clear its
performance tradeoff. It is not on core main. A smaller live boolean-preflight
experiment measured **+5.75% and +9.99% hosted GPIO**, and **+3.09% and +3.49%
VPS GPIO**. A hosted reverse-order repeat gained **4.99% GPIO**, but lost
**1.02% motion and 1.22% RAM**. Motion remains mixed and RAM medians declined. GPIO and motion
still fail every 1× window; the engine PR remains draft. See the
[scalar-preflight results and order-control evidence](docs/receipts/2026-10-02-scalar-edge-preflight/README.md).
App pins and artifact publication remain unchanged.

A separate WASM register-inlining experiment gained **3.64–8.73% GPIO,
7.06–20.47% RAM and 5.48–8.24% motion** on three hosted Node 22 comparisons.
Clean VPS Node 20 F0 comparisons instead lost **4.00–32.00% GPIO** and
**7.75–29.94% RAM**; reverse-order RAM goes from every window passing to a
candidate minimum of **0.862541×**. VPS motion is roughly flat to +4.86%,
still below 1×. The largest hot WASM body grows **181.63%**. The engine PR
remains draft: hosted Node 20 controls gained GPIO/motion but reverse-order RAM
fell **22.03%**, so this variant is not qualified for landing. Hardware
acknowledgements remain unchanged. See [register-inlining results and raw receipts](docs/receipts/2026-10-02-wasm-register-inline/README.md).

A narrower T16-only register variant avoided the large interpreter expansion,
but still is **not qualified for landing**. Hosted Node 20 GPIO declined
**8.87% / 5.02%** and RAM **1.70% / 0.93%**; hosted Node 22 RAM gained
**13.67% / 13.31%**, with worse minima and mixed motion. VPS reverse F0 lost
about **19%** on both workloads. All 101 actual WASM integration tests and
independent determinism passed; the fresh motion floor failed (**0.764890×
median / 0.751187× minimum**). Engine/app pins and hardware acknowledgements
remain unchanged. See [restricted T16 results and original receipts](docs/receipts/2026-10-02-wasm-t16-register-inline/README.md).

Pinned Binaryen `-O3` postprocessing of unchanged core main produces an
**11.12% smaller module** and passes independent byte determinism plus all 101
actual WASM integration tests. Four hosted Node 20/22 order-controlled comparisons
gain **0.21–6.89% motion**, but lose **0.25–9.85% RAM** and **0.66–4.40% GPIO**.
One motion median reaches **1.020360×**, with a **0.956308× minimum**, so the
all-window floor still fails. This optimization is **not enabled in production**;
only manual, nonpublishing diagnostic tooling is landed. App/engine pins and
hardware acknowledgements remain unchanged. See [postprocessing results and raw receipts](docs/receipts/2026-10-02-wasm-postprocess/README.md).

Two targeted postprocessing recipes also pass independent determinism and all
101 actual WASM integration tests, but remain **not production-qualified**.
Hosted RAM gains **1.41–6.68%** (instruction cleanup) and **3.00–13.06%** (locals
cleanup); motion/GPIO are mixed. VPS RAM regresses in both orders for both
recipes, and locals cleanup loses **30.63% GPIO** in the forward run. Instruction
cleanup's fresh motion pass (**1.017790× median / 1.001569× minimum**) does not
erase its paired regressions. Only manual, nonpublishing recipe tooling is
landed; production and hardware acknowledgements are unchanged. See
[targeted results, all-window floors and original evidence](docs/receipts/2026-10-02-wasm-targeted-postprocess/README.md).

An off-by-default WASM occurrence census now isolates the next source targets:
RAM windows retire entirely through cached blocks; GPIO block attempts make
**zero progress**, mostly from already-memoized discovery misses, and
**49.8–59.9%** of overall fast attempts return zero. Every GPIO cold hook in
these selected windows exits with no edge-driven devices. Two runs repeat
identically and all **101 actual-WASM integration tests** pass. These are
instrumented counts, **not new RTx results**. See
[raw census receipts and next experiment](docs/receipts/2026-10-02-wasm-fastpath-census/README.md).

The isolated, uninstrumented literal-load probe bypass now passes exhaustive
opcode/T16 checks, determinism and **101 actual-WASM integration tests**, but is
**not production-qualified**. Hosted GPIO medians improve **0.06–9.57%**;
VPS GPIO loses **0.82% and 5.72%** in opposite orders, and both Node 22 motion
comparisons regress. Every paired motion/GPIO run still fails the unchanged
all-window ≥1× floor. Its separate fresh motion pass (**1.236514× median /
1.170159× minimum**) does not erase these results. Source promotion, app pins
and physical acknowledgements remain unchanged. See
[complete runtime/order comparisons and original receipts](docs/receipts/2026-10-02-wasm-literal-barrier/README.md).

A separate live word-address admission candidate now improves hosted GPIO in
all four Node 20/22 and forward/reverse comparisons (**+1.24–9.12%**). One Node 22
GPIO minimum crosses **0.983296× → 1.032780×**, passing every candidate window.
Both independent builds, determinism, exhaustive live-admission/T16 checks and
**101 actual-WASM integration tests** pass. It remains **unmerged/unqualified**:
motion loses **2.24%** in one pair, another motion minimum worsens, the separate
fresh motion floor fails, and VPS repeats were deferred because load and disk
headroom did not permit them. App pins and physical acknowledgements stay
unchanged. See [complete live-address results and raw receipts](docs/receipts/2026-10-02-wasm-live-word-admission/README.md).

The selective-placement revision has now completed its own four pinned-runtime,
forward/reverse comparisons: GPIO medians rise **1.67–8.90%**, but motion and
RAM medians each regress in **three of four** pairs. The forward GPIO minimum
also drops **1.144104× → 1.078001×** despite its median gain. Motion/GPIO floors
still fail on both slower runners; differing CPUs are not a Node-version or
parent-versus-revision speedup control. It remains **unmerged/unqualified**.
Both deterministic builds and **101 actual-WASM integration tests** pass, plus
seven focused same-PC RAM→GPIO→RAM/alignment/boundary tests on **each** original
engine. Those prove deployed behavior, not fast-path hit counts or RTx. The
expanded future build gate requires 108 tests. No VPS repeat, production pin or
physical acknowledgement change is claimed. See
[all selective results, minima and original proof](docs/receipts/2026-10-02-wasm-live-word-selective/README.md).

The subsequent post-RAM placement also completed all four comparisons: GPIO
medians improve **2.87–8.20%**, but motion medians regress in two pairs and RAM
medians in three. Node 22 forward RAM loses **7.94%**; reversed motion minimum
falls **0.756411× → 0.509397×**. Both deterministic builds pass and the candidate
passes **108 actual-WASM integration tests**, including the seven same-PC word
dispatcher cases. Its separate fresh motion floor remains **0.758882× median /
0.749085× minimum**. Source is **unmerged/unqualified**; no production pin,
published engine or physical acknowledgement changes. VPS load/disk headroom
prevented local repeats. See
[all post-RAM results and original receipts](docs/receipts/2026-10-02-wasm-live-word-post-ram/README.md).

Independent GPIO-only main profiles now separate GPIO execution from the RAM
guest. Two valid captures attribute about **20%** of whole-process self samples
to the bounded cached executor and **11.56–12.26%** to the cold GPIO hook; the
failed repeat's negative CPU-profile delta is preserved, not clamped or hidden.
All ordinary GPIO captures remain below 1×. These percentages are diagnostic
attribution, not removable costs or verified speedups. Acceptance and production
engines are unchanged. See
[all GPIO-only captures, failures and next experiments](docs/receipts/2026-10-02-wasm-isolated-gpio/README.md).

The resulting live GPIO edge-gate experiment completed all four ordinary hosted
pairs. Node 20 GPIO medians gain **4.30–4.51%**, but Node 22 loses
**5.42–7.49%**; motion is mixed and reverse Node 20 RAM loses **27.57%**.
Native verification, independent WASM determinism and **108 actual integration
tests** pass. Fresh motion is **1.004303× median / 0.987461× minimum**, so the
unchanged all-window ≥1× gate fails. This source remains **unmerged/unqualified**;
production, app pins and physical acknowledgements are unchanged. VPS load/disk
prevented local repeats. See
[all live GPIO gate results and original receipts](docs/receipts/2026-10-03-wasm-live-gpio-edge-gate/README.md).

The isolated cached-run cap experiment (16 → 64 instructions) also completed
all four ordinary hosted pairs. Motion medians gain **0.52–1.58%** in three
pairs but lose **1.19%** in the fourth; reverse Node 20 motion minimum drops
**1.252052× → 1.085393×**. RAM medians are mixed (**−0.34% to +2.42%**),
as are GPIO (**−0.22% to +3.20%**). Native verification, independent WASM
determinism and **108 actual integrations** pass; fresh motion remains
**0.809596× median / 0.783265× minimum**, below the unchanged ≥1× gate.
Source remains **unmerged/unqualified**; production, app pins and physical
acknowledgements are unchanged. Prior census indicates almost all GPIO cached
runs stop at instruction/address barriers, which a larger cap does not remove.
Different hosted CPUs do not establish Node-version causality or significance.
See [all cached-run64 results and original receipts](docs/receipts/2026-10-03-wasm-cached-run64/README.md).

The isolated ordinary scalar LDR/STR word-dispatch experiment completed four
more hosted pairs without stacking earlier variants. GPIO gains **3.46–5.12%**
in the Node 20 pairs but loses **1.36–3.59%** in the Node 22 pairs; candidate
GPIO fails the ≥1× floor in all four. Motion gains **2.79%** once but loses
**1.31–3.37%** in the other three; RAM is mixed (**−1.02% to +1.44%**).
Timed-source native verification, independent WASM determinism and **108 actual
integrations** pass, but fresh motion is only **0.793103× median / 0.791293×
minimum**. Separate supplemental differential tests strengthen fault/reset,
state and observer proofs without changing the timed production source. The
initial scanner-ratchet failure is also preserved. This candidate remains
**unmerged/unqualified**; production, app pins and physical acknowledgements
are unchanged. Different hosted CPUs do not establish Node-version causality.
See [all scalar word-dispatch results and original receipts](docs/receipts/2026-10-03-wasm-scalar-word-dispatch/README.md).

WASM-only call-site inlining of the unchanged 16-instruction cached executor
also completed four ordinary hosted pairs. GPIO loses **9.26–15.93% in all
four**; motion is mixed (**−2.53% to +14.23%**), as is RAM (**−1.40% to
+5.36%**). The Node 22 reverse RAM minimum drops **2.849149× → 2.754971×**.
Native verification, independent WASM determinism and **108 actual integrations**
pass. Fresh motion remains **0.805111× median / 0.800217× minimum**, below the
unchanged ≥1× floor. The candidate WASM is 26,554 bytes smaller, which does not
establish a speedup. The engine body, cap and all safety guards are unchanged;
only its WASM inlining attribute differs. This experiment remains
**unmerged/unqualified**; production, app pins and physical acknowledgements
are unchanged. See
[all cached-executor inlining results and original receipts](docs/receipts/2026-10-03-wasm-cached-run-inline/README.md).

## Limits

This is not a universal SPICE replacement or a calibrated model of every
physical component. Supported parameters, nonlinear convergence, timing,
parasitics and thermal behavior depend on the selected model and analysis.
Strict operating-point APIs refuse unsupported domains or conflicting
constraints; inspect their result rather than treating diagnostics as a valid solve.

Instruction and machine tests do not establish universal peripheral coverage,
silicon-exact timing or compatibility with every program. Simulation throughput
also depends on the circuit, observers, backend and host machine.

## Develop and verify

```sh
npm ci
npm test
node scripts/oracle-census.mjs
```

The oracle census reports available independent tools and the gates that
require them. Some tests need external tools or backend artifacts: an explicit
skip is not a successful oracle comparison. Heavy suites can run in
[GitHub Actions](https://github.com/CrispStrobe/bw-board/actions).

[VERIFICATION.md](VERIFICATION.md) explains evidence and its limits.
[ROADMAP.md](ROADMAP.md) tracks development; [LANES.md](LANES.md) records
contributor ownership and the upstream-first package regime.
Detailed benchmark and campaign receipts remain in their own documents;
historical totals are not a statement of current coverage.

## License

MIT. See [LICENSE](LICENSE) and [third-party notices](THIRD-PARTY.md).

The fixed native baseline has [qualitative Inspector results](docs/I80386-OWNED-BASELINE-PROFILE-RESULTS.md), with full parity evidence and explicit attribution limits.
