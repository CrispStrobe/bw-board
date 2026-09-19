# Experimental 80286 far control transfers

The protected executor implements direct same-privilege far CALL/JMP, far RET,
and 286 type-4 call gates. A gate may enter a numerically lower privilege ring
through the current TSS stack pointers. The transition preflights the complete
new frame and old parameter span, copies the gate's declared parameter words,
then writes `old SS`, `old SP`, parameters, `old CS`, and return IP in 286 stack
order. `RETF imm16` discards the declared bytes on both sides of an outer
return.

This is an experimental CPU contract, not a complete protected operating
system. Conforming code, expand-down stacks, task gates, and task switches are
separate boundaries until their own tests land. The implementation follows
the Intel 80286 Programmer's Reference Manual (1987), protected-mode control
transfer and call-gate sections. Tests use independently constructed descriptor
and stack images and include privilege and atomic-fault controls.
