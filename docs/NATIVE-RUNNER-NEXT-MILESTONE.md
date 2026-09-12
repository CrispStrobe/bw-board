# Next native runner milestone: actual CPU-driven wired execution

2026-09-12 engineering audit at engine `878d571c8fb603f63b026cd2ff875e605042e9ed`
(P2 policy atop `5804fff`; native runtime sources unchanged by those commits).
This document proposes implementation; it does not claim a native CPU runner,
new measurements, a DOS boot, or checkpoint support. No third-party core port is
proposed. P6 dirty-net measurements are independent work and are not prerequisites
for proving the new runner against the checked resolver.

## What can be reused, and where execution currently stops

| Existing owned code | Reusable contract / missing behavior |
| --- | --- |
| `src/experimental/harris-80c286-boot-cpu.js` | `_byte`, `_memory`, `_port` yield logical bus transactions; `_pump` submits one and resumes after its final completion. Decode/ALU/exception/REP continuation remains in a JS generator. |
| `src/experimental/harris-80c286-contract.js` | `plan286Transfers` defines status outputs, byte lanes and odd-word splitting. Physical wrap is refused; CPU handles its specifically supported wrap cases. |
| `src/experimental/harris-80c286-bus.js` | `Harris80C286Bus` is the missing native transaction sequencer: reset/init, TS/TC/TI/TH, phase, READY, write hold, transfer completion, interrupt qualification and INTA gap. |
| `src/experimental/harris-80c286-memory-board.js` | Authoritative period ordering, including peripheral updates and controller preview before CPU sampling. Not just a memory map. |
| `src/experimental/wired-kernel/phase-circuit.c` | Actual-net controller, latch and memory processing already reside together; neither CPU bus nor peripheral clocks are present. |
| `src/experimental/wired-kernel/phase-schedule.c` | `run_latched_memory_schedule` consumes preplanned host drive levels and expected reads. It does not decode instructions, accept adaptive read-dependent transactions, or execute device clocks. |

### A required seam change, not a wrapper shortcut

The JS board's end ordering is:

1. Controller `previewEnd` validates/captures READY.
2. Check that CPU and controller observe the same READY.
3. CPU bus `endClock` samples data/READY and produces physical completion.
4. Optional DMA `endMaster` samples its transfer and settles resulting devices.
5. Controller `finish` releases commands; devices and memory observe those edges.

Current C `end_latched_memory_clock` combines preview and finish. Inserting a CPU
after that function would sample **after** strobes/data can have been released,
and would lose the pre-commit fault ordering. Refactor private native internals
into preview, CPU/master sampling, and finish/settle stages. Keep the existing
standalone export as a composition so its current oracle remains meaningful.
No extra JS callback between these stages is necessary or desirable.

Begin ordering must likewise preserve input settling, oscillator advance,
peripheral updates, CPU pin drive, optional DMA ownership drive, controller
begin, peripheral updates, latch update and memory settling. Stateful device
updates cannot be folded into arbitrary pure-net evaluation passes.

## Smallest honest delivery sequence

### R1 — Native transaction sequencer, with a JS instruction producer

Port the owned transfer planner and bus state machine to a private C context.
Bind CPU inputs to actual net IDs and outputs to actual driver IDs. Memory
acceptance must still be caused by controller strobes, never by a completed
transaction callback updating a RAM array.

Expose a bounded operation approximately `runUntilCompletion(maxPeriods)` plus
validated transaction submission and timestamped external pin events. Return
physical/final completion, elapsed periods, and a stop reason; leave the context
resumable when its period budget expires. Run each native period normally and
stop at a completion, observation breakpoint, input deadline, fault or budget.
No idle/cycle skipping in this stage.

A temporary JS board adapter can implement `submit` and initialization, while a
new explicit CPU run method drives the generator via `_pump` at transaction
completion boundaries. Do not make existing `stepClock` silently execute many
periods. Byte code fetches currently yield separately, so crossings remain
frequent, but they need not happen every period or memory-settle pass.

**This reuses the existing transaction vocabulary, not executable native CPU
micro-ops.** Future instruction addresses, data and ports depend on values fed
back into the generator. Precomputing `phase-schedule` vectors for an arbitrary
program would require executing/speculating the program first and validating
all its dependencies. Do not present trace replay as an emulator.

