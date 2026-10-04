# Experimental 16-bit block decoder and coverage probe

External licensed-guest notes and historical context are retained in the [private documentation archive](https://github.com/CrispStrobe/brickwright-firmware-private/tree/master/public-documentation-archive/2026-10-04). Public examples and instructions use freely licensed or freeware software.

`decodeI80386Code16Block(window, maxInstructions)` accepts only a window from
`prevalidateI80386Code16Window`. It revalidates the mode, mapping and every
captured byte before decoding. It has no guest execution path. Its default and
maximum budget is 64 instructions; the input window is already bounded to one
linear page and one in-limit CS span.

Supported forms are NOP, register INC/DEC, register PUSH/POP, MOV immediate to
register, register-only MOV/XOR/ADD/SUB/CMP through ModR/M `mod=11`, JZ/JNZ
relative 8, JMP relative 8/16, CALL relative 16, and RET. CALL and RET are
decode-only terminal records. No stack admission or executable stack semantics
are established by this decoder. A taken 16-bit branch target is wrapped to
16 bits; its sequential fallthrough retains the full EIP, including EIP above
`0xffff` in a large-limit 16-bit protected CS. RET has no static target.

The decoder stops before any prefix, memory operand, unknown opcode, or
incomplete instruction. It also stops immediately after a branch, call or
return. It reports `prefix`, `memory-operand`, `unsupported-opcode`,
`incomplete`, `control-flow`, `budget`, `window-end`, or `invalid-window`.
The returned instructions are immutable byte/operand descriptions; they do
not authorize execution. A future runner would need a fresh window check at
entry and after writes, exact starting CS:EIP, fault and target validation,
stack proof for stack forms, and event boundaries.

The AT console rejects the option with native blocks. It reports:

- 16-bit step calls, admitted windows, and supported first opcodes, split by
  real, protected 16-bit and VM86 mode;
- the number of decoded instructions in a *candidate* block starting at every
  observed 16-bit EIP, plus stop reasons;
- *observed* consecutive block lengths: the ordinary machine continues one
  step at a time. The observer counts an instruction only after core cycles
  advance by one, no interrupt is delivered before execution, and post-step
  CS:EIP matches the decoded fallthrough or branch target. It rechecks the
  original window before each following instruction. A branch or call ends
  the block. RET is recorded as ambiguous because its target is dynamic.
  HLT idle and single-step traps are also uncredited. The observer restores
  the machine's original interrupt-service method when the probe ends.

Candidate histograms overlap by design because every 16-bit step is probed.
Observed block histograms count disjoint retired steps. The observer never
substitutes decoded instructions for the machine's execution.

The [diagnostic receipt](receipts/2026-09-27-i80386-code16-block-decode.json)
records a 60-million-step external workload. A supported first opcode was
seen on 42.805% of 16-bit steps. Conservative replay of decoded consecutive
blocks credited 40.371%; only 24.205% of 16-bit steps fell in blocks of at
least two instructions. The instrumented guest's CPU, serial, text, and VGA
outputs exactly matched the ordinary private baseline. These counts justify
further decoder research, but not native execution wiring or a speed claim.
