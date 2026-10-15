# Subscribed 386 free-guest debugger checkpoint

Updated 2026-10-15. The sole corrected-source
[run38716662156](https://github.com/CrispStrobe/bw-board/actions/runs/38716662156)
succeeded on `bc3d0d3514098b97290fccb54993d24587a491da`. Original artifact,
metadata, source and finite event joins passed independent review. The
[source debugger PR599](https://github.com/CrispStrobe/bw-board/pull/599) and
[qualification harness PR607](https://github.com/CrispStrobe/bw-board/pull/607)
are both READY for review. Consult those PRs for current required CI and
combined adoption review; neither is represented here as merged. This fixture
passed before adoption and does not qualify an installed GUI.

The unchanged pinned MIT xv6 4 MiB build and redistributable Bochs BIOS/VGA ran
through ordinary `machine.step`, once as control and once with the dedicated
386 debugger subscribed. The complete guest stdout reports were byte-identical.
Both executions created, read and removed a file, observed
`BW_XV6_FREE_BIOS_FS_OK` followed by the shell prompt, and ended at step
14,643,086. Both original stderr streams were empty; execution records retained
successful exit, EOF and owned-child reap with no timeout or cleanup refusal.

| Observed window | Result |
|---|---:|
| First selected outer step | 2,993,293 |
| Consecutive completed instructions | 64 |
| Actual pre-instruction protected 32-bit ring-3 retirements | 5 |
| Other/kernel retirements | 59 |
| Physical byte memory facts | 206 |

The reader reconstructed instruction before-state from full after-state and
explicit register-change before values. Ordinary AT interrupt arbitration can
change privilege inside a machine step, so the outer selected ring-3 boundary
was not used to credit every subsequent instruction as ring 3. Direct outer
before/after register snapshots were strictly typed and joined contiguously;
linear PCs used cached CS base plus EIP. Memory addresses remained unsigned
32-bit physical addresses. Event time counted completed core instructions with
no Hz field, separately from the board's synthetic scheduling charges.

The retained window contained instruction and memory events only. It supplies
no actual IRQ-event observation; tiny authored IRQ-before-instruction and IRET
controls cover that adversary separately. Source-issued observation controls
checked register/memory reads at two positions without changing the observed
state. This was not an independent replay of RAM, checkpoint/restore proof,
full protected-mode OS qualification, physical timing measurement or performance
experiment.

All 78 probe source roles and ten qualification roles joined exact Git/live
byte identities. The corrected target preserved the existing destructive-IN
refusal without performing an I/O read. Earlier hosted general/xv6 host tests
failed that refusal-text assertion; guest build/execution did not run in the
failed xv6 job. The earlier queued guest attempt was cancelled before any child
execution. Those failures are not presented as a passing guest run or a second
CPU defect.

The sole [artifact11966015324](https://api.github.com/repos/CrispStrobe/bw-board/actions/artifacts/11966015324)
is 63,587 bytes, ZIP SHA256
`2e393918fa981b4eeddc8c91e532abd0cc30b9220a087b9751499b22451bbc9c`.
Continue latest source CI and scoped adoption review before exposing these
capabilities through an installed consumer; no dependency pin changes here.
