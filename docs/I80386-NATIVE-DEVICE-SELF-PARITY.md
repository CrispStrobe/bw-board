# Native CPU3 PIT/PIC device self-parity

**Status (2026-09-30): source-bound native device self-parity passed and independently reproduced.** Executable, host-model, runner, validator and test source is frozen at `5501fa3e0f7572c4747aa7ce093136ecccdcbb61`.

The free BDEV001 guest programs PIT channel 0 and a single master PIC through real guest OUT instructions. The host directly instantiates the existing JavaScript `I8254` and `I8259` models. PIT OUT0 drives PIC IR0; the PIC supplies vector `0x20` only when the native CPU accepts INTA. The guest installs a protected interrupt gate, executes STI and its successor, halts before the timer edge, checks the saved interrupt frame in its handler, sends EOI, and returns with IRETD before emitting its marker and entering a masked terminal HLT.

This is a separate native CPU3 adapter with BWS7 evidence and a bounded BWR7 pipe transport. The Node parent supplies dedicated fd3/fd4 pipes to the native child. Every callback request/reply and between-resume command is retained. IN and OUT yield after instruction commit. Device transitions request a post-commit cut; INTR setters run only between resumes, including after the IRQ-delivered cut. Recursive resume and line-setting from callbacks are rejected. The transport is a proof apparatus, not an installed CLI/GUI or performance backend.

Post-BIOS ownership begins at `0000:7e00`: native CPU state and 288 decoded RAM pages are retained, while the host PIT/PIC start from a declared fresh reset and board-time zero. This does not transfer the BIOS device state or qualify native reset/full AT boot. The inherited A20 gate is enabled; the reused typed map and pinned ROM remain unchanged. This fixture does not exercise A20 transitions or MMIO.

## Clock and interrupt evidence

The actual exported AT functional profile supplies 6,000,000 board clocks per second and six clocks per ordinary successful CPU quantum. PIT time uses its own 1,193,182 Hz crystal and fractional carry. These are functional scheduling conventions, not physical 386 instruction timings or an RTx measurement. The fixture excludes REP and faults; their successful-quantum accounting remains a later boundary.

| Arm | Resume calls | Native ticks / successful quanta | Raw native events | Raw HLT idle observations |
| --- | ---: | ---: | ---: | ---: |
| Continuous |20|92 / 92|584|4|
| Budget 1 |95|92 / 92|657|2|
| Budget 2 |50|92 / 92|612|2|
| Budget 257 |20|92 / 92|584|4|

All arms have 552 active board clocks plus 20,492 idle clocks, for 21,044 total. During idle, the PIT edge occurs at board clock 20,804 while native ticks remain 52. The PIC raises INT, acknowledgment returns `0x20` and clears IRR/sets ISR, the host stages line deassertion after delivery, and guest EOI clears ISR. The handler and final RAM witness agree on saved EIP `0x7e9c`, CS `8`, flags `0x246`, and successor/IRQ-count bytes `1`/`1`. Terminal IF is clear and no second interrupt is taken.

Every raw record is preserved. RUN commands and global ordinals vary with the budget. A continuous slice can also report an unchanged halted state before a zero-tick reentry, whereas a one-tick slice first returns at the HLT instruction's budget boundary. The cross-arm projection excludes CMD/RPC administration and strips ordinals, then collapses only adjacent identical HALT_IDLE observations with no CPU/device event between. It compares 343 logical CPU/bus/IRQ events, the full actual host-model journal, selected final CPU/RAM, and seeds. Separate checks validate the complete RPC mirrors, REQ→REP→native completion ordering, per-slice caps/continuity and actual zero-tick idle/delivery cuts. This is not raw-journal byte equality across budgets.

The native byte journal contains 96 RAM read bytes and 38 committed write bytes. Replaying the seed and writes verifies every read and reconstructs the final frame witnesses. Physical callback totals are 21 reads and 15 writes; execute-page callbacks are 4 and tick callbacks 92. There are 15 guest port outputs and 108 synchronous RPC requests/replies. All five Bochs RAM/direct-pointer/PIO/timer fallback counters stay zero. Instruction fetch bytes through executable pointers are not individually recorded.

Nine actual C ABI probes pass. Eleven actual native memory/device/fallback guards and seven malformed command/reply guards terminate with their exact named failure and SIGABRT. Transport cases cover command sequence, negative/overflowing budget, overlong line, reply sequence, negative value and uint32 overflow. The runner bounds input/output and response/session time, retains failure evidence, and closes the child process group. It rehashes sources, binary/config, free media and retained artifacts.

