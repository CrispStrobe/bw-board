# Native CPU3 successful-work clock self-parity

**Status (2026-10-01): source-bound native proof passed and independently reproduced.** Executable, host-model, runner, validator, fixture and test source is frozen at `9bb43d86254d1708f00860d14eee64c8437e6cae`. This separate v6 prototype preserves the previous adapters and receipts.

The free BQNT001 fixture runs protected 16-bit code with 16-bit REP addressing and 32-bit STOS data. It programs the actual JavaScript I8254/I8259 models through guest PIO. A PIT edge cuts REP after architectural CX/DI progress is committed; pending IR0 remains masked through two recoverable page faults. The guest repairs its page tables, reloads CR3, retries, checks zero-count and one-element REP, then executes STI and its successor before actual PIC acknowledgment, EOI and IRETD.

BWS8 evidence and the BWR8 fd3/fd4 pipe transport keep successful-work quanta separate from native ticks. Each successful ordinary instruction or REP element immediately advances devices by six functional board clocks; zero-count REP completes once without data access. A failed attempt earns no successful-work charge. Native fault ticks advance only the native ledger. This is a scheduling proof apparatus, not a shipped CLI/GUI/WASM backend or a speed benchmark.

Post-BIOS ownership starts at `0000:7e00` with retained CPU state and 288 decoded RAM pages. PIT/PIC start fresh at board time zero. A20 remains enabled. BIOS device handoff, full reset/AT boot, A20 transitions and positive MMIO behavior are outside this fixture.

## Recorded boundaries

| Arm | Resume calls | Native ticks | Successful quanta | Raw events | Raw terminal idle observations |
| --- | ---: | ---: | ---: | ---: | ---: |
| Continuous | 21 | 4043 | 4041 | 37206 | 2 |
| Budget 1 | 4045 | 4043 | 4041 | 42255 | 1 |
| Budget 2 | 2026 | 4043 | 4041 | 39723 | 1 |
| Budget 257 | 35 | 4043 | 4041 | 37223 | 2 |

All arms record 24,246 active board clocks, 3,014 completed instructions, 1,029 successful REP elements, two page faults and one IRQ. There is no idle clock advance in this fixture. PIT uses its 1,193,182 Hz crystal with fractional carry; six board clocks per quantum is the existing functional AT convention, not a physical 386DX timing model.

The timer edge occurs at quantum 2,985 / board clock 17,910, after the 102nd element of the main REP: CX=926, DI=`0x4198`. The first fault occurs at quantum 3,907, CR2=`0x5000`, saved EIP=`0x7f0c`, CX=4, DI=`0x5000`. The second occurs at quantum 3,953, CR2=`0x6000`, saved EIP=`0x7f84`. Both stack frames contain error 2, their instruction address, CS=8 and flags=`0x10046`. Failed writes never commit. The page repairs/retries produce final PTEs `0x5063` and `0x6063`.

Zero-count REP at the still-unmapped `0x6000` earns exactly one quantum at Q=3,947 with no operand access. One-element REP at `0x6004` earns one at Q=3,989. Actual PIC acknowledgment returns vector `0x20` only after the STI successor at Q=3,999; the saved interrupt frame is `[0x7ff9, 8, 0x246]`. IRQ delivery adds no work or native tick after acknowledgment. Larger RUN calls may already contain successful work before acknowledgment; only that delivery interval is required to have zero charge.

The byte journal records 449 RAM read bytes and 9,389 committed write bytes. Every arm has 110 physical read callbacks, 2,356 write callbacks, 18 executable-page callbacks, 15 PIO outputs and 8,100 RPC transactions. All five native fallback counters remain zero. Executable-pointer fetch bytes are not individually journaled.

Cross-arm comparison retains all raw records, then removes command/RPC administration and global ordinals for the logical CPU/bus comparison. Only adjacent identical, effect-free terminal HALT_IDLE observations are collapsed. The resulting 17,964 logical events match across all budgets, alongside full host device evidence, RAM seeds and selected final CPU/RAM. Raw journals are not byte-identical across budgets. Separate checks enforce raw counts, per-attempt classification, slice limits, REQ→REP→typed-completion ordering and exact clock mirrors.

Twelve actual API probes pass. Eleven native fallback/memory/device guards and seven malformed command/reply guards abort at their named rejection with SIGABRT. Mutation tests use an exact lossless gzip of the retained historical initial capture: a passing baseline plus 27 rejected mutations, including incorrect REP/fault charges, lost progress, premature IRQ, changed idle state, wrong clock phase, altered RAM evidence, plausible replacement hashes and missing fallback/callback counters. That historical fixture is distinct from the final qualified receipt.

## Pins, receipts and reproduction

