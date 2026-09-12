# Execution policy and whole-system optimization

2026-09-12. User requested documentation first, then implementation, with
independent agents and existing relevant screen sessions available for help.
This is an execution plan, not a claim that the performance target is achieved.
Engine baseline: `5ecd6125b685e52819b1064871750ed41f7f16d0`.
Application baseline: `411828a304dd84759cd4c1fb82444e72944ffbdc`; its engine
pin is still `53c3fdbabab232667da98f92db9e3a184f371373` at this checkpoint.

## Distinguish the choices

1. **Machine semantics:** DOS-service environment, functional hardware machine,
   or wired digital machine. DOS services are not BIOS/disk boot. Functional
   hardware can execute BIOS and real device models without resolving every
   CPU bus wire. Wired execution preserves supported net topology and bus phases.
2. **Implementation:** reference JS, optimized/compiled JS, or native/Wasm.
   Compiled connectivity means indexed actual nets, not automatically Wasm.
   Faster implementations must preserve the selected machine's semantics.
3. **Observation:** registers, memory, instruction events, bus events, analog
   values, checkpoints/replay. An observation can change backend eligibility.
4. **Host scheduling:** worker/main thread, execution chunk size, rendering and
   pacing. Responsiveness and simulation capacity are different measurements.

The existing Harris native prototype is not a complete CPU/peripheral runner.
Wired here means the supported ideal-digital model, not complete silicon/analog
timing certification. No setting may advertise capabilities absent at runtime.

## Current GUI and other families

Settings → 8086 execution diagnostics offers optimized RAM words (default) or
reference bytes, persisted locally and applied on target reconstruction only.
The JS/decoded/Wasm comparison is an isolated bundled-program sandbox, not a
project backend selector. The DOS bench and hardware bench both apply the RAM
preference. Media metadata selects DOS-program versus hardware loading.

RAM shortcut guards automatically fall back for intercepted accesses, tracing,
boundaries and special regions. BoardImpl also defers analog solves on eligible
pure-digital nets, but retains required solving for analog observations.
Neither behavior automatically selects the Harris native wired kernel.

| Family | Existing execution support |
| --- | --- |
| 8086/80186 | Functional JS, guarded optimizations, diagnostics/sandbox |
| Experimental 80286 | Reference/compiled wired paths; partial native kernels |
| Z80 | Fast target and explicit optional cycle-provider interface; reviewed loader required |
| W65C02 | Fast target; evaluated JSMoo candidate explicitly rejected, no selectable runtime |
| STC/8051 | Wasm already supplies the normal emulator path |
| AVR/RP2040 | JS/TypeScript engines; no universal dual-mode selector |

Share policy, admission, observation and scheduling infrastructure. Do not build
two independently maintained CPU emulators for every chip merely for symmetry.

## Required selection contract

- Default **Auto** chooses the fastest *qualified* available implementation
  satisfying requested machine semantics and observation requirements.
- Explicit functional or wired requests never silently substitute another
  semantic machine. Unavailable requests return structured, named refusals.
- Reference and experimental overrides are advanced options. Experiments remain
  default-off and require explicit opt-in; Auto does not select them implicitly.
- Return requested mode, actual implementation, reason, capabilities, restart
  requirement and evidence identity. A label is not evidence of qualification.
- Deterministic admission, not an unrecorded runtime speed contest. Measurements
  inform reviewed ranking; slow hosts must not silently lose fidelity.
- Project semantics belong to the project; implementation preferences may be
  local. Preserve the existing RAM diagnostic preference and storage fallback.
- Whole-backend changes initially require stop/rebuild. No hot swap until exact
  compatible snapshots cover hidden CPU/bus/device/event/interrupt state.
- Observation attachment must re-check eligibility before execution resumes.
  Safe per-access deoptimization is allowed; fabricated bus events are not.
- Wire edits invalidate affected compiled topology and require re-admission.

## GUI target

One execution panel: Auto / functional / wired where supported; advanced
reference/experimental controls; active backend and reason; required restart;
supported observations; throughput, pacing and responsiveness displayed apart.
Unavailable choices explain why rather than pretending a backend loaded.
The existing sandbox stays distinctly labeled. First ship truthful status and
policy seams, then expose only modes actually connected to project execution.

