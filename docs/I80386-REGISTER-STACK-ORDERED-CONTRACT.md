# Bounded `50–5F` register stack ordering contract

The owned-byte fixtures in
`test/i80386-register-stack-ordered-contract.test.mjs` pin ordinary CPU
effects for register PUSH/POP, independently of any trace observer or
executor. They extend the existing broad PUSH/POP semantics tests with exact
per-byte bus order, pre/post visible state, and a later-fault sequence.

| Mode and form | Ordered successful effect |
| --- | --- |
| Protected16 `54; 5b` | `PUSH SP` stores the **entry** SP word, low byte first, at the decremented `SS:SP`; `POP BX` reads that word low byte first before replacing BX. The high halves of ESP and EBX remain intact. |
| VM86 `66 54; 66 5b` | Operand-size override pushes the full entry ESP dword and later reads it into EBX, while the stack uses 16-bit address arithmetic and retains the high ESP half. |
| Protected32 `54; 5b`, SS.B=0 | Dword operand size remains independent of the 16-bit stack address width; four writes and four reads occur in address order. |
| Protected32 `66 54; 66 5b`, SS.B=1 | Word operand size remains independent of the 32-bit stack address width; the high register halves and high stack-pointer bits survive. |
| Protected32 `5c` | `POP ESP` reads four stack bytes before the loaded dword replaces ESP; the final ESP is the loaded value, not the incremented intermediate pointer. |

In protected16 and protected32, an initially configured expand-down SS
allows the first PUSH but makes a second PUSH fault with `#SS`. In VM86, a
normal 64 KiB SS allows the first PUSH from SP=3, then the next word PUSH
crosses the segment top and faults. Each sequence keeps the same SS cache
throughout: the earlier PUSH's bytes and stack-pointer change remain
committed, while the faulting instruction restores its entry CPU snapshot
and performs no stack write. Register PUSH/POP do not create an
interrupt shadow; the separate [segment-stack tests](../test/i80386-segment-stack.test.mjs)
pin the `POP SS` shadow behavior. Existing
[PUSH/POP semantic tests](../test/i80386-pusha-popa.test.mjs) and
[POP r/m tests](../test/i80386-pop-rm.test.mjs) cover broader families,
including full-frame preflight and memory destination fault order.

This is an owned ordinary-CPU contract. It does not assert external 386
equivalence, expand observer admission, change the 15M/5M disjoint Windows
opportunity gate, or justify an executable trace.
