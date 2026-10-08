# Stock xv6 rollback-allocation diagnostic: source checkpoint

This checkpoint contains an exact reversible heap-sampling derivative of the
held stock probe and a bounded sampling-heap parser. It is **not connected to a
hosted guest runner or workflow**. No xv6 child, profiler support control, guest
comparison, allocation result, or performance result has run for this branch.

The derivative admits only the held probe SHA-256
`0f283611891e0afbee5359e51b246a2572637257c297815f7ae2c6917ddfc93a`.
It brackets the original guest loop with Inspector `HeapProfiler` sampling,
requests both collected-by-minor-GC and collected-by-major-GC flags, limits the
raw profile to 8 MiB, preserves the original guest exception before a profiling
failure, and verifies that removing the three exact edits reproduces the held
probe bytes. A hosted short-lived-allocation control must verify support for
both flags; merely accepting their protocol parameters is insufficient.

The parser refuses duplicate JSON keys, invalid graph or sample references,
nonfinite values, negative or excessive sample sizes, and source roles whose
bytes differ from the admitted inventory. It reports sampled allocation bytes
by exact source role and unresolved frames separately. These are diagnostic
samples, not total allocations or measured CPU cost.

CPU-free local checks:

```sh
node scripts/xv6-js-rollback-profile/derive-control.mjs "$PWD"
PYTHONDONTWRITEBYTECODE=1 python3 -B scripts/xv6-js-rollback-profile/profile-control.py
```

The next source slice must bind a fresh free MIT xv6 4 MiB PSE/APIC workload,
one unprofiled reference and at least two sampled children to the same
authenticated emulator, media, command, and semantic projection; verify both
GC flags on the hosted Node runtime; retain raw profiles and first failures;
and gate report-only artifacts before upload. No speedup or adoption follows
from this checkpoint.
