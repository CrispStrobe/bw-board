# Native 386 clock batching — experimental ABI3

The separate native ABI3 candidate executes the fixed free protected-mode ROM against an actual private board. Its first complete capture matches **all 1,649,067 canonical native CPU rows and all 209,839 chronological logical board events** from H4, including six full CPU/board checkpoints, settled PIT/PIC state and the whole RAM hash. This is actual native CPU execution, extending the earlier [host-only ownership replay](I80386-NATIVE-OWNED-CLOCK-REPLAY-WIP.md).

Actual counters show **9,204 clock transfers: 8,738 nonempty commits plus 466 state queries**, carrying exactly 201,366 ordered native-tick/successful-work words. Native tick and successful work remain independent (100,684 N versus 100,682 Q). These are measured crossings for this ROM; crossing reduction alone is not a throughput or RTx result.

## Source and ownership

Compiled source is frozen at `7df84bc2c367aff1cadec7cecdde69cf0e904ace`, with 16 new files and an authenticated 86-file closure. Documentation/merge revisions do not relabel that identity. The held H4 baseline was compiled from `15631beb63d7c1f17e693de7c86d4ed37b96a768`. The inherited H4 preparer lists 25 source files; the historical packed H4 compiled manifest lists 32. They are distinct provenance records.

The factory creates the fixed ROM, board and native engine inside a pristine Node worker. Native execution and synchronous memory/page/PIO/IRQ/clock callbacks stay on its initializing thread. Parent IPC carries whole resumes and snapshots. It accepts serialized trusted artifact paths, not caller boards, hooks or live callback objects. The generic ABI2 loader and dynamic callback behavior remain unchanged.

A static 900-word tape preserves N1/Q0/QREP order across faults and longjmp. Independent per-resume limits are 600 N and 300 Q; total bounds remain 160,000/150,000. Device deadlines constrain successful work independently of ticks. Commits flush before host observations, fault/IRQ/HLT boundaries and returned snapshots. Pending A20 changes reject observers and N/QREP before effects; ordinary-Q publication keeps the original mapping/cache transition. INIT/ENTRY/POSTPIO queries have explicit phase guards. Native logical counters and trace ordinals remain unchanged; physical crossing counters are separate.

Every clock response is copied from an attached ordinary exact-backing seven-word Uint32Array and checked against cumulative ledgers, mapping and clock mirrors. The private actual device provider supplies legitimate deadline/rearm changes; the C layer does not invent an independent PIT model.

## Actual checks

The frozen source passed **81 tests without skips**, including 27 executable C clock-helper controls and provider/source-inverse checks. A fresh single-job build passed root and independent static artifact audits. Actual capture OFF has an empty journal and matching full logical snapshots/RAM; capture ON preserves the complete original CPU and board chronology. Comparing snapshots converts H4's indexed-object `sliceBytes` into an exact contiguous 160-byte array; no CPU bytes are masked. Only newly added physical clock counters are excluded from original-snapshot equality.

All **33 fresh-process runtime controls passed**: independent N/Q limits, zero-work deadline, malformed reply fields/backing, query phases, reentry, initializing-thread ownership and singleton lifetime. Fifteen controls exited normally; eighteen intentionally triggered the native fatal guard. Malformed-reply controls first apply correct board effects, then corrupt the response; they prove acceptance denial and no later observer, not rollback.

The initial guest launch failed before guest execution because a saved configuration referenced removed BIOS files. Its receipt remains preserved. A new configuration changes only paths to SHA-bound tracked free BIOS/VGA files; compiled source is unchanged. The first offline comparison also rejected array-versus-indexed-object serialization shape; strict byte-preserving conversion resolved it without a guest rerun.

## Measurement and limits

The predeclared process-CPU gate **failed**. Across seven measured pairs, H4 averaged **477,772 µs** and ABI3 **522,203.571 µs**: **9.2997% more process CPU cost**, with only one of seven pairs favorable. All 18 fresh children retained full logical snapshot/device/RAM parity. H4 remains the baseline; no performance-gate repeat or adoption followed the negative result.

The protocol used two discarded warmup pairs and seven measured alternating H4/ABI3 pairs, with a fresh child for each run and both journals/profilers disabled. The window includes all parent/worker threads, IPC, callbacks, GC, resumes/snapshots and six checkpoints; it excludes startup, settlement and final report serialization. The gate required at least 10% lower mean process CPU and all seven pairs favorable, with full logical parity in every child. The broader [10× target](I80386-10X-PERFORMANCE.md) remains open. The next work is attribution of worker/tape replay/snapshot/IPC costs before another optimization.

This remains a bounded diagnostic, not a general native backend or GUI/browser implementation. Worker termination cannot cancel arbitrary C++ or contain a native abort: CLI/tests need a fresh child process with heap/file/core/wall limits. Full AT boot, native xv6/Windows/Doom, production CLI/GUI integration and physical 16 MHz 386DX RTx are not qualified by this fixture.

`node scripts/prepare-bochs-cpu3-native-owned-clock.mjs --prepare /new/tree` requires `BOCHS_386_ROOT` pointing to the clean pinned Bochs source. Preparation does not build or run. `node scripts/run-i80386-native-owned-clock.mjs /absolute/input.json` is a diagnostic child entry, requiring authenticated prepared/build receipts, the fixed-ROM JS reference and existing BIOS/config paths; invoke it through bounded process containment, not directly in a long-lived application. Source/receipt identities must match the checkout used for compilation.

## Receipts

[Lossless source/build/capture/control/measurement receipts and their SHA index](receipts/2026-10-02-native-owned-clock/index.json) retain the actual positive and negative results. Large CPU traces and host journals remain local and hash-bound; all guest code used here is freely licensed.
