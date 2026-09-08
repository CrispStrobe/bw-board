# SingleStepTests/80286 diagnostic baseline

## Measured 2026-09-08

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
I80286_VECTORS=/external/80286 node scripts/grind-i80286.mjs
# Explicitly sampled, not a full inventory receipt:
I80286_VECTORS=/external/80286 node scripts/grind-i80286.mjs --limit 100 00 B8 EB
```

Exit codes: 0 means all selected, non-revoked vectors passed; 1 means a
mismatch, unsupported case or budget exhaustion; 2 means invalid arguments,
missing/corrupted inputs or runner error. `fullSuite` in stdout means the
complete inventory was selected, **not** that all vectors executed or passed.
Each file emits counts and its first mismatch; the last JSON line is the total.
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
load expected final state into the emulator. The CPU itself remains unchanged,
experimental and incomplete.

Owned tests cover malformed/truncated inputs, actual MOV and self-jump results,
HALT semantics, defined-bit failures, unexpected writes, addresses above 1 MiB,
fresh state, revocation syntax, exception refusal and budgets.

No pin-level state, bus order, READY timing, prefetch or clock equivalence is
graded. The upstream inventory is real-mode only and does not establish
protected mode or whole-system readiness. Separate wired READY/reset/interrupt
and actual guest-boot acceptance remain necessary.

## Next implementation gates

1. Add carry arithmetic (ADC/SBB) with independently calculated flag tests, then
   re-run its opcode/group vectors and the wired Paterson regressions.
2. Fill remaining common real-mode groups, shifts/rotates, string and port-I/O
   operations with explicit flag, REP and bus-completion checks.
3. Implement architectural exception/interrupt delivery, including fault IP
   and segment-limit behavior; replace preflight refusal only when delivery is
   real. Do not merely remove prefixes or patch expected registers to pass.
4. Re-run the complete inventory and retain comparable hashed receipts before
   promoting any experimental engine pin. Keep board timing acceptance separate.
