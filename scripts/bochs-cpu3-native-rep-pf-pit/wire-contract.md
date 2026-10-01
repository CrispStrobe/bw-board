# Native compact actual-board REP / PF / PIT wire v1

BWS11 stderr evidence; BWR11 dedicated fd3 host->native and fd4 native->host.
Canonical ASCII tabs, maximum255 bytes including newline, unsigned decimal
without leading zeros, fixed lowercase hex. Separate new adapter; previous
cold/RAM/v6 sources and receipts remain unchanged. Host owns actual configured
board RAM/ROM, PIT/PIC, reset epoch4 clocks, debt and deadlines. Native internal
A20 and actual board A20 remain ON; mapping epoch is always0. Execute admits
only homogeneous immutable ROM pages, SHA-verified64x64 chunks in32 persistent
aligned4096-byte slots; no eviction, RAM execution, DMA or asynchronous writes.
RAM data spans1..16 are entirely prevalidated before effects, must not overflow,
cross physical pages, mix classes or touch MMIO. RAM generations advance once
per acknowledged WRITE callback; ROM/open bus generation0; no wrap.

BWR11 prefix-inclusive forms:
- READY cs(hex4) eip(hex8) N Q (6), initially f000/0000fff0/0/0.
- CMD seq verb arg0 arg1 deadline (7). RUN nativeCap quantumBudget UINT64_MAX;
  LINE asserted0/1 0 0; STOP 0 0 0. LINE legal only outside resume; it carries
  the actual host PIC level after board catch-up/ACK, never a scripted vector.
- REQ seq operation arg0 arg1 arg2 payload N Q (10). QUANTUM(kind0/1,0,0,'-'),
  NATIVE_TICK(1,0,0,'-'), ACK(0,0,0,'-'), PIO_OUT(port,width1,value,'-'),
  READ(raw,width,0,'-'), WRITE(raw,width,0,hex2width), PAGE(rawPage,4096,0,'-').
- REP seq OK value (5): QUANTUM returns actual deadline-due0/1 after adding6
  successful board clocks; NATIVE_TICK returns0 and charges zero board clocks;
  ACK returns the actual master PIC vector20 via native eligible acknowledge;
  PIO_OUT returns0 after actual port handler/catch-up. Allowed byte ports are
  20/21/a0/a1/40/43/e9. All other ports and input operations reject.
- MEM seq OK decoded(hex8) kind effect hex2width generation epoch0 (10).
  WRITE observed bytes equal actual after-effect bytes; MEM records attempted
  bytes. RAM write echo must equal operand. ROM/open bus ignored bytes remain
  observed immutable ROM/ff. Whole span prevalidation precedes any effect.
- PAGE seq decoded(hex8) generation0 kind2 sha256 epoch0 (8), then64
  DATA seq index0..63 hex128 (5), then END seq (3). Native verifies whole SHA.
- DONE seq RUN reason chargedN chargedQ cs eip totalN totalQ attempts completed
  repIterations faults IF(0/512) activity irqDelivered (18).
- DONE seq LINE value N Q (7); DONE seq STOP 0 N Q (7).

Class RAM1/ROM2/MMIO3/UNMAPPED4. Effects RAM_READ1/RAM_COMMIT2/ROM_READ3/
ROM_IGNORED4/MMIO_READ5/MMIO_WRITE6/OPEN_BUS7/UNMAPPED_IGNORED8. Synchronous
REQ<REP<typedcompletion, all tuples bound to actual native clock ledger.

BWS11 field counts below exclude prefix and tag. Full raw RESET20,
RESET_EXTRA20, RESET_SEG15x6, RESET_SYS15x2 and RESET_DR6 retain the frozen RAM
wire layouts, including all segment/cache/system/debug attributes. POST_STATE23,
POST_EXTRA23, POST_SEG18x6, POST_SYS18x2, POST_DR9 append N/Q/ordinal.
RPC_REQ9, RPC_REP5, RPC_MEM10, RPC_PAGE9, PAGE_CHUNK3, EXEC8, MEM9,
PREFETCH4, ATTEMPT8, QUANTUM10, NATIVE_TICK5, PORT6, CMD6, SLICE38,
HALT_IDLE7, FINAL14, CALLBACKS5, FALLBACK5, PROBE2, FAIL1, READY4,
ACTIVATE4 and DEACTIVATE1 retain frozen RAM layouts. No RPC_PIO extension;
PIO uses scalar REP/RPC_REP. Physical MEM why is data, pde-read, pte-read,
pde-ad-write, pte-ad-write, fault-frame or irq-frame. Paging attribution takes
precedence over delivery attribution; delivery includes descriptor reads too,
so these labels describe ownership rather than assuming every byte is stack.

