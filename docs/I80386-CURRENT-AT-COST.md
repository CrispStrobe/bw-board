# Current ordinary JS 386 cost capture

The [selected hosted capture](https://github.com/CrispStrobe/bw-board/actions/runs/40057621920)
completed successfully at source
`0d7f046479176fcb3528731fec3fa0f99e4cbb06`. Its four original children,
source/import bytes, resources and raw V8 profiles passed the standalone
reader and separate official run/job/artifact audit. Source landed through
[PR675](https://github.com/CrispStrobe/bw-board/pull/675).
The existing authored five-operation loop is run for one million retired
instructions after a separate fixed warmup. The independent golden is
AX=65534, BX=65535, IP=0 and memory word 65535. The core's one million and
AT's six million charges are **synthetic model counts**, not CPU seconds or a
calibrated physical 16 MHz 386DX clock.

Four serial hosted children collected
unprofiled core and AT timing plus distinct V8 profiles for attribution.
The runner records startup, warmup, setup, warmed-loop and whole-child CPU
and wall facts separately, under one CPU, 1 GiB without swap, 60 seconds
per child and 8 MiB per profile. The standalone original reader checks
source/import bytes, Node identity, semantic/device goldens, resources,
profiles and finite cleanup. An external audit must still bind official
run, job, steps, artifact and exact source before using any result.

The AT checks preserve PIT fractional state, PIC request/mask/in-service
state and CPU IF eligibility. An RTC pending flag with interrupts disabled
does not establish interrupt delivery. Profile samples cannot be treated as
exact CPU cost shares. This diagnostic neither adopts an optimization nor
qualifies a guest, physical RTx, general OS behavior or a speedup. A later
source change needs its own narrow claim, paired measurements and affected
guest qualification.

## Observed authored-loop throughput

The runner reported an AMD EPYC 9V74 CPU; the job used one effective CPU,
Node 22.23.3 and the fixed resources described above. Each timing child warmed
25,000 instructions on separate state before measuring one million instructions.

| Path | Warmed loop | Million instructions/s | Whole-child CPU | Whole-child wall |
| --- | ---: | ---: | ---: | ---: |
| Ordinary core | 0.221171 s | 4.521 | 0.376782 s | 0.428764 s |
| Ordinary AT | 0.287148 s | 3.483 | 0.472163 s | 0.524154 s |

These values describe this five-operation loop and this host/runtime. Startup,
module loading, warmup and setup are included in whole-child times, not in
the warmed-loop column. The profiled children are separate observations; do
not substitute their times for the unprofiled values. No Kaggle CPU/GPU
measurement or physical 16 MHz 386 RTx conversion is established.

The raw V8 profiles contain 276 core samples and 362 AT samples. The core
records `_stepInstruction` 53 times, `step` 43, `_readLinear` 26 and
`_decodeEA` 17; AT records 46, 45, 17 and 24 respectively. These sampled
counts include startup and warmup and are neither exact CPU cost shares nor
allocation counts. They suggest examining CPU dispatch and operand/memory
helpers before attempting a broad device-scheduler rewrite.

The first proposed follow-up specializes the contiguous-page two-byte read
arm while preserving ordered callbacks and faults. Its
[claim](https://github.com/CrispStrobe/bw-board/pull/677) and
[task contract](https://github.com/CrispStrobe/bw-board/blob/05f080fd765991a9232b8686439184362d8043e4/docs/X86-NEXT-LANES.md#ordered-16-bit-scalar-read-candidate)
require semantic controls, an unchanged strict paired CPU/wall gate and
affected clean protected guest qualification before adoption. The capture
provides a baseline and attribution evidence; it proves no optimization gain.

## Ordered word-read candidate: unadopted

The one selected [paired run](https://github.com/CrispStrobe/bw-board/actions/runs/40067572890)
tested source `55917c48dffe0c7c743388024481ef0a47a7c76c` with pinned
Node 22.23.3, one effective CPU and all eighteen children. The job failed.
The unchanged independent reader refused the final inactive-unit readback:
the stop command returned zero, but the later unit status still reported a
failed state with an old main PID while the cgroup and PID censuses were empty.
That terminal observation has not been resolved, and the reader result is not
an admission.

An independent diagnostic calculation from the retained measurements shows
median whole-child CPU A/B **1.06475**, minimum CPU A/B **0.99946**, and median
wall B/A **0.94318** over the seven measured pairs. The unchanged gate requires
median CPU at least 1.03, **all seven** CPU ratios greater than 1, and median
wall at most 1.02. One CPU pair fails, so the candidate is **unadopted** even
apart from the reader refusal. Its median warmed-loop ratio of 1.07285 is a
diagnostic, not a substitute for the whole-child gate.

This run did not capture the physical CPU model. The earlier baseline's host
model cannot be assigned to this paired job. No physical 386 RTx, general
workload speedup, guest qualification or merge approval follows from these
measurements. The one-shot run will not be replayed. A follow-up should retain
the failed original while separately reviewing the reader's failure-only
terminal handling, select a larger workload before any different paired
measurement, capture the actual host hardware identity, and profile a new
narrow optimization proposal. Its gates and affected clean guest checks remain
required.
