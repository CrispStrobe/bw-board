# Opt-in 16-bit WASM block slice

`createI80386Code16WasmDispatcher(machine)` runs a narrow, bounded block of
16-bit instructions over the experimental shared RAM bridge. It is separate
from the existing 32-bit native dispatcher and is off by default. The AT
console enables it with `AT_CODE16_WASM=1` or `--code16-wasm`. This option is
mutually exclusive with the 32-bit native dispatcher, the per-step code16 load
experiment, and the diagnostic coverage observer. Production GUI execution is
unchanged. No speed improvement is claimed.

The decoder accepts unprefixed NOP, MOV immediate/register 16-bit, register
CMP16 and XOR16, read-only memory `8A`/`8B` with 16-bit ModR/M addressing,
exact `0x26`-prefixed ES memory `8A`/`8B` loads and `3A` byte CMP, terminal
short JZ/JNZ, and terminal unprefixed `89 /r` mod00/rm6 (`MOV DS:[disp16],r16`).
A block contains at least two instructions and at most eight by
default. It stays within one code page and the CS limit. The final code proof
captures only the decoded bytes; every cached block rechecks those bytes and
its mode, segment, A20, and paging identity before entry. Unsupported bytes,
other prefixes, register-only `8A`, other stores, stack operations, and missing proofs
fall back to ordinary board stepping.

Each memory read obtains a fresh published EA/data proof at block entry. The
host proves segment base, limit, access, paging hit and privilege, A20 decode,
and the exact physical byte addresses. The WASM kernel computes the live
BX/BP/SI/DI offset with 16-bit wrap and checks it against the admitted offset
before reading current shared memory. A preceding instruction that changes an
EA register can cause a boundary exit. Already completed instructions remain
committed; the ordinary interpreter resumes at the refused instruction.
Uncached pages fall back so interpreter page walks retain accessed-bit writes
and fault behavior. The initial read-only slice never wrote guest memory;
the later terminal-store extension has a separate write proof below.

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
be used for performance. It remains off by default. These figures describe
the original unprefixed slice before the ES/XOR extension.

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

## ES reads, byte CMP, and register XOR16

The later opt-in extension admits only one `0x26` prefix followed by memory
`8A`, `8B`, or `3A`. The pure EA descriptor receives explicit ES override
index 0; its segment and physical data-window proof is checked before WASM
entry. The module recomputes the live 16-bit offset before reading the proved
physical byte or bytes. `3A` compares the selected low or high byte register
against the ES byte and changes only flags, including CF, PF, AF, ZF, SF, and
OF. Unprefixed register-only `31`/`33` XOR16 preserves the high halves of
registers and follows the interpreter's logic-flag behavior. The WASM ABI is
version 2. A refused proof leaves the instruction for ordinary stepping;
this extension still does not write guest memory or enter the production GUI.

Focused differential tests cover real, protected16, VM86 and paged execution,
ES versus DS/SS, AH/AL flag edges and taken/fallthrough JZ, a word crossing
noncontiguous physical pages, missing second-page and ES-limit refusal, code
mutation, chip deadlines, and both XOR register orientations. A pinned
private 60-million-step ordinary/opt-in A/B matched the full normalized guest
report and stopped at the same budget without refusal. The extension retired
5,039,835 native instructions in 2,344,005 calls, 8.40% of all steps, versus
2,730,404 instructions and 4.55% for the original slice. Mean block length
remained 2.15 instructions per call. Ordinary execution used 78.60 user CPU
seconds; opt-in used 308.17, **3.92 times slower**. This remains correctness
groundwork and should not be used for performance. The flat block length
points to reducing block-entry frequency and broadening or linking control
flow before another isolated opcode addition.

## Branch-link opportunity observer

Set `AT_CODE16_WASM=1 AT_CODE16_WASM_DIAGNOSTICS=1
AT_CODE16_WASM_BRANCH_LINKS=1` in the external-media console CLI to observe
single-instruction JZ/JNZ blocks that currently fall back to ordinary stepping.
The observer wraps only that ordinary step's instruction fetch. It requires
the first fetched CS:EIP and both branch bytes to match the pre-step code
proof, and the branch to retire, before calling its post-step CS:EIP an actual
successor. It classifies taken and fallthrough separately; an interrupt,
fault, code edit, or other redirect is excluded rather than mistaken for a
branch link. Untaken sequential EIP is kept at full width; a taken rel8
target wraps to 16 bits.

