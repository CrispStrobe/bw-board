# Experimental 16-bit memory loads

`enableI80386Code16LoadExecution(machine)` enables one narrow executable path
on a 386 AT machine. It recognizes only unprefixed `8A r8,r/m8` and
`8B r16,r/m16` with 16-bit memory ModR/M addressing. The default is off.
`AT_CODE16_LOADS=1` enables it in the media-neutral AT console probe; its JSON
report records the input flag and `code16LoadExecutions` count. This flag is
independent of the existing native block option.

Each attempt proves the exact instruction bytes from CS, decodes a 16-bit
effective address from those bytes, resolves the current registers, and proves
the scalar read's physical byte addresses. The proof is rechecked immediately
before the read. The value comes from current RAM or ROM bytes. A refused proof
falls through to the interpreter before changing EIP, registers, or cycles, so
ordinary fetch and data faults retain their order. Prefixes, register-only
forms, debug/trap/shadow state, traced execution, and uncovered pages fall
through as well.

This path runs inside the existing CPU `step()` snapshot, fault, RF/TF and
shadow handling. The board still services chip events and arbitrates interrupts
before every instruction. It makes one JavaScript callback per step and does
not batch consecutive instructions. It is semantic groundwork, not a measured
speed improvement. Differential tests compare the CPU and board state with
ordinary stepping across all 24 memory ModR/M forms, page crossing, protected
16-bit and VM86 modes, and fallbacks.

The [60-million-step A/B receipt](receipts/2026-09-27-i80386-code16-load-exec.json)
records 2,637,257 successful opt-in loads and exact normalized guest-report
parity. The ordinary run used 83.13 user CPU seconds; the opt-in run used
164.94 seconds on the same shared host. This per-step proof path is almost
twice as costly overall. It remains off by default and should not be enabled
for a performance-sensitive run. Broad multi-instruction execution and cheaper
validated entry remain necessary for a meaningful speedup.
