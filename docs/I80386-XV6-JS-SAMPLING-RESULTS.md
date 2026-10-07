# xv6 functional JavaScript sampling result

The [actual diagnostic run 37639569357](https://github.com/CrispStrobe/bw-board/actions/runs/37639569357) passed all six guest outcomes: two fresh unprofiled references and four sampled children. The full reported CPU, RAM and disk hashes, serial/input, interrupt prefixes and device outcomes agree across ordinary JavaScript and the opt-in protected32 dispatcher. This is a profiling checkpoint, not a new throughput measurement or default-backend decision.

[PR431](https://github.com/CrispStrobe/bw-board/pull/431) harness source is `59229dc3bb0f266da2fb1358867cdb1d2ea82f70`. The unchanged executed emulator and original probe source is `22ca742ed60e1350ed96110986a09b2ce84620ac`, also used by the [earlier paired timing](I80386-XV6-JS-PAIRED-RESULTS.md). One authenticated, reversible probe derivative brackets the existing guest loop with Node Inspector sampling. The hosted run built a fresh stock MIT xv6 image at `eeb7b415dbcb12cc362d0783e41c3d1f44066b17`, using the explicit 4 MiB PSE/APIC profile and `forktest` command. This profile is not strict original 386DX hardware.

## Observed samples

The host reported AMD EPYC 9V74, four logical CPUs, Node 20.20.2 and Ubuntu GCC 13.3.0. Percentages below are **leaf sample counts**, not precise execution-CPU cost shares. Only canonical JavaScript URLs whose source bytes match the immutable inventory receive a source role. Native, WASM and blank leaves remain unresolved.

| Sample | All leaves | CPU JS | Board/device JS | Dispatcher JS | Other authenticated JS | Negative deltas |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| First ordinary | 10,015 | 80.38% | 9.74% | 0% | 1.55% | 1 |
| Second ordinary | 9,926 | 81.10% | 8.90% | 0% | 1.62% | 0 |
| First dispatcher | 6,840 | 52.15% | 5.83% | 13.85% | 17.46% | 1 |
| Second dispatcher | 6,892 | 52.87% | 6.28% | 12.96% | 17.25% | 0 |

The remaining leaves include the probe, garbage collection, Node runtime and unresolved frames. Both first profiles contain one negative time delta. Their summaries correctly suppress every time-weighted bucket; their sample counts remain available. Sampling perturbs execution, so neither profile durations nor differing sample totals replace the seven-pair timing benchmark.

Ordinary CPU leaves repeatedly identify `_stepInstruction`, `step`, `_translate`, `_decodeEA`, `_fetch8` and `_linear`. The two ordinary profiles have 2,446/2,438 `_stepInstruction` leaves, 753/736 `_translate` leaves and 744/749 `_decodeEA` leaves. The dispatcher profiles also show JavaScript block dispatch and byte-block execution work. These observations prioritize source inspection; they do not establish the speedup available from changing a particular function or attribute a WASM leaf to an authenticated module.

## Next bounded optimization

Inspect instruction dispatch, effective-address decoding and paging/fetch admission at the exact qualified source before choosing one change. Preserve segment limits and privilege checks, page permissions/accessed/dirty behavior, precise fault restart, self-modifying-code invalidation and device/interrupt boundaries. Use an independent instruction or machine oracle for the changed behavior. Then repeat the unprofiled same-workload semantic and paired timing gate on a fixed source and media identity. Reject an optimization that changes guest outcomes or fails its declared speed gate. Do not infer protected-mode game or GUI compatibility from this xv6 diagnostic.

## Evidence

[Artifact 11492205431](https://api.github.com/repos/CrispStrobe/bw-board/actions/artifacts/11492205431) is 179,766 bytes, SHA-256 `903225540f093c353a5436c064bc541c3d8585f7fd106c024c6bf9c17e6b8da1`. The original ZIP contains 41 unique members and four raw V8 profiles. The root independent stdlib audit verified inventory hashes, immutable harness and emulator source roles, six semantic reports, profile graph/sample identities, source-role classification, counts and negative-delta handling without importing the producer parser or replaying a guest. A second independent stdlib audit agrees on the source, guest outcomes, profile counts and timestamp boundary. The [small summary receipt](receipts/2026-10-07-xv6-js-sampling.json) preserves per-profile counts and CPU leaf names without hosted checkout paths.

RAM, disk images, kernel binaries and a complete interrupt/bus trace are not included in this packet. Equal reported hashes are not an independent reconstruction of memory contents. No physical 16 MHz calibration, game frame rate, general OS compatibility or new speed claim follows from this diagnostic.
