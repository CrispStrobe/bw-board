# Current ordinary JS 386 cost capture

This is a separately admitted hosted measurement of the current ordinary JS
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

The workflow has separate source-control and owner-selected capture routes.
The selected one-shot capture is complete; do not replay its label. The hosted
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

## Capture activation candidate — 2026-10-24

The distinct capture label route is enabled in this follow-up source. It still
requires exact final-head CI, an externally reviewed frozen source/event and
one owner-applied label. No capture, physical RTx or measured gain is implied
by activation. The current CPU source has separately passed bounded xv6
compatibility cases; those do not qualify this diagnostic or the GUI. The
media-free measurement can proceed independently of QEMU setup and browser
font provisioning. Keep every first failure and acquire each official original
once for independent byte-only review.

## Retained capture — 2026-10-24

[Run40057621920](https://github.com/CrispStrobe/bw-board/actions/runs/40057621920),
job `120763987558`, completed four children at exact source `0d7f046479176fcb3528731fec3fa0f99e4cbb06`.
Artifact `12545743584` has 57,291 ZIP bytes and SHA-256
`e0ba0756e9e031c94f791b8e02c1ac2f81e2b506b1052e0d46eee83393a9c5ba`.
Its 43 originals, raw profiles and exact source graph passed independent
reading and official metadata joins. The original-only reader itself leaves
`officialMetadataAuthenticated` false; the separate external audit establishes
that join without changing the retained original report.

See the [result guide](../../docs/I80386-CURRENT-AT-COST.md) for the measured
4.521/3.483 million instructions/s core/AT loop throughput, host/runtime,
startup separation and sampled-frame limits. Capture source and input hashes
remain bound to that historical head even when these notes advance. There is
no paired speedup, physical RTx or full-OS result.
