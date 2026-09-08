# Wired conventional-memory and text-RAM prerequisite

2026-09-08. The experimental Harris board now supports explicit conventional
RAM expansion through 640 KiB and an optional B8000h text-memory window. This
removes the previous 64 KiB physical-memory ceiling. It is not a BIOS, disk
controller, display implementation, DOS boot or complete 286 acceptance.
No application pins, GUI defaults, saved-profile schemas, media or deployment
were changed.

## Why this gate matters

The existing `test/dos-boot-fdc.test.mjs` uses SYSINIT's relocation segment
`9000h`, corresponding to physical `90000h`. `rom/bios.asm` declares 640 KiB
and reports it through its BIOS data area/INT 12h. Neither is satisfied by
the original wired board's 64 KiB. This is a source-level prerequisite audit;
the existing successful DOS boot test uses a different, non-wired machine.

## Construction

```js
createHarrisMemoryBoard({
    enabled: true,
    ramBytes: 640 * 1024,
    textRAM: true,
    rom, romLowAlias: true
});
```

Default `ramBytes` remains 65536; allowed values are 64 KiB through 640 KiB in
64 KiB increments. `textRAM` defaults false. Both remain behind the board's
existing explicit experiment gate. PIC/timer options compose with this map;
their defaults remain off. Firmware must report the configured capacity:
the board does not secretly initialize BDA memory-size fields or INT 12h.

| Address window (inclusive) | Backing and conditions |
| --- | --- |
| `000000h .. ramBytes-1` | Conventional RAM, pairs of registered 62256 chips |
| `0A0000h .. 0B7FFFh` | Unmapped; no graphics RAM or MDA window added |
| `0B8000h .. 0BFFFFh` | Optional text RAM, not a video controller |
| `0C0000h .. 0EFFFFh` | Unmapped option-ROM region |
| `0F0000h .. 0FFFFFh` | ROM alias only with `romLowAlias:true` |
| `FF0000h .. FFFFFFh` | Existing reset ROM |

The interval between installed conventional RAM and A0000h is also unmapped.
All other addresses remain unmapped; there is no A20 wraparound or hidden
extended memory. Unmapped reads fault on floating data. Unmapped writes still
have no responding storage, as in the earlier board; this increment does not
turn them into allocation or invent a hardware bus-error signal.

## Wiring and inspection

Each added 64 KiB conventional window has two existing 32Kx8 memory adapters,
connected to the 16-bit bus by byte lane and selected using the full latched
address and M_IO. Storage is never accessed via a CPU-address callback. RAM
writes still commit on the controller's WR trailing edge; READY stretches
the command without early or repeated writes.

Legacy bank-zero IDs stay `ram0`/`ram1`; extra pairs are `ram1_0`/`ram1_1`
through `ram9_0`/`ram9_1`. Text chips are `text0`/`text1`. Their decoder selects
only B8000h..BFFFFh: CPU A1..A15 address the upper 16 KiB of each existing
32 KiB chip, so the lower half is intentionally not mapped. For example, the
first character/attribute bytes appear at chip offset `4000h`. This mapping
does not alias conventional RAM or broaden the text window to B0000h.

`board.memoryMap` is frozen metadata containing primary half-open ranges,
explicit ROM aliases and chip IDs. `inspectMemory(id)` retains defensive
copies of chip storage and write counters. Neither interface changes the
hardware path. The saved `harris-latched-memory-v1` recipe remains a fixed
64 KiB profile; expanded maps are construction-API experiments, not silently
accepted additions to that saved schema.

Word transfers spanning a 64 KiB boundary use two physical byte cycles. A
fault in the second cycle cannot roll back the already completed first byte.
Tests distinguish this from an even-word transfer, whose two selected lanes
are preflighted before either chip commits. Faulted boards remain unavailable
until reconstructed.

## Evidence

Final targeted run: **274/274 passed, zero skips**, including PIC/PIT and
the prior wired regressions.

Ten owned tests in `test/harris-memory-map.test.mjs` cover configuration guards,
640 KiB signatures/bank isolation, the top conventional word, boundary-split
words, READY/write counts, ROM isolation, exact text-window bounds, unmapped
holes, broken upper-bank nets and partial-transfer failure semantics.

An owned assembly guest uses REP MOVSW to relocate executable bytes to
`9000:0200`, far-calls them, returns with RETF using a stack in segment `8000`,
and stores an actual character/attribute word at `B800:0000`. Results are
verified in registers and the physical chip arrays. This is deliberately
named a relocation/stack/text-memory regression, **not a DOS or display test**.

```sh
node --test --test-reporter=spec test/harris-*.test.mjs test/paterson-fat12.test.mjs test/sst286.test.mjs test/private-guest-fixtures.test.mjs test/dos-guest-persistence.test.mjs test/i8259.test.mjs test/i8254*.test.mjs
```

CPU/SST adapter/runner SHA-256 values still match
[SST286-INTR-REPORT.json](SST286-INTR-REPORT.json). The previous full real-mode
result remains 1,477,997 passes, three revocations, zero failures/unsupported/
budget exits. No new full-vector run is claimed. Those vectors do not validate
the physical memory map. No full CI or browser acceptance was run, and no
performance improvement is claimed: more physical chips increase simulation
work per bus cycle.

## Remaining boot gates, checked against this tree

An actual unmodified owned-BIOS probe was also run with `buildBios().bytes`,
640 KiB RAM, text RAM, ROM alias, PIC and timer enabled (divider half-period 8).
It exhausted its 6,000 execution-clock budget after 747 retired instructions
at `F000:0073`, still in the initial IVT setup loop. PIC writes were zero and
the timer remained unconfigured. Built ROM SHA-256:
`6f9f5463afa5c30ce25263c0430f741cbb0274e98b00c675ef04c9edfee0aa34`.
The probe result is **accepted:false**: no POST completion, peripheral fault,
disk transfer or boot was observed. Increase the execution budget for the next
probe; do not skip IVT initialization or host-initialize its RAM to shorten it.

The [PIC](HARRIS-286-PIC.md) and [timer](HARRIS-286-TIMER.md) subsets now exist;
the old statement that the board has neither is obsolete. They still do not
make the existing BIOS directly compatible:

- BIOS POST writes PIC ICW4 `09h` (buffered mode); the wired adapter explicitly
  accepts only `01h`. This is a known configuration mismatch, not an observed
  full-ROM execution result. Do not silently ignore the requested mode.
- BIOS POST configures PPI/keyboard and video ports. Text RAM alone does not
  implement those devices or their status reads.
- Its floppy driver uses uPD765 ports, IRQ6 and 8237 DMA channel 2/page-latch
  registers. The wired board has none of that disk/DMA path; CPU HOLD/bus
  arbitration is still unsupported.

Next, extend the bounded owned-BIOS POST probe on this map and implement the first
verified peripheral/configuration gap. Then wire the disk transfer path and
verify real boot-sector loading before claiming DOS boot. Existing non-wired
DOS tests are useful references, not substitutes for those gates. Protected
mode and full 286 conformance remain separate unfinished work.
