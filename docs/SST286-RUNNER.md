# SingleStepTests/80286 real-mode acceptance

## HOLD/physical DMA follow-up, 2026-09-09

The [physical DMA increment](HARRIS-286-PHYSICAL-DMA.md) adds an implicit-lock
request flag to the CPU's memory XCHG path. The [fresh full-suite receipt](SST286-HOLD-REPORT.json)
pins that CPU and records **1,477,997 passes, zero fail/unsupported/budget,
three upstream revocations**, exit 0. No masks or exclusions were changed.
HOLD/arbitration, DMA, keyboard and physical boot evidence comes from separate
wired tests and diagnostics; this semantic corpus does not grade those nets.

## Wired BIOS diagnostic follow-up, 2026-09-08

The [extended POST probe](HARRIS-286-BIOS-POST.md) confirms the original BIOS's
PIC configuration stop on the 640 KiB wired board. An explicit unbuffered
firmware build changes only ICW4, retaining default-ROM byte identity and PIC
guards. Five new tests; targeted regressions including BIOS ROM/floppy-driver
tests pass **345/345**, zero skips. CPU/SST adapter/runner hashes are unchanged;
no new full-vector run or wired DOS boot is claimed. Diagnostic exit 2 and
`accepted:false` are intentional and separate from passing regression tests.

## Wired memory-map follow-up, 2026-09-08

[Conventional/text RAM expansion](HARRIS-286-MEMORY-MAP.md) adds configurable
64–640 KiB conventional RAM, optional B8000h text storage, and ten owned map/
relocation tests. Targeted regressions including PIC/PIT pass **274/274**,
zero skips. CPU/SST adapter/runner hashes still match `SST286-INTR-REPORT.json`;
no new full-vector run or wired DOS-boot result is claimed.

## Wired timer follow-up, 2026-09-08

The [pin-clocked timer subset](HARRIS-286-TIMER.md) connects a guest-programmed
counter 0 to PIC IRQ0, with sixteen owned tests. The targeted command in that
document includes production PIC/PIT regressions: **264/264 pass**, zero skips.
CPU, SST adapter and runner hashes still match `SST286-INTR-REPORT.json`;
no new full-vector run is claimed. Timer/PIC/wiring evidence is separate from
the real-mode vector receipt. Actual wired DOS boot and full 286 remain pending.

## Wired PIC follow-up, 2026-09-08

The [PIC/port bridge](HARRIS-286-PIC.md) adds a default-off, programmable
single-PIC subset and fifteen owned net/guest tests. Targeted regressions,
including `test/i8259.test.mjs`, pass **218/218**, zero skips. CPU, SST adapter
and runner hashes still match `SST286-INTR-REPORT.json`; no new full-vector
run is claimed. That receipt does not validate PIC, I/O wiring or interrupts.
Timer wiring, actual wired DOS boot and full 286 support remain pending.

## Wired INTR follow-up, 2026-09-08

The [INTR integration](HARRIS-286-INTR.md) adds an opt-in CPU/controller path
using an external interrupt-device connector. A [fresh full-suite receipt](SST286-INTR-REPORT.json)
pins the changed CPU: **1,477,997 passes, zero fail/unsupported/budget,
three upstream revocations**, exit 0. This suite supplies no INTR inputs;
asynchronous evidence comes from separate owned wired tests, not this receipt.
The targeted regression command below now passes **176/176**, no skips,
including twelve new INTR tests.

The later [INTA sequencer-only increment](HARRIS-286-INTA.md) leaves CPU,
adapter and runner hashes unchanged from the NMI receipt (historical, before
the INTR follow-up above). It has separate
resolved-net tests and does not claim a new full-vector run.

## NMI follow-up, 2026-09-08

[Opt-in wired NMI](HARRIS-286-NMI.md) adds an independent asynchronous-input
path, with thirteen new owned tests. The targeted regression command below
now passes **159/159**, no skips. The [fresh full-suite receipt](SST286-NMI-REPORT.json)
retains **1,477,997 passes, zero fail/unsupported/budget, three revocations**,
exit 0, with a new CPU hash. This suite sends no NMI inputs; its green result
is not a silicon/timing oracle for NMI. Earlier receipts remain historical.