## Ordered delivery gates

- [ ] P1: Adopt a reviewed engine SHA into an isolated app branch. Reconcile
  declared vendor forks, mirrors, census/provenance and browser tests. No unrelated
  application deployment or guest-media publication.
- [ ] P2: Implement a dependency-light, tested selection/admission contract.
  Tests: semantic mismatch, missing capability, unavailable loader, rejected
  candidate, opt-in experiment, explicit reference, deterministic Auto, and
  restart/no-mutation behavior. Integrate existing consumers incrementally.
- [ ] P3: App execution status/preferences using the contract, with browser
  coverage of actual target creation, persistence, refusal and reconstruction.
- [ ] P4: Repeated end-to-end benchmarks: CPU, devices, nets, allocation/GC,
  tracing, rendering and messages separately; full state hashes and named host.
- [ ] P5: Common host optimizations: dirty rendering, bounded chunks, lazy
  observation, reusable buffers, worker execution where supported.
- [ ] P6: Wired dirty scheduling: reduce residual full scans, schedule affected
  components only, preserve delta ordering, X/Z/conflicts and topology changes.
- [ ] P7: Complete a native execution region including CPU bus sequencing and
  required peripherals; avoid JS↔Wasm crossings around individual operations.
- [ ] P8: Proven event-bounded batching/idle skipping with READY, DMA, IRQ/NMI,
  input events, strobes and debugger stops as boundaries.
- [ ] P9: Promote only after reference/external-oracle comparisons, real DOS
  boot/application tests, browser benchmarks and debugger/replay qualification.

Each gate gets an exact commit, tests/skips, and limitations. Update progress
only from evidence. A partial kernel benchmark cannot close P7 or P9.
Keep working code behind gates; do not select known-broken candidates.

## Performance acceptance

### P6 incremental checkpoint — dirty net queues

The gated incremental C resolver now queues dirty nets and clears only the
previous changed-net list instead of scanning every net for both operations.
Initial admission queues all nets so unchanged initial drivers still compare
against the previous image. Driver scanning and full publication copies remain;
this is not a fully event-indexed or whole-board native runner.

The existing native/registered-memory sweep passed 66 tests without skips; the
expanded incremental file separately passed five tests including changed-flag
reset, duplicate driver changes and re-admission. All seven-round A/B workload
state hashes matched. HARRIS-NATIVE-QUEUE-AB.json pins the prior artifact sources
to `5ecd612` and captures current source hashes/build identity.

Component-only A/B medians: prior incremental 68.60 ms versus queued 53.10 ms
for 4,098 periods (about 1.29× ratio). Ranges overlap substantially, individual
rounds reverse order, and shared-host load is uncontrolled: **no stable speedup
claim or default promotion**. Structural scan removal is established; capacity
remains unestablished. The benchmark now accepts an optional prior artifact only
with a full commit ID, matching source inventory, source hashes and module hash.

The current Harris clock convention requires **9,545,454 modeled periods/s**
for 4,772,727 Hz processor-equivalent capacity. This is neither instruction
throughput nor a certified hardware clock rate. Historical full populated-board
JS browser measurements were 10,903–26,218 periods/s; isolated native fixtures
must not be used to claim that full-board gap is closed.

First milestone: complete representative runner, correctness and observable
behavior unchanged, repeated browser measurements. Then 1× XT-equivalent
capacity for a named reference board and workload, with separate traced/untraced
results. Arbitrary custom circuits have no promised performance ceiling.

## Coordination

One worker per worktree. Pin remote SHAs; shared refs can move. Delegate bounded
independent work with explicit file/worktree ownership. Inspect existing screen
sessions before messaging; never type into an unidentified shell or interrupt
unrelated work. Workers return commit IDs, verification and remaining gaps.
The coordinating agent integrates and checks producer/consumer contracts.

See WIRED-X86-PERFORMANCE-PLAN.md, X86-ORACLE-STRATEGY.md and
X86-UPSTREAM-INTEGRATION.md for historical receipts and scope.
