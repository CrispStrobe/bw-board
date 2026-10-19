# Tail-declared boolean edge eligibility: layout restored, motion still regresses

Candidate core `226fe97835bb5bed06cbb377b3d218c661937a49` is a direct child of production43b2. The live boolean first eligibility gate and its five tests are identical to the earlier14a experiment; only the WASM/test trait method's declaration moves to the end. Removing it reproduces the original trait exactly, preserving native production. There is no inventory/address cache, chip-specific shortcut, tier forcing, profiling or optimizer. CPU, accessors, routing, tick, synchronous device order and mux/timer paths are unchanged.

[Native verification](https://github.com/CrispStrobe/labwired-core/actions/runs/37122173204) passes five focused live/mutation tests with and without the event scheduler, **4,239 library tests** (three existing ignored), and **16 GPIO integrations**. [Independent WASM build](https://github.com/CrispStrobe/bw-board/actions/runs/37123103124) passes module/glue determinism and **108 actual integrations**, including seven same-PC RAM/MMIO proofs. Its separate fresh motion check **fails** the unchanged floor: **0.810358× median / 0.789109× minimum**. Publication is skipped. This is not a paired gain.

## All four ordinary pairs: 240 timing windows

Ten windows per engine/row, frozen harness `fb13d48b7bc377bceb5da5a1d4ed5cd11555e162`, original verified module/glue bytes and default Node flags. Different rows use different hosted VMs; this is not Node-version causality, statistical significance, calibrated silicon CPI, browser/UI/debugger throughput or all-target qualification.

| Runtime/order | Guest | Baseline median / min RTx | Candidate median / min RTx | Median delta | Floor baseline / candidate |
| --- | --- | --- | --- | --- | --- |
| 20.20.2 ABBA | motion | 0.628288 / 0.619432 | 0.626131 / 0.601522 | -0.34% | FAIL / FAIL |
| 20.20.2 ABBA | RAM | 2.832441 / 2.706618 | 2.845646 / 2.766288 | 0.47% | pass / pass |
| 20.20.2 ABBA | GPIO | 0.546308 / 0.530782 | 0.593837 / 0.585167 | 8.70% | FAIL / FAIL |
| 20.20.2 BAAB | motion | 0.671339 / 0.667862 | 0.667859 / 0.662586 | -0.52% | FAIL / FAIL |
| 20.20.2 BAAB | RAM | 2.940509 / 2.870720 | 3.030511 / 2.813090 | 3.06% | pass / pass |
| 20.20.2 BAAB | GPIO | 0.554771 / 0.545765 | 0.660937 / 0.643763 | 19.14% | FAIL / FAIL |
| 22.23.3 ABBA | motion | 0.968189 / 0.953055 | 0.961721 / 0.938790 | -0.67% | FAIL / FAIL |
| 22.23.3 ABBA | RAM | 4.127333 / 3.910110 | 4.130873 / 4.020912 | 0.09% | pass / pass |
| 22.23.3 ABBA | GPIO | 0.757528 / 0.740887 | 0.777377 / 0.775000 | 2.62% | FAIL / FAIL |
| 22.23.3 BAAB | motion | 0.815249 / 0.801301 | 0.812698 / 0.788800 | -0.31% | FAIL / FAIL |
| 22.23.3 BAAB | RAM | 2.850548 / 2.779749 | 2.814200 / 2.732449 | -1.28% | pass / pass |
| 22.23.3 BAAB | GPIO | 0.631043 / 0.611452 | 0.698006 / 0.676078 | 10.61% | FAIL / FAIL |

- [Original run 37124535375](https://github.com/CrispStrobe/bw-board/actions/runs/37124535375): Node 20.20.2, ABBA.
- [Original run 37124754282](https://github.com/CrispStrobe/bw-board/actions/runs/37124754282): Node 20.20.2, BAAB.
- [Original run 37124887236](https://github.com/CrispStrobe/bw-board/actions/runs/37124887236): Node 22.23.3, ABBA.
- [Original run 37124975414](https://github.com/CrispStrobe/bw-board/actions/runs/37124975414): Node 22.23.3, BAAB.

GPIO medians/minima improve in all four pairs (+2.62% to +19.14%), but **motion medians and minima worsen in all four** (median −0.31% to −0.67%). RAM medians range −1.28% to +3.06%, with minima worsening in the two reverse-order pairs. Motion/GPIO floors fail all four pairs; RAM passes all four. Restoring declaration/compiled slot placement does not resolve the measured tradeoff. The source stays **unmerged/unqualified**; no engine promotion is justified by selecting GPIO gains. CP13/all-target ≥1× remains open. Production app pins and seven physical drift acknowledgements/captures/expiry are unchanged; hardware re-capture is owed.

## Actual compiled layout, not a performance explanation

Pinned hosted disassembly retains raw bounded vtable bytes, resolved table symbols, complete target bodies and full-WAT hashes. No engine executes during inspection; the ~201MB full WAT and engine bytes remain on runners.

| Static Button slot | Production43b2 | Middle-declared14a | Tail-declared226 |
| --- | --- | --- | --- |
| edge_service_addrs | 48 | 48 | 48 |
| has_edge_service_addrs | absent | 52 | 72 |
| service_edge | 52 | 56 | 52 |
| as_any_mut | 68 | 72 | 68 |

These are observations from these exact compiled artifacts, not a stable Rust ABI guarantee, dynamic device inventory or cause of the timing changes. [Production inspection](https://github.com/CrispStrobe/bw-board/actions/runs/37123746233), [middle inspection](https://github.com/CrispStrobe/bw-board/actions/runs/37123891458) and [tail inspection](https://github.com/CrispStrobe/bw-board/actions/runs/37124659076) all pass on exact tool457. The first loose Button-anywhere match produced five matches among17 production windows, including function-table bytes. The corrected independent drop/Debug/as_sim_input/size/alignment prefix checks identify one strong Button candidate per artifact. Original loose captures and the correction are preserved, not silently substituted. Middle originally had only one loose match; the production false positives motivated the stronger controls.

[Tooling PR303](https://github.com/CrispStrobe/bw-board/pull/303) merged after all11 visible enabled checks plus independent verification of all three actual inspection runs, with two intentional vectors-full skips. Manual dispatches are not included in that PR's visible rollup; their exact-head success is separately required and archived. Initial waiting-only gate count corrections are retained. There is no waived failed check or engine merge.

## Complete evidence and resource constraints

The manifest binds189 raw or losslessly wrapped members (~13.8MB): source/native/build/integration/floor logs, all240 ordinary timing windows, initial and corrected disassembly, controller/configuration, checkpoint recovery and exact-head tooling merge proof. Eight portable archive checks independently verify all bytes, guest observations, runtime/order, medians/minima/floors, actual integration counts, original vtable bytes and target bodies, source invariants and merge gates.

The workspace filled while other work ran. Small source/receipt work used a sparse shared clone on the separate root filesystem; the workspace was never cleaned. Load reached15.09 on four CPUs, with available memory2293MiB. Before archive work, root free2685MiB and available memory3973MiB permitted the small static copies and portable tests. No local engine build, download, execution, benchmark, profiler or new agent ran. Only superseded queued owned tooling runs were cancelled, with IDs retained. One measurement watcher received SIGTERM (cause unknown); its saved checkpoint was safely resumed without a new build or duplicate dispatch.
