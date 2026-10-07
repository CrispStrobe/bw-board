# Paged IRQ source fixture (development checkpoint)

This separate owned cold-reset fixture uses strict 386 semantics, CPL0 code16,
nonidentity paging, and the existing free BIOS reset configuration. The reset
master PIC must have vector base 0, no mask, no request and no in-service bit.
A single fixture-controlled IRQ0 is asserted at CS:IP 0018:7002 after `STI`
and its following `NOP`. The source board acknowledges the real PIC before
its translated vector-0 interrupt gate runs. No PIT event, PIO, software INT,
page fault, EOI or HLT wake belongs to this first slice. Execution stops
before HLT.

The handler stores `2222h` at logical D102 (physical C102) and IRETs. The
interrupted ordinary path stores `1111h` at logical D100 (physical C100).
The 16-bit same-CPL frame is six bytes at physical CFFA; the live linear SP
is DFFA during the handler and E000 after IRET. The source test observes the
original JavaScript PIC acknowledgment and CPU interrupt methods. A nested
post-delivery cut is captured because one JavaScript board step also retires
the first handler instruction; that cut is not treated as another successful
instruction or merged with a native zero-Q delivery boundary.

`node --test test/i80386-paged-irq-source.test.mjs` exercises the actual
JavaScript machine, PIC and paging path. It does not qualify the native addon,
an independent external emulator, timer scheduling, code32 frames, HLT wake,
privilege changes or an operating system. A new native policy, exact-source
build, clean guest differential and preserved first-failure receipts remain
required before a runtime claim.