## System-state follow-up, 2026-09-08

The [system-state prerequisite increment](HARRIS-286-SYSTEM-STATE.md) adds
real-mode GDT/IDT/MSW operations and relocated interrupt-table delivery.
Its [fresh full-suite receipt](SST286-SYSTEM-STATE-REPORT.json) records the same
**1,477,997 passes, zero failures/unsupported/budget, three revocations**, exit 0,
against the new CPU source hash. The older receipts below remain historical.
The targeted command below now passes **146/146**, zero skips, including twelve
new system-state tests. The suite does not itself contain those new opcodes;
their evidence is owned tests plus the cited manual, not new silicon vectors.

## Expanded result, 2026-09-08

All **326 files / 1,478,000 vectors** selected at revision
`37c73caf53dcd22d3dd369ff09305d13d117a4fe`:
**1,477,997 executed and passed**, zero mismatches, unsupported cases or budget
exhaustions, and **3 upstream revocations**. Exit **0**. No new exclusions or
weakened masks. The [full hashed receipt](SST286-REAL-MODE-REPORT.json) includes
every file's counts. This is full acceptance of this pinned real-mode state
inventory, not full 80286, timing, device or application compatibility.

Local regression verification: **134/134 passed, zero skips**, including wired
bus/memory/CPU, Paterson routines on all three CPU profiles, reader negatives,
private-fixture admission, and DOS persistence on 8086/80186:

```sh
node --test --test-reporter=spec test/harris-*.test.mjs test/paterson-fat12.test.mjs test/sst286.test.mjs test/private-guest-fixtures.test.mjs test/dos-guest-persistence.test.mjs
```

No full CI, browser acceptance, new guest downloads, application pin changes,
merge or deployment were performed for this increment.

## Historical baseline, 2026-09-08

The complete pinned **inventory** has now been traversed: all 326 files,
1,478,000 vectors. This is not a complete successful execution of the suite.
The [machine-readable receipt](SST286-BASELINE.json) pins the suite, revocation
list, runner, adapter and CPU source hashes.

| Outcome | Vectors |
| --- | ---: |
| State matched | 675,501 |
| State mismatch after completed execution | 0 |
| Unsupported | 802,496 |
| Revoked upstream | 3 |
| Transfer budget exhausted | 0 |

42,341 exception/interrupt vectors were classified unsupported before execution;
1,435,656 vectors entered the executor, including those which then refused an
unsupported operation. No unsupported case is included in the pass count.
The runner exited **1**, not success. The 45.7% matching share describes this
vector inventory, not a percentage of DOS/game/OS compatibility.

## Reproduce

