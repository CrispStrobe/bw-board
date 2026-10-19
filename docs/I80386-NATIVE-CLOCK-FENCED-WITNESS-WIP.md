# 80386 native clock witness and fenced H4 diagnostic — WIP

External licensed-guest notes and historical context are retained in the [private documentation archive](https://github.com/CrispStrobe/brickwright-firmware-private/tree/master/public-documentation-archive/2026-10-04). Public examples and instructions use freely licensed or freeware software.

The unchanged H4 engine now has an authenticated diagnostic capture of **all 439 resume entry/return pairs**, six selected checkpoint inspections, IRQ staging, terminal settlement and close. Its 1,326 fence rows preserve exact host callback ordinals and independent native-tick/successful-quantum ledgers. Full exposed CPU, board and RAM match held H4; all 1,649,067 canonical native trace rows and the entire ordered host journal match accepted H1. This is evidence for the diagnostic and offline validator. **No native batching ABI or performance optimization is implemented.**

The earlier native trace and host journal have no resume entry/return fences. Their 8,322 uninterrupted clock runs cannot establish legal batch spans or recover the 439 resume cuts. The new capture supplies these missing diagnostic boundaries; it does not prove private bridge ownership, legal batch count, wider guest admission or a speed gain. The [H4 baseline](I80386-NATIVE-HOT-PACKED-SCALAR-WIP.md) and [10× work](I80386-10X-PERFORMANCE.md) retain their existing scope.

## Frozen diagnostic and held binary

Diagnostic source is `2d1cf651d7d7d0dfda55b9df482cf0ec70d9187c`, authenticating 67 source inputs including all seven new witness/model/validator/driver/test paths. The held native addon was compiled from H4 source `15631beb63d7c1f17e693de7c86d4ed37b96a768`, with 32 build source inputs and 12 transformed inputs. Its SHA-256 remains `5257a116734fb813b3ef9df31666eea0b41753d344f5c928b312765c0c497cd4`. Actual compiled NAPI, native runtime, ABI2 header and configuration are pinned separately. A later publication commit does not relabel either source identity.

The driver adds synchronous diagnostic fence writes, explicit capture requirements, report metadata and source identity inventory. An independent exact inverse removes only these declared changes and restores the original H4 driver byte-for-byte. Original dynamic method lookup, facade/wrapper operations, native resume calls and existing inspection points remain intact. The additional fence writer reads compact host count and ledger fields directly; it adds no board inspection calls. Return fences are recorded after the existing native snapshot: a future batch implementation must flush before that snapshot, rather than rely on the diagnostic write.

Seventy-eight focused tests passed with zero skips, including unchanged H4 tests and model/validator mutations for missing, dropped or reordered events/fences, malformed domains, independent caps, reported charged deltas, overflow, fault versus successful work, partial/final REP work, PIO rearming, terminal flush and actual NAPI BigInt serialization. Issues found during source review were fixed before the single diagnostic guest execution.

## Actual capture and independent audit

The 1,326-row fence file is 276,122 bytes, SHA-256 `3e0610e5507b612ba15a6323428149d15ecdc02933c273bd4efdd92103d3c30a`. Capture SHA-256 is `fef68e50495e97ff03df0a3ce8a22a92dfb12b202eef28f3dfbbfd3d7a0befbb`. The 149,865,650-byte raw native stderr is retained locally, SHA-256 `fbdcd8ae90edc1282a0725443db4942ab9d0fafb614f91dcd1d3039540312d3d`. The full ordered host journal retains H1 SHA-256 `bf1224a77fed44aaabe0e2e00cb2319e25084aca71601d215930f3362722f3f1`.

The independent actual audit passed 1,887,438 checks. Root separately passed 22,311 actual artifact/fence checks, in addition to its parent comparison of all 1,649,067 canonical rows. The independent audit constructs the exact start/stage/entry/return/inspection/settlement/close sequence from actual resumes and checkpoints; checks that host ordinals advance only inside resumes; mirrors native/board/host N/Q and six-clocks-per-Q ledgers; validates safe domains, independent requested caps, exact charged deltas, selected-Q request horizons and settled entry deadlines; and requires terminal HLT with zero charge and settled debt. It also compares every canonical H1 trace field/order, full H4 exposed state, before/after helper/source/build/binary bindings and historical source identities.

The source-owned offline validator exited successfully over the actual capture. It compared 201,366 ordered clock events: 100,684 native ticks and 100,682 successful quanta. Native fault ticks and partial REP work remain independent; no equality between N and Q is assumed. Historical inputs still report missing resume/observer fences explicitly. The diagnostic ran with official Node 22.23.3, 512 MiB heap, 120-second child timeout, 256 MiB regular-file cap, full native tracing and host journaling. Its timing includes extra synchronous writes and is not benchmark evidence. No repeat or CPU performance comparison followed this diagnostic.

## Proposed future boundary

The [source-owned contract](../scripts/bochs-cpu3-native-clock-batch-witness/contract.md) describes a future distinct opt-in native ABI, a private factory-created actual facade and closed ownership during resume. Generic dynamic H4 callback behavior keeps its existing path. Brand tokens or frozen wrappers alone do not prove this ownership.

The offline model uses `ceil((deadline-debt)/6)` successful units after chip settlement, independent N/Q caps and explicit ordered flush barriers. PIO publishes preceding debt and rearms before charging its current successful quantum. Memory/PAGE, IRQ acknowledgement, inspection/snapshot, fault/IRQ/HLT, return, stage IRQ, settlement and close remain observable boundaries. Model attempt/REP completion annotations are explicit synthetic inputs and are not inferred from historical clock rows. These model tests do not establish an actual native batching implementation or legal execution spans.

A later implementation requires separately reviewed ownership, actual ordered expansion/state proof, source-bound build and a predeclared unprofiled CPU gate. No 10×, physical RTx, broader guest/broader game, full AT or production native CLI/GUI qualification follows from this tranche.

## Receipts

The [SHA-indexed inventory](receipts/2026-10-02-i80386-clock-fenced-receipt-index.json) contains frozen source, exact inverse, focused process logs, authorization/build bindings, losslessly compressed capture/fences and actual independent/offline audits. Process files use original-byte base64; large trace, journal and addon remain local and SHA-bound. Only public free-ROM evidence is included. Historical absolute paths are provenance, not portable execution instructions.
