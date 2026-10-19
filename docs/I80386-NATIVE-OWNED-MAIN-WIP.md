# Native 386 closed main-thread diagnostic — WIP

External licensed-guest notes and historical context are retained in the [private documentation archive](https://github.com/CrispStrobe/brickwright-firmware-private/tree/master/public-documentation-archive/2026-10-04). Public examples and instructions use freely licensed or freeware software.

The fixed free protected-mode ROM now runs with the existing ABI3 addon and actual private provider inside a fresh child process on its main thread. This separate topology removes internal Worker IPC and per-resume JSON replies while preserving all **439 full native snapshots** and **six exact Q checkpoints**. It is a new ownership/provenance proof, not adoption of the earlier [Worker candidate](I80386-NATIVE-OWNED-CLOCK-WIP.md), whose CPU gate failed.

Capture OFF matches every original CPU/device snapshot, settled board and whole RAM with an empty journal. Capture ON matches **all 1,649,067 canonical CPU rows and 209,839 ordered host rows**, including the exact journal SHA `bf1224a77fed44aaabe0e2e00cb2319e25084aca71601d215930f3362722f3f1`. Snapshot comparison removes only newly added physical clock-transfer counters on native snapshots and converts the complete 160-byte slice representation losslessly. Native N 100,684/Q 100,682, two faults, one IRQ and two HLT cuts remain unchanged.

## Source, lifecycle and containment

The [qualified runtime checkout](https://github.com/CrispStrobe/bw-board/tree/bab751825473d55d8bf6da8c6ad5786921ffcfe1) is `bab751825473d55d8bf6da8c6ad5786921ffcfe1`, with seven new files and 95 authenticated inputs. The unchanged addon SHA is `144f3af7b906e46bfb68c10b991fef15847d81c60e7bb44820ee73653e723818`, compiled from `7df84bc2c367aff1cadec7cecdde69cf0e904ace` with its separate 86-file source map and actual build/prepared/config receipts. All 86 old source bytes remain unchanged. The current publication checkout and later merged code are distinct identities; they have not received this runtime qualification. The archived seven qualified source files permit exact inspection without relabeling compilation or merged-main source.

The loader is lexical and unexported inside a direct CLI entry. It admits the fixed SHA-bound configuration, tracked free BIOS/VGA assets and ROM before addon load. The provider, native methods and callback table stay private; no caller board, hooks, raw API or ownership brand are admitted. Native initializing-thread/environment ownership, singleton lifetime, busy/reentry, fault/mapping/clock guards remain actual unchanged C/C++ behavior.

All **13 actual fresh-child lifecycle controls passed**: second create and failed callback capture reject before callbacks, failed capture permits subsequent valid creation, and five wrong-thread operations reject while the initializing main thread remains valid. Ten clock/memory callback reentry cases reject nested resume/inspect/close/setIRQ/create and deliberately trigger the native fatal guard, with no later observer. These unsupported diagnostic wrappers prove denial, not production-hook admission or rollback of preceding legitimate effects.

Trusted parent launch and a fresh bounded child are required: heap 512 MiB, CPU/wall 120 s, files 256 MiB, core 0 and nice increment 10; executable hook/profile environment variables are blank. Child bootstrap checks cannot undo already executed preloads, and main-thread lexical ownership is not isolation from arbitrary injected code or debugger access. Native abort kills the child; no safe in-process native cancellation or reusable startup-failure recovery is claimed.

## Paired process-CPU result

The single predeclared gate has two discarded warmup pairs and seven alternating measured H4/main pairs: 18 sequential fresh children. It requires at least 10% lower mean process CPU and all seven pairs favorable, with full snapshot/device/RAM parity every child. The process.cpuUsage window includes scheduler, local callbacks, all snapshots, six board checkpoints and GC; creation, settlement and final report serialization stay outside both arms. The actual gate **passed**: H4 averaged **503,081.571 µs** and the new main-thread ABI3 runner **370,625.714 µs**, or **26.3289% less process CPU**, with all seven measured pairs favorable. All 18 children retained complete logical snapshot/device/RAM parity. Independent result audit passed **318,736 checks**, authenticating all 18 complete captures, source/build bindings, resources, CPU arithmetic and the predeclared gate. The CPU-cost ratio implies about **1.35738×** fixture work at an equal process-CPU budget, not a physical-clock RTx measurement, a general guest speedup or the 10× target. The single earlier smoke is not the speed evidence.

The first parent preflight failed before any native child because compiled H4's 32-file source map was incorrectly assumed to be a subset of its 61-file runtime closure. The failed parent receipt is retained. The repaired second attempt authenticates these maps independently and uses the identical predeclared plan; it is not a retry of a negative CPU result.

The passed gate qualifies this isolated main-thread fixed-ROM candidate against H4; it does not retroactively change the failed Worker or transport results. Full AT boot, native xv6/broader guest/broader game, general CLI/GUI/browser integration, physical 16 MHz 386 RTx and the broader 10× target remain unqualified by this fixed fixture.

The next bounded work is to profile the new main-thread native callback and clock-replay costs before choosing another optimization, then separately broaden freely licensed AT guest support. Existing Worker attribution does not quantify CPU shares in the new topology.

[Lossless source, positive/negative controls, build bindings and SHA-indexed receipts](receipts/2026-10-02-native-owned-main/index.json) preserve the evidence. Large native traces, host journals and the native binary remain outside this small archive.

## Main-thread attribution (2026-10-02)

One separate, unprofiled timing diagnostic preserved all 439 resumes, six CPU/board checkpoints, settled state, RAM, and physical clock counters exactly against the qualified main-thread capture. Independent review passed 18,491 checks. Its two instrumented JavaScript files reverse exactly to the frozen source; their identity is recorded separately from runtime `bab75182` and compiled addon `7df84bc2`. Startup INIT and terminal settlement are excluded from the timer buckets.

| Execution-only wall bucket | Calls | Time (ms) |
| --- | ---: | ---: |
| Native resume, including C/NAPI snapshot construction | 439 | 337.798 |
| Clock callback, inclusive | 9,203 | 147.251 |
| Ordered clock replay | 9,203 | 108.890 |
| Clock preflight | 9,203 | 18.279 |
| Native-tick dispatch and actual board effect | 100,684 | 33.010 |
| Quantum dispatch and actual board effect | 100,682 | 36.662 |
| Clock state validation | 9,668 | 8.664 |
| Clock reply allocation | 9,203 | 5.487 |
| Full board checkpoints | 6 | 6.529 |

These buckets overlap: native resume contains clock callbacks; replay contains dispatch. Per-word closures, timestamps and bookkeeping also distort this diagnostic. The times cannot be summed, converted into process-CPU shares, or used to predict a removable speed gain. The instrumented execution used 512,453 µs of process CPU; it is not another performance-gate sample and does not replace the qualified seven-pair result.

The source review found that both clock methods create temporary argument arrays and effect closures for every word even when journaling is disabled. The subsequent [allocation candidate](I80386-NATIVE-OWNED-CLOCK-ALLOC-WIP.md) preserved actual parity but failed its predeclared CPU gate; qualified MAIN remains the baseline. The next source-only hypothesis aggregates private capture-OFF ledger effects after the complete ordered clock preflight. It needs separate native qualification and a new paired CPU gate before any gain is claimed. The generic board and held H4 remain unchanged.

The earlier logged source-check attempt timed out after 30 seconds before its first test result. Its partial output and failure receipt remain preserved. A subsequent unchanged, SHA-bound check passed all six tests within the 120-second containment budget. Host contention is a possible explanation for the earlier timeout; its cause was not established.

[Lossless diagnostic source, test attempts, authenticated capture and audit receipts](receipts/2026-10-02-native-owned-main-attribution/index.json) retain the complete small evidence set. No extra guest, native profile or performance-gate retry was performed.
