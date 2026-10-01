# Next bounded actual-board gate: protected paging, REP/PF/PIT/IRQ, RAM SMC and A20

This is a source-audited implementation proposal, not execution evidence. Preserve all qualified JS/native REP and RAM lanes, builds and receipts. Create a new actual JS baseline first, then a separate native ABI/runtime/host gate. No compatibility or speed claim. No new code/build/capture has been performed for this proposal.

## Smallest fixture candidate

Extend the free compact REP/PF/PIT guest, preserving its cold-reset witnesses, protected16/address16 data32 REP, two actual page faults, zero/final REP, real PIC/PIT/STI successor/ACK/EOI and full configured-chip snapshots. Keep the four REP destination words at 4ff8..5007 and ordinary/one-REP data at 6000..6007 NON-executable. Tables, GDT, IDT, stack and witness pages are also non-executable.

Add only two executable RAM backing pages: low physical7000 and high107000. Guest creates BB1111CB / BB3333CB (MOV BX,imm16; RETF), never preseeding code or CPU state. Initialize low with DS0:[7000] and high in real mode with ESFFFF:[7010]; the existing protected transition later reloads ES10. DS0 address32:[107000] is forbidden: it exceeds the retained real-mode segment limit, as the earlier RAM pilot demonstrated.

Add present PTE7000 at A01C and PTE107000 at A41C. Add three guest-created RAM GDT descriptors: protected16 executable selector18 base0/limitFFFF, executable selector20 base100000/limitFFFF, data selector28 base100000/limitFFFF. Existing ROM selector8 and low data/stack selector10 remain unchanged. Extend the guest LGDT limit for these descriptors. Validate GNU assembled descriptor bytes independently; do not assume descriptor layout or synthetic cached state.

After paging is enabled, BEFORE PIT programming:

1. Immediate16 far CALL18:7000; store BX to560 (1111).
2. Ordinary ROM instruction patches DS10:[7001] to2222; CALL18 again; witness562=2222.

The previously executed low RAM page remains admitted throughout the existing REP/PF/PIT/IRQ phase. REP still writes only non-code data. This makes a mistaken all-write cache flush visible as extra continuous REP decoder entries/cuts.

After actual IRQ return, relocate the existing final CLI to this point (no added CLI count). Load ES28 for high operand stores, then:

3. Actual8042 OUT64,D1 / OUT60,01 disables board A20; CALL20:7000 witnesses564=2222.
4. CALL18:7000 witnesses566=2222 BEFORE alias write, admitting both raw aliases in the current epoch.
5. ES28:[7001]=5555 writes raw107001, decoded7001; CALL18 witnesses568=5555.
6. CALL20 witnesses56A=5555, proving BOTH admitted current-epoch aliases were refreshed.
7. Actual8042 OUT64,D1 / OUT60,03 enables A20; CALL20 witnesses56C=3333, proving retained high backing independence.
8. ES28:[7001]=4444; CALL20 witnesses56E=4444.

Witness words560..56F avoid existing reset510/514, PF520/524/528, successor530, IRQ534 and frame-copy540..548. Return-stack top remains9000; each same-ring16 far CALL creates only a four-byte return frame, and RETF restores it. Use a new distinct E9 marker/receipt schema.

Instruction estimate: existing135Q plus six GDT dword stores, two PTE stores, two code stores, two real-mode high-ES setup instructions, two protected high-ES setup instructions,24 CALL/body/RETF instructions, eight witness stores, three patches and eight8042 MOV/OUT instructions = approximately192 successful Q, two fault-only attempts. This is an estimate only: actual JS pilot determines counts, symbols and timer reload. Timer absolute phase shifts when setup expands; preserve the required edge after one successful REP element by measuring actual PIT advancement and tuning the free fixture before freeze, never synthesizing an edge. Bound the new JS pilot at200Q initially; if genuinely more work is required, report the measured cause before expanding the limit.

## Exact cache/publication policy

