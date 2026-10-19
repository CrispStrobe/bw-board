# Repeated GPIO-only main profiling, without qualification claims

These captures use unchanged current core main
`43b2d62f5a0fa24ae0b38a645069f5aaa78af685`, original deterministic
[build 36915940413](https://github.com/CrispStrobe/bw-board/actions/runs/36915940413),
original NODEJS WASM `7bd66fe4e926fbf14322621499f3fbddefefae763f61742c4c8c7312113b7a3d`
and original glue `b93d7f484286d64ae8f19d86bf67eb8d4309cf49720cbb06f59557c401b7ad73`.
All runs use pinned Node 22.23.3 and verify both original artifacts before engine
execution. No source optimization, extra optimizer, forced compiler tier, app
pin, published engine or physical acknowledgement change occurs.

## All ordinary timings

Each workflow first runs unchanged RAM+GPIO acceptance, then independent
ordinary and sampled GPIO-only processes. Every ordinary guest retains its
five 48M-cycle windows, image hashes, progress/checksum/held-input/BSRR receipts,
actual exit/floor verdict and zero skips. The GPIO-only harness differs from
the original only by selecting GPIO; it neither compiles nor executes the RAM
guest. Loaded GPIO image hashes and all cycle-indexed observations agree across
the both-guest, GPIO-only ordinary and GPIO-only sampled runs. Different process
rates are not an optimization A/B. No VPS engine work was allowed by load/disk
headroom; only small receipt/profile artifacts were downloaded.

Values are median / minimum RTx. Every window must meet ≥1×; these are engine
cycles scaled to nominal 48 MHz, not silicon-calibrated CPI or all-target speed.

| Hosted run | CPU model | Ordinary capture | Median / minimum | Every-window floor |
| --- | --- | --- | --- | --- |
| [37048440399](https://github.com/CrispStrobe/bw-board/actions/runs/37048440399) | AMD EPYC 7763 64-Core Processor | ordinary RAM | 2.884187 / 2.787478 | pass |
| [37048440399](https://github.com/CrispStrobe/bw-board/actions/runs/37048440399) | AMD EPYC 7763 64-Core Processor | ordinary GPIO (both-guest process) | 0.644989 / 0.636066 | fail |
| [37048440399](https://github.com/CrispStrobe/bw-board/actions/runs/37048440399) | AMD EPYC 7763 64-Core Processor | ordinary GPIO-only | 0.607899 / 0.598714 | fail |
| [37048740665](https://github.com/CrispStrobe/bw-board/actions/runs/37048740665) | AMD EPYC 7763 64-Core Processor | ordinary RAM | 2.886744 / 2.817273 | pass |
| [37048740665](https://github.com/CrispStrobe/bw-board/actions/runs/37048740665) | AMD EPYC 7763 64-Core Processor | ordinary GPIO (both-guest process) | 0.641624 / 0.632403 | fail |
| [37048740665](https://github.com/CrispStrobe/bw-board/actions/runs/37048740665) | AMD EPYC 7763 64-Core Processor | ordinary GPIO-only | 0.666367 / 0.655988 | fail |
| [37049199265](https://github.com/CrispStrobe/bw-board/actions/runs/37049199265) | AMD EPYC 7763 64-Core Processor | ordinary RAM | 2.868004 / 2.763728 | pass |
| [37049199265](https://github.com/CrispStrobe/bw-board/actions/runs/37049199265) | AMD EPYC 7763 64-Core Processor | ordinary GPIO (both-guest process) | 0.644667 / 0.639661 | fail |
| [37049199265](https://github.com/CrispStrobe/bw-board/actions/runs/37049199265) | AMD EPYC 7763 64-Core Processor | ordinary GPIO-only | 0.645449 / 0.604564 | fail |

## Valid whole-process GPIO-only attribution

| Self-sampled frame | First capture | Retry capture |
| --- | --- | --- |
| step_batch | 22.82% | 24.80% |
| run_t16_cached_run | 20.33% | 20.02% |
| service_edge_driven_gpio_devices_cold | 11.56% | 12.26% |
| write_u32 | 7.76% | 7.21% |
| read_u32 | 4.02% | 3.45% |
| run_t16_fast_block | 2.39% | 2.43% |

These profiles include initialization, guest compilation, functional tests,
warm-up, tiering and timing windows. They are not steady-state-only profiles.
Self-sample shares are attribution, **not removable costs**, confidence bounds
or verified speedups. Sampling can change timings and tiering; sampled RTx never
replaces ordinary floor measurements. Raw profiles are included, with original
hashes, exact tool source and recomputable sample/time-delta summaries. Named
WASM frames may share generated code; names alone do not prove a source call
site. The prior census separately shows overwhelmingly memoized failed block
probes, so its occurrence counts must not be equated with profile cost.

## Failed repeat preserved

[Run 37048740665](https://github.com/CrispStrobe/bw-board/actions/runs/37048740665)
completed valid ordinary and sampled GPIO guest proofs but attribution failed:
its 7751-sample raw profile has one **−2 µs time delta at index 7742**. The strict
parser rejects it. The workflow failure, partial receipt, original raw profile,
all timing outputs and hash-bound failure explanation remain here. No sample
was clamped, dropped or used to manufacture a valid summary. The old receipt
had not persisted the profile hash before throwing; the raw file survived.
The follow-up tool saves its hash and any attribution error before rethrowing.

First two runs use tool `d06d8c183d3c11d3ab65eb20a6b9c8b61c985ea2`;
retry uses `3a6562ff588b65293bcae5afeafea0d59b63bc14`. The latter changes only
error/identity persistence, not harness execution or the shared profile parser.
The retry passes actual evidence validation. A green diagnostic means successful
capture, not passing GPIO speed or all-board qualification.

## Next source experiments

1. Test a **live** no-edge gate before the outlined GPIO hook. Preserve current
   metadata queries and analog-mux/timer-edge ordering; do not cache public,
   mutable device inventory. Require attachment/removal/live-address changes,
   nested-edge and real display/sensor routing regression tests. Avoiding the
   cold call is a hypothesis, not a promised 12% improvement.
2. Inspect the bounded cached executor, which remains about 20% of both valid
   profiles. Preserve every-retirement budget, IRQ/observer/debugger, MMIO and
   self-modifying-code invariants. Do not turn peripheral accesses into RAM
   chunks or memoize MMIO values.
3. Any new source must start from unchanged main, without stacking the mixed
   admission variants, and pass actual-WASM correctness plus repeated ordinary
   Node 20/22 forward/reverse RAM/GPIO/motion acceptance. Keep the ≥1× floor and
   all physical captures/2026-10-31 acknowledgements unchanged until promotion
   is justified. Hardware re-capture and the all-target ≥1× goal remain open.
