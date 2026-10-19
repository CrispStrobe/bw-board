# Bounded owned AX=0501 task-mode diagnostic

This source-only gate extends the separate task diagnostic after the original
strict AX=0501 frame journal refuses at `task-switch-during-owned-frame`. It
keeps that refusal, null frame return, finite client report and top-level
`passed:false`. It does not qualify an IRET, full DPMI service or OS behavior.

The derivative adapter uses the same pinned free AT BIOS, VGA BIOS, FreeDOS
floppy, host, freshly compiled client/map and constructed HDD as the existing
task gate. At the owned main cut it byte-compares the privately admitted
allocation wrapper. Once the CPU reports the committed INT 31h entry, it arms
the separately named task-mode recorder. No ordinary continuation step is
allowed until the original strict refusal and a source-owned committed outgoing
task transition are both present.

The same machine then takes at most 100,000 ordinary `machine.step()` calls
within 120 seconds. The controller polls only between steps. Progress records
bounded counts; the full mode-change history exists only in a terminal CPU
observation after `takeOwned0501TaskModeObservation`. On refusal or an owned
bound, it attempts the source-owned abort and drain while retaining the first
diagnostic failure. Faults and attempted transitions are observations, not
claims of rolled-back guest effects. A handler candidate is diagnostic only.

The report and closed artifact inventory contain bounded JSON, logs, hashes
and notices. They exclude executable, RAM, task-state, disk and floppy bytes.
The source gate must authenticate every inherited role, the reviewed CPU and
journal-test changes, and this new namespace before any hosted guest run.
This workflow has not run a guest yet.
