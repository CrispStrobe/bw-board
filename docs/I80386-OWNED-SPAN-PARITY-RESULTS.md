# Private uniform-page span: native parity results

External licensed-guest notes and historical context are retained in the [private documentation archive](https://github.com/CrispStrobe/brickwright-firmware-private/tree/master/public-documentation-archive/2026-10-04). Public examples and instructions use freely licensed or freeware software.

All three fresh hosted native parity cells pass independent audit for the original closed IN8 free-ROM fixture. This qualifies the private candidate's semantics for this fixture. It supplies no performance result, adoption, or broader AT/broader guest/broader game admission.

The [source controls](I80386-OWNED-SPAN-SOURCE-RESULTS.md) freeze the provider at `8e35080d29b32e9fcee5f8fbc5800209c74df2e7` (110 inputs). The separate [runtime integration](I80386-OWNED-SPAN-RUNTIME-PREPARATION.md) is `bbf2a73e3d9090e73fe7037f4b8dbd4f6248aaa1` (116 inputs). The compiled identity remains `fe1eff2039520536350922a2164c8bbe29404c68` (103 unchanged inputs), with original addon SHA256 `8d9c83fcc3c42c2c94d17782ae42c152c52fcb2e833c31decc4bfee2af5aa841`. The provider proof removes per-byte span validation only for admitted uniform pages; original read/write/PAGE methods and memory effects remain unchanged. It combines neither dispatch nor bulk-clock experiments.

## Actual hosted cells

[Run 37056398077](https://github.com/CrispStrobe/bw-board/actions/runs/37056398077), PR event, attempt 1, used exact publication head `80d228ee5452f380655a16c4bc823beb76e781c1`. Each child ran once, sequentially, with no timeout or failure. The native bounds were 120 CPU/wall seconds, 512 MiB heap, 256 MiB per output file, zero core files, nice increment 10, and six blank preload/profile/coverage hooks. Every cell authenticates 212 artifact pins, runtime116 and compiled103 current/Git source maps, helpers, Node and input bindings before and after execution.

| Cell | Native trace | Host journal | Audited result |
| --- | --- | --- | --- |
| smoke-off | Off | Off | Exact stored state parity; empty journal |
| fulltrace-on | On | On | All 1,649,271 canonical rows and entire ordered journal match the qualified original baseline |
| trace-fast | On | Off | All 1,649,271 canonical rows match the qualified original baseline; empty journal |

All three match the qualified fe1 baseline's entire stored reset/final/six-cut native snapshots: all 166 CPU words, descriptors, counters, physical-transfer fields, boards, RAM hashes and witnesses. Each has 445 resumes, 100,696 native ticks, 100,694 successful quanta, 9,211 clock transfers, 8,733 commits and 201,390 logical clock words. The ON journal has 209,871 rows and matches the original bytes exactly. Its clock/port order is checked against the source-bound JavaScript reference reconstruction and native chronology. Trace-only keeps the host journal empty while preserving full native chronology.

The unchanged scheduler returns ordinary full snapshot arrays at every one of the 445 resumes. The archive stores reset, final and six cuts; it does not contain 445 individually saved snapshots. JavaScript reference parity covers eight recorded CPU fields plus the existing exact EDX/CR0 profile rule, complete recorded board state, and raw RAM with the verified eight-byte reset witness and canonical RAM policy. It does not invent unrecorded JavaScript state.

The [independent full-state/chronology audit](receipts/i80386-owned-span-parity-20261002/publication/independent-hosted-cells-audit.json) and [complete provenance addendum](receipts/i80386-owned-span-parity-20261002/publication/independent-hosted-provenance-audit.json) pass. The [root audit](receipts/i80386-owned-span-parity-20261002/publication/root-actual-hosted-span-artifact-audit.json) separately verifies official metadata and every ZIP entry/extracted file. Before/after authentication maps remain unchanged. A separate [pure outer timeout control](receipts/i80386-owned-span-parity-20261002/outer-lifecycle/result.json) verifies that a timed-out wrapper kills a separately sessioned descendant and retains the failure receipt, with no addon or guest involved.

## Provenance and scope

The hosted preparation reconstructs genuine frozen Git commits/trees from byte-exact payloads over separate fe1 checkout. It downloads original compiled artifact `11226630502`, checks all 31 extracted files and 20 relevant prepared files, and restores the qualified historical derived receipts at their admitted paths without changing their bytes. A [new materialization proof](receipts/i80386-owned-span-parity-20261002/hosted-artifact/home/runner/work/_temp/owned-span-native-parity/context/new-materialization-proof.json) identifies the recreated filesystem as a new host materialization, separate from the original build/run provenance. No C/addon rebuild occurs. Original raw trace, journal and JavaScript events are restored losslessly; the full comparator remains unchanged apart from its result labels.

Prior source factory controls, 24 pure runtime controls, read-only build authentication and separate local OFF/ON cells are recorded as distinct prerequisites. The fresh hosted three-cell result governs this qualification. Raw captures retain their original `UNQUALIFIED_ABI4_IN8_NATIVE_CANDIDATE` status; external audits qualify only this diagnostic. [PR 261](https://github.com/CrispStrobe/bw-board/pull/261) passed all six enabled exact-head checks and merged at `b0a13d670bc6e5f87d719afc8b31f89021a33f6e`.

Next: prepare and review a fresh paired CPU gate against unchanged fe1. Adoption requires at least 10% lower mean process CPU and all seven measured pairs favorable under the existing two warmup-pair/seven alternating measured-pair protocol. That gate has not run here. The rejected allocation, bulk and dispatch results remain separate; there is no new speed, cumulative 10× or physical 386DX RTx claim.

## Retained evidence

The [SHA256 index](receipts/i80386-owned-span-parity-20261002/sha256.json) covers byte-identical small captures, raw streams, bounded inputs/invocations/exits, source/authentication maps, materialization contexts, root/peer audits and prerequisite/lifecycle records. [Origins](receipts/i80386-owned-span-parity-20261002/external-origins.json) bind every copied original. [External retention](receipts/i80386-owned-span-parity-20261002/external-retention.json) records exact size/SHA256/member paths for large traces, journals, reference payloads and native build archives retained outside Git.

Official artifact `11248833105` is 44,331,598 bytes, SHA256 `7cae79af646feba252df601a811098a92614cc334a8a29b0d90d5d51d552f41e`. Its single safe extraction contains 350,488,886 bytes. The lossless local namespace is `/mnt/volume1/tmp-astra/386-owned-span-hosted-native-parity-publication-20261002`; the raw large streams and official ZIP are retained there. No native binary or private OS media is bundled in these notes.
