# Opt-in 386 dispatcher microbenchmarks

Requires Python 3, Node and Git on Linux or macOS, plus two bw-board
checkouts with tracked `src` and `wasm` files. No dependencies, compilation
or external guest media are required. Run from the repository root:

```sh
python3 scripts/bench-i80386-dispatch/run.py \
  --base /path/to/baseline --candidate /path/to/candidate \
  --out /path/to/new-results
```

Both authored workloads use paged protected32 code: a register MOV/CMP/JNZ
loop and an indexed RAM load/CMP/JNZ loop. Each child runs 25,000 excluded
warmup retirements on a discarded machine, then 9,999,999 retirements on a
fresh machine. Each workload runs two excluded rounds followed by seven
measured rounds, rotating or reversing ordinary JS, baseline dispatcher and
candidate dispatcher order. Both dispatcher arms use their source defaults.
The output directory must not exist; each child has a 30-second timeout.

For a short smoke check, add:

```sh
--samples 1 --warmup-rounds 0 --steps 3000 --warmup-steps 300
```

Use `--workload register` or `--workload indexed-memory` to select one loop.
`--help` lists count, timeout and Node options. Changed configurations are
recorded and must be reported separately; smoke runs establish no speedup.

The harness retains raw child stdout/stderr, samples, summaries, host/runtime
metadata and source hashes. Metadata includes the supplied checkout and output
paths; remove local path details before sharing generated results publicly.
It checks complete CPU instruction snapshots,
RAM hashes and selected device state across arms. Source drift, untracked
runtime source or unequal semantics fails the run. Whole-child CPU uses
serial `RUSAGE_CHILDREN` deltas; wall includes launch, setup, reporting and
wait. Execution metrics cover only the retirement loop. Ratios compare means
and also report favorable pairs. No CPU isolation is imposed.

[Retained measurements](../../docs/benchmarks/x86-dispatch-2026-11-14/README.md)
describe the original runs and their observation limits. Those runs used the
retained workload-specific children; this portable harness was consolidated
afterward. These are shared-host microbenchmarks. Historical xv6 `forktest`
was not remeasured; results do not establish general guest performance,
physical 386 timing or default-backend adoption.
