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
- [x] P2 contract: Implement a dependency-light, tested selection/admission contract.
  Tests: semantic mismatch, missing capability, unavailable loader, rejected
  candidate, opt-in experiment, explicit reference, deterministic Auto, and
  restart/no-mutation behavior. Implemented at 9931e37, nine focused tests;
  independent review found no blocker. Existing consumer integration is P3,
  not established by these synthetic catalog tests.
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

### Integration checkpoint — policy, GUI and native prerequisites

The full engine test run at `63359b8364fc4d4e463752e0269348b8c594a572`
completed with **5,073 passed, zero failed, 32 skipped** (5,105 tests,
937 suites). It used the locally built queued-net artifact, so optional native
tests actually ran. This is a local result, not a hosted-CI completion or a
qualification of commits added afterward.

The next engine checkpoint adds the split preview/finish clock-end seam
(`bcbe00c`), pure clock-domain measurement (`dbc017a`), and standalone native
286 memory bus sequencer (`3a37121`, audited in `f30dd06`). See
[NATIVE-END-CLOCK-SEAM.md](NATIVE-END-CLOCK-SEAM.md),
[EXECUTION-MEASUREMENT.md](EXECUTION-MEASUREMENT.md), and
[HARRIS-NATIVE-BUS-SEQUENCER.md](HARRIS-NATIVE-BUS-SEQUENCER.md).
These are prerequisites, not a complete native execution region. Phase ABI v2
requires rebuilding old artifacts; old ABI-v1 A/B receipts remain historical
evidence rather than modules loadable by the new wrapper.

The application GUI candidate is isolated on `feat/execution-policy-gui` at
`bbfe54a41`: browser-local Auto/Functional/Wired preferences, named wired
refusal, and status published only after successful construction. It preserves
the separate RAM preference. Twenty focused behavioral tests passed using an
explicit test-only mapping to the policy source. The actual browser journey is
implemented but **not yet run against the migrated installed package**; P1/P3
remain open. This first slice does not persist project semantics, expose a
native project backend, or establish cross-chip/observer re-admission.

P4 review also found that the old browser `xtCapacityFactor` mixed wall waits
and initialization time with a numerator excluding initialization periods.
Do not interpret that historical field as measured active execution capacity.
A corrected consumer must count the same initialization/run interval at both
ends and report active throughput separately from wall pacing. No new capacity
number is established merely by adding the arithmetic helper.

The corrected browser consumer is integrated at `0da858c`. Combined checks:
87 native/registered-memory tests, 32 policy/measurement/census tests, and
22 measurement/chunk tests passed without skips (the latter selections overlap).
Chromium accepted schema v2, reference/packed/layout memory state hashes,
all existing native oracles, and the standalone bus's 782 boundaries,
30 transactions and 36 physical completions. See
[HARRIS-POLICY-INTEGRATED-BROWSER.json](HARRIS-POLICY-INTEGRATED-BROWSER.json)
and [HARRIS-POLICY-INTEGRATED-BUILD.json](HARRIS-POLICY-INTEGRATED-BUILD.json).
This one-round shared-host run measured roughly 5,498 / 13,425 / 13,658
active modeled periods/s for the three **JavaScript whole-board memory modes**.
It is correctness/measurement acceptance, not a stable performance comparison,
native full-board measurement, full DOS run or 4.77 MHz qualification.

### P6 incremental checkpoint — dirty net queues

The gated incremental C resolver now queues dirty nets and clears only the
previous changed-net list instead of scanning every net for both operations.
Initial admission queues all nets so unchanged initial drivers still compare
against the previous image. Driver scanning and full publication copies remain;
this is not a fully event-indexed or whole-board native runner.

The final integrated native/registered-memory plus policy sweep passed 76 tests
without skips. This includes five incremental tests covering changed-flag
reset, duplicate driver changes and re-admission. Chromium accepted the same
native oracles plus reference/packed/layout memory workloads; receipt:
HARRIS-NATIVE-QUEUE-BROWSER.json. All seven-round A/B workload state hashes
matched. HARRIS-NATIVE-QUEUE-AB.json pins the prior artifact sources
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

**Application adoption update:** simclaude2/lego-38 owns the concurrent migration
from copied bw-board/bw-circuit-ui roots to pinned npm dependencies. The isolated
old-copy adoption checkpoint `42ea32059` in Lite is **not for landing**; its
documentation is retained, but the obsolete sync changes must not be published
over that migration. GUI work is isolated from packaging and will integrate
after the new dependency boundary is available. P1 remains open until verified.

One worker per worktree. Pin remote SHAs; shared refs can move. Delegate bounded
independent work with explicit file/worktree ownership. Inspect existing screen
sessions before messaging; never type into an unidentified shell or interrupt
unrelated work. Workers return commit IDs, verification and remaining gaps.
The coordinating agent integrates and checks producer/consumer contracts.

See WIRED-X86-PERFORMANCE-PLAN.md, X86-ORACLE-STRATEGY.md and
X86-UPSTREAM-INTEGRATION.md for historical receipts and scope.
