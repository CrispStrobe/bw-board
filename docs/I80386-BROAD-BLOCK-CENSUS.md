# Observed broad-block potential census

Set `AT_BROAD_BLOCK_CENSUS=1` for the ordinary, noninteractive
`run-i80386-at-console.mjs` path or `XV6_BROAD_BLOCK_CENSUS=1` for the ordinary
`probe-xv6-stock.mjs` path. Both reports gain a `broadBlockCensus` object.
The option cannot be combined with a native dispatcher. The observer records
bytes fetched by completed `machine.step()` calls; it does not read future
code, translate an address, inspect data operands, or execute a candidate
block. It can add substantial host overhead, so its runtime is **not** a
performance comparison.

The deliberately limited **syntactic potential** grammar is:

* Linear forms: register INC/DEC/PUSH/POP (`40–5f`), MOV immediate register
  (`b8–bf`), NOP (`90`), and the explicit ModRM families `01/03`, `09/0b`,
  `21/23`, `29/2b`, `31/33`, `39/3b`, `80/81/83`, `85`, `88–8b`, `8d`, and
  `c0/c1/d0–d3`. These include memory forms and writes, but the census does
  **not** claim that a native data-window or precise-fault proof accepts them.
* Terminal control flow: short Jcc (`70–7f`), near Jcc (`0f 80–8f`), near
  CALL/JMP (`e8/e9`), short JMP (`eb`), and near RET (`c2/c3`).
* Terminal string forms: MOVS/STOS/LODS/SCAS (`a4/a5/aa/ab/ac/ad/ae/af`),
  including REP/REPNZ. These count one completed step call, not all repeated
  iterations as separate instructions.

Segment, operand-size, and address-size prefixes are accepted. LOCK is a
refusal; REP/REPNZ with a non-string opcode is a refusal. Other opcodes,
including segment reload, far control flow, I/O and privilege instructions,
are refusals. A candidate run ends at a terminal form, at 64 steps, or when
the next observed entry changes mode, CS, linear code page or sequential EIP.
An instruction whose observed bytes cross a linear 4 KiB page is refused.
This is a *linear-page locality* filter, not a physical-code-page proof.
Unexpected pre-instruction redirects and steps with no increment to core
`cycles` break runs. The census has no event-budget, paging, self-modification,
data-write or precise-fault proof; those must be established by an executable
backend separately.

For each entry mode (`real`, `protected16`, `vm86`, `protected32`), the report
counts attempted step calls, completed core steps, potential steps, and
non-candidate steps. `potentialSteps + nonCandidateSteps = retiredSteps`;
`entryAttempts = retiredSteps + noRetirement + abortedCalls`. Run-length histograms count
potential steps in consecutive observed runs, while `runEndReasons` counts
one termination per run. `firstRefusals` counts each non-candidate step's
first syntactic/locality reason, including steps reached outside any run.
Here `retiredSteps` means ordinary step calls for which the core cycle counter
advanced, including REP iterations; it is not a count of distinct static
instructions. These denominators are **not** native retirements or CPU-time
shares.

Use the census only to decide whether a broad executable path merits a
bounded implementation. A tactical gate is at least 50% potential retired
steps and mean run length at least four on each pinned workload. Even passing
that gate would not demonstrate a speedup: retain an executable experiment
only after exact guest-report parity and serial paired user-CPU A/B showing
at least 10% gain on both workloads. A 10× total speedup requires removing
at least 90% of measured user CPU even with a zero-cost replacement.
