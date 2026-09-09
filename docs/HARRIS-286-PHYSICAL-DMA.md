# Physical DMA and wired DOS boot work

2026-09-09. This supersedes the transfer limitations in the earlier
[register-only DMA](HARRIS-286-DMA.md) and [control-only FDC](HARRIS-286-FDC.md)
milestones. Those modes remain available and retain their refusal boundaries.
All additions remain experimental and explicitly gated. No application pin,
production default, deployment, or guest-media hosting changes are included.

## What crosses the wires

Enable `holdEnabled:true` on the board and `transferEnabled:true` on **both**
the DMA and FDC adapters. The board rejects an incomplete transfer configuration.

1. FDC execution asserts its resolved DREQ2 net. The programmed, unmasked DMA
   channel requests HOLD; the CPU finishes its current bus operation and grants HLDA.
2. The CPU releases its bus drivers. The external DMA master drives the shared
   address/byte-enable nets; a status multiplexer selects the current owner.
3. The existing memory phase controller generates the physical RAM read/write
   strobes. Disk bytes use the same resolved data lanes as CPU operands.
4. DACK and READY delimit each byte. A trailing acknowledgement advances the
   FDC sector cursor. The actual RAM model commits on its write-strobe edge.
5. N-1 count exhaustion generates TC and masks channel 2. Ownership returns
   to the CPU. DMA completions never become CPU operand completions.

The bridge does **not** call `I8237.transfer`, supply memory callbacks, patch
RAM on completion, or invoke the CPU interrupt API. The private FDC variant
disables the sector core's callback pump and automatic PIO fallback.

The admitted DMA modes are single/increment/no-autoinit channel-2 memory
write (46h), memory read (4Ah), and verify (42h, transfer gate required).
Verify acknowledges disk bytes and advances counters without RAM strobes.
The external page latch remains an XT-style 20-bit subset; the 16-bit address
wraps without carrying into it. Other channels, software transfer requests,
decrement, autoinit, demand/block/cascade modes remain refused.

The FDC admits READ/WRITE DATA with MT/MFM/SK flags in transfer mode. Images
are flat normal sectors: there are no deleted-data marks for SK to skip,
magnetic CRC validation, rotational latency, or mechanical drive timing.
PIO, FORMAT, READ ID and other unimplemented commands remain refused. Media
is supplied explicitly and cloned into a disposable private in-memory disk;
there is no persistence or public-media API in this adapter.

## HOLD, locking, and keyboard

With HOLD disabled, asserted HOLD still faults. Enabled HOLD grants only at
an idle boundary after pending write-data hold expires. A locked split operand
and the two interrupt-acknowledge cycles cannot be separated by a grant.
Memory XCHG marks its constituent requests locked. Explicit LOCK prefixes
remain unsupported on this physical path. RESET revokes ownership.

The [Harris data sheet](https://datasheets.chipdb.org/Harris/80c286.pdf)
describes HOLD/HLDA and the interrupt-acknowledge interlock. This implementation
is an ideal phase-level subset: released drivers and external passive-status
logic stand in for weak keepers; AC timing and a complete 82C288 arbitration
controller are not certified.

The optional `HarrisKeyboardAdapter` is an XT-style scancode latch and a narrow
mode-0 8255 bridge, not an AT 8042 keyboard controller. Guest mode 99h configures
ports 60h–63h. A supplied scancode raises actual IRQ1; the guest reads port 60h,
acknowledges with port 61h bit 7, sends PIC EOI and returns through IRET.
Busy input, unsupported programming and missing required wires fault explicitly.
Speaker/timer-2 behavior and a serial keyboard clock protocol are not modeled.

## Verification and boot acceptance

Owned tests exercise both byte lanes, a full 512-byte sector, RAM-to-disk/read
back, verify without RAM writes, N-1 terminal count, READY stretching, page
wrap, reset cancellation, missing DACK wiring, and HOLD during locked operands
and an INTA pair. Keyboard tests require guest interrupt delivery and
acknowledgement. Existing control-only/register-only tests remain separate.

Targeted regression: **500/500 passed, zero skips**:

```sh
node --test --test-reporter=spec test/harris-*.test.mjs test/digital-circuit-lab.test.mjs test/paterson-fat12.test.mjs test/sst286.test.mjs test/private-guest-fixtures.test.mjs test/dos-guest-persistence.test.mjs test/i8259.test.mjs test/i8254*.test.mjs test/i8255.test.mjs test/bios-rom.test.mjs test/bios-fdc.test.mjs test/upd765.test.mjs test/i8237.test.mjs
```

An additional BIOS-driver integration test passes separately:
`node --test test/harris-bios-dma.test.mjs` (**1/1**). An owned microguest
installs BIOS vectors and programs a faster PIT divisor, then calls the
unmodified INT 13h routine. It verifies the actual spin-up tick count, DMA
sector bytes, IRQ6 handling, successful return flags and restored stack.
Its explicit microguest entry replaces POST, so it is **not** DOS acceptance.
The existing non-wired DOS/controller differential test also passes **7/7**;
it validates the local image independently, not the new physical board.
The additional `harris-bios-keyboard` test passes **1/1**, exercising the real
BIOS's translation, ring buffer and two paced INT 16h reads through IRQ1.

The complete pinned real-mode SingleStepTests corpus has been rerun after the
CPU's implicit-lock change ([hashed receipt](SST286-HOLD-REPORT.json)): **1,477,997 pass, 3 upstream revocations, zero
failures/unsupported/budget cases**, across 326 files. This grades instruction
semantics through the test memory adapter, **not physical-board timing**.

`scripts/probe-harris-dos.mjs` uses only already-present local DOS build inputs,
assembles the owned BIOS/OEM boot code, and constructs a disposable disk in
memory. It starts at RESET with 640 KiB and text RAM. No BIOS/DOS service
traps, POST skips, host BDA writes, or direct interrupt injections are used.
The sole firmware option is the already-supported single-unbuffered PIC build.

The probe records its laboratory PIT divider explicitly. The BIOS divisor,
motor-start delay and wait loop are unchanged. This is functional acceptance,
not a claim about stock PC clock ratios or real-time performance. Two Enter
scancodes are paced at BIOS keyboard input to answer the DOS date/time prompts.
Acceptance requires boot-sector execution, matching loaded COMMAND.COM bytes
and PSP, disk activity, and an actual `A>` prompt in physical text RAM.

```sh
node scripts/probe-harris-dos.mjs 10000000 /tmp/harris-dos-result.json
```

The optional report is create-only. Missing local inputs and non-acceptance
are explicit failures; this command does not download, publish, or retain a
boot image. Long-run acceptance results will be recorded separately from the
owned component tests; a successful unit suite alone is not a DOS boot claim.

## Simulator overhead

Fixed topology is cached, only changed nets are resolved, and pure combinational
parts are reevaluated when their pin levels change. Unchanged settled calls
return immediately. Already-idle, unselected memory adapters avoid reconstructing
their state. Public resolver/inspection results remain defensive; `snapshot`
is internal settled state, not a mutable user API. Stateful device commits
remain outside combinational evaluation.

The previous resolver is retained as an independent test oracle. Tests compare
resolved conflicts, omitted-output releases, complete wired traces, READY waits,
and memory contents, and verify that public resolution does not consume pending
settlement and that failed convergence preserves the last settled snapshot.

Remaining limits include protected mode, complete PC/AT hardware, 8042/A20,
general DMA modes and channels, full FDC/media fidelity, DMA timeout policy,
browser/editor integration and performance. None is inferred from DOS boot.