1. Host owns RAM bytes, decoded classification, per-decoded-page generation and actual8042 A20/epoch. Native internal A20 stays ON permanently so native physical callback addresses retain raw uint32 provenance. Board A20 is a separate named value, not native CPU masking. No private Bochs RAM authority, asynchronous host memory mutation or fallback.
2. Persistent aligned executable slots admit immutable ROM and ONLY the two fixture RAM pages. Key each admission by raw physical page + decoded backing page + mapping epoch + generation. Never evict/free an old pointer; new mapping epochs use new bounded slots. A capacity64 is comfortably sufficient for three epochs times ROM/low/high pages; verify the actual admitted census and fail before allocation overflow.
3. Every acknowledged RAM write is already committed to actual board backing. Preserve every byte/effect and stage its raw/decoded span, observed committed bytes, new generation, and source reason. Publication is after ordinary instruction completion, every successful REP element, fault delivery or IRQ delivery; pagewalk-only publication has its separately audited safe prefetch site. Failed attempts must NOT discard A/D updates or frame writes.
4. At a safe completed/delivered boundary, update every admitted CURRENT-epoch RAM slot sharing the decoded backing page, in acknowledgment order; generation/SHA reflect the actual host reply. Retired-epoch slots stay allocated and are never returned or overwritten. After data publication, invoke instruction invalidation only if an admitted executable RAM alias intersects the write. Use the exact raw physical cache key for each alias and the span-aware pageWriteStampTable.decWriteStamp(raw+offset,length); log each alias and invalidation decision. Conservatively invalidating the CPU prefetch queue for a real executed-code alias is permissible at this safe boundary. Do NOT flush TLBs for these ordinary writes.
5. No executable alias means publication ONLY: zero cache invalidations, no STOP_TRACE and no TLB invalidation. This includes REP destinations, stack/frame/witness/GDT/table stores in this fixture. Mark executable admission/execution explicitly; never infer that every RAM page is code.
6. Actual A20 changes are committed only after OUT completes, from the authoritative host reply effective A20/epoch. OUT64,D1 alone must not create an epoch or invalidate anything. At the committed OUT60 transition, flush instruction entries/prefetch and TLBs once, then use fresh epoch slots. This mapping-policy invalidation is explicitly different from ordinary page-table writes. Native internal A20 remains ON. No callbacks can observe half-applied mapping.
7. Guest PTE/PDE writes NEVER synthesize TLB invalidation. Architectural stale translations remain possible until the actual guest MOVCR3 (or an explicit actual A20 mapping transition under this bounded policy). The existing fault handler's MOVCR3 remains authoritative. Do not treat page generation changes as permission/translation changes.
8. In-progress translate_linear/update_access_dirty: preserve why=pde/pte AD and publish only the actual staged AD bytes at the existing prefetch stage, WITHOUT TLB/cache/prefetch invalidation. Reject an AD write targeting any executable alias BEFORE host side effects in this first gate. This denies executable page tables/self-modifying AD tables rather than silently flushing an entry being populated. The fixture keeps executable pages disjoint from tables.
9. Initial scope denies RAM-resident REP and instructions modifying their currently executing backing page. RAM bodies are only MOV BX,imm16; RETF; SMC stores execute from immutable ROM. This avoids asserting that an icache instruction object or persistent fetch pointer can safely be overwritten midway through its own execution. Future REP-to-executed-code/self-patch qualification is separate.
10. Carry the qualified REP clock hooks: successful elements charge Q after decrement; final outer epilog retains its N while suppressing duplicate Q; faults charge independent N with zero Q; IRQ delivery charges neither. Genuine continuous REP remains intact unless a real budget, PIT deadline or eligible IRQ cut requires a pause. Preserve raw staged REP RIP and the two source-backed budget1 re-entry witnesses; do not blanket-drop ATTEMPTs.
11. Carry IRQ safe cut after delivery, then actual staged LINE0 before handler/IRET can re-ack a stale native INTR level. No raw inhibit_mask/inhibit_icount parity claim: ABI exposes IF/pending event mask and exact successor/ACK eligibility chronology only.

## Pinned source evidence and pitfalls

Upstream is Bochs2.7 revision0e45b736ef9792eb9b752b0a35db49eaf2faea47; readonly checkout /tmp/bw-bochs-2.7-oracle-src.

