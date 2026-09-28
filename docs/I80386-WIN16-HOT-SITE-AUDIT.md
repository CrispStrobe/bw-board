# Windows protected-16 hot-site audit

The strongest retained protected-16 candidate with at least eight steps in the
pinned 60-million-step Windows locator report has 6,580 recorded traversals of
eight completed instructions, or 52,640 traversal steps. Because the locator
evicted other candidate records, this site's retained count is a lower bound.
It represents 0.524% of the report's 10,036,060 completed protected-16 steps
and 0.0877% of the 60-million-step run. These are step ratios, not CPU-time
or speed estimates. The mode-wide 3,089,886 steps in traversals of length at
least eight overlap nested traversals and are not disjoint coverage.

A targeted ordinary replay stopped after three executions of this eight-step
body. The observed forms, in order, were three zero-displacement short JMPs,
`IN AL,DX` from the COM1 UART line-status register, `TEST AL,imm8`, a
forward JNE, an ES-override byte `CMP` against a fixed 16-bit displacement,
and a backward JE. The JNE fell through and the JE was taken in all three
captures. The instruction bytes and one ES byte-read count matched across
captures; the byte read mapped to plain low RAM under paging. There were no
guest memory writes in this observed path.

This site is a **no-go for the current read-only/reg-only code16 WASM block
grammar**. Its UART status read is guest-visible work, not an invariant
operand: the board catches chips up to the read cycle, the 16550 read clears
its overrun latch and resynchronizes IRQ, and the CPU may check protected-mode
I/O privilege through a TSS bitmap before the read. The current WASM grammar
also lacks these IN, TEST, and zero-displacement JMP forms. A device-aware
executor would need to preserve the per-instruction port-read, chip-event,
interrupt, and fault boundaries; this candidate supplies no basis for batching
those reads or predicting a speed gain.

The observed code stayed on one linear code page, but a future executable
path would still need exact code-byte revalidation, CS base/limit/access and
paging proof, and correct taken versus fallthrough fault ordering. The ES
operand needs segment and paging admission on each access; the alternate JNE
path and later changes to data, page mappings, UART state, or code were not
proved by three captures. The retained site accounts for only 0.524% of
protected-16 completed steps as a single-site opportunity; no CPU-time
conclusion follows from that fraction. The private trace retains guest
addresses and bytes; this note deliberately does not.
