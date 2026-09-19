# Protected 80286 IDT PCjs oracle

`scripts/compare-pcjs-protected286-idt.mjs` runs owned 16-bit instruction
images in both the experimental executor and PCjs at revision
`c7f21b4fa2bdedac3d5c73094a6402fdc8b24c70`. It compares ring-0 interrupt
and trap gate entry, the saved FLAGS/CS/IP frame, interrupt-gate IF clearing,
trap-gate IF preservation, same-ring IRET, and a delivered #GP frame with its
error code and restart IP. Timing, privilege changes, tasks, call gates, and
32-bit gates are outside its claim.

The Intel *80286 and 80287 Programmer's Reference Manual* (1987), INT pages
8-42 through 8-49 and IRET pages 8-50 through 8-54, specifies that the RPL in
an interrupt-gate target code selector is ignored and that the loaded visible
CS has the target code segment's privilege level. The oracle therefore also
checks that target selector `000b` becomes visible CS `0008` locally.

That selector-RPL case is a known, ungraded PCjs limitation. At the pinned
revision PCjs derives `cplNew` from the selector RPL in
`machines/pcx86/modules/v2/segx86.js` and its adjacent TODO says the code
segment DPL should select the stack; PCjs consequently rejects this legal
ring-0 target instead of normalizing it. The receipt records the discrepancy
separately. Only selector `0008` cases participate in the PCjs pass/fail
comparison.

PCjs also performs the three frame pushes separately. It accepts initial SP
`0000`, `0002`, and `0004`, producing wrapped entry SP values `fffa`, `fffc`,
and `fffe`. The manual requires the complete same-level frame to fit before
the operation changes state. Thus SP `0000` is valid (`fffa` through `ffff`),
while SP `0002` and `0004` raise #SS before any write. This boundary is also
recorded as an ungraded PCjs limitation rather than used to weaken the local
preflight rule.

The qualification workflow also runs three negative controls. Each corrupts
one local observation after execution: the saved frame, entry IF, or #GP
restart IP. Every corrupted comparison must fail.