- Qualified RAM runtime scripts/bochs-cpu3-native-ram-coherence/runtime.inc:384-404 updates aliases then UNCONDITIONALLY calls flushICaches+TLB_flush. That policy was bounded proof scaffolding; do not transplant it as normal paging semantics.
- Qualified REP runtime scripts/bochs-cpu3-native-rep-pf-pit/runtime.inc:388-406 explicitly publishes AD/non-code writes without synthetic invalidation. :602-623 contains REP pre/post-element publication hooks. Combine its clock/delivery semantics with selective RAM cache updates, not either old runtime wholesale.
- cpu/icache.cc:43-61 flushICaches sets BX_ASYNC_EVENT_STOP_TRACE and resets write stamps; handleSMC also sets STOP_TRACE while invalidating matching entries. SHA735fb30940b8e12cd74555bfa745e7aedf5e9dc75a1f587022ed5d145f506fa4.
- cpu/icache.h:65-89 whole-page/range decWriteStamp dispatches handleSMC only for tracked masks, but keys use native physical address. Apply stamps to EVERY raw admitted alias, never only decoded backing. SHA73a1a7228f83f0432cd618a97b709b7ecf6e6cc7c7cdc9a0a697a7828fbd56b0.
- cpu/paging.cc:383-402 TLB_flush clears prefetch/stack/TLBs and breaks cache links, not instruction entries. Ordinary page-table writes must not call this. update_access_dirty:1262/1270 mutates AD before translation returns, so cache/TLB operations inside it are unsafe. SHA3ab63124df3b393624bcd2bf0f8878d56ec638bc0ebdfd1e23cf70d154a122b1.
- cpu/cpu.cc:221-229 icache lookup uses pAddrFetchPage+offset; :629-644 execute fetch uses translated physical page/host pointer; preserve the RAW address before board decode. REP loop exits for async_event and restores restart RIP (:529-535); any unnecessary handleSMC/flush therefore changes REP control flow. SHA2754d42ed014f72b28af1bfdf7d5fcaa50c7fdedd679f4845a90c191c6904587.
- cpu/call_far.cc:110-124 same-privilege protected16 CALL writes CS atSP-2 before IP atSP-4. SHA9acca787f6aba9ffc7fb72a7d37904d69a66d9a07d3dd8cd33acfaa4c3888051. This is NOT the earlier real-mode CALL exception. Audit new JS _protectedFarTransfer (src/experimental/i80386.js:1626) and protected RETF against cpu/ret_far.cc (SHA71cd93f498316629d578f158d2f06f01efa4d4c2ec1b8846da66273eadcadaf3), including duplicate descriptor reads/accessed writes, BEFORE native capture. Predeclare only exact eight same-ring CALL sites and actual protected return read differences that source proves. No generic sorting/masking or inherited real-mode rule.
- Actual JS src/experimental/i80386-at-machine.js:47-51 invalidatesTranslationCache on effective8042 A20 changes when the configured fast-A20 controller hook is installed; port92 itself remains unused/denied. Verify the exact new profile hook and source-owned mapping policy before freezing. src/experimental/i80386.js:381 owns the translation cache clear. This is a mapping transition rule, never an ordinary PTE-write rule.
- Existing named reset/SetCR0 reserved-bit differences remain explicit full raw fields; never normalize native7ffffff1/fffffff1 to JS11/80000011.

## Qualification and rejection tests

First new actual JS oracle: exact raw physical read/write/fetch/pagewalk effects; every configured chip; actual PIT edge/fractions/advances; CPU caches/system/debug; source-bound free ROM and historical import inventory. Preserve initial failed pilots as diagnostics. Guest creates all RAM code/tables and actual8042 state. Freeze meaningful same-engine replay/mutation tests before final JS source capture and independent bus/timer audit.

New native protocol/ABI (candidate BWS12/BWR12) must explicitly report publication reason, boundary owner N/Q, alias raw/decoded keys, epoch/generation/SHA, whether stamp/prefetch/TLB invalidation occurred, and actual A20 transition. Required exact phase invariants: REP data publication has zero executable aliases/invalidation; pre-REP low SMC invalidates only admitted low code; OFF alias write updates BOTH previously admitted aliases; ON high SMC does not change low backing. Keep full native bus chronology and budget comparison, plus narrowly source-backed JS/native descriptor/frame-order differences.

Native guards: executable-table AD before-effect rejection; REP-from-RAM/current-executing-page SMC denied; non-code publication cannot call flush; missing one alias/stamp/stale generation; stale epoch pointer; unexpected A20 change or transition during TLB fill; unsupported raw overflow/mixed/MMIO span; write/fetch while pending publication; bounded slots/no generation wrap; port92/unexpectedPIO; unknown trap/vector/REP; all five Bochs fallback counters/actual API reentry rejects. Transport guards bind complete typed span, observed commit, PAGE chunk/SHA/class/gen/epoch, exact synchronous clocks/sequence and authoritative A20 transition tuple.

Actual native qualification: continuous, Q1, Q2, Q257 with native cap independent/large; all guards/transport/API probes; new committed actual historical report fixture+coherent mutation suite; fresh final source capture and root independent repeat/backing+native raw audit. Preserve raw counters/attempts and admit only demonstrated source-backed budget projections. Continuous REP must show no SMC-induced cut while low RAM code remains admitted.

Resources: reserve512MiB filesystem space, <200 successfulQ target, <=300 diagnostic bound only if root approves measured need, compressed receipts and per-arm diagnostic sidecars, capped journals. Split source work into exactly two Sol ownership groups: native6 ABI/runtime/patch/preparer/wire vs actual-JS freefixture/oracle/tests initially; host/runner/comparator reassigned only after first JS source freeze and wire agreement. Root retains serial builds/guest slots, audits and publication.

## Execution resources

The VPS is close to its disk reserve. Preserve existing builds and raw captures. Before implementation, select a working directory and capture budget that retain at least 512 MiB free; use GitHub CI for sustained native builds/captures if local space is insufficient. Kaggle CPU runs are not authorized by the current usage notes. No execution or speed claim follows from this resource plan.
