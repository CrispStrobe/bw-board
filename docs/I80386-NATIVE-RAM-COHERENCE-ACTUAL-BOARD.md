# Native CPU3: actual-board executable RAM, SMC and A20

**Qualified bounded checkpoint, 2026-10-01.** A separate pinned Bochs 2.7 CPU3 bridge executes the free RAM-coherence ROM before the first BIOS instruction. The actual JavaScript AT board owns RAM, ROM, effective A20 mapping, ports and device clocks. Continuous and successful-work budgets 1/2/257, followed by a separate fresh reproduction, reach 75 instructions and 454 functional board clocks. These counts are not physical 386 timing or an RTx result.

The [actual capture](receipts/2026-10-01-i80386-native-ram-coherence-capture.json.gz), [result](receipts/2026-10-01-i80386-native-ram-coherence-result.json) and [audit](receipts/2026-10-01-i80386-native-ram-coherence-audit.json) are public. This extends the [qualified native ROM-only cold entry](I80386-NATIVE-COLD-RESET-ACTUAL-BOARD.md) with persistent executable RAM and committed cache coherence. It is a qualification bridge, not a shipped CPU backend.

## Guest and cache ownership

The [free JavaScript baseline](I80386-JS-RAM-COHERENCE-ORACLE.md) defines the MIT guest and its eight entries into RAM code. Guest writes create `MOV BX,imm16; RETF` at physical `7000` and `107000`. The actual 8042 switches A20 OFF and ON. Both raw aliases execute in the same OFF epoch before an aliased operand write. The final words at `0520..052F` are `1111/2222/2222/2222/5555/5555/3333/4444`; low and high code end as `BB5555CB` and `BB4444CB`. No executable RAM is preseeded.

Native internal A20 stays ON so its address mask preserves raw addresses. The actual board applies A20 and returns decoded backing, mapping epoch, page generation and authenticated bytes. Persistent aligned page slots retain their storage; admissions are keyed by raw page and mapping epoch. Ordinary RAM and ROM execute; the VGA/MMIO aperture and open-bus execution are rejected.

A WRITE acknowledgment means the actual board has committed the bytes. The native bridge stages executable-cache updates until the owning instruction successfully completes. It then patches every current decoded alias, updates generation and SHA, changes write stamps, and flushes instruction caches, TLB and prefetch before publishing post-state or admitting another instruction. A20 changes invalidate mapping admissions at the same committed boundary. Even writes with zero executable aliases require a flush-completion witness.

Each arm retains 31 COMMIT records, four ALIAS_UPDATE records, 25 COHERENCE records, eight page fills and 70 execute callbacks. The OFF alias write updates both raw `7000` and `107000` pointers to decoded `7000` at generation three. The high backing remains independent. The 235 consumed instruction bytes, 32 read bytes, 70 write bytes and 11 byte PIO events match the baseline under only the named differences below. All eleven configured chips, device debt, reset/interrupt signals and terminal settlement are checked. Native execution leaves the board's JavaScript CPU unused.

## Preserved differences

Architectural reset parity is **false**. Full raw reset caches/registers and guest witnesses remain captured; the predeclared [cold-entry reset differences](I80386-NATIVE-COLD-RESET-ACTUAL-BOARD.md) still apply.

Full JavaScript/native byte-bus-order parity is also **false**. Exactly eight successful immediate 16-bit far calls write their ordinary RAM stack frame in different word order. Pinned Bochs `ctrl_xfer16.cc` pushes CS then return IP; the JavaScript transactional stack commit writes ascending frame addresses, IP then CS. The checker independently derives both exact sequences at the eight declared sites and requires two native word callbacks. It does not sort bus events or allow a generic permutation. RETF reads and every other data access retain exact order. Both raw chronologies and source hashes remain in the capture.

Native order across all four budgets is exact after removing only RUN commands/ordinal numbering and collapsing adjacent identical, effect-free terminal HALT observations. Raw HALT counts remain checked as 2/1/1/2, with 13/76/40/13 slices. Every cumulative slice counter is bound to preceding raw chronology; counters are not summed as per-resume deltas.

