# Stock xv6 rollback-allocation diagnostic

This source checkpoint contains an exact reversible heap-sampling derivative of
the held stock probe, a bounded sampling-heap parser, and a dedicated hosted
runner and label-only workflow. The [first hosted attempt](https://github.com/CrispStrobe/bw-board/actions/runs/37888206087)
stopped in the support control before any xv6 child: its minor baseline retained
4,096 targets, 3,328 dead targets, 46 minor and 3 major GC events. It did not
qualify collected-object sampling or a guest result. This follow-up's corrected
support schedule is source-only and unrun.

The derivative admits only the held probe SHA-256
`0f283611891e0afbee5359e51b246a2572637257c297815f7ae2c6917ddfc93a`.
It brackets the original guest loop with Inspector `HeapProfiler` sampling,
requests both collected-by-minor-GC and collected-by-major-GC flags at a
predeclared 128 KiB sampling interval, limits the raw profile to 8 MiB,
preserves the original guest exception before a profiling failure, and
verifies that removing the three exact edits reproduces the held probe bytes.
A hosted control checks minor and major collection separately. The corrected
minor case uses two fixed 64-target cohorts, crosses an event-loop turn after
each WeakRef creation, and bounds each cohort to eight 128-array pressure
blocks. It requires every target in each cohort to die after an observed minor
collection, with no major collection anywhere in the case. The support-only
child uses a pinned Node 20.20.2 anti-inlining flag to keep the allocation
factory visible in sampled stacks; it checks the actual V8 option list and
records its process arguments before sampling. This flag does not alter the
qualified guest probe. Each single-flag case must retain
samples of short-lived arrays after the matching observed GC kind, while a
no-flags baseline does not. Ambiguous GC behavior refuses qualification. The
major case keeps its targets strongly reachable
until immediately before a forced major collection and refuses an intervening
minor collection. Each case writes its bounded raw profile and filtered GC
timeline/dead-target facts before causal refusal, so an incomplete first run
still retains those originals. All four control profiles are required for a
successful support receipt; an independent reader can recompute the result;
accepting protocol parameters alone is insufficient.

The parser refuses duplicate JSON keys, invalid graph or sample references,
nonfinite values, negative or excessive sample sizes, and source roles whose
bytes differ from the admitted inventory. It reports sampled allocation bytes
by exact source role and unresolved frames separately. These are diagnostic
samples, not total allocations or measured CPU cost.

The hosted runner authenticates a pinned free MIT xv6 4 MiB PSE/APIC image,
the held ordinary-JavaScript emulator revision and probe, one unprofiled fresh
reference and two fresh sampled children. It requires the same complete
reported CPU, RAM/disk hashes, serial/input and interrupt/device projection
for all three. These are reported hashes; the runner does not independently
reconstruct guest RAM. The source manifest binds the exact new harness paths,
immutable qualified helper bytes, and the inherited recursive guest source
inventory. The artifact inventory excludes executable and image roles even on
failure.

CPU-free checks:

```sh
node scripts/xv6-js-rollback-profile/derive-control.mjs "$PWD"
PYTHONDONTWRITEBYTECODE=1 python3 -B scripts/xv6-js-rollback-profile/profile-control.py
node scripts/xv6-js-rollback-profile/support-control.mjs
PYTHONDONTWRITEBYTECODE=1 python3 -B scripts/xv6-js-rollback-profile/source-control.py
PYTHONDONTWRITEBYTECODE=1 python3 -B scripts/xv6-js-rollback-profile/run-control.py
PYTHONDONTWRITEBYTECODE=1 python3 -B scripts/xv6-js-rollback-profile/inventory-control.py
```

The next hosted run must establish whether Node 20.20.2 actually samples
collected short-lived objects with both requested flags under this corrected
support-only schedule. Unsupported behavior,
missing samples, malformed profiles or a semantic difference refuse
qualification and retain bounded original reports. This experiment does not
time a performance candidate or establish a speedup.
