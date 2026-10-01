# BWS12/BWR12 combined protected paging/RAM/REP bridge

Source implementation contract only. No compiled/native execution qualification exists for this lane. Bochs2.7CPU3 pinned0e45b736ef9792eb9b752b0a35db49eaf2faea47; genuine unchanged hardware reset, activation before first CPU fetch. The reference is the qualified actual JS combined guest:192 successful Q, two PF attempts,1156 board clocks, eight protected RAM entries and actual8042 A20 OFF/ON. Keep full raw reset/CR0/selector/system/debug differences; no architectural reset/stale-PTE/native-TLB parity claim.

## Ownership and bounds

The host supplies actual board RAM/ROM/open-bus data, PIT/PIC/8042/PIO and decoded addresses. Native internal A20 remains ON; board A20 is separate. No private Bochs RAM authority, CPU state copy, BIOS execution, injected IRQ or asynchronous host write. Execute admits immutable ROM plus decoded RAM pages7000/107000 ONLY.64 persistent page slots, no eviction/free/old-epoch overwrite. Raw uint32 spans1..16 cannot overflow, cross a4KiB page, mix classification or touch MMIO. PAGE is exactly4096 aligned bytes in64 fixed64-byte chunks; SHA-256 verified before pointer admission.32 pending writes and64 generation entries; generations/epochs never wrap. Canonical line bound256 bytes including terminator.

Each RAM WRITE reply advances the authoritative decoded-page generation once per typed callback (not once per byte). READ observes current committed bytes/generation. Mapping epoch advances exactly once when actual effective8042 A20 changes. PIO reply effective state comes from actual board, never inferred from scripted values. Byte OUT admitted ports20,21,A0,A1,40,43,60,64,E9; port92 and ALL IN operations are denied before requesting any host PIO effect. Port92 latch stays zero under the reference explicit experimentalFastA20Port92=true configuration. CABI IN callback remains required but returns rejection; there is no scalar-IN/mapping interpretation ambiguity.

## Canonical formats

Tabs separate fields; one LF terminates each line. d=canonical unsigned decimal (no sign/leading zeros except0), h8/h4/h2=exact lowercase hexadecimal. SHA=64 lowercase hex; bytes=two lowercase hex digits per byte. N=native execution ledger, Q=successful work ledger, ordinal=monotonic native event ordinal. Counts below EXCLUDE the BWS12 prefix/tag or, for BWR12, INCLUDE prefix/tag as explicitly stated. Optional markers use a literal dash. Class names in native bus rows are ram/rom/mmio/unmapped; wire class enum RAM1/ROM2/MMIO3/open4. Effects are read-observed0/RAM-commit1/ROM-ignored2/open-ignored3.

Q ordinary0 includes zero-count REP; element1 includes EVERY successful nonzero REP element including final. Q earns6 actual board clocks; N earns none. Faults earn independent N but zero Q, delivery retains effects and frame; IRQ delivery earns neither. Guest MOVCR3 owns inherent normal translation invalidation. Native fixed-CPU-level SetCR0 OR7FFFFFF0 is retained raw.

## BWR12 subprocess transport fd3/fd4

|Row|Total fields including prefix/tag|Fields after tag|
|---|---|---|
|READY|6|CS h4, EIP h8, N d, Q d|
|CMD|7|commandSeq d, RUN/LINE/STOP, arg0 d, arg1 d, deadline d|
|REQ|10|requestSeq d, operation, arg0 d, arg1 d, arg2 d, payload, N d, Q d|
|REP|5|requestSeq d, OK, value d|
|MEM|11|requestSeq d, OK, decoded h8, class d, effect d, observed bytes, generation d, epoch d, boardA20 d|
|PAGE|9|requestSeq d, decodedPage h8, generation d, class d, SHA, epoch d, boardA20 d|
|DATA|5|requestSeq d, chunkIndex d0..63, bytes128hex|
|END|3|requestSeq d|
|PIO|7|requestSeq d, OK, value d0, boardA20 d0/1, epoch d|
|DONE RUN|18|commandSeq, RUN, reason, chargedN, chargedQ, CS h4, EIP h8, totalN, totalQ, attempts, completed, successfulREP, faults, IF d0/512, activity, IRQdelivered|
|DONE LINE/STOP|7|commandSeq, verb, value, N, Q|

RUN uses independent native/Q caps and absolute deadline. LINE only stages actual paused host PIC line. STOP is zero-budget/zero-deadline. Requests READ/WRITE carry raw address/width/0 and dash/read or attempted WRITE bytes; MEM WRITE bytes are the OBSERVED committed/ignored bytes, not universally operand echo. PAGE args rawPage/4096/0/dash. NATIVE_TICK count/0/0 returns REP0; QUANTUM kind/0/0 returns REP due0/1; IRQ_ACK0/0/0 returns actual master vector20. PIO_OUT port/width1/value returns PIO, including unchanged effective gate/epoch. Replies must complete their exact synchronous request before typed callback completion. No reentry, unsolicited replies or incomplete commands.

