# Pinned Binaryen O3 on unchanged main: not qualified for production

The independently reproduced transformation passes correctness coverage and
shrinks the module, but **RAM and GPIO median performance declines in all four
hosted comparisons**. Do not enable it in ordinary builds, publish it, change
app/engine pins, or update hardware drift acknowledgements. The all-target 1×
goal remains open. No instruction dispatch source was changed for this experiment.

## Provenance and correctness

Both sides use core `43b2d62f5a0fa24ae0b38a645069f5aaa78af685`.
The original [build 36915940413](https://github.com/CrispStrobe/bw-board/actions/runs/36915940413)
uses tooling `1cac10ba28ddd5e71c5a7e32437a3b0080d47f14`.
The [independent postprocessing run 36991093841](https://github.com/CrispStrobe/bw-board/actions/runs/36991093841)
uses tooling `7d09526dd0aeb62031de9f9a596801530fdd5309`.
Both independent optimizer build jobs, byte determinism and all **101 actual
WASM integration tests** passed, with zero failures/skips. Its motion job
**failed**, correctly: fresh median **0.806543×**, minimum **0.797786×**.
That run's overall failure is not a correctness pass or waived floor.

Binaryen release 123 is archive- and executable-hash pinned. The exact flags
are retained in `candidate/BUILD-INFO.json`: `-O3`, debug/producer stripping,
and explicit feature support; no fast-math or ignored implicit traps. Original
Node/web glue is unchanged. Input/output module descriptors and module
validation passed; those checks alone do not prove instruction equivalence.

| Module | Bytes | SHA-256 |
| --- | ---: | --- |
| Original | 27,556,189 | `7bd66fe4e926fbf14322621499f3fbddefefae763f61742c4c8c7312113b7a3d` |
| Postprocessed | 24,492,963 | `880fcdde04b581675c89cf5c638cf2c198c276478532c4a013dd36cb2e135b29` |

The module is **11.12% smaller**. Both hosted outputs match the completed native
local pilot byte for byte. Smaller size and integration success do not establish
a workload-wide speedup. Original metadata is preserved separately and hash-bound;
original build time/raw Rust module size are not relabelled as optimizer output.

## Hosted runtime and order controls

All four comparisons use immutable ordinary harness tooling
`fb13d48b7bc377bceb5da5a1d4ed5cd11555e162`, without profiling. Within each
comparison both artifacts run sequentially on the same runner. Each workload
has ten measured windows per artifact, retaining guest observations and minima.
ABBA means baseline/candidate/candidate/baseline; BAAB reverses it.

| Comparison | Runtime/order | CPU | Original run |
| --- | --- | --- | --- |
| 1 | Node 20.20.2, ABBA | EPYC 7763 | [36991552272](https://github.com/CrispStrobe/bw-board/actions/runs/36991552272) |
| 2 | Node 20.20.2, BAAB | EPYC 9V74 | [36991842327](https://github.com/CrispStrobe/bw-board/actions/runs/36991842327) |
| 3 | Node 22.23.3, ABBA | EPYC 9V74 | [36992022366](https://github.com/CrispStrobe/bw-board/actions/runs/36992022366) |
| 4 | Node 22.23.3, BAAB | EPYC 9V74 | [36992254830](https://github.com/CrispStrobe/bw-board/actions/runs/36992254830) |

Values are RTx median / minimum; percentages are paired median changes.

| Comparison | Workload | Original | Postprocessed | Change |
| --- | --- | --- | --- | ---: |
| 1 | motion | 0.572578 / 0.502187 | 0.604973 / 0.584030 | +5.66% |
| 1 | RAM | 2.816666 / 2.737454 | 2.539135 / 2.443904 | −9.85% |
| 1 | GPIO | 0.558315 / 0.547933 | 0.554643 / 0.514097 | −0.66% |
| 2 | motion | 0.867403 / 0.858065 | 0.869217 / 0.859511 | +0.21% |
| 2 | RAM | 3.828789 / 3.620317 | 3.534988 / 3.443157 | −7.67% |
| 2 | GPIO | 0.734328 / 0.717375 | 0.710187 / 0.701112 | −3.29% |
| 3 | motion | 0.751981 / 0.734545 | 0.803826 / 0.788805 | +6.89% |
| 3 | RAM | 3.021982 / 2.891569 | 2.929458 / 2.227825 | −3.06% |
| 3 | GPIO | 0.604534 / 0.602440 | 0.588564 / 0.580414 | −2.64% |
| 4 | motion | 0.976726 / 0.929234 | 1.020360 / 0.956308 | +4.47% |
| 4 | RAM | 3.805590 / 3.690686 | 3.795893 / 3.377672 | −0.25% |
| 4 | GPIO | 0.791264 / 0.783225 | 0.756424 / 0.741761 | −4.40% |

RAM meets every hosted 1× window on both sides but regresses. GPIO fails every
hosted window on both sides. Motion fails the all-window floor in every
comparison, including comparison 4 despite its candidate median exceeding 1×.
Between-run CPU/runtime differences are not a controlled causal explanation.

## Original shared-VPS pilot: retain mixed results

Node 20.20.2, Xeon Skylake IBRS/no TSX; no owned compiler, optimizer or overlapping
benchmark during these sequential timings. Other-project load was uncontrolled.
These results are not pooled with hosted timings or discarded as inconvenient.

| Workload/order | Original median / minimum | Postprocessed median / minimum | Change |
| --- | --- | --- | ---: |
| motion ABBA | 0.257421 / 0.167575 | 0.279589 / 0.185599 | +8.61% |
| motion BAAB | 0.170661 / 0.136638 | 0.173002 / 0.114065 | +1.37% |
| motion ABBA repeat | 0.201727 / 0.176550 | 0.189682 / 0.145176 | −5.97% |
| RAM ABBA | 1.207541 / 0.941229 | 1.144413 / 0.933999 | −5.23% |
| GPIO ABBA | 0.309410 / 0.193530 | 0.284273 / 0.243965 | −8.12% |
| RAM BAAB | 0.620101 / 0.424820 | 0.713021 / 0.488721 | +14.98% |
| GPIO BAAB | 0.164792 / 0.124484 | 0.188997 / 0.126348 | +14.69% |

Every local all-window floor fails, including RAM ABBA despite passing medians.
The first local integration attempt failed (42 tests / 4 failures) because two
locked dependencies were missing. It remains archived and excluded. Installing
only those locked dependencies with lifecycle scripts disabled produced the
101-test / zero-failure / zero-skip retry. The original local `pilot.json`
records the state **before** hosted reproduction; its then-owed checks are not
rewritten retrospectively. A redundant finalized-script local repeat was stopped
after both hosted builds succeeded; its partial tree has no final BUILD-INFO and
is explicitly unqualified in [the interruption note](LOCAL-REPEAT-INCOMPLETE.md).

## Rechecking and next work

`EVIDENCE-SHA256.json` records byte-identical copies of original receipts, logs,
metadata, runner details, and collection scripts. Collection scripts retain
their original machine paths as provenance; they are not portable rerun commands.
The portable checks reparse motion stdout and actual F0 child stdout, compare
guest observations, bind hashes/runtime/order, and recompute every median,
minimum and floor:

```sh
node --test test/wasm-postprocess-evidence.test.mjs test/wasm-postprocess.test.mjs
```

The [manual diagnostic tooling](../../LABWIRED-WASM-POSTPROCESS.md) is landed,
read-only and nonpublishing. No ordinary builder/default changed. Hardware
acknowledgements and their 2026-10-31 expiry remain unchanged; physical recapture
is still owed. Register-inlining engine PRs 149/150 remain unqualified drafts.

A useful next experiment is a separately pinned size-oriented or targeted-pass
optimizer mode on unchanged main, with the same deterministic rebuild, actual
integration and Node 20/22 order controls. Do not treat this O3 result as evidence
for such a mode, browsers, other targets, or a production speedup.
