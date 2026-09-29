# Combined ordinary 80386 ordered-state fixtures

The [ES load contract](I80386-8E-SEGMENT-LOAD-CONTRACT.md) and
[call/return contract](I80386-CALL-RETURN-ORDERED-CONTRACT.md) pinned their
individual instructions. The owned-byte fixtures in
`test/i80386-combined-ordered-contract.test.mjs` now carry one ordinary CPU
sequence across both boundaries: memory-source `MOV ES,[0080]`, dependent
`MOV AL,ES:[0000]`, direct `CALL`, `RET`, and an `IN AL,21h` I/O boundary.
Protected16 reads the selector from RAM and the GDT descriptor, sets the
descriptor Accessed byte, reads through the new ES cache, writes and reads
the return word, then consumes one port input. VM86 follows the same
control path with a real-address ES cache and TSS bitmap reads at I/O.
Every step asserts the relevant visible state and ordered fetch, RAM, stack,
descriptor, or device effects.

Later faults preserve completed earlier instructions. A protected16 bad
call target leaves the ES load, dependent read, and Accessed write committed
without a stack write. A bad return target reads the committed call frame
and rolls back only the return step. A VM86 bitmap denial occurs after the
load/read/call/return span and consumes no port input. The AT board fixture
uses `runBlock` to stop at a chip deadline immediately before `IN`, then
resumes through one ordinary board step; a separate `MOV SS` case confirms
the machine defers a pending PIC IRQ while the interrupt shadow is active.

These fixtures exercise only owned bytes in the ordinary core and bounded AT
machine. They are an ordered-state correctness cut for future admission
work, not a new observer, executor, external oracle, or speed result. The
grouped first-refusal opportunity gate remains failed.
