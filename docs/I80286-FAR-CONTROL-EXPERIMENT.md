# Experimental 80286 far control transfers

The protected executor implements direct same-privilege far CALL/JMP, far RET,
and 286 type-4 call gates. A gate may enter a numerically lower privilege ring
through the current TSS stack pointers. The transition preflights the complete
new frame and old parameter span, copies the gate's declared parameter words,
then writes `old SS`, `old SP`, parameters, `old CS`, and return IP in 286 stack
order. `RETF imm16` discards the declared bytes on both sides of an outer
return.

The same executor implements available/busy 286 TSS descriptors, direct task
CALL/JMP, task gates in the GDT and IDT, and nested-task IRET. A switch saves
the outgoing IP-through-DS image, handles backlink, busy, and NT state for the
three switch kinds, loads the incoming LDTR and segment caches, sets MSW.TS,
and preserves faults after the architectural task-switch commit point. An IDT
task gate also pushes an exception error word on the incoming task stack when
that exception has an error code. CLTS is restricted to CPL 0.

Conforming code and expand-down data/stack bounds are admitted by the common
segment checks. Tests cover call-gate parameter copies, LDT-backed incoming
task data, task-gate DPL rules, post-commit task faults, and RETF/IRET fault
priority. The unchanged `ja1umi/80286_programming` images at revision
`3ee4c6f1178e71db8926caf999416af7f4e340b3` provide additional independent
CALL-gate and task-switch inputs; their VGA-retrace loops require a machine
fixture with the declared port behavior to become completion evidence.

This remains an experimental CPU contract rather than a complete protected
operating system. It follows the detailed `SWITCH_TASKS` pseudocode in Appendix
B of the Intel 80286 Programmer's Reference Manual (1987). That sequence is
used where the manual's overview table differs about task-fault vectors or
whether the new context has already committed. NPX state and hardware reset
task behavior remain outside this bounded implementation.
