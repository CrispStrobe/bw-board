# Experimental 286 system-state prerequisites

2026-09-08. This increment extends the real-mode Harris CPU, not the production
8086/80186 cores. No application engine pin or production default changes.

## Contract and source

Primary reference: Intel **80286 and 80287 Programmer's Reference Manual**,
1987, 210498-005, sections 10.2–10.4 and instruction entries B-31, B-65,
B-67, B-101–103. [External manual copy](https://bitsavers.trailing-edge.com/components/intel/80286/210498-005_80286_and_80287_Programmers_Reference_Manual_1987.pdf).
Downloaded PDF SHA-256:
`ad487ba99b48cd9f61b14c0fe912a04c7cdb4c7c14a18419aa9faf62d8962460`.
The manual is not bundled or relicensed.

Implemented:

- `LGDT`/`LIDT`: load a 16-bit limit and 24-bit physical base; ignore byte six.
- `SGDT`/`SIDT`: store six bytes. Byte six is undefined architecturally;
  this model writes FF, without claiming a measured Harris value.
- `SMSW`, non-PE-setting `LMSW`, and `CLTS`; flags are preserved.
- Real-mode vector 6 for protected-only `SLDT`/`STR`/`LLDT`/`LTR`/`VERR`/`VERW`,
  `LAR`, `LSL`, `ARPL`, and invalid descriptor-table register operands.
- IDTR-based real-mode interrupt reads, including limit checks and 24-bit
  physical addressing. Reset IDTR is base zero, limit 03FF.

GDTR reset zero and preservation of MSW reserved bits are deterministic model
policies. Descriptor transfers use three words, with independently wrapped
16-bit offsets. Cross-segment word faults are preflighted. The precise silicon
transfer order, boundary side effects and reserved-bit behavior are **not**
certified by the real-mode SingleStepTests inventory, which lacks these forms.

## Fail-closed boundaries

`LMSW` requesting PE=1 throws `UNSUPPORTED_PROTECTED_MODE` before changing MSW.
It does not retire and the wired CPU latches a fault. This is an explicit
emulator limitation, **not an architectural CPU exception**. A defensive check
also refuses to run externally supplied PE=1 state as real mode.

An IDT-limit violation can deliver vector 13. If fault delivery itself fails,
the model stops with `UNSUPPORTED_NESTED_FAULT`; double-fault/shutdown behavior
is not implemented. Undocumented LOADALL remains unsupported. External
INTR/NMI and physical interrupt-acknowledge cycles remain unsupported.

`inspect()` exposes defensive copies of GDTR/IDTR. This is debugger inspection,
not live-state save/load or new circuit-profile serialization.

## Evidence

Final local run: **146/146 tests passed, no skips**, including the twelve new
system-state tests and the existing wired, Paterson, DOS-persistence and reader
regressions. Full pinned SST286 rerun: **1,477,997 passes**, zero failures,
unsupported cases or exhausted budgets, three upstream revocations, exit 0.
The [hashed receipt](SST286-SYSTEM-STATE-REPORT.json) pins the new CPU source.
No full CI, browser tests, merge or deployment were performed.

`test/harris-system-state.test.mjs` contains owned assembly/raw-encoding tests,
independent of the SST reader and its final-state masks:

- Wired MSW read/change/store and CLTS, preserving FLAGS.
- Wired GDT round-trip, 24-bit base and ignored sixth input byte.
- Wired relocated IDT, guest INT/IRET and SIDT round-trip.
- Delayed final LGDT read, delayed final SGDT write and delayed LMSW read:
  register state/retirement wait for the external completion edge.
- Protected-mode refusal and protected-only real-mode faults.
- IDT limit, nested-fault refusal, addresses above 1 MiB and bus wrap.
- Descriptor/word segment faults, memory operands and nonzero ES override.

These establish owned semantic and wired integration behavior, not independent
silicon-vector coverage for system instructions. The full SST286 rerun remains
a regression gate for the already measured instruction inventory.

## Next

The subsequent [NMI foundation](HARRIS-286-NMI.md) adds opt-in NMI sampling,
SS shadow, IRET blocking, HLT wake and REP resumption. The
[INTR follow-up](HARRIS-286-INTR.md) adds controller/pin-level acknowledgement;
programmable PIC/device wiring and a real 286 DOS boot fixture remain pending.
Protected-mode descriptors, gates, privilege rules, tasks and exception delivery
need their own implementation and acceptance corpus before permitting PE=1.
