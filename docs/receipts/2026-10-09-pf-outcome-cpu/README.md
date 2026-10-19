# Fault-outcome CPU prerequisite: original hosted qualification

[Draft PR486](https://github.com/CrispStrobe/bw-board/pull/486), source
`33d53542aa4375f9eb4c3c508ecf9bc8b1bba0d9`, passed the original
[automatic push run37970304717](https://github.com/CrispStrobe/bw-board/actions/runs/37970304717).
Root and a separate Sol reviewer independently read the retained original ZIP
and job log without importing producer helpers or replaying the guest.
The [summary](summary.json) gives the official API origins and original hashes.

All twenty new fault-outcome tests and 131 related focused controls passed.
The current CPU cohort reported 1,726 tests: 1,715 passed, eleven skipped and
zero failed. The historical cohort passed all 288 tests. Both exited zero.
The closed five-member report artifact contains two build receipts and three
finite MIT-licensed xv6 scenarios at source
`eeb7b415dbcb12cc362d0783e41c3d1f44066b17`, using the free BIOS fixture.
The filesystem, 14-MiB echo and 4-MiB forktest probes reached their respective
markers in 14,643,086, 10,962,834 and 24,338,279 steps. Source/image joins and
paging/user-mode milestones were checked. All twelve enabled exact-head PR
checks passed; only the two declared optional `vectors-full` jobs skipped.

This qualifies the focused CPU controls and the existing finite xv6
compatibility profile, including its PSE/APIC extensions. It does not qualify
strict physical 386DX behavior, a connected fault-outcome diagnostic, fault
service, an owned DPMI frame return, broader application acceptance or speed.
The next gate is the separately admitted pre-continuation connection described
in the [task lane](../../I80386-DPMI-TASK-EXCURSION-LANE.md#separate-page-fault-delivery-outcome-source).
No local CPU or guest execution was used for this documentation checkpoint.
