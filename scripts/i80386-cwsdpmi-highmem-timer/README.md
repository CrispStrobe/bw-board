# Separate owned high-linear-memory and timer QEMU gate

This is an uncompiled, unrun source checkpoint for the gate in the
[high-memory/timer plan](https://github.com/CrispStrobe/bw-board/blob/71b2425e4bc7babb478c41965ec2afb684c4bcc5/docs/I80386-DPMI-HIGHMEM-TIMER-PLAN.md).
The historical client, compiler helper, QEMU control and AT evidence remain
unchanged. The new client requests a 4,096-byte DPMI `0501h` block, requires a
linear start strictly above 1 MiB and a nonwrapping requested span, verifies
the selector's read-back base/limit before a 256-byte far-pointer checksum,
then polls simulated BIOS `INT 1Ah/AH=00h` until a positive 1–36 tick
modulo-day advance or the predeclared 262,144-call cap. All acquired selector
and block resources are released on later failure, including handle zero.
The base readback uses [DJGPP's DPMI `0006h` wrapper](https://www.delorie.com/djgpp/doc/libc/libc_237.html);
the [limit readback](https://www.delorie.com/djgpp/doc/libc/libc_238.html)
uses the CPU `LSL` instruction, not another `INT 31h` service. The exact
byte-granular limit must be 4,095; a silently retained flat selector is not
accepted.

`grade.py` admits only two exact DOS output lines: a fixed success marker and
canonical unsigned decimal diagnostics. It rejects extra lines, non-ASCII,
signs, leading zeros, overflow, invalid selector mapping, address/tick range,
wrong checksum and cap/zero-delta results. Exact exit and shell-return files
are separate evidence. A cap failure means progress was not observed within
the budget; it is not proof of a broken timer. The source-owned client never
sleeps or seeds guest ticks from the host.

`compile-adapter.py` binds the unchanged, Git-authenticated compiler helper's
source metadata to this new client and retains the raw compiler report plus a
separate outer profile. `media.mjs` builds distinct batches and markers from
that profile and the pinned CWSDPMI member. The dedicated label-triggered
workflow authenticates its exact source head and unchanged inherited roles,
then bounds hosted fetch, compile, media construction and one QEMU invocation.
The oracle retains report-only input/component hashes, bounded screen and disk
observations, terminal files after QEMU exit, and the first failure. It offers
keys through QMP; these offers are not guest keyboard-acceptance evidence.
Running-disk reads are bounded observations, not atomic disk snapshots. Host
parser and synthetic media/oracle controls do not establish compiler, DPMI,
QEMU or AT behavior until the hosted run is reviewed.

The QEMU control is a `pc`/486/4 MiB machine, distinct from the AT
CPU/device profile and firmware. Even a future successful pair of finite
guests would show high **linear**, not physical, allocation and would not prove
`INT 31h` frame/IRET ownership, calibrated clock accuracy, or general
application compatibility.
