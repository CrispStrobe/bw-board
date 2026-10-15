# Isolated width-mask public paired result

Updated 2026-10-15. The sole unprofiled [run38699840269](https://github.com/CrispStrobe/bw-board/actions/runs/38699840269)
succeeded. Root and independent peer original-packet audits passed. [CPU PR594](https://github.com/CrispStrobe/bw-board/pull/594) is READY
at unchanged `f6863484`, with mandatory READY-transition CI still pending.
Measurement [PR601](https://github.com/CrispStrobe/bw-board/pull/601) merged as
`503ab56359f4968ea59deaf77933102cd0bc7a41` after all nine enabled checks passed.
CPU PR594 remains unmerged; source adoption has not occurred.
The affected hosted xv6 and original full-CI checks passed. This page records a measured CPU candidate, not CPU adoption or a consumer-pin
update.

The [published measurement source](https://github.com/CrispStrobe/bw-board/tree/f88f366207a98ad7dc7bfde6047ed295760f482f/scripts/i80386-width-mask-paired)
is `f88f366207a98ad7dc7bfde6047ed295760f482f` ([PR601](https://github.com/CrispStrobe/bw-board/pull/601)).
Arm A is `3646417a959b5aa9f93ac446398ea9cacd5a6da5`, CPU SHA256
`2303557f35ad56d8101eb96ffc8749fa4d64338425726027d70bd64a6b10d4ba`.
Arm B is `f6863484d02b4c4b0ce56415054f2e6a0c154097`, CPU SHA256
`8f92cc4f8117d2371b493a7ee5a49dbf0245d1367f050194680f68a1454a9846`.
The only CPU change adds literal 8/16-bit masks; width 32 and fallback arithmetic
remain unchanged. Both 43-row source maps and nine common publication roles
joined original Git/live declarations; no scalar-EA candidate is included.

Each child executes 100000 passes of the authored 24-instruction mixed 8/16/32-bit
ALU stream: 2.4M retired instructions, 10.6M fetched bytes, 1.4M operand reads and
1.4M writes. Independent flags/register/address/work/full-memory goldens passed
for all 18 children. Four ABAB warmups precede seven measured AB,BA,AB,BA,BA,AB,BA
pairs. Whole-Node wait4 user+system CPU and matching monotonic wall include
setup, host IP rewind, source checks and hashing; no profiler is active.

| Pair | CPU A/B | Wall B/A |
|---|---:|---:|
| 1 | 1.272480636570 | 0.793036222336 |
| 2 | 1.213153522442 | 0.841296674648 |
| 3 | 1.225626909685 | 0.810711498170 |
| 4 | 1.201314826958 | 0.826920982034 |
| 5 | 1.204566284740 | 0.841079553933 |
| 6 | 1.219872656113 | 0.823085744405 |
| 7 | 1.192303685597 | 0.856390243920 |

Median CPU ratio was **1.213153522442**, minimum **1.192303685597**, with all seven
CPU wins; median wall ratio was **0.826920982034**. This clears the predeclared
1.03/all-wins/1.02 gate, about 21.3% higher CPU throughput for this authored mix.
The conditional 99.21875% minimum-ratio bound assumes independent continuous
exchangeable pairs; it does not establish a universal workload gain.

The allocated AMD EPYC 9V45 96-Core Processor runner exposed four logical CPUs;
CPU0 affinity and one-CPU quota, 1 GiB/no swap, Node 20.20.2 and source/runtime
before/after checks were observed. Original pre-exec/resource/timing records
and raw owned-service/cgroup cleanup joined successfully. No run was replaced
or retried. The sole [artifact11957851558](https://api.github.com/repos/CrispStrobe/bw-board/actions/artifacts/11957851558)
is 210972 bytes, ZIP SHA256
`95011fb8d7b7b88681d909cf9c45f9b98b84ccbe0b3a1772f0204f30a6b364a4`.

The result is limited to `MIXED_ALU_WIDTH_PUBLIC_24_INSTRUCTION_MACRO`.
It cannot be multiplied by the earlier isolated fetch or scalar-EA ratios,
credited to a combined candidate, substituted for PR557's original gate, or
used as physical RTx, full-OS or installed GUI/CLI qualification. See the
[measurement contract](X86-NEXT-LANES.md#mixed-width-alu-public-paired-measurement).
