# Experimental 80286 exception escalation

The protected executor implements the 80286 double-fault rule from Intel's
1987 Programmer's Reference Manual, section 9.6.2. If entry for `#DE`, `#TS`,
`#NP`, `#SS`, or `#GP` encounters a second protection fault, the processor
enters vector 8 with a zero error word. It does not apply the broader exception
pair matrix used by later x86 processors. A fault while entering vector 8 puts
the CPU in shutdown. Normal execution and INTR stop in shutdown; RESET clears
it, and a successfully delivered NMI may leave it. The machine layer decides
whether a board converts shutdown into an external reset.

Faults encountered while entering an ordinary external interrupt are delivered
as protected exceptions with the EXT bit retained. If a task switch committed
before an entry fault, replacement-exception and double-fault frames use the
incoming task's CS:IP and stack; the switch is not rolled back.

Single-step is sampled before an instruction and delivered after that
instruction commits. MOV/POP SS inhibits the trap for one boundary. STI's
separate maskable-interrupt shadow does not inhibit it. HLT completes before
the trap wakes the processor, while software interrupt and task entry suppress
the trace sampled in the old context. Single-step and processor-extension
delivery faults use the manual's external-event error-code convention.

The numeric extension boundary is deliberately small. WAIT raises `#NM` only
when both MP and TS are set. ESC raises `#NM` when EM or TS is set; otherwise
the executor admits the addressing operation against an inactive numeric
extension. It does not execute 80287 arithmetic, BUSY/ERROR signaling, or
processor-extension segment-overrun behavior.

`hardwareReset()` provides the 286 reset vector without changing the legacy
`reset()` contract: visible `CS:IP` is `F000:FFF0`, the reset-only hidden CS
base is `FF0000`, MSW is `FFF0`, and IDTR is `000000:03FF`. Reloading CS,
including a far transfer to the same visible selector, discards the special
base. This only supplies CPU reset state; ROM mapping and reset wiring remain
machine responsibilities.
