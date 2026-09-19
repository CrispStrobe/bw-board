# Experimental protected 80286 common ISA

The opt-in `ProtectedI80286` decoder supports the common 286 instructions
needed by the owned and external protected-mode guests without changing the
production real-mode CPU path. This increment adds unsigned and signed
multiply/divide, immediate IMUL, PUSHA/POPA, ENTER/LEAVE, LDS/LES, BOUND,
XLAT, INS/OUTS, the decimal and ASCII adjust family, ARPL, LAR, LSL, VERR,
and VERW.

Divide errors raise restartable #DE before changing AX or DX. PUSHA, POPA,
ENTER, LDS, LES, BOUND, and string I/O validate their complete memory spans
and permissions before the first visible write or port access. REP INS/OUTS
use the protected string executor's one-iteration `step()` contract, retaining
the prefix IP between iterations. CLI, STI, INS, OUTS, and scalar I/O enforce
CPL against IOPL.

LAR, LSL, VERR, and VERW treat null, unavailable, out-of-table, and
privilege-inaccessible selectors as a cleared ZF result rather than a
protection exception. Their memory operand itself may still fault. ARPL writes
only after destination permission and span checks.

This remains a bounded functional decoder. Timing is estimated and ungraded.
Far calls, gates, task switches, and task returns are maintained in the
separate protected control-transfer layer.