## Qualification and replay

Measured source: `93020e30a16fe6327ab5edc99a55c7688d897bae`, with 58 committed inputs authenticated before and after capture. Pinned Bochs source: `0e45b736ef9792eb9b752b0a35db49eaf2faea47`. Audited native binary SHA-256: `7921ba0624c906c9a957870261618964f8a78a691a22ad4fb9c652ffc641b74e`. CPU level 3, SMP off, debugger off, REP speedups off and handler chaining off are part of the source/build proof.

The uncompressed public capture is 60,269,199 bytes, SHA-256 `55f3330db564f86a265a478b106ffdbfddb921d35234480a8502cf8aa817127c`. The gzip SHA-256 is `66ffbfd2d38ec33aacfa17310ec986e4ad47d8ad60060a707c3fd0db6fe5151a`. Root independently checked all 201 external artifact hashes per fresh capture, historical source blobs, raw event ordinals and clocks, physical RAM backing, executable alias bytes/generations, instruction snapshots, named CPU differences, ordered data accesses and whole-board checkpoints with Python.

The two fresh captures have exactly equal native records/state, actual-board journals and dedicated RPC transcripts in every arm. Their whole JSON files differ because the retained output directory changes the Bochs log path, diagnostics and artifact hashes. They are not described as byte-identical captures.

All eleven API probes, sixteen native guards and twenty injected transport rejections pass. The mandatory report suite uses an exact initial actual capture from `ef2a7359`, not manufactured arms: one passing baseline plus 78 corruption tests pass without skips. Mutations rebuild raw/parsed evidence and both artifact digest mirrors, with specific semantic diagnostics required. The five host tests and twelve census tests also pass. The final serial run of these suites plus the adjacent JS RAM and native cold-entry report suites passes all 170 tests without skips. Ordinary CI needs no native binary to run these committed report checks; it fetches both exact historical source revisions.

Build and capture from a clean checkout with a clean pinned Bochs source tree and GNU binutils:

```sh
BOCHS_386_ROOT=/path/to/pinned/bochs node scripts/prepare-bochs-cpu3-native-ram-coherence.mjs --prepare /new/build > /new/manifest.json
cd /new/build/bochs
./configure --enable-cpu-level=3 --with-nogui --disable-plugins --disable-debugger --disable-repeat-speedups --disable-handlers-chaining --enable-instrumentation=instrument/stubs
make -j1
cd /path/to/bw-board
node scripts/run-bochs-cpu3-native-ram-coherence-compare.mjs --build /new/build --manifest /new/manifest.json --out /new/capture
node --test --test-concurrency=1 test/i80386-native-ram-coherence-host.test.mjs test/i80386-native-ram-coherence-report.test.mjs test/oracle-census.test.mjs
```

A new compiler/build produces a different binary identity and needs a separately audited source-bound qualification; the current proof intentionally rejects substituting another digest. This replay recipe describes the apparatus, not an assertion that another host's binary matches the published one.

## Retained failed drafts and next work

The `7567ebb4` draft actually executed the guest but failed strict JS/native data order. Its capture remains unqualified. After auditing both engines, the exact eight-site rule was declared in later source before fresh captures. The `fd208489` draft then failed because the checker summed cumulative HALT counters; `ef2a7359` corrected the raw chronology binding. Neither failed capture was relabeled as passing. An earlier build's missing IRQ setter export and the invalid-segment guest pilot are retained in local build/audit notes.

Next run the free REP/two-page-fault/PIT fixture through this same actual-board ownership seam, qualifying committed cache updates at REP and fault boundaries. Then define a production backend factory and an in-process/WASM path before paired workload speed measurements. Protected-mode/paging/IRQ compatibility, full AT boot, strict-386 xv6, Windows enhanced mode, Doom and the 10× target are not established by this real-mode fixture.
