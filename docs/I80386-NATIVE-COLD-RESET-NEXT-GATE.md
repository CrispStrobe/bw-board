# Next native 386 gate: cold reset and actual board ownership

**Status (2026-10-01): implementation contract, not an execution or speed result.** The successful-work proof qualifies a post-BIOS CPU handoff with fresh standalone PIT/PIC models. A native backend still needs to execute from hardware reset and route memory, ports and scheduling through the actual `ExperimentalI80386ATMachine` before a WASM port or production speed comparison.

## First free checkpoint

Use a newly assembled, freely distributable 64 KiB ROM. Its reset vector far-jumps from the architectural hidden CS base at physical `0xfffffff0` into the low BIOS mapping. The guest executes CLI, sets a valid stack and data segments, writes a low-RAM signature, attempts a ROM write and verifies unchanged data, reads open bus, emits an owned marker through port `0xe9`, and enters CLI/HLT. Declare every instruction, mapped region and expected witness. No BIOS disk or licensed software is needed.

The JavaScript oracle must use the actual board with `hardwareReset=true` and the same ROM/RAM/configuration intended for the native bridge. Instantiate fresh machines and perform exactly one reset: `I8086Machine.reset()` charges four board clocks and advances devices immediately but does not reset all devices. Retain the first reset fetch at `0xfffffff0`, the fetch after real CS reload, raw and decoded bus addresses, write effects, PIO, successful-work charges, chip-debt settlement, final CPU/RAM and device state. A marker alone is insufficient.

Both paths must identify coprocessor/stepping profiles and preserve defined hardware-reset state. The current JavaScript reset deliberately zeroes undefined CR0 bits 5..30; Bochs may retain different reserved values. Define any excluded undefined fields in advance, preserve full raw state, and compare all defined fields and the post-instruction behavior. Do not mask an unexpected divergence after observing it. The read-only audit also found genuine initial-state differences: EDX (`0x300` versus native zero), GDTR/IDTR limits, DR6/DR7 and cached CS attributes. These require named compatibility decisions or fixes before claiming architectural reset parity; guest initialization of a field can establish a later checkpoint but does not erase the recorded reset mismatch. Coprocessor ET also differs and must use an explicitly aligned profile.

## Native seam

Keep the prior post-BIOS adapters unchanged. The new adapter must become active before the first reset fetch, accept externally owned physical read/write/execute providers and PIO, and never silently fall back to Bochs RAM/devices/timers. Current executable admission permits only RAM; a reset bridge must admit stable read-only ROM pages with correct aliases. Apply the actual board's A20 and reset-ROM decode to every physical path, including page walks. Preserve raw addresses and decoded effects. ROM writes must remain ignored, executable RAM writes must maintain native decode stamps, and unsupported spans or mappings must fail closed.

The board currently constructs its JavaScript CPU directly. First define an optional backend factory with the CPU operations the board actually uses; preserve the existing default. A native bridge must service board-owned chip debt, pending IRQ arbitration and HLT wake horizons at safe committed boundaries. Its native ticks remain separate from successful board quanta, including faults and REP. Reset epoch clocks and CPU-instruction clocks must remain distinct.

Compare continuous and successful-work budgets 1/2/257 using identical configuration, ROM/RAM seeds, source/build pins and terminal stop. Require reset/fetch order, write effects, PIO, defined CPU state, RAM, device/debt state and guards to agree. Qualify the initial ROM checkpoint first, then run the existing free REP/two-page-fault/PIT fixture through the same actual-board bridge. Broader traps, REP I/O and other address sizes need their own named cases.

## Build and measurement boundary

Clang/wasm-ld 18.1.3 are present on the audit host; Emscripten and a standalone WASM runner were not found on PATH. Existing code16 WASM handles a bounded subset, not the Bochs CPU3 core. A future WASM build needs an identified toolchain, flags, licenses, runtime/memory model and source-bound parity receipts. Native subprocess RPC and per-quantum evidence are correctness apparatus; direct in-process/WASM callbacks and safe clock-debt batching are later optimization candidates.

Only after the same real board workload matches CPU/RAM/device/fault order should paired same-host user-CPU runs measure speed and RTx. Windows enhanced mode, Doom, full AT boot and the 10× target remain unfinished. Strict CPU3 has no CR4/PSE; retain the separately labeled stock-xv6 compatibility route and require a 4 KiB/UP/PIC port for strict 386 xv6.
