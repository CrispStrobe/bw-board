# Finite paged IRQ0 and IRET result

Updated 2026-10-07. [Actual run 37622795990](https://github.com/CrispStrobe/bw-board/actions/runs/37622795990)
passes the fixed same-CPL0, code16, strict-386 paging fixture at source
`8f1be780b191176ff1d3789b38e2c73e48041198` in
[PR424](https://github.com/CrispStrobe/bw-board/pull/424).
Root and a separate reviewer independently audited the original packet using
standard-library readers without importing producer helpers or replaying the guest.

## What passed

The source-owned ROM creates descriptors, nonidentity page tables and RAM code.
After STI and its successor, actual PIC IRQ0 delivery at 39 N/Q produces a
zero-Q return to the handler. The handler stores its marker, IRET returns to
the interrupted instruction, and that instruction stores its marker once.
The final pre-HLT cut is 44 N/Q after 45 native resumes. The stack frame bytes
are `02 70 18 00 02 02`; the handler and interrupted markers are `2222` and
`1111`, respectively. There is one PIC acknowledgement and one delivery.

The packet retains 47 boundaries, 45 line stages and all 16 named cuts. Audits
check all 166 native CPU/cache words for representation, compare the represented
JS counterparts without an EFLAGS mask, and compare the whole board and all ten
unmasked physical pages at the architectural cuts. Q36 and Q37 remain explicitly
unmatched memory/board phases. The native zero-Q IRQ cut is compared to the
real nested JS delivery cut, rather than inventing a separate JS outer step.

Independent replay checks all 54 memory events: 23 reads, including four exact
read-only ROM descriptor chunks, and 31 writes (20 boot, six accessed/dirty,
three frame and two marker writes). It reproduces all ten final pages and checks
readback, generation/order, frame/marker bytes, final PIC state and complete RAM
hash agreement. Native, provider and JS sessions all close.

## Evidence and earlier failures

[Artifact 11483164789](https://api.github.com/repos/CrispStrobe/bw-board/actions/artifacts/11483164789)
has 75 members, ZIP 2,010,826 bytes, SHA256
`45bf6df2c62e283d3f1eb283088f40812bd2fc459fe3fa8c81cc60372ab57736`.
The decoded capture is 25,093,058 bytes, SHA256
`3cead708cba384b776b47bb326317902c0bdbb130edc7219b0508fbc73b3b7d5`.
Audits bind 236 source roles to Git bytes and check build, configuration and
artifact inventories. The ZIP omits the addon binary and prepared source
archives; their recorded hashes are bindings, not independent rehashes of
those omitted bytes. See the [summary receipt](receipts/2026-10-07-paged-irq.json).

Keep these original failures unchanged:

- [37618660994](https://github.com/CrispStrobe/bw-board/actions/runs/37618660994): inherited cold-profile ACK veto aborted the native guest.
- [37619512616](https://github.com/CrispStrobe/bw-board/actions/runs/37619512616): actual delivery reached, but the driver expected nonexistent top-level IRQ fields.
- [37620774682](https://github.com/CrispStrobe/bw-board/actions/runs/37620774682): decoder expected Boolean IF instead of the exact ABI mask `0x200`; this run stopped before delivery.
- [37622053238](https://github.com/CrispStrobe/bw-board/actions/runs/37622053238): delivery and terminal cuts passed, but final replay classified four ROM reads as RAM.

The corrections retain exact ABI-byte, malformed-mask, finite ROM-read and
pre-effect callback controls. This result qualifies no privilege change,
code32 interrupt frame, TSS/task switch, VM86 interaction, HLT wake, full OS,
general native CLI/GUI backend or performance improvement. Next cover one
actual privilege or restart mechanism at a time and keep application acceptance
on its separately qualified functional backend.