Use an external checkout of the MIT-licensed
[upstream suite](https://github.com/SingleStepTests/80286). Do not put its large
binary files into the application or engine repository.

```sh
git clone https://github.com/SingleStepTests/80286 /external/80286
git -C /external/80286 checkout --detach 37c73caf53dcd22d3dd369ff09305d13d117a4fe
I80286_VECTORS=/external/80286 node scripts/grind-i80286.mjs --report /external/new-report.json
# Explicitly sampled, not a full inventory receipt:
I80286_VECTORS=/external/80286 node scripts/grind-i80286.mjs --limit 100 00 B8 EB
```

Exit codes: 0 means all selected, non-revoked vectors passed; 1 means a
mismatch, unsupported case or budget exhaustion; 2 means invalid arguments,
missing/corrupted inputs or runner error. `fullSuite` in stdout means the
complete inventory was selected, **not** that all vectors executed or passed.
Each file emits counts and its first mismatch; the last JSON line is the total.
`--report` additionally saves per-file results and CPU/adapter/runner SHA-256
hashes, refusing to overwrite an existing receipt.
Zero matches, unmatched requested forms and invalid limits fail explicitly.
The current runner is opt-in, not a new full-suite CI gate.

HEAD must match the pin. Every selected compressed file and the revocation list
is checked against its Git blob from that revision before parsing. Selection
uses the pinned tree, not a permissive filesystem glob. The reader checks MOO
1.1/C286, real mode, chunk bounds, registers, RAM, masks, hashes and declared
test counts. Unknown semantic chunks fail closed rather than being ignored.
Cycle data is length-validated and counted, but not compared.

Two measured format details: BYTS includes the terminating HALT; META's count
is cumulative in these files (e.g. opcode 04 carries 25,000 despite having
5,000 vectors), so the file-header count is used for completeness. GMET is
generator metadata, not CPU state. The reader is separate from the old 8086
reader to avoid silently dropping masks and exceptions.

## Exactly what is tested

The test-only adapter directly drives HarrisBootCPU's instruction generator
against sparse storage representing 16 MiB of writable, initially zero RAM.
It is **not the latched circuit board**. It initializes only from `initial`,
executes the real decoder, injects HALT on taken flow control without changing
RAM, and merges final register/memory deltas with initial state. It checks
unexpected writes too, and applies file/per-test register masks. It does not
load expected final state into the emulator. Exceptions are now executed, not
preflight-skipped: the actual delivered vector must match EXCP. Its flag address
only locates upstream-defined comparison masks on the saved stack bytes.
The CPU remains experimental and incomplete as a whole 80286.

Owned tests cover malformed/truncated inputs, actual MOV and self-jump results,
HALT semantics, defined-bit failures, unexpected writes, addresses above 1 MiB,
fresh state, revocation syntax, false exception expectations and budgets.

No pin-level state, bus order, READY timing, prefetch or clock equivalence is
graded. The upstream inventory is real-mode only and does not establish
protected mode or whole-system readiness. Separate wired READY/reset/interrupt
and actual guest-boot acceptance remain necessary.

## Implemented expansion and remaining gates

Carry arithmetic, multiply/divide, shifts/rotates, decimal adjustments, stack
frames, near/far transfers, strings/REP, port transactions, software INT/IRET
and real-mode faults now execute. Wired tests independently check fault stack
contents, first-prefix return IP, INT/IRET, REP copies and READY-delayed ADC
commit. Exhaustive byte ADC/SBB tests use an independent arithmetic oracle.

Harris-specific observations are deliberately retained: immediate IMUL SZP
from the high product word, partial string-fault register updates, pair-of-word
offset wrapping and byte IDIV overflow behavior. The latter uses an operand
division algorithm, never vector hashes; see the
[upstream anomaly discussion](https://github.com/SingleStepTests/80286/issues/1).
AAM-zero flag behavior is inferred from the pinned observations, not asserted
as portable architectural behavior. These need additional hardware evidence
before making claims beyond this Harris profile.

The semantic harness accepts LOCK decoding without grading LOCK signaling.
It explicitly selects an inactive-coprocessor-lines profile: reads return FF,
no BUSY/ERROR/PEREQ are asserted and no 287 instructions execute. Port values
and bus cycles are not compared against the upstream traces. The physical
board defaults to refusing unwired LOCK and coprocessor protocols.

Remaining acceptance gates:

1. Remaining system operations outside this inventory (including undocumented
   LOADALL), complete PIC/cascade integration, nested faults/shutdown and debug/trap behavior.
   [Wired INTR](HARRIS-286-INTR.md) and
   [Opt-in NMI](HARRIS-286-NMI.md) has separate wired tests, not SST timing coverage.
   The supported real-mode 0F prerequisites are documented in the follow-up above;
   protected execution still fails closed.
2. Physical I/O devices, controller/LOCK/coprocessor handshakes, larger memory
   maps, actual DOS boot and persistent files on the wired 286 board.
3. Protected-mode descriptors, privilege checks, gates, tasks and exceptions,
   with dedicated tests: this real-mode suite cannot certify them.
4. Prefetch/timing and named Circuit Editor boards, followed by guest acceptance
   for DOS applications, ELKS and MINIX. No production pin promotion is implied.
