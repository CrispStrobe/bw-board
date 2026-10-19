# Landed main: active F0 timing and bus/admission profiling

Core source **`43b2d62f5a0fa24ae0b38a645069f5aaa78af685`** remained remote main
at verification. No engine optimization is introduced here. Tooling landed in
[PR 216](https://github.com/CrispStrobe/bw-board/pull/216) as `002da604`;
hosted runs used tool head `a6d9d785d7224c65a6c2fc1942063de26377122f`.
The deterministic [source build](https://github.com/CrispStrobe/bw-board/actions/runs/36915940413)
and [build info](hosted-build-info.json) bind unmodified NODEJS glue and WASM
`7bd66fe4e926fbf14322621499f3fbddefefae763f61742c4c8c7312113b7a3d`.

## Ordinary 48 MHz F0 results

| Capture | RAM/ALU median / minimum RTx | GPIO polling median / minimum RTx |
| --- | --- | --- |
| VPS primary, Xeon Skylake / Node 20.20.2 | 1.874278 / 1.392027 | 0.316040 / 0.241820 |
| VPS repeat, same host configuration | 1.584328 / 1.037683 | 0.283053 / 0.172831 |
| [Hosted primary](https://github.com/CrispStrobe/bw-board/actions/runs/36960285662), EPYC 9V74 / Node 22.23.3 | 3.014053 / 2.861637 | 0.593817 / 0.582681 |
| [Hosted repeat](https://github.com/CrispStrobe/bw-board/actions/runs/36960470139), EPYC 7763 / Node 22.23.3 | 2.865436 / 2.827110 | 0.658736 / 0.657664 |

**RAM passed every window; GPIO failed every window in all four captures.**
Both guests passed functional tests. Each capture has four tests: three passed,
one correctly failed the GPIO floor, zero skips. Green diagnostic workflows
mean valid evidence capture, not passing 1×. This is not a code A/B or speedup
claim; rates on different hosts/Node versions are not interchangeable.

MIT Cortex-M0 guests execute active arithmetic/RAM operations; the GPIO variant
also polls actual held PA1 IDR and writes PA0 BSRR. Both boot outside timing
and run five 48-million-engine-cycle windows. Receipts check progress, bounded
RAM-store skew, held inputs and outputs. No WFI, delay-loop idle shortcut,
uncounted settling cycles or circuit solver is involved. Cycles are engine
accounting scaled to 48 MHz, **not calibrated silicon CPI**. Production
recommended ticking is unchanged; no observer/debugger is timed. The old
short rounded RAM benchmark remains unchanged and cannot qualify GPIO firmware.

Loaded image hashes and every cycle-indexed observation match across the two
VPS captures and independently across the two hosted captures. ELF hashes
remain provenance; nonloaded temporary-object metadata can vary. Full receipts:
[VPS primary](vps-primary.json), [VPS repeat](vps-repeat.json),
[hosted primary](hosted-primary.json), [hosted repeat](hosted-repeat.json).
Raw ordinary stdout: [VPS primary](vps-primary-ordinary.txt),
[VPS repeat](vps-repeat-ordinary.txt), [hosted primary](hosted-primary-ordinary.txt),
[hosted repeat](hosted-repeat-ordinary.txt). Ordinary stderr was empty.
Hosted runners: [primary](hosted-primary-runner.txt), [repeat](hosted-repeat-runner.txt).
See the [usage/comparison guide](../../LABWIRED-F0-TIMING.md).
This is not all-firmware, all-chip or browser/UI qualification.

## Separate profiles, not qualification timings

Whole-process motion self-sampling attributes:

| Frame | VPS share | Hosted primary share |
| --- | ---: | ---: |
| CortexM `step_batch` | 37.34% | 35.48% |
| `run_t16_fast_block` | 7.89% | 9.88% |
| `run_t16_cached_run` | 6.17% | 8.66% |
| SystemBus `read_u32` | 7.98% | 7.33% |
| `note_mmio_activities` | 4.03% | 5.09% |
| `find_peripheral_index` | 2.74% | 3.78% |

These are **not removable-cost percentages**: initialization, compilation,
warmup and all windows are included; sampling may affect tiering. Independent
**unsampled** motion traces confirm TurboFan compilation of dispatcher, fast
block and bounded run in both environments. Hosted compile times were
124/25/37 ms respectively; VPS times were 585/198/165 ms. These are diagnostics,
not throughput comparisons. The 77,390-byte dispatcher already optimizes;
size alone does not justify another outlining change.

Whole-process F0 profiles include both guests, not isolated GPIO windows.
They identify `service_edge_driven_gpio_devices_cold` for investigation:
5.98% VPS self-sampling / 13.85% hosted. Fast-block/bounded-run shares were
18.65%/17.46% VPS and 16.65%/14.95% hosted. Full summaries and profile hashes
are in primary F0 receipts; sampled stdout is separate for
[VPS](vps-primary-sampled.txt) and [hosted](hosted-primary-sampled.txt).
None of those timings replace ordinary RTx.

[VPS motion extract](vps-motion-profile-extract.json) and
[hosted motion extract](hosted-motion-profile-extract.json) retain module/glue,
profile and raw-file hashes, tier rows and named summaries. These are
**extracts**, not full compiler traces or CPU profiles. Full hosted evidence
remains in run 36960285662's `active-f0-main-profile-diagnostic` artifact
(14-day retention), and local `.f0-main-20261002-hosted-primary`.
Full VPS motion evidence remains in `.f0-profile-main-20261002-trace` and
`.f0-profile-main-20261002-sampled`; the VPS F0 raw profile is in
`.f0-main-20261002-primary`. Local directories are under the LEGO workspace.

## Next optimization targets

1. Repeated fast-path rejection around **live MMIO addresses**. Profile GPIO
   separately before attributing all fast-block samples to failed admission:
   these profiles also include successful RAM work.
2. GPIO write-hook metadata. Source already guards empty resident-device lists,
   then scans `edge_service_addrs()` to detect edge work. `SystemBus::gpio_devices`
   is publicly mutable: a naive build-time “no edge devices” flag could go
   stale and drop real edges. A metadata cache needs a mutation contract,
   conservative fallback and attachment/change regression tests.
3. Ordinary bus reads, preserving clock gates, memory precedence, read-to-clear
   IRQ reconciliation, tracing and observers. Never memoize MMIO values or
   suppress peripheral effects to obtain speed.

Candidates should start from main, not rejected literal variants, and require
differential correctness, actual-WASM integration and repeated same-runner
A/B/B/A for both F0 fixtures and motion. `assertSameF0Guest` supplies loaded-image
and observation comparison; profile percentages are not performance proof.

Verification: 21 local parser/profile/workflow tests passed, zero skips;
actionlint, syntax and whitespace checks passed. Both manual hosted workflows
completed successfully at the intended head, their parser tests passed, and
ordinary captures re-parsed. Broader unrelated BW CI was not claimed passing
at the tooling merge. App pins, hardware acknowledgements/captures and floors
are unchanged. CP13, physical re-capture and browser/worker/debugger acceptance
remain open.