## Qualification and reproduction

- Pinned Bochs: `0e45b736ef9792eb9b752b0a35db49eaf2faea47` (CPU3; SMP/debugger/repeat speedups/chaining/idle hack disabled).
- Free fixture image: `ce06e9c8ebb8e014f548cf03ba2fd11b16b13e1eaed1ea58fd056da3bbc08cff` (2560 bytes).
- Native binary: `a97dc9f7519da1d65fd181e62dad4b5a88c60f6dce295c866e596bbd3ba632ca`.
- Config: `d4945445c2412c0b4e8c5cac80cee28d443bb438c36c9ea6b1bb5196147f1e8c`.
- Qualified capture: `f33e03c8545e19f041d50b62739c031726def490eb30dbaa6e17d20357bfe2af`.
- Compact result: `1d48bbf9df3d38efba82ddd1bb3552d14ef3ed383dddd2e3eb904bfc8d8501b3`.

The [capture](receipts/2026-09-30-i80386-bochs-cpu3-native-device-events-capture.json) contains raw-record-derived CPU/bus evidence, actual host-model state/journals, RPC transcripts and source/build/media/seed/artifact identities. The [compact result](receipts/2026-09-30-i80386-bochs-cpu3-native-device-events-result.json) states the bounded scope. Raw external files have retained SHA-256 references; the offline semantic validator does not authenticate unprovided file bytes. The source-bound runner and root audit verify the actual files.

Root's independent capture SHA is `073c10a7c233e6de09327c390b031d2e358e51751795a53317f2a758e1c31269`; its compact result is byte-identical. Full host/native/RPC evidence and named guard outcomes match. Their path-independent semantic SHA is `d1278ebfd25f37cf718490a5692efde5ebaf6f8ac1ba6d13f0f18c609dae9db6`. Complete capture bytes differ because configuration/log hashes include output paths. Root separately verified all 90 retained artifact/input hashes, reparsed raw records, reconstructed RAM reads/writes, checked raw ordinal/RPC/frame ordering, and independently calculated PIT edge/fractional carry with rational clock arithmetic.

Focused tests pass 23/23 without skips: actual model/parser tests and a clearly labeled historical four-arm mutation input. Nineteen one/all-arm mutations reject false clocks, plausible fractional/model state drift, RAM class/value/effect substitutions, callback/API loss, reply ordering, saved frames, idle cuts, binary identity and guard exits. The historical input proves the core boundary with eleven native guards; it does not invent the seven later transport executions. Root additionally rejected eight mutations of the actual final transport report. The broad 386 suite passes 785 tests with zero failures and five optional-data skips.

Reproduce from a clean checkout of the frozen source using new directories:

```sh
BOCHS_386_ROOT=/clean/pinned/Bochs node scripts/prepare-bochs-cpu3-native-device-events.mjs --check
BOCHS_386_ROOT=/clean/pinned/Bochs node scripts/prepare-bochs-cpu3-native-device-events.mjs --prepare /new/native-device-events
cd /new/native-device-events/bochs
./configure --enable-cpu-level=3 --with-nogui --disable-plugins --disable-debugger --disable-repeat-speedups --disable-handlers-chaining --enable-instrumentation=instrument/stubs
nice make -j1
cd /checkout/of/frozen/source
node scripts/run-bochs-cpu3-native-device-events-compare.mjs --preflight /new/native-device-events
node scripts/run-bochs-cpu3-native-device-events-compare.mjs --capture /new/native-device-events /new/proof-directory
node --test test/i80386-native-device-events.test.mjs test/i80386-native-device-events-report.test.mjs
```

Earlier adapters/builds/receipts remain unchanged. This gate covers one actual PIT0/single-PIC model connection, not dual PIC/APIC, DMA/RTC/VGA/ATA, full JavaScript AT event parity, native/WASM board integration, Windows enhanced mode, Doom, or the 10× speed target. Next, define and prove successful-quantum/device-time behavior through REP, fault retry and an active timer edge before integrating and measuring the backend. Strict CPU3 cannot run stock xv6's CR4/PSE bootstrap. A strict 386 xv6 variant needs 4 KiB paging and a compatible PIC/UP platform; the existing stock-xv6 JavaScript compatibility route remains separately identified.
