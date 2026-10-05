# Private per-word dispatch: paired CPU gate rejected

External licensed-guest notes and historical context are retained in the [private documentation archive](https://github.com/CrispStrobe/brickwright-firmware-private/tree/master/public-documentation-archive/2026-10-04). Public examples and instructions use freely licensed or freeware software.

The single hosted 18-child gate completed with full fixed-fixture semantic parity, but failed its predeclared performance criterion. Keep unchanged `fe1` as the baseline; the private dispatch candidate is not adopted or retried.

| Measured pair | Baseline process CPU (µs) | Dispatch process CPU (µs) | Favorable |
|---|---:|---:|---|
| 1 | 163701 | 151196 | yes |
| 2 | 157539 | 149251 | yes |
| 3 | 161480 | 169815 | no |
| 4 | 156715 | 151345 | yes |
| 5 | 152524 | 152567 | no |
| 6 | 152765 | 154095 | no |
| 7 | 154625 | 152174 | yes |
| Mean | 157049.857143 | 154349 | 4 of 7 |

The nominal mean difference was 1.719745% less process CPU. The gate required at least 10% less mean CPU **and all seven pairs favorable**. Two warmup pairs were discarded, followed by seven alternating measured pairs; all samples are retained. All 18 children passed complete stored native/board/RAM/physical-counter comparisons. The unchanged scheduler produced a full 166-word native snapshot at each of 445 resumes; captures retain reset, final and six selected checkpoints, rather than an array of every resume snapshot. The whole-process CPU window includes local callbacks, snapshots, six checkpoints and GC, and excludes creation, settlement and final serialization. Native trace, host journal and Inspector profiling were disabled during timing.

[Run 37042592639](https://github.com/CrispStrobe/bw-board/actions/runs/37042592639) used reviewed tooling head `7a24f7d4f1057e5e9523d0f2f23d426bb3b40476`, baseline `fe1eff2039520536350922a2164c8bbe29404c68`/103 inputs and dispatch runtime `2c688e69cae516b9749d70a126a3b474707d5cb7`/112 inputs. Both reused the original CI addon with SHA `8d9c83fcc3c42c2c94d17782ae42c152c52fcb2e833c31decc4bfee2af5aa841`; no native core rebuild or default switch occurred. Exact reconstruction, portable path derivatives and separate compiled/runtime provenance are retained with the [preparation record](I80386-OWNED-DISPATCH-CPU-GATE-PREPARATION.md).

The hosted machine reported AMD EPYC 9V74, four logical CPUs, Ubuntu 24 and Node 22.23.3. Quota paths were missing or unreadable; that does not establish unlimited quota. Absolute timings are not comparable to the earlier EPYC 7763 bulk experiment. This result is not combined with earlier gains or rejected candidates, and establishes no full broader guest/AT qualification, physical-clock RTx or progress to 10×.

The independent actual audit passed 3,914 checks, with its addendum retained; the separate root semantic/math audit passed 307 checks. The [lossless receipt index](receipts/i80386-owned-dispatch-cpu-negative-20261002/index.json) binds 210 selected files, including all 18 small captures, inputs, exits, streams, provenance, original build records and audits. [External origins](receipts/i80386-owned-dispatch-cpu-negative-20261002/external-origins.json) identify 208 byte-exact originals. [External retention](receipts/i80386-owned-dispatch-cpu-negative-20261002/external-retention.json) binds six larger binary archives/addons without vendoring them. Official artifact `11243860198` has ZIP SHA `73b99f1a5328707e3a613570f588548d66057fb6f4ff6f309d87660a3eb3c5d8` (14,841,836 bytes).