Acceptance: owned boot ROM and loop ROM execute through the JS CPU/native bus
bridge, with every physical completion, instruction retirement and final mapped
byte matching the reference. This is a hybrid bridge milestone, not P7 closure.

### R2 — Complete native runner for one explicitly limited owned ROM profile

Replace the generator only for a declared small opcode profile with an explicit
native decode/execute continuation state. Start with the already-owned
`createHarrisBootROM()` program: reset far jump, CLI, MOV AX immediate, moffs word
read/write, ADD AX direct-memory ModRM, and HLT. Fetch every instruction byte and
operand over the native bus and actual ROM/RAM nets. Preserve the reset hidden
CS base `0xff0000` separately from visible CS `0xf000`; the reset read is at
`0xfffff0`, and the far jump changes the base to `0xf0000`.

Use two 28C256 lanes with high ROM mapping/low alias and two 62256 RAM lanes
(64 KiB RAM), owned controller/latch/decoders and explicit digital inputs.
That is a coherent CPU+memory+controller/latch machine; it is not a general 286
and does not yet contain a time-driven peripheral. HLT retains the current
profile's explicit limitation: no silicon bus-HLT waveform claim.

Only this exact supported opcode/profile envelope is admitted. Unknown opcodes,
unsupported prefixes, interrupts/coprocessor lines and unsupported topology must
refuse visibly, rather than call JS instruction execution or guest services.
Faulting on an unsupported opcode after its fetch is a diagnostic stop, not an
architectural #UD emulation claim. Do not resume the JS core from partial native
state as an implicit fallback.

Acceptance: same actual wiring and ROM bytes as reference; full memory and
register/defined-flag equality; same period/completion/retirement sequence, both
one-period and bounded multi-period calls. Add the loop ROM profile separately
to exercise effective addresses, branches and repeated reads/writes; do not
generalize support from one program's successful execution.

### R3 — First time-driven device milestone: owned PIT, then PIC

Port `Harris8254Adapter` and `HarrisTimerClock` semantics, not an unrelated full
8254. The current model supports channel 0, binary modes 0/2/3, LSB/MSB access,
even mode-3 divisors, and named refusals for unsupported operations. Preserve
sampled gate/clock edges, separate initial-load edge, latched reads, one value
per RD pulse and trailing-edge writes through actual I/O pin nets.

**Current topology constraint:** `createHarrisMemoryBoard` requires a PIT to use
the PIC/I/O path, and `settleInterruptDevice` returns early when no PIC exists.
Therefore "attach only the PIT to the existing board" does not work. Two honest
options are a new clearly named owned PIT-only reference fixture, or porting the
PIC as well. Prefer the existing-board route for end-to-end qualification:
port `Harris8259Adapter`, keep interrupts masked initially, and then enable the
already-owned interrupt workload after native CPU interrupt/IRET support lands.
Do not replace the PIC with a permanently inactive output and call that the
existing populated board.

The first CPU/PIT program writes a control word and divisor through OUT, waits
using executed code/bus periods, latches and reads the count through IN, stores
results in wired RAM, then halts. Every oscillator edge occurs inside the native
region. Reuse the `io` workload shape in
`scripts/lib/harris-owned-workloads.mjs`, but report the exact smaller topology
until all its PIC/FDC/DMA/keyboard population is represented.

R3 is a complete runner for a named restricted board, **not full P7/P9**, DOS,
the entire real-mode CPU, or arbitrary Circuit Editor circuits. Subsequent
stages add full owned real-mode instruction semantics, PIC/INTA/NMI, keyboard,
FDC and DMA master sequencing, then the existing populated-board workloads and
real DOS boot gate. The 8086/80186 models need separate model contracts; do not
relabel this 286 reset/bus profile as all three CPU generations.

## State, fault and boundary contracts

- Use explicit native continuation fields: instruction start, decode phase,
  fetched bytes/length, prefixes, effective address/width, intermediate operands,
  pending bus request, and retirement state. Later REP/fault/interrupt support
  also requires restart registers, partial-repeat position, segment selection,
  STI/SS shadows and NMI blocking. A JS generator stack is not serializable.
