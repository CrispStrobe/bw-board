# Frame-gate source: xv6 regression checkpoint

[Hosted push run 37798349010](https://github.com/CrispStrobe/bw-board/actions/runs/37798349010)
passed at source [`c968428d`](https://github.com/CrispStrobe/bw-board/commit/c968428d4d478ae115b8e9cb1065f8a349b7ccbe),
attempt 1. The [derived summary](summary.json) records official origins and
original log/ZIP hashes without reproducing raw receipts.

The current cohort reported 1,624 tests: 1,613 pass, zero fail and 11 skip.
All 288 historical tests passed separately. The 29 CPU-journal controls and
20 CPU-free policy/orchestration controls have passing exact-name TAP rows.

The five-JSON artifact records the 4 MiB shell/filesystem exercise, 14 MiB shell
boot and 4 MiB process-exhaustion test. Root checked the original packet's
70 listed source roles per guest and free BIOS hash against immutable Git,
plus build/probe identity consistency and finite serial/milestone predicates.
The independent peer confirmed the source/build/image bindings, ordered guest
command bytes, finite outputs and all 49 focused test names. No producer helper,
compiler reconstruction or guest replay was used.

These are regressions under the existing compatibility profile, with reported
CR4 `0x10`. They do not qualify a strict physical 386DX, the allocation-frame
probe, performance or consumer adoption. See the [frame attribution lane](../../I80386-DPMI-FRAME-ATTRIBUTION-LANE.md)
for the separate actual diagnostic and its acceptance gates.

The same source also passed [full PR CI 37798358085](https://github.com/CrispStrobe/bw-board/actions/runs/37798358085):
8,468 current tests, 8,166 pass, zero fail and 302 skip; all 288 historical
tests passed. The preceding vector-admission controls passed 2/2. Root and
independent peer checked the original log, official metadata and all 49
focused names against Git. These separate log hashes and counts are retained
in the summary. One enabled push-vector check is still queued at this
checkpoint; full PR CI success does not complete every enabled check.
