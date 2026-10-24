# Current ordinary JS 386 cost capture

This is an inactive hosted measurement candidate for the current ordinary JS
core and AT paths. It uses the existing authored media-free five-operation
loop, warmed on a throwaway CPU/machine before each one-million-instruction
child. Four serial children run in order: core timing, core V8 profile, AT
timing, AT V8 profile. Timing results are read only from the unprofiled
children; V8 samples are attribution evidence, not paired timing.

The fixed architecture golden is AX=65534, BX=65535, IP=0 and memory word
65535. The core reports one million synthetic charges; AT reports six million
synthetic scheduling charges. The AT reader checks PIT phase, PIC request,
mask and in-service state, CPU IF, RTC, CGA and keyboard facts. Pending device
state does not prove an interrupt was delivered.

The workflow's measurement job is literally false gated. Its active job runs
only pure source controls. On a separately reviewed activation, the hosted
parent verifies exact Git/live source and the 35-file current import closure,
the exact selected Node 22.23.3 executable extent/hash before invoking it,
and pre/post resource facts. It retains startup, warmup, setup,
warmed loop, whole-child CPU/wall, wait4, stream prefixes, V8 profile bytes
and first/secondary cleanup facts. It reuses two immutable, SHA-pinned
resource/Git helpers from the prior reviewed code16 diagnostic; their runner
and evaluator entry points are not invoked.

Each child has one effective CPU, a 1 GiB cgroup without swap, a 60 second
deadline, bounded stdout/stderr, and an 8 MiB V8 profile file-size limit
verified in the child. In-service and outside-service cgroup originals must
show no nested or dying groups before cleanup is accepted. A standalone
reader checks all four original roles and exact semantic goldens without
importing the producer or running the workload. Source and official run,
job, step and artifact identities still need external admission. The reader
reports neither physical 386 timing nor a measured optimization gain.

Pure controls:

```sh
node --test test/i80386-current-at-cost.test.mjs
/usr/bin/python3 -I -B scripts/i80386-current-at-cost/run.py --controls
/usr/bin/python3 -I -B scripts/i80386-current-at-cost/reader.py --controls
```