- Bus context includes state/phase/open period, captured period, pending split
  transfers/index/bytes/waits, held write data and duration, reset/init counts,
  INTA gap, LOCK/HOLD ownership, interrupt sample qualification and NMI edge
  state. Preserve 17 complete reset periods and 50 initialization periods, the
  existing wait-limit refusal, and safe counter overflow behavior.
- Circuit context includes pending/live/published driver/net/conflict levels,
  previous resolved levels, controller phase/captured READY, latch outputs,
  pending memory writes and write counters. Incremental dirty/cached state must
  be reconstructed only by a proven restore algorithm, not discarded casually.
- PIT state includes previous clock/gate, sampled gate, loadPending, low byte,
  read phase, latched value and active read/write cycles; `inspect()` omits some
  of these and is **not** a checkpoint. The oscillator's elapsed half-period and
  output also matter. PIC/DMA/FDC later bring their own hidden protocol state.
- Preserve failure ordering and committed effects. Current board faults do not
  roll back already-committed memory. Structural admission and malformed event
  queues must be validated before mutation, while a genuine circuit fault stops
  at its actual boundary. Do not copy final net values into a JS board and imply
  that pending scheduler history migrated with them.
- Initially report `snapshots: false`; stop/rebuild for backend changes. A future
  versioned snapshot needs topology/source identity, all the above state, queued
  external events and observations. Restoring only registers/RAM is insufficient.
- Return only closed-period budget stops initially. Record a structured fault
  boundary if an error happens mid-period. Bounded worker calls must still yield
  to the browser; cancellation is checked between bounded calls/events, not by
  a synchronous JavaScript callback in every native period.

## Verification before calling this an optimization

1. Port planner and bus tests with parity at each begin/end: odd/even lanes,
   inactive Z lanes, READY waits, reset recovery, held write data, unknown/floating
   required pins and contention. Later enable HOLD, LOCK, NMI and two-cycle INTA
   tests before advertising those features.
2. Re-run `harris-native-phase-components`, `harris-native-phase-circuit`, memory
   and schedule suites after splitting preview/sample/finish. In particular keep
   the test where invalid TC2 READY prevents trailing-edge memory commitment.
3. Differentially test the timer/PIC state machines against their owned JS
   adapters, including pulse boundaries and invalid register operations. Full
   `inspect` equality alone does not cover hidden state: use continuation tests.
4. Compare reference and native instruction/physical-transfer streams plus full
   mapped RAM/ROM hashes under zero waits, inserted waits, swapped address wiring
   and chunk sizes 1, 2, odd-sized and large. A wrong wire must affect both paths
   identically; this catches hidden address-map shortcuts.
5. Inject faults before/after sampled read and write commitment; verify named
   refusal, preserved effects, no duplicate accesses across budget resumptions,
   and no callback access to native RAM on CPU completion.
6. Run Node and Chromium with checked/admitted/incremental net implementations,
   exact source/module hashes and default-off entry points. Exercise bounded
   cancellation, input event deadlines and optional observation ring overflow.
7. Measure the complete named runner, not only C settling: wall time, periods,
   retirements, crossings, device ticks and browser responsiveness. Separate
   trace/observation enabled runs. A smaller board cannot substantiate a speedup
   for the historical full populated-board benchmark or meet its 4.77 MHz gate.

## Port complexity and recommended next change

The inspected JS CPU is 789 lines and bus is 260 lines; the PIT/clock adapter is
140 lines. These counts are **not effort estimates**: generator continuations,
fault restart semantics, externally observed ordering and parity tests dominate
the CPU port. The bus is a bounded state-machine port; a restricted native ROM
executor is moderate scope; full CPU plus interrupt/DMA/device parity is several
separate substantial implementation lanes. No credible completion date or
throughput ceiling follows from source size.

Implement the native end-phase seam and R1 bus parity first. It validates the
architectural boundary and removes per-period crossings without simultaneously
rewriting the CPU. Keep the bridge explicitly named and unqualified for full
native selection. Then R2 makes native instruction execution measurable, and
R3 prevents optimizing a CPU/memory-only island while omitting time-driven work.
