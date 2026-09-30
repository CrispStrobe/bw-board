# Next native 386 gates after host-event self-parity

**Status (2026-09-30): read-only implementation audit, not a new execution result.** Audited candidate `be8865164da0b384a0de5db5f6f809fb9b4c9d13` is now part of main through merge `11ea6ee3691b405be2d5f39dc5066ac2f93d62c2`. The [published event proof](I80386-NATIVE-CPU-EVENT-SELF-PARITY.md) binds its executable/validator source to `d144cb5bdd25a08da9b97133b71bb12e11a8e3fb`. The following are concrete unfinished gates, in order. Preserve the published v1/v2 source, binaries, fixtures, and receipts; use new files/builds and freeze each source before qualification.

## 1. Combine paging, fault retry, and a pending IRQ

Start from the free event fixture: keep the tick-256 deadline inside REP, consume it, and assert IRQ under CLI. After REP, install identity 4 KiB paging, the page-fault gate at IDT entry 14, and IRQ gate 0x20. Leave page 5 nonpresent and execute a supervisor write to `0x5000` before STI. Reuse the owned page-fault handler's PTE repair, CR3 reload, error-dword removal, and IRETD retry. Enable interrupts only after the retried store succeeds, then retain the STI successor, second IRQ/HLT wake, and terminal masked HLT.

No new Bochs CPU hook appears necessary: the event adapter retains the inherited fault-delivery longjmp cut. Its current driver deliberately aborts on a fault, so a separate driver must expect and record exactly one fault, prove the host IRQ remains pending and masked through repair/retry, and require the successful retried data write before the first acknowledgement. Derive fault, handler, retry, IRQ, and HLT addresses from assembled symbols; use a distinct fixture marker.

Capture the four-dword `#PF` frame at its delivery cut (`0x6ff0` error, `0x6ff4` EIP, `0x6ff8` CS, `0x6ffc` flags). Later IRQs reuse the three upper slots. Validate error 2, CR2 `0x5000`, saved RF/EIP/CS, the absence of a failed data write, PTE repair, CR3 reload, IRETD, and the one successful retry. Continuous and budgets 1/2/257 must match ordered fault/IRQ/host actions, physical writes, ticks, selected final CPU/RAM, and guard evidence. Fault delivery's native charge remains separate from JavaScript AT fault/cycle accounting.

Suggested two-agent split: one owns the separate runtime driver/ABI/preparer; one owns the free fixture, runner/parser, validator, and mutation tests. Root audits source/budget/interrupt ordering, reproduces independently, then publishes exact receipts. This gate still uses plain 1 MiB RAM; it is not MMIO, AT device arbitration, or board parity.

## 2. Qualify decoded host memory and A20

The current native runtime copies raw `BX_MEM::get_vector` pages into one writable RAM domain. This is not an authority for mapped ROM or MMIO. The actual board classifies RAM, ROM, slow device regions, and unmapped pages in [`_buildPageTable`, `_read`, and `_write`](../src/i8086-machine.js). Its [`_read386`/`_write386`](../src/experimental/i80386-at-machine.js) additionally route A20, reset aliases, MP/APIC, and VGA. A board adapter needs that decode, including byte order across region/device boundaries, before granting direct executable-page pointers.

In pinned Bochs `0e45b736ef9792eb9b752b0a35db49eaf2faea47`, `paging.cc` applies `A20ADDR` before the physical callback. `pc_system.cc::set_enable_a20` calls `MemoryMappingChanged`, which flushes CPU TLBs on transitions. Drive this transition once; do not independently mask callback addresses again. `cpu.cc::prefetch` requires an executable host pointer and panics when it is vetoed. The adapter must explicitly fail closed on unsupported executable mappings instead of assuming NULL invokes a slow fetch path.

The smallest free memory fixture keeps code in RAM and tests:

- Distinct low `0x000500` and high `0x100500` sentinels. Real-mode `FFFF:0510` reaches the high address without an out-of-limit offset.
- A source-pinned free BIOS ROM byte, an attempted write, and unchanged readback. ROM bytes must come from the mapped, source-pinned ROM provider rather than raw copied RAM.
- An owned fake MMIO register at `0xa0000`, with counted reads/writes and behavior distinct from backing RAM.
- An intentionally unmapped window with `0xff` open-bus reads and discarded writes.
- `OUT 0x92` transitions with the 8042 A20 source explicitly fixed low: disabled high access aliases low RAM, and reenabling restores the untouched high sentinel. Check for stale data/fetch mappings.

The actual AT gate is the OR of the 8042 output and port-92 latch (`_out386`), so both sources need a later board-level test. The first fixture must state its fixed-source assumption. Define RAM commits, ignored ROM/unmapped writes, and MMIO side effects separately in the event journal. RAM writes must maintain Bochs write stamps for decoded code. Map/A20 transitions must invalidate relevant translations; ordinary guest PTE writes retain hardware CR3/INVLPG rules and must not cause an invented automatic TLB flush. Reject unknown regions, unsupported widths/ports, unmodeled boundary spans, unsafe direct pointers, and unqualified DMA/device mutations. A byte-decoded path is the correctness baseline; direct pointers require a stable executable region.

Suggested split: one agent owns the typed map/A20 API and native adapter; one owns the free fixture and independent validator. Freeze map/ROM/source/binary identities and compare continuous/sliced journals before attempting a selected-state comparison with the real JavaScript board. This gate does not yet prove real VGA, ATA, PIC, DMA, or IRQ/device scheduling.

## 3. Attach devices, then build and measure the backend

Board PIO settles chip debt before relevant accesses; `_serviceInterrupts` arbitrates actual PIC/APIC events. During HLT, the JavaScript machine settles debt and advances chips to `_wakeHorizon` while completing no CPU instruction. Native idle returns charge zero instruction ticks. A host scheduler must advance device time separately and demonstrate timer/device wakeup; it must not equate these clock domains. The native event fixture currently controls a line/vector directly, not an AT PIC model.

Strict CPU3 has no CR4/PSE. Stock xv6's current bootstrap therefore remains outside this strict route, even though the existing JavaScript compatibility profile runs it. A strict 386 target needs a 4 KiB bootstrap port, or a separately identified later-ISA compatibility core; do not silently relax strict386 semantics.

After these boundaries pass, integrate the native/WASM core with the board, qualify real free/private guest workloads, then measure identical workload/source/hardware configurations. The 10× objective remains unfinished. The new gates establish neither RTx nor a Windows enhanced-mode or Doom performance result.
