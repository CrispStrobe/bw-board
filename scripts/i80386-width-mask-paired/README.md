# Mixed-width ALU public paired measurement

This separately named authored macro compares ordinary A `3646417a959b5aa9f93ac446398ea9cacd5a6da5` (CPU2303) with isolated mask-literal B `f6863484d02b4c4b0ce56415054f2e6a0c154097` (CPU8f92). Fresh 43-row Git/live length/SHA maps include package resolver metadata; only the CPU row differs. New common nine roles (package, fixture, runner, policy, independent reader, controls, README, fixture test and workflow) join one exact publication commit for both arms. Existing experiments and their admissions remain immutable. PR557's scalar-EA candidate is not included.

Each pass executes 24 real instructions/106 authored bytes with the ordinary byte bus: ADD/SUB pairs for accumulator8/16/32, ADD/SUB pairs for byte/word/dword memory2000, XOR sign-bit pairs for each width, then CMP and TEST for each width. Explicit66 prefixes select32-bit operands. EAX12345670 and memory bytes10/32/54/76 hexadecimal restore after every pass; IP106/EFLAGS2 and other registers, complete memory SHA, address sums and work counts have independently calculated goldens. Six tiny tests prove every instruction's flags/registers and exact fetch/read/write sequence:106 fetches,14 reads and14 writes per pass. Fault controls preserve source error identity and partial memory effects. Timed code uses numeric counters, no per-instruction trace allocation.

100000 host passes yield2.4M ordinary steps,10.6M fetches and1.4M reads/writes each. Common setup, IP rewind, source admission and final hashing are included in whole-Node time. The four ABAB warmups and seven fixed AB,BA,AB,BA,BA,AB,BA pairs cannot be retried, dropped or replaced. Wait4 user+system CPU and matching monotonic wall require median A/B>=1.03, every CPU ratio>1 and median wall B/A<=1.02; conditional99.21875% minimum-ratio assumptions are reported. No profiler is active.

The new resource/capture implementation is a reviewed source copy of immutable publication `acb31651502cfbc78ab63dceb4f70ccfe0d3e5f6`, with new experiment admissions/names and explicit finite source/runtime-position originals; no old runner/policy is imported or mutated. Ubuntu24.04/Node20.20.2, executable-byte checks before/after, oneCPU affinity/quota, wrapper-and-child cgroup memory1GiB/swap0 and zero pressure events are required. Children have60s deadlines and hard256KiB output-file limits; nonempty stderr refuses. Fixed service/job bounds plus always-observed exact owned-unit/cgroup cleanup supplement source-owned wait4/reap; client timeout/EOF is not termination proof. Original timing/prefixes/first errors remain even on refusal.

`reader.py` independently duplicates the fixed contract and imports no producer validator/helper. Its byte API joins original stdout/stderr, wait4 records, preexec resource observations, finite source/runtime positions, command declarations, fixed source/common maps and raw service/cgroup cleanup, then computes all seven ratios independently. `audit(originals, expected_publication)` accepts an externally declared head/common map for independent original auditors; the hosted CLI uses the source-issued declaration and labels that consistency only. Neither authenticates official metadata from self-reports; root/peer original Actions/Git admission remains required. Unknown/partial/mismatched facts cannot promote success.

Tiny checks:

```
node --test --test-concurrency=1 test/i80386-width-mask-paired-fixture.test.mjs
/usr/bin/python3 -I -B scripts/i80386-width-mask-paired/controls.py
```

No full macro or actual resource setup ran locally. Only one reviewed branch push may launch the hosted measurement after affected exact CPU guest/full-CI success. No performance result or PR594 adoption exists yet. This authored ALU mix cannot replace the original private gate, multiply earlier isolated gains, establish physical RTx or qualify an OS/consumer. See the [contract](../../docs/X86-NEXT-LANES.md#mixed-width-alu-public-paired-measurement).
