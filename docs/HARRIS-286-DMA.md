# Wired DMA register prerequisite

2026-09-09. `HarrisDMAAdapter` is a default-off **channel-2 register bridge**,
not a DMA bus master. It reuses the existing `I8237` programmer-register model
privately, without transfer hooks, requests admitted to the core, or calls to
its transfer method. The latter uses host callbacks and cannot provide wired
memory ownership or terminal-count evidence.

The Harris CPU still refuses HOLD. The board advertises `dmaRegisters:true`
only when this adapter is supplied; `dma:false` remains unchanged. There is
no HRQ/HOLD output, HLDA input, DACK, TC, or hidden DMA completion in this bridge.
The FDC still refuses all data commands regardless of whether DMA registers
are present. This does not yet increase disk-sector transfer coverage.

## Register subset

| Port | Supported behavior |
| --- | --- |
| 04h / 05h | Channel-2 address/count, low and high bytes through one shared pointer |
| 08h | Status read; controller command 00h or 04h only |
| 09h | Clear channel-2 software request only; setting it refuses |
| 0Ah | Mask/unmask channel 2 only |
| 0Bh | 46h or 4Ah: single mode, increment, no autoinit, memory write/read |
| 0Ch | Write clears the shared byte pointer; read remains undriven |
| 0Dh | Write master clear; read remains undriven |
| 0Fh | 0Bh/0Fh masks only: channels 0, 1, 3 must stay masked |
| 81h | Separate channel-2 page latch, write-only, values 00h–0Fh |

Other-channel writes, unmask-all at 0Eh, unsupported modes and page values,
and either physical DREQ2 assertion or software request setting fail explicitly.
This includes masked DREQ2: request qualification is not implemented, so it
is a subset refusal rather than pretending to queue/service the request.

The page restriction names an **XT-style 20-bit subset**, matching the reused
core's transfer-address convention, not a complete AT/286 DMA implementation.
Page and address registers are separate. No rollover, decrement, autoinit,
count exhaustion or TC transfer behavior has been verified on this wired path.
Programming count 511 is verified as a register value, not as proof of a
512-byte transfer.

Master clear preserves the external page latch. Board reset clears both the
controller and page latch as explicit combined-model reset policy. Undefined
and write-only reads remain floating, rather than inheriting the core's
convenience FFh/read-back behavior or clearing the pointer on a read of 0Ch.

Writes commit once at trailing WR; reads consume one byte-pointer step and
hold that value through the RD strobe. Aligned word cycles refuse; odd words
can still split into separate physical byte cycles with non-atomic effects.
Direction overlap, changes/removal of selection during a strobe, and missing
required levels are diagnostic faults. Already committed effects are not
rolled back after a later fault.

## Wiring and verification

`createHarrisMemoryBoard({...,dmaDevice})` requires the PIC/I/O path. The
adapter receives latched addresses and byte enables, controller read/write
strobes, reset and resolved data nets. Its optional `dma_inputs.dreq2` stimulus
starts low; it is not connected to a fictional FDC request source. The reserved
00h–0Fh and 81h ranges are checked against PIC/PIT/FDC windows.

Seven owned tests cover gates/conflicts, shared-pointer semantics, held read
and write strobes, separate page state/reset, strict request/mode refusals,
floating ports and missing wires. The microguest programs a masked channel,
address 7C00h, count 01FFh, page 04h, mode 46h and unmask, then reads the address
and count back via actual IN instructions and halts. PIC, PIT and FDC remain
connected. The tests require HRQ/status to remain zero and prove inspection
cannot change the programmed address.

Targeted regression: **475/475 passed, zero skips**, including seven new DMA
bridge tests, one new probe CLI test, and existing wired CPU/memory/peripheral,
preservation, BIOS, FDC-core and DMA-core tests. CPU/SST adapter/runner hashes
are unchanged. Existing callback-core transfer tests are regression protection,
not evidence of DMA transfer capability on this board.

```sh
node --test --test-reporter=spec test/harris-*.test.mjs test/digital-circuit-lab.test.mjs test/paterson-fat12.test.mjs test/sst286.test.mjs test/private-guest-fixtures.test.mjs test/dos-guest-persistence.test.mjs test/i8259.test.mjs test/i8254*.test.mjs test/bios-rom.test.mjs test/bios-fdc.test.mjs test/upd765.test.mjs test/i8237.test.mjs
```

The probe adds explicit `--dma-mode registers`; `none` stays the default.
One-clock CLI tests verify the new metadata and non-acceptance status. A future
long diagnostic can use:

```sh
node scripts/probe-harris-bios.mjs --pic-mode single-unbuffered --fdc-mode control --dma-mode registers --ram-kib 64 --max-clocks 160000
```

This command is not a new POST receipt. A 64 KiB fixture is reduced diagnostic
memory, while the firmware still declares 640 KiB. Existing receipts keep
their original source hashes. No complete POST, DOS boot, full-vector rerun,
browser run, application pin/default change, merge/deploy or media is claimed.

## Next functional gates

1. Implement an explicitly gated HOLD/HLDA boundary, finishing active writes
   and respecting locked/interrupt-acknowledge sequences before releasing CPU
   drivers. Test requests during idle, READY waits, split operands and reset.
2. Add physical arbitration/controller enables so an external master can drive
   the actual memory address/data/control nets without CPU contention. Suspend
   CPU operand completion while it does not own the bus.
3. Implement channel-2 DRQ/DACK, memory cycles and terminal count with owned
   byte/sector fixtures. Verify page wrap and N-1 counts through memory effects,
   not just register reads or the existing callback-core tests.
4. Only then admit FDC data commands and verify boot-sector handoff separately.
