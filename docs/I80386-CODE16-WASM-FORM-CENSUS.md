# Code16 WASM form census

Set `AT_CODE16_WASM=1 AT_CODE16_WASM_DIAGNOSTICS=1
AT_CODE16_WASM_FORM_CENSUS=1` on the experimental AT console to describe
refused instruction bytes. The option is off by default and requires the
existing opt-in WASM and reason counters. It does not execute guest code or
change the ordinary path.

The observer receives bytes already captured by the side-effect-free code
window proof. It scans the prefix chain, records the opcode after prefixes,
the ModR/M register or memory shape and group extension where applicable,
operand/address widths, and an instruction length only when its bounded
grammar can account for ModR/M, SIB, displacement and immediate bytes.
Unknown or incomplete lengths remain unknown. A decoded length is a census
description, not admission to native execution or a general disassembler.
Focused tests compare representative length estimates against the existing
CPU decoder's EIP advance.

`formCensus.first26`, `first66`, and `first8e` count calls that refused those
exact first bytes. `shortBlockSequential` describes the next byte span after
one supported instruction when decoding stopped before a second.
`excludedTerminalBranches` counts single terminal JZ/JNZ blocks; bytes after
those branches are not called a sequential continuation because the next
executed address can be the branch target. Counts are dispatcher calls, not
distinct static instructions or retired instruction coverage. The observer
does not infer the behavior of a full instruction from its first byte alone.

In a private pinned 60-million-step Windows ordinary/opt-in pair, the full
normalized guest reports matched. The form census counted:

| Refused first byte | Calls | Leading decoded forms |
| --- | ---: | --- |
| `0x26` | 2,840,502 | `26:8B` memory read 670,274; `26:3A` byte compare from memory 482,417; `26:8A` byte read 407,566 |
| `0x66` | 1,113,760 | 32-bit register shifts and ALU forms, including `66:D1` reg 119,281 and `66:C1` reg shifts 179,637 combined |
| `0x8E` | 1,114,818 | MOV ES from register 600,021 or memory 399,147 |

All selected `0x26` and `0x8E` spans had lengths described by this grammar;
1,112,486 of 1,113,760 `0x66` spans did. Of 8,005,084 short-block calls,
3,965,253 were terminal branches and were excluded. The remaining 4,039,831
sequential continuations included PUSH r16 (424,461), MOV to memory (338,449),
and register XOR16 (284,384); 3,877,592 had described lengths.

The first bounded implementation target is `0x26`-prefixed read-only `8A` and
`8B` memory loads, then `0x26 3A` CMP byte from memory. The published 16-bit
EA descriptor already accepts an explicit ES override, and the data-window
proof already distinguishes reads and validates exact physical bytes. The
implementation must validate the code and data proofs immediately before
each access, preserve high-byte register and CMP flag behavior, and fall back
before any guest change when a proof fails. Register-only XOR16 is a separate
small continuation candidate. `0x8E` changes segment caches and may fault;
`0x66` spans several 32-bit semantics; stack and memory writes need separate
fault-ordering proofs. These counts identify candidates for testing, not
additional native instruction coverage or a speed projection.
