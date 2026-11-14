# Actual xv6 forktest — 2026-11-14

Candidate `1cf0952ab61799e490d5f3f39236fde8548c45d1` reduces mean whole-child
CPU time by **6.45%** and wall time by **7.68%** against current-main opt-in
dispatch at `d19b5e4d2b8aa0f025fd7a3512db3252e470433d`. Both metrics improve
in all seven measured pairs, exceeding the requested 5% reduction in each.

| Execution | Baseline CPU (s) | Candidate CPU (s) | CPU ratio | Baseline wall (s) | Candidate wall (s) | Wall ratio |
|---|---:|---:|---:|---:|---:|---:|
| Opt-in native dispatch | 14.924989 | 13.962650 | 0.935522 | 11.387014 | 10.512421 | 0.923194 |
| Ordinary interpreter | 20.411238 | 20.117041 | 0.985587 | 17.493994 | 17.242858 | 0.985644 |

The ordinary interpreter improves in six of seven pairs for each metric;
its 1.44% CPU/wall reduction does not meet the 5% target on its own.

This is the combined candidate: batch limit 64, the guarded ordinary instruction
transaction, direct dispatcher lookup cache, near conditional branches with CS
bounds, cold translation retry, and native byte-memory TEST. The comparison
does not isolate the contribution of each change. Earlier results on different
VMs cannot be subtracted to estimate those contributions.

The unchanged benchmark builds the pinned MIT xv6 guest and runs the same 4 MiB
stock `forktest` with the free BIOS. Four arms run serially in alternating forward
and reversed order. Two warmup rounds are excluded; seven measured rounds give
36 total fresh guest processes. Each completes exactly 24,338,279 instructions.
All reported CPU snapshots, full RAM/disk hashes, serial output, screen,
interrupts, LAPIC/IOAPIC and other device observations match across all 36.
All children exit successfully within the original resource/time bounds.

Independent archive inspection verifies the source inventories, every retained
comparison-file digest, guest equality, raw means, ratios and favorable pairs.
The returned 79 runtime hashes per source also match the frozen task and original
Git blobs. Candidate native retirements are 17,403,877 versus 16,428,211 for the
baseline; every repetition within each arm has identical native counters.

Kaggle CPU execution used four logical Intel Xeon CPUs at 2.20 GHz, Node
22.23.4, GCC 13.3.0 and Python 3.13.18. These are observations on this workload
and host configuration. They establish neither calibrated physical 386 timing
nor general OS performance; the dispatcher remains opt-in.

`samples.json` retains all numeric child CPU/wall observations, including the
excluded warmups. `summary.json` records independently verified results and the
SHA-256 of the retained original archive. `source-bindings.json` records both
original commits and runtime hashes. Original guest receipts remain privately
retained. Recompute the numeric result without running a guest:

```sh
python3 docs/benchmarks/x86-dispatch-2026-11-14/xv6/audit-samples.py
```

Source controls include the original 90 focused TEST/window/native controls and
81 final focused native/ordinary-transaction checks, all passing. Existing
repository CI still requires an owner decision under the instruction forbidding
`ci:full`; no full-suite dispatch or merge accompanies these measurements.
