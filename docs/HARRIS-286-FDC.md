# Wired FDC control bridge

Historical control-only milestone. The subsequent opt-in
[physical DMA/FDC transfer path](HARRIS-286-PHYSICAL-DMA.md) supersedes the data
command gaps below; control-only mode itself keeps these restrictions.

Follow-up: the optional [DMA register bridge](HARRIS-286-DMA.md) now verifies
channel-2 programming over the wired bus. It still rejects requests and does
not enable any FDC data commands or sector transfers.

2026-09-09. `HarrisFDCAdapter` is an explicitly gated ideal-digital address
decoder/byte-lane bridge around the existing `UPD765` control-command core.
It is **not** a bare 765 pin model, a floppy-drive simulation, or a DMA bridge.
It exposes no media insertion, image persistence, or transfer callback API.
The core is private so callers cannot bypass the command admission guard.

`createHarrisMemoryBoard({...,fdcDevice})` requires the existing PIC/I/O path.
The default remains no FDC. The connector uses the latched address and byte
enable signals, shared resolved data nets, controller I/O strobes, reset, and
an actual net from FDC `irq6` to PIC `ir6`. It replaces only the manual IRQ6
input wire. The timer's independent IRQ0 wire remains available. Overlapping
PIC/PIT/FDC port windows are refused at construction.

| Default port | Implemented access | Physical byte lane |
| --- | --- | --- |
| 3F2h | DOR write; reads undriven | D0–D7 |
| 3F4h | MSR read; writes refuse | D0–D7 |
| 3F5h | Command/result FIFO | D8–D15 |

Other ports remain unclaimed, including DIR/CCR at 3F7h. No fictitious FFh
driver fills missing wires or unimplemented read registers. The port window
can be explicitly relocated to an eight-byte-aligned address.

## Supported control subset and refusals

The admitted command bytes are exactly SPECIFY (03h), SENSE DRIVE STATUS
(04h), RECALIBRATE (07h), SENSE INTERRUPT STATUS (08h), and SEEK (0Fh).
These reuse the existing core's logical control behavior. Seek/recalibration
complete synchronously; there is no mechanical step timing, index, media-ready
device, motor spin-up, magnetic track or electrical timing conformance claim.

Every other command, including READ/WRITE DATA, READ ID, FORMAT and their
flagged variants, throws `UNSUPPORTED_FDC_COMMAND` before entering the core's
command FIFO. Selecting SPECIFY's non-DMA bit does not enable PIO transfers.
The existing core's automatic DMA-to-PIO fallback is unreachable through this
bridge. This is a diagnostic refusal, not a fabricated guest success status.

FIFO writes while held in reset, commands while results remain, and FIFO reads
without a result refuse explicitly. Aligned word cycles at implemented ports
refuse; split odd-word operands are still separate physical byte cycles and
are not atomic. Already completed byte effects are not rolled back after a
later fault. As elsewhere on the board, an unclaimed write can complete without
a responder; that is not evidence of an implemented device.

Writes commit once on the trailing WR edge. A result byte is consumed once
when its read cycle starts and held on its lane until RD releases, including
READY stalls and repeated settle calls. Reset cancels pending adapter cycles.
Direction overlap, disappearing/changing selection during an active strobe,
and missing required levels fault rather than supplying hidden state.

## Verification and remaining work

Ten owned tests cover gates/range overlap, reset IRQ gating, four queued reset
replies, status/seek/recalibration, SPECIFY, refusal boundaries, inspection
isolation, reset cancellation, stretched strobes, physical READY waits, and
disconnected IRQ6/upper-lane data wires.

The owned microguest installs vector 0Eh, programs the PIC to base 08h and
unmasks IRQ6, pulses DOR, enables interrupts, receives a two-pulse physical
acknowledgement, sends EOI, and returns through IRET. It then drains all four
SENSE INTERRUPT replies through IN instructions, stores them in actual RAM,
programs SPECIFY, and halts. Tests verify one IRQ, restored SP, clear PIC ISR,
four stored C0h/C1h/C2h/C3h replies with zero cylinder bytes, and programmed
timings. This is device integration evidence, **not BIOS POST or DOS boot**.

The BIOS diagnostic now has an explicit option:

```sh
node scripts/probe-harris-bios.mjs --pic-mode single-unbuffered --fdc-mode control --ram-kib 64 --max-clocks 160000
```

`--fdc-mode none` remains the default. The report records the chosen mode, FDC
state, and pre-run hashes of the adapter and underlying core. An additional
one-clock CLI test checks opt-in/provenance and retained `accepted:false`.
The command above is a proposed next long diagnostic, not a new boot receipt.
64 KiB is a reduced fixture; firmware still declares 640 KiB. Existing older
POST receipts remain historical results for their original board hashes.

Targeted regression: **431/431 passed, zero skips** (10 new FDC tests, one
new CLI test, and existing wired/PIC/PIT/BIOS/preservation/SST-parser and FDC
core tests). CPU, SST adapter and SST runner hashes are unchanged. No new full
vector, full CI or browser run is claimed. The existing core and non-wired
BIOS disk tests do not establish sector-transfer support on this wired board.

```sh
node --test --test-reporter=spec test/harris-*.test.mjs test/digital-circuit-lab.test.mjs test/paterson-fat12.test.mjs test/sst286.test.mjs test/private-guest-fixtures.test.mjs test/dos-guest-persistence.test.mjs test/i8259.test.mjs test/i8254*.test.mjs test/bios-rom.test.mjs test/bios-fdc.test.mjs test/upd765.test.mjs
```

Next: wire the DMA controller's channel 2 and physical bus ownership/terminal
count, provide a real request/acknowledge transfer path, and test owned sectors
before admitting data commands. Then verify boot-sector handoff and DOS
separately. No DMA callbacks, host interrupt traps, firmware shortcuts, public
media, app defaults/pins, merge or deployment are introduced here.
