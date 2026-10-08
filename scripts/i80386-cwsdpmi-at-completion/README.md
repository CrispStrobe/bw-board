# Owned CWSDPMI AT completion gate

This directory prepares a same-machine FreeDOS completion gate for the owned
DJGPP client. This integration is **source only and unrun**. Its dedicated
label-gated workflow freshly compiles the same owned client and calls the
separately named `bindOwnedCodeAtMain` at a synchronous pre-step cut. That cut
retains the strict whole-`.text` PASS or FAIL while requiring exact bytes for
the complete owned `main` and seven wrapper extents in one ordinary-RAM copy.
The [fourth diagnostic](../i80386-cwsdpmi-at-owned-code/FOURTH-RESULTS.md)
observed a strict whole-text FAIL and reported those eight extents equal;
it did not execute this separate cut. No CPU, client, media, toolchain, ROM,
or prior guest gate is changed here.

The proposed driver authenticates the same fresh compiled client, map, pinned
CWSDPMI member, FreeDOS floppy, HDD, and free AT BIOS/VGA bytes used by the
loaded-main gate. It creates the same 4 MiB configured AT guest with a larger
16 MiB backing allocation, then offers paced Set-1 codes while calling only
ordinary synchronous `machine.step()`. The driver captures four result files
from one cloned HDD snapshot at each observation. They must all be absent in
the pristine image. At the loaded-main cut, `DPOUT.TXT` may be absent or empty
because shell output redirection creates/truncates it before the client runs;
`DPOK.TXT`, `DPFAIL.TXT`, and `RETURN.TXT` must remain absent. The exact
FreeCOM [source at the pinned commit](https://github.com/FDOS/freecom/blob/04fc21a9f6792abe9048598e8f2d048b4f6cd0e5/shell/command.c)
opens redirected output with create/truncate flags before invoking the command.
That is source-backed expected behavior, not an observed cut in this gate or
proof that the FreeDOS 1.4 bundled shell has identical bytes.

After a successful owned-code cut, two identical complete file snapshots at least
one million ordinary steps apart must show the exact 29-byte success line and
16-byte zero-exit marker, with no failure or return marker. A newly visible
batch-done line and current last-row prompt precede a separate VERIFY command.
After its full accepted scan sequence, two more identical snapshots must also
show the exact 22-byte return marker, and a nonprompt-to-current-prompt
transition must stabilize for at least 100,000 ordinary steps. The driver
retains accepted and rejected scan offers, four ordered file-snapshot receipts
with steps, hashes and small owned text, bounded screen/prompt milestone rows,
bounded partial FAT diagnostics, input and final media hashes, and
the first failure. It rejects malformed settled FAT/files and does not publish
images, executables, raw RAM, or toolchain bytes. Its 120-million-step and
640-second wall caps apply to the entire same-machine scenario. Execution CPU,
wall, and cycle deltas are diagnostic timings that include observation cost;
they are not an RTx, paired benchmark, or adoption claim.

`grade.mjs` and the injected `runScenario` controls use caller-supplied records.
They check ordering and refusal policy but cannot authenticate guest origin,
the screen epoch, source session, or FAT coherence by themselves. Only a later
reviewed workflow binding the actual machine and exact source closure can make
those observations eligible. The new workflow has not run. Even a future
completed-client result would not
prove INT 31 delivery/IRET ownership, DPMI callback behavior, strict physical
386 timing, Windows, games, or a performance improvement.
