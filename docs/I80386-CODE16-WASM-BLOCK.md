# Opt-in 16-bit WASM block slice

`createI80386Code16WasmDispatcher(machine)` runs a narrow, bounded block of
16-bit instructions over the experimental shared RAM bridge. It is separate
from the existing 32-bit native dispatcher and is off by default. The AT
console enables it with `AT_CODE16_WASM=1` or `--code16-wasm`. This option is
mutually exclusive with the 32-bit native dispatcher, the per-step code16 load
experiment, and the diagnostic coverage observer. Production GUI execution is
unchanged. No speed improvement is claimed.

The decoder accepts unprefixed NOP, MOV immediate/register 16-bit, register
CMP16, read-only memory `8A`/`8B` with 16-bit ModR/M addressing, and terminal
short JZ/JNZ. A block contains at least two instructions and at most eight by
default. It stays within one code page and the CS limit. The final code proof
captures only the decoded bytes; every cached block rechecks those bytes and
its mode, segment, A20, and paging identity before entry. Unsupported bytes,
prefixes, register-only `8A`, stores, stack operations, and missing proofs
fall back to ordinary board stepping.

Each memory read obtains a fresh published EA/data proof at block entry. The
host proves segment base, limit, access, paging hit and privilege, A20 decode,
and the exact physical byte addresses. The WASM kernel computes the live
BX/BP/SI/DI offset with 16-bit wrap and checks it against the admitted offset
before reading current shared memory. A preceding instruction that changes an
EA register can cause a boundary exit. Already completed instructions remain
committed; the ordinary interpreter resumes at the refused instruction.
Uncached pages fall back so interpreter page walks retain accessed-bit writes
and fault behavior. This first slice never writes guest memory.

The kernel copies eight full 32-bit registers, full EIP, EFLAGS, and CPU cycle
count. Width-16 register writes preserve upper halves; `8A` handles both low
and high byte registers. Sequential EIP remains full width in a large-limit
16-bit protected CS. A taken short branch wraps its target to 16 bits; an
out-of-limit target exits before the branch so the interpreter delivers its
fault. Branches always end a block. Entry refuses trace/debug/shadow/repeat
state, pending interrupts, and expired chip or APIC timer horizons. Its budget
stops before the next board event; board cycles and chip debt are charged only
for completed instructions.

The bundled module can be rebuilt with:

```sh
clang --target=wasm32 -O3 -Wall -Wextra -Werror -nostdlib \
  -Wl,--no-entry -Wl,--export-all -Wl,--import-memory \
  -Wl,--global-base=16779264 -Wl,--initial-memory=16908288 \
  -Wl,--max-memory=16908288 \
  -o wasm/i80386-code16-wasm.wasm src/experimental/i80386-code16-wasm.c
```

The focused differential tests compare ordinary board steps in real,
protected16, VM86 and paged modes; guard dynamic EA changes, code mutation,
ROM/MMIO refusal, interrupt and chip boundaries, BP/SS addressing, high-byte
registers, and taken/fallthrough branches. A 512-step run of the vendored LGPL
BIOS matched the interpreter's CPU state and full RAM hash. Only 31 of those
steps used WASM across 19 calls, so it serves as a correctness smoke rather
than a performance measurement. A private pinned 60-million-step Windows A/B
matched normalized guest output exactly, but this slice ran 3.77 times longer
in user CPU time than ordinary execution (295.91 versus 78.40 seconds). It
retired 2.73 million native instructions in 1.26 million WASM calls, only
2.16 instructions per call on average: 4.55% of all 60 million steps. The
remaining 57,269,596 steps fell back to ordinary execution. The measured
user CPU cost was 3.77 times ordinary execution, so this option should not
be used for performance. It remains off by default.

The 60-million-step A/B used the pre-rebase console CLI. The final candidate
adds an unrelated mode CPU profiler option and explicitly excludes profiling
with this WASM path. The WASM implementation bytes and ordinary guest step
path did not change in that rebase. The final candidate passed the focused
tests and full 386 suite; the long-run timing is bound to the measured CLI
hash in the private evidence, not presented as a final-candidate timing.

## Opt-in refusal diagnostics

Set `AT_CODE16_WASM=1 AT_CODE16_WASM_DIAGNOSTICS=1` to add a
`code16WasmDiagnostics` object to the AT console report. Diagnostics require
the WASM option and leave the ordinary/default guest path untouched. The
dispatcher keeps the reason maps absent when diagnostics are off. The maps
count dispatcher **calls**, not retired guest instructions:

- `fallbacks` assigns one reason to each call that executes one ordinary
  `machine.step()`. The sum equals `code16WasmStats.fallback`.
- `exits` assigns one reason to each WASM call that commits at least one
  instruction. The sum equals `code16WasmStats.blockCalls`.
- `shortBlockStops` records why decoding stopped when it found only one
  supported instruction. `unsupportedFirstOpcodes` uses decimal byte keys
  for first-byte refusals. `preparationTruncations` records data proofs that
  cut a block after at least two ready instructions; those calls can still
  execute. `cacheInvalidations` counts stale cached code proofs.

Reasons are tied to observed guards. When several eligibility guards are true,
the first matching guard supplies the category; it is not a causal timing
attribution. `dynamicEA` means the WASM-computed live offset differed from
the exact address proved before entry. `branchTargetLimit` means a taken
branch crossed the CS limit. `wasmGuard` covers a boundary that these
observable checks cannot distinguish; no such exit appeared in the pinned
run. Diagnostics do not attempt to classify instruction internals beyond the
first opcode byte.

A pinned private 60-million-step ordinary/diagnostic A/B matched the full
normalized guest report. Of 57,269,596 fallback calls, 29,848,776 began with
an unsupported opcode byte, 15,277,507 were in 32-bit mode, and 8,005,084
had fewer than two supported instructions. Further blockers were repeat
context (2,150,307 calls) and unsupported memory forms (1,811,593). Only
13,319 fallbacks were data-proof refusals; 98,169 native exits were caused
by a changed effective address. The leading refused first bytes include
`0x26`, `0x8E`, `0x66`, `0xE8`, `0xC3`, `0x50`, and `0xF3`. A first byte alone
does not establish its full instruction form. These counts favor broader
opcode, prefix, stack, and control-flow support, followed by useful block
linking; they do not identify a page-window proof as the leading blocker.

The diagnostic opt-in used 311.13 user CPU seconds versus 78.33 for ordinary
stepping in that serial pair. This is a correctness and bottleneck census,
not a performance improvement. It does not isolate the cost of diagnostics
from the already slower WASM slice. The diagnostic WASM option should not be
used for performance.
