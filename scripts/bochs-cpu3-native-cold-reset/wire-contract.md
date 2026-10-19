# Cold-reset proof wire contract v1

BWS9 stderr evidence and BWR9 dedicated fd3(host->native)/fd4(native->host) pipes. Canonical ASCII tabs; lines including newline at most255 bytes. Unsigned decimal has no leading zeros and is checked for overflow; hex is lowercase fixed width. First gate: fixed A20 ON, generation0, stable ROM execution only, 8 persistent aligned cache slots; no cache eviction, RAM execution, MMIO effects, IRQ, traps, REP or mapping transitions. Old BWS8/BWR8 files and proof are unchanged.

BWR9 forms (prefix included):
- READY cs(hex4) eip(hex8) N Q (6 fields), initially f000/0000fff0/0/0.
- CMD seq verb arg0 arg1 deadline (7). RUN nativeCap quantumBudget UINT64_MAX; STOP 0 0 0. LINE rejected in this bounded gate.
- REQ seq operation arg0 arg1 arg2 payload N Q (10). Scalars QUANTUM(kind0,0,0), NATIVE_TICK(1,0,0), PIO_OUT(port233,width1,value) use payload '-'. READ(raw,width,0,'-'), WRITE(raw,width,0,hex2width), PAGE(rawPage,4096,0,'-'). Physical addresses are raw uint32, spans1..16 must not overflow/straddle/mix classification.
- REP seq OK value (5) for scalar callbacks.
- MEM seq OK decoded(hex8) kind effect hex2width (8). WRITE returns observed after-effect bytes (RAM commit equals operand, ROM ignored equals cached immutable ROM, open bus ignored reads ff); MEM evidence retains attempted operand bytes. Whole span is prevalidated before effects.
- PAGE seq decoded(hex8) generation kind sha256 (7), then64 DATA seq index hex128 (5), then END seq (3). Complete native SHA-256 verification precedes publishing a pointer. kind2 ROM only, generation0, decoded page aligned.
- DONE seq RUN reason chargedN chargedQ cs(hex4) eip(hex8) totalN totalQ attempts completed repIterations faults IF(0/512) activity irqDelivered(0/1) (18); DONE seq STOP 0 totalN totalQ (7).

Kind enum RAM1 ROM2 MMIO3 UNMAPPED4. Effects RAM_READ1 RAM_COMMIT2 ROM_READ3 ROM_IGNORED4 MMIO_READ5 MMIO_WRITE6 OPEN_BUS7 UNMAPPED_IGNORED8. Scalars REQ<REP<typedcompletion strictly synchronous. Memory/page reply evidence reflects actual returned bytes and classifications, never fabricated guest captures.

BWS9 schemas inherited v6 unchanged except explicit extensions below:
STATE/RESET20: eax ecx edx ebx esp ebp esi edi eip eflags cr0 cr2 cr3 (hex8), cs ds ss(hex4),gdtrBase(hex8),gdtrLimit(hex4),idtrBase(hex8),idtrLimit(hex4).
RESET_EXTRA20: dr6/dr7(hex8),es/fs/gs(hex4), CS selector index/TI/RPL(dec),valid(hex8),p/dpl/segment/type(dec),base/limit(hex8),g/d_b/avl(dec),pending/eventMask(hex8).
RESET_SEG15 per ES0 CS1 SS2 DS3 FS4 GS5: segIndex(dec),selector(hex4),index/TI/RPL(dec),valid(hex8),p/dpl/segment/type(dec),base/limit(hex8),g/d_b/avl(dec).
RESET_SYS15 uses RESET_SEG15 layout with segIndex6 LDTR/7 TR. POST_SYS18 appends N/Q/ordinal.
RESET_DR6: DR0/1/2/3/6/7(hex8). Raw reset is emitted before first prefetch/attempt; no native register normalization or private RAM seed copy.
POST_STATE23/POST_EXTRA23/POST_SEG18/POST_DR9 append N/Q/ordinal to corresponding20/20/15/6 field record after successful charge before native tick.
ATTEMPT8: cs(hex4),eip(hex8),N,Q,ordinal,rawPC(hex8),decodedInstructionLength(dec1..15),hex2length cachedROM instruction bytes. Length comes from actual Bochs decoder; bytes are cached immutable executable-page evidence, not a byte-fetch bus journal. First gate rejects instruction page crossings.
PREFETCH4: rawPhysicalPC(hex8),N,Q,ordinal, at actual native prefetch translation before pointer admission. First rawPCfffffff0; this plus page SHA and instruction entries is narrower evidence than JS's byte-fetch journal.
RPC_REQ9: seq,operation,arg0,arg1,arg2,payload,N,Q,ordinal. RPC_REP5: seq,value,N,Q,ordinal. RPC_MEM8: seq,decoded(hex8),kind,effect,hex,N,Q,ordinal (8 fields after tag; total10 includingprefix/tag). RPC_PAGE8: seq,decoded(hex8),generation,kind,sha,N,Q,ordinal (8 aftertag). PAGE_CHUNK3: seq,index,hex128 (raw record, noordinal).
EXEC7: rawPage(hex8),decodedPage(hex8),rom,N,ordinal,generation,sha256. MEM9 unchangedv6: rw,raw(hex8),decoded(hex8),class,value(hex2),effect,N,ordinal,why.
ACTIVATE4: f000,0000fff0,0(copiedBytes),1(A20). READY4 mirrors BWR9. CMD6/SLICE38/QUANTUM10/NATIVE_TICK5/PORT6/HALT_IDLE7/FINAL14/CALLBACKS5/FALLBACK5/PROBE2/FAIL1/DEACTIVATE1 retain v6 field order.

Host owns reset epoch4 board clocks with N/Q0. Native QUANTUM charges6 successful clocks, NATIVE_TICK charges0. Actual board debt/PIO catch-up and terminal stop are host-owned; no Bochs devices/timers/RAM fallback active. First free ROM records raw EDX/CR0 witnesses; known JS/native reset differences remain explicit.

Native guard env BW_CPU3_COLD_RESET_PROBE: unsupported-span-width,physical-overflow,unsafe-execute-ram,unsafe-execute-mmio,unsafe-execute-unmapped,unexpected-pio,bochs-ram-read,bochs-ram-write,bochs-direct-pointer,bochs-pio,bochs-timer,unknown-trap. Native CABI/API and transport rejection evidence are separate from host metadata checks.
