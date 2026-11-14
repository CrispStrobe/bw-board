# Opt-in dispatcher measurements — 2026-11-14

The later combined candidate passed the [actual xv6 forktest comparison](xv6/README.md):
6.45% lower CPU time and 7.68% lower wall time, with matching guest outcomes.
The authored-loop results below describe the earlier batch-only candidate.

Baseline: `d19b5e4d2b8aa0f025fd7a3512db3252e470433d`.
Candidate product: `0a5c49e34ecf7654e1974c0433249cda1a491f32`, increasing
the existing opt-in batch limit from 16 to 64. Later test/harness commits
retain the measured dispatcher SHA-256
`40bd9da01f46f7e0dd2c8b7d423d319e6ff52622d57e09a278e188111e36c649`.

| Workload | Baseline CPU → candidate | CPU reduction | Baseline wall → candidate | Wall reduction |
|---|---:|---:|---:|---:|
| Register MOV/CMP/JNZ | 1.282532 → 0.900839 s | 29.76% | 1.163170 → 0.760233 s | 34.64% |
| Indexed RAM load/CMP/JNZ | 1.495573 → 1.031629 s | 31.02% | 1.254008 → 0.771848 s | 38.45% |

These are mean whole-child CPU and wall times over seven measured rounds;
all seven candidate pairs improved in both metrics for both workloads.
Each workload retained 27 fresh serial children: two excluded rounds and
seven measured rounds, with ordinary JS, baseline and candidate arms in
rotated/reversed order. Each child executes 9,999,999 retirements after
25,000 throwaway warmup retirements. A 30-second child limit applies.

Both series compare selected CPU/cycle/device state and complete RAM hashes.
The register series captured selected CPU fields in its timed children;
full instruction-snapshot equality was checked in a separate control and
does not enlarge the timed observation. The indexed-memory series captures
full instruction snapshots in every timed child. `control-*.json` belongs
only to the register series and is excluded from performance aggregates.

The subdirectories retain unchanged samples, raw child stdout/stderr,
metadata, summaries, original child source and standalone numeric audits.
No private paths were present in these selected originals; unrelated local
controllers, host paths and pilot runs are omitted. `inventory.json` hashes
the retained files. Recompute each summary without executing guest code:

```sh
python3 docs/benchmarks/x86-dispatch-2026-11-14/register/audit.py
python3 docs/benchmarks/x86-dispatch-2026-11-14/indexed-memory/audit.py
```

[Portable rerun instructions](../../../scripts/bench-i80386-dispatch/README.md)
use a consolidated harness with full snapshots for both workloads.

Node v24.22.1 ran on a shared four-logical-CPU Intel Xeon Skylake host,
affinity 0–3, without CPU isolation. Load changed during both series;
metadata and summaries retain those observations. Whole-child CPU is a
serial child-resource delta and wall includes process overhead. Execution
metrics and all raw samples are retained for comparison.

These authored paged protected32 microbenchmarks and the separate xv6 result
do not establish general OS performance, calibrated 386 timing or
default-backend adoption.
