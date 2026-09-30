# Register-stack observed admission

This diagnostic adds a separate, default-off observed grammar named
`bw.i80386-register-stack-admission.v1`. The earlier
`bw.i80386-expanded-grouped-admission.v1` grammar and report remain unchanged.
Enable the new variant with `AT_REGISTER_STACK_ADMISSION=1` for the AT console
or `XV6_REGISTER_STACK_ADMISSION=1` for the xv6 probe. It observes completed
ordinary single steps; it does not execute, cache, or replay instructions.

The only new forms are `50–5F` register PUSH/POP, unprefixed or with one `66`
operand-size override. Every other prefix and extra fetched byte refuses.
Operand width follows CS.D and `66`; stack address width follows SS.B
independently. Admission requires the exact one-operand read or write byte
trace in order, the entry register value for PUSH (including SP/ESP), the
loaded destination and final stack pointer for POP (including SP/ESP), an
ordinary linear successor, and unchanged other registers and flags. The
`POP SP` result uses the high half of the incremented ESP when SS.B=1, so a
carry at `ESP=0x0000ffff` is preserved. Missing proof or an unexpected effect
refuses.

Without paging, the byte trace must match SS base plus the stack offset. With
paging, bus addresses are translated: the observer requires contiguous
physical bytes and separately checks the logical stack-pointer result. It
does not claim a linear-to-physical mapping proof. The existing single safe
data-page, code-page, translation identity, event horizon, fault, write, and
device cuts still apply before an ordinal can join a run.

The report keeps the historical disjoint-run accounting. The predeclared
Windows opportunity gate is **15,000,000** total ordinals in runs of at least
eight and **5,000,000** protected16 or VM86 ordinals in such runs, within a
60,000,000-step paired run. The source-bound reducer
`scripts/summarize-i80386-register-stack-result.mjs` verifies source hashes,
whole reported state parity outside the diagnostic flag and observer, and
run partitions. Guest media and raw serial evidence remain private. A passing
opportunity gate would describe observed trace coverage, not speed or an
executable trace.

The completed [Windows and xv6 result](I80386-REGISTER-STACK-ADMISSION-RESULT.md)
shows 9,616,345 unique Windows ordinals in runs of at least eight overall and
8,514,517 in protected16+VM86. The **overall 15M gate fails**. The separate
stock xv6 pair found 967,663 such ordinals, all protected32, with no xv6 pass
threshold. These are source-bound ordinary-step observations, not execution or
speed results.