- Pinned Bochs: `0e45b736ef9792eb9b752b0a35db49eaf2faea47`; CPU3, SMP/debugger/repeat speedups/chaining/idle hack disabled.
- Free fixture: 2,560 bytes, SHA-256 `57f0247a8c198cd3aa0aa33b35e80d303eb3ae9ca50483cd22917e1d6d6b1d3c`.
- Native binary: `66d2b24b00afa9bf2614799b0f8fd37b32788f5b6885bcc1ce9f536810ffd702`.
- Config: `d4945445c2412c0b4e8c5cac80cee28d443bb438c36c9ea6b1bb5196147f1e8c`.
- Runtime include: `506980b4a62f11e0f5c5d841d0a75e9d0bf6b9d208f95d8a9342b3f283c16b31`.
- Formal JSON capture: `0bcb0b6acd6bd2768375e5d8e14915ba4df87c6e4e3a4ceb6c765f34d0d0c68b`.
- Compact result: `868486b74acc31dafe36697fc23d6a9967f52ef078d3d335007acdfbc05ae850`.

The [capture](receipts/2026-10-01-i80386-bochs-cpu3-native-device-quanta-capture.json.gz) is losslessly gzipped because the original JSON exceeds GitHub's 100 MiB file limit. The JSON hash above applies after decompression; the compressed file has its own hash: f0a93e3d9e6823e687f67bf4d9b38c7e05827589279d45904f5365bce950861a. The [compact result](receipts/2026-10-01-i80386-bochs-cpu3-native-device-quanta-result.json) states the bounded result. Raw external files are represented by retained SHA-256 references; the offline validator cannot authenticate file bytes it is not given. The capture runner rechecks actual sources, binary/config, media and artifacts.

Root's independent capture SHA is `0761457006163c04534b82db64bece3df484721160cc273aa741871ded54e38b`; its compact result is byte-identical. All host/native/RPC evidence and named guard outcomes agree exactly; their path-independent semantic SHA is `cb5a8ad5ddc9a65feb1eab613ebc8811ba549e369062d47c9d1e4aeb4b2c462f`. Whole capture bytes differ because path-bearing configuration/log hashes differ. Root separately verified all 90 actual artifact hashes in each capture, reparsed raw BWS8 records, replayed RAM bytes, checked fault/IRQ frames and native/work/RPC ordering, and independently computed PIT fractional carry. The independent attempt at the prior source timed out while exporting a guard RAM seed under VPS load; its files remain preserved. The final runner allows a bounded 120-second bootstrap/session and a 15-second post-READY RPC wait, with explicit retained timeout diagnostics. Both fresh final-source captures passed unchanged strict named-failure/SIGABRT checks.

At source `aae7a493bf86c8a43cf3d2ed23a5d73f591be315`, the broad 386 suite and affected adapter retest totaled 817 passing tests with six optional-data skips and no unresolved failures. The initial broad run lacked the locked `avr8js` dependency; after `npm ci`, all eight tests in that file passed. Actual report mutation tests passed 28/28. The subsequent runner-only timeout fix passed all four focused tests and the fresh formal and independent captures; executable CPU/device/validator bytes were unchanged. The hardware is four KVM vCPUs reported as Intel Xeon Skylake (IBRS, no TSX), Node 20.20.2, Ubuntu g++ 13.3.0. These are qualification runs, not RTx measurements.

These receipts bind the exact source freeze and dependency hashes, not a moving branch tip. Later documentation-only commits may preserve those executable bytes; preflight verifies them. Any runner/model/runtime change needs a new freeze and fresh captures, and runtime changes also need a new isolated build. Keep earlier receipts and record new pins rather than rewriting historical SHAs. Binary pins also identify the qualified build environment.

Reproduce in a clean checkout of the frozen source with new output directories:

```sh
BOCHS_386_ROOT=/clean/pinned/Bochs node scripts/prepare-bochs-cpu3-native-device-quanta.mjs --check
BOCHS_386_ROOT=/clean/pinned/Bochs node scripts/prepare-bochs-cpu3-native-device-quanta.mjs --prepare /new/native-device-quanta
cd /new/native-device-quanta/bochs
./configure --enable-cpu-level=3 --with-nogui --disable-plugins --disable-debugger --disable-repeat-speedups --disable-handlers-chaining --enable-instrumentation=instrument/stubs
nice make -j1
cd /checkout/of/frozen/source
node scripts/run-bochs-cpu3-native-device-quanta-compare.mjs --preflight /new/native-device-quanta
node scripts/run-bochs-cpu3-native-device-quanta-compare.mjs --capture /new/native-device-quanta /new/proof-directory
node --test test/i80386-native-device-quanta.test.mjs test/i80386-native-device-quanta-report.test.mjs
```

The [cold-reset/board ownership contract](I80386-NATIVE-COLD-RESET-NEXT-GATE.md) defines the next free checkpoint. Next, qualify a real board bridge and a separately pinned WASM build, then compare full guest state/events and measure matching workloads. General exception/trap accounting, other REP forms/address sizes, dual PIC/APIC, DMA/RTC/VGA/ATA and full reset/board ownership remain open. Windows enhanced mode, Doom and the 10×/RTx objective remain unfinished. Strict CPU3 has no CR4/PSE: unmodified stock xv6 belongs to the separately identified compatibility route; a strict 386 port needs 4 KiB paging and a compatible UP/PIC platform.
