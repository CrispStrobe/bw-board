# Bounded owned AX=0501 task-excursion diagnostic

This proposed AT gate retains the existing mixed-profile AX=0501 frame journal's
strict refusal. It uses the same pinned free BIOS, VGA BIOS, FreeDOS floppy,
CWSDPMI host, freshly compiled owned client, map and HDD construction as the
frame gate. The runner still reaches the owned main cut and byte-compares the
private admitted allocation wrapper before arming the original CPU journal.

After a committed owned INT 31h entry, the derivative driver privately arms
the separate CPU task-excursion recorder. If the strict journal refuses with
`task-switch-during-owned-frame`, the original partial finite-client report,
entry, null return and first refusal remain in the result. The same machine
then takes at most 100,001 ordinary `machine.step()` calls with a 120-second
wall bound, polling the CPU recorder only between steps. A candidate is
consumed before any further step. Only a committed outgoing transition may
support a diagnostic resumption candidate. Neither the candidate nor a
successful host run qualifies an owned IRET or another DPMI service.

The report and artifact inventory contain bounded JSON, logs, digests and
licensed notice text. They exclude raw RAM, task-state segments, executables,
disk and floppy bytes. The separate source policy must authenticate all
inherited inputs and the new observer code before a hosted run is admitted.
The workflow has not yet been run against a guest.