## BWS12 native rows

All inherited full CPU forms remain: RESET/STATE20, RESET_EXTRA20, RESET_SEG15 x6, RESET_SYS15 x2, RESET_DR6; POST_STATE23/EXTRA23/SEG18/SYS18/DR9 append N,Q,ordinal. These preserve all six segment caches, LDTR/TR and debug registers. Existing QUANTUM10/NATIVE_TICK5/BOUNDARY6/FAULT_BEGIN8/FAULT_DELIVERED9/IRQ_ACK6/IRQ_DELIVERED7/IRQ_LINE4/PORT6/HALT_IDLE7/SLICE38/FINAL14/CALLBACKS5/FALLBACK5/PROBE2 keep the BWS11 field layouts, new prefix only. SLICE counts are cumulative where defined by runtime, never sum cumulative HALT counts as per-resume deltas. API and named rejection counters are actual capture witnesses, not guessed report metadata.

Changed/new forms (field counts after prefix/tag):

|Row|Fields|Ordered fields|
|---|---|---|
|RPC_REQ|9|seq, operation, arg0,arg1,arg2,payload,N,Q,ordinal|
|RPC_REP|5|seq,value,N,Q,ordinal|
|RPC_MEM|11|seq,decoded h8,class,effect,observed bytes,generation,epoch,N,Q,ordinal,boardA20|
|RPC_PAGE|10|seq,decodedPage h8,generation,class,SHA,epoch,N,Q,ordinal,boardA20|
|RPC_PIO|7|seq,value,boardA20,epoch,N,Q,ordinal|
|PAGE_CHUNK|3|seq,index,bytes128hex|
|MEM|11|R/W,raw h8,decoded h8,class name,value h2,effect name,N,ordinal,why,epoch,boardA20|
|PREFETCH|6|rawPhysicalPC h8,N,Q,ordinal,epoch,boardA20|
|EXEC|10|rawPage h8,decodedPage h8,class name,N,ordinal,generation,SHA,epoch,boardA20,nativeA20=1|
|ATTEMPT|14|CS h4,EIP h8,N,Q,ordinal,rawPhysicalPC h8,decodedLength,actual entry bytes,decodedPhysicalPC h8,class name,generation,epoch,boardA20,nativeA20=1|
|COMMIT|12|raw h8,decoded h8,length,committed bytes,generation,epoch,N,Q,ordinal,boundaryKind,boardA20,why|
|ALIAS_UPDATE|11|rawPage h8,decodedPage h8,offset,length,generation,epoch,SHA,N,Q,ordinal,boundaryKind|
|STAMP|10|rawAddress h8,length,decodedPage h8,epoch,N,Q,ordinal,boundaryKind,stopBefore0/1,stopAfter0/1|
|PREFETCH_INVALIDATE|10|reason,oldWindow,newWindow,rawFetchPage h8,epoch,N,Q,ordinal,boundaryKind,nativeA20=1|
|TLB_INVALIDATE|6|reason,epoch,N,Q,ordinal,boundaryKind|
|TLB_OBSERVED|9|owner,reason,epoch,boardA20,nativeA20=1,N,Q,ordinal,boundaryKind|
|MAP_COMMIT|8|oldA20,newA20,oldEpoch,newEpoch,N,Q,ordinal,boundaryKind|
|COHERENCE|12|reason,epoch,boardA20,aliasUpdates,N,Q,ordinal,boundaryKind,bridgeStampCalls,bridgePrefetchCalls,bridgeTLBCalls,bridgeGlobalICacheFlushCalls|

Reasons why: data,pde-read,pte-read,pde-ad-write,pte-ad-write,fault-frame,irq-frame. Pagewalk attribution has precedence over delivery attribution. Boundary kinds ordinary,rep-element,fault-delivery,irq-delivery,prefetch-pagewalk. COMMIT/alias/invalidation tuples belong to ONE owning boundary. Coherence reason publish-only/pagewalk-publish/executable-alias-write/mapping-transition. Ordinals remain raw; do not discard ATTEMPT/EXEC or read/pagewalk callbacks when comparing budgets.

All COHERENCE invalidation counts and TLB_INVALIDATE/PREFETCH_INVALIDATE/STAMP rows refer ONLY to BRIDGE-owned calls. Native CPU's actual TLB_flush completion is separately observed in TLB_OBSERVED: owner cpu/bridge, reason implicit/activation/mapping-transition, boundaryKind dash for inherent/activation. The new pinned paging.cc hook emits AFTER actual TLB_flush operations, preserving guest CR0/CR3 call provenance and avoiding false total-TLB claims. Initial activation cache clears are separately named; they are not charged board clocks or guest publication. Other inherent CPU prefetch/icache operations are not falsely included in bridge counts.