New exact layouts:
- BOUNDARY6: kind(string),attemptCS(hex4),attemptEIP(hex8),N,Q,ordinal.
  kind=ordinary/rep-element/fault-delivery/irq-delivery/prefetch-pagewalk.
- COMMIT10: raw(hex8),decoded(hex8),length,hexBytes,generation,epoch0,N,Q,
  ordinal,boundaryKind. Every acknowledged RAM write is retained exactly once.
- COHERENCE8: reason(rom-only-publish/pagewalk-publish),epoch0,A20(1),aliasUpdateCount(0),N,Q,ordinal,
  boundaryKind. Exactlyone per BOUNDARY; bounded ROM-only execution has no
  writable execute aliases. Full POST state follows COHERENCE.
- FAULT_BEGIN8: vector,error,CR2(hex8),CS(hex4),restartEIP(hex8),N,Q,ordinal.
- FAULT_DELIVERED9: vector,error,CR2(hex8),handlerCS(hex4),handlerEIP(hex8),
  SP(hex8),N,Q,ordinal.
- IRQ_ACK6: vector(hex2),entryCS(hex4),entryEIP(hex8),N,Q,ordinal.
- IRQ_DELIVERED7: vector(hex2),handlerCS(hex4),handlerEIP(hex8),SP(hex8),N,Q,
  ordinal. Host reconstructs frames from actual native MEM writes; no synthetic
  diagnostic frame reads or private Bochs RAM witness copies.
- IRQ_LINE4: level0/1,N,Q,ordinal.

Successful ordinary instructions (including zero-count REP) and each completed
REP STOSL element earn one Q and6 host board clocks. Native N remains a separate
execution ledger, including failed attempts; exception delivery earns zeroQ,
IRQ delivery changes neitherN norQ. Every successful REP element is observed
AFTER actual CX decrement. Its raw RIP is already decoded instruction end,
because pinned cpu.cc increments RIP before execute; nonfinal JS checkpoints
retain restart EIP instead. This narrow source-backed staging difference is
retained explicitly, without rewriting native state or forcing continuous cuts.
Slice exits retain actual architectural restart RIP. Only protected16/address16
F3+66 STOSL is admitted for repeated work; no general REP claim.

Writes are host-committed immediately and staged in32 bounded native records.
An ordinary/REP boundary drains only that committed work; fault/IRQ boundaries
drain retained pre-fault A/D and delivery effects before handler fetch, zeroQ.
Prefetch-pagewalk is admitted ONLY after successful physical translation and
ONLY if every pending write is explicitly PDE/PTE A/D. It cannot drain ordinary
or delivery writes. ROM pointer admission requires a clean stage. No pending
writes at resume/end. No boundary synthesizes TLB/cache invalidation: only immutable ROM executes, so RAM/data/A-D publication cannot require executable alias updates. Native guest MOV CR3 owns actual architectural translation invalidation. This no-synthetic-invalidation policy preserves genuine continuous REP (flushICaches would set STOP_TRACE). Prefetch AD-only publication occurs at pinned paging.cc before A20ADDR/getHostMemAddr, never clears an entry being populated, and requires every staged write whyPDE/PTE-ad. No RAM execution/SMC/asynchronous mutation claim is made; the separately qualified RAM coherence adapter is unchanged. Actual
host deadline consumption and IRQ line updates occur between RUN commands.
Bochs SetCR0 CPU_LEVEL3 ORs7ffffff0; raw CR0 reserved-bit/reset differences are
retained, never masked to claim full CPU parity. Qualified JS135Q/137attempts/
814 clocks is historical JS evidence, not an invented native capture.

Native guard environment BW_CPU3_REP_PF_PIT_PROBE: unsupported-span-width,
physical-overflow,execute-pending-write,native-a20-off,stale-cache-generation,
write-stage-bound,write-generation-overflow,prefetch-non-pagewalk-write,
unsafe-execute-ram,unsupported-rep,unsafe-execute-mmio,unsafe-execute-unmapped,
unexpected-pio,bochs-ram-read,bochs-ram-write,bochs-direct-pointer,bochs-pio,
bochs-timer,unknown-trap. Each separate actual subprocess must abort with its
named FAIL witness; no empty or metadata-only rejection census qualifies.