For an actual successor on the same linear code page, it checks the current
mode, CS cache, paging and A20 identity, then runs the existing side-effect-free
code-window decoder and data-read preparation to count a candidate of at least
two instructions. It separately counts register-only and memory-read
candidates and refusal reasons. The observer never executes a successor or
speculatively fetches a target. Its post-step readiness check does not prove
that a linked executor could have entered the successor within the *previous*
chip-event budget; such an executor needs its own entry proof and event check.

The pinned Windows 60-million-step A/B produced identical normalized guest
reports and stopped at the same budget. There were 3,484,531 terminal
single-Jcc fallbacks in this ES/XOR slice. Every observed first fetch and
retired branch matched its proved bytes and predicted successor: 1,738,345
taken and 1,746,186 fallthrough. Of these, 3,422,856 landed on the same
linear code page. Only 223,020 destinations (6.40% of all terminal Jcc calls)
had a currently supported two-or-more-instruction successor: 52,044
register-only and 170,976 with a memory read. The current decoder refused
877,964 same-page successors after one supported instruction; the report
does not distinguish how many of those could link recursively. Candidate
counts are a conservative lower bound under today's grammar, not a count of
instructions a linked executor would retire.

This result is a **no-go for implementing a narrow Jcc-to-current-block
link** as a performance slice. Register-only ready successors account for
only 1.49% of terminal Jcc calls; all ready successors including memory
reads reach only 6.40%.
The next experiment should first broaden safe opcode, stack, and store
coverage and reduce block-entry cost. A later bounded link prototype can
use one terminal Jcc root and two separately byte-proved successor spans,
at most 64 IR slots, with exact per-slot EIP and event-budget checks. It
must retain the current expected-offset guard for any memory read and leave
unproved targets to ordinary stepping. The census executes no such links.
The diagnostic opt-in used 363.14 versus 79.63 user CPU seconds; that
includes millions of extra decode/proof probes and is not a native-link
performance result.

## Terminal plain-RAM word store

The next default-off extension admits only unprefixed `89 /r` with
mod00/rm6, a direct DS:disp16 word destination. It must end a block with at
least one earlier supported instruction. The host rechecks the captured code
bytes and obtains the published two-byte write proof before entering WASM.
It further requires both bytes in one physically contiguous kind-1 RAM page.
The proof refuses segment/limit/privilege failures, uncached or clean paging
translations, gated-A20 writes, ROM, device overlays, tracked page-table
pages, and overlap with the captured code bytes. A refusal executes the
ordinary instruction, preserving its page walk, fault, CR2 and rollback
effects. The ordinary CPU translates both bytes before either is stored;
the native path writes only after both addresses are proved.

The WASM instruction samples its source register when reached, writes its
low and high bytes to the proved shared-RAM addresses, leaves flags intact,
and returns immediately. This preserves an earlier register update in the
same block and prevents execution of code that the store might modify.
For the admitted RAM page, the board's ordinary `notePhysicalWrite` call
would not invalidate a TLB entry: tracked page-table pages and A20-gated
writes are refused. The ordinary base write has no other effect there beyond
the two RAM bytes; display and device ranges are refused. A later call
revalidates its own code window, including host/DMA edits. The WASM ABI is
version 3. This remains a proof-bounded experiment outside the production
GUI, without a speed claim.

Focused differential tests cover real, protected16, VM86 and paged stores,
live source registers, flags and high register halves, dirty-bit and tracked
page-table rules, page crossing and zero writes before a second-page fault,
CS/code overlap, A20, ROM/MMIO, chip-event boundaries, and host/DMA-equivalent
code and data edits. The full 386 suite passed 452 tests with four skips.
In a pinned 60-million-step Windows A/B, the complete normalized guest
reports matched exactly and both stopped at the budget without refusal.
The extension retired 5,042,482 native instructions in 2,345,288 calls,
only 2,647 more instructions and 1,283 more calls than the prior ES/XOR
slice. Ordinary execution used 79.20 user CPU seconds; the opt-in used
303.48, **3.83 times slower**. It stays default-off and should not be used
for performance. The result reinforces that an isolated store opcode does
not solve limited block length or entry overhead.