ATTEMPT bytes are a snapshot of the SHA-verified admitted page at actual decoded instruction entry with native decoder length, not invented bus fetches. Native PREFETCH and execute PAGE fills remain separate from JS raw byte fetch callbacks; no universal physical fetch-count parity claim.

## Safe publication

Every observed RAM write is host committed before acknowledgment; native stages bytes/why/generation. Publication after ordinary success, EVERY successful REP element, delivered PF/IRQ retains all effects even failed attempts. At any execute/attempt admission, no pending write/mapping publication may remain.

At a safe completed/delivered boundary, update ALL admitted current-epoch RAM slots sharing decoded backing in original acknowledgment order, computing their new SHA/generation. Retired epoch slots remain allocated and untouched. Stamp each affected raw physical alias with decWriteStamp(raw+offset,length) only for an actual admitted/executed code page; prefetch invalidation is permissible here. STAMP logs actual STOP_TRACE state before/after. RAM writes without executable aliases have zero bridge cache/prefetch/TLB calls. NO ordinary data/GDT/PDE/PTE/frame/witness write synthesizes a TLB flush. Native immutable ROM cannot be modified through RAM writes.

During in-progress paging translation, prefetch-pagewalk publication admits ONLY staged PDE/PTE A/D writes. It performs zero stamps/prefetch/TLB/icache calls. Any AD write whose decoded target matches an executable alias is rejected BEFORE host WRITE effect. This scoped gate forbids executable page tables. Current RAM page SMC is likewise rejected BEFORE host effect; RAM instruction bodies are only MOV BX,imm16/RETF, all SMC stores originate from immutable ROM. RAM-resident REP is denied. REP writes target only non-executable pages; no unnecessary STOP_TRACE may split continuous REP.

PIO mapping change is staged from the authoritative PIO reply and installed only after its OUT instruction commits. No memory callback can occur with mapping pending. MAP_COMMIT installs effective gate/epoch; mapping-transition invokes ONE bridge global icache flush and ONE bridge TLB flush (which also invalidates prefetch), then future execute admission uses fresh epoch slots. OUT64,D1 with unchanged gate/epoch performs zero mapping invalidation. Epoch+1 must correspond to a changed effective A20 state; no wrap, guessed sequence or native internal mask change.

The actual JS reference includes conservative translation invalidations on ordinary OFF writes and tracked table writes, in addition to its two A20 hooks. Those are recorded source behaviors; this native policy does not copy them or assert architectural stale-PTE/native-TLB parity. Exact future pagewalk differences require source/site audits before capture qualification. Guest inherent MOVCR3 invalidations remain authoritative and visible separately.

## Freeze and qualification

The adapter must pin the actual inherited REP/RAM/v6/memory-map/events/slice transforms and all modified upstream files. New paging.cc TLB-observation hook is source-derived on top of that exact chain; upstream hardware-reset init.cc stays unchanged. Source-only transform/ABI checks are not compiled validation. No binary digest is guessed; hosted actual build and source/pin audit precede guest execution.

Future proof uses continuous/Q1/Q2/Q257 with independent native cap, bounded actual 192Q guest, actual native/transport/API rejection sessions and exact artifacts/raw hashes. Protected CALL/RETF/descriptor/frame orders require separate source-backed rules before capture; old real-mode CALL or generic read sorting is not an admissible substitute. Actual receipts, fresh final source captures, independent repeat/backing/raw audit and coherent mutations are required before qualification.

A RAM slot admitted but not yet used by an actual ATTEMPT may already have decoder state. Any write to such a current-epoch slot is rejected before the host WRITE request (`admitted-unexecuted-code-write`); the fixture only patches RAM bodies after execution. This prevents an unobserved pre-first-ATTEMPT decode from escaping the executed-alias stamp policy. The current instruction backing is set at every ATTEMPT and cleared only at safe publication boundaries.

Wire MEM effects are 0 read-observed, 1 RAM-commit, 2 ROM-ignored, 3 open-ignored. These are explicitly validated and converted to the CABI tag enum (RAM-read1/RAM-commit2/ROM-read3/ROM-ignored4/MMIO-read5/MMIO-write6/open-bus7/unmapped-ignored8); MMIO remains denied. Native MEM byte records retain the CABI literal effect names. The scalar interrupt request operation is exactly `ACK`, with arguments 0,0,0 and actual vector reply; `IRQ_ACK` names the native completion event only.
