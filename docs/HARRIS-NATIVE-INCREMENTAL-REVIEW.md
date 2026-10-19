# Read-only review: wired native incremental kernel

Review date: 2026-09-12

## Exact basis and scope

- Repository/worktree: `/mnt/volume1/code/wt/i8086-optimized-pinned`
- Requested document commit: `5804fff2b083ee0a37c7fa65937917e5915a7ca4` (`docs/EXECUTION-POLICY-AND-OPTIMIZATION.md`).
- Exact incremental implementation source commit: `64138f172f730aa250e3cd86515ae7930a70878d` (`Queue incremental native net changes and compare pinned kernel artifacts`). The implementation and test SHA-256 values are respectively `5b22a712a21a0014bb8f33067e7ddbfed37c61cd104b4cf6756158d2cb6d4820` and `5d8e65f43b52d55a4d9c896677e9bdea1b9182cc026bb6edbe7e403ba746e230`.
- The implementation began as owner-held working changes on top of `5804fff` and was committed during this review as `64138f1`; the same shared worktree then advanced through separate policy/planning commits to `953a2e9678701ab5d3ee8729e61971cd82560527`. There is no incremental-source or test diff between `64138f1` and `953a2e9`; the hashes above still identify the reviewed implementation exactly. I did not edit files or change the branch.
- Scope is the current default-off owned native incremental net/evaluator/memory/phase path. App adoption and the generic execution-selection policy are excluded.

The implementation is directionally sound. It replaces the second full-net changed scan with bounded dirty and changed queues, initializes every net on admission so a caller-supplied previous image is compared on the first settle, clears prior changed flags sparsely, deduplicates multiple changed drivers on one net, and adds differential coverage for admission/re-admission and idle clearing. The remaining costs below are after that improvement.

Its committed A/B receipt (`docs/HARRIS-NATIVE-QUEUE-AB.json`) reports identical state hashes across all modes and a component-only median of 53.10 ms for the queued implementation versus 68.60 ms for the pinned prior incremental artifact over 4,098 periods, about 1.29x. The ranges overlap and individual rounds reverse, so the document correctly makes no stable speedup or capacity claim. That noisy result strengthens the case for work counters before choosing the next loop.

## Concrete residual costs

### 1. The dirty-net resolver still discovers dirtiness with a full driver scan

`incremental-nets.c:37-40` compares every driver with `last_driver` on every delta. The net-resolution work is sparse after that, but the discovery step remains O(drivers), including an idle settle. This is especially wasteful inside the native schedule because `phase-schedule.c:25` already has the exact IDs being written; the information is discarded and then rediscovered by scanning.

The shipped native phase oracle graph gives a useful scale reading: 84 nets, 100 drivers, two evaluator rows and 54 evaluator dependencies. An idle settle therefore performs 100 driver comparisons before doing no resolution work. This is a fixture-size fact, not a full-board capacity claim.

### 2. Any changed resolved net triggers two whole-driver staging passes

`incremental-nets.c:60` copies all live drivers to `staged`; `:63` then compares and copies all staged drivers back. Only affected evaluator outputs can change, but an active delta pays O(2 * drivers). On the measured fixture that is another 200 driver iterations per evaluator delta, followed by the next delta's 100-driver discovery scan.

The natural sparse unit is not merely an affected evaluator: it is the evaluator-owned output driver. Admission can derive each supported operation's output IDs from the fixed operation record, verify single ownership, stage only those outputs, then compare/commit only the outputs of scheduled operations.

### 3. Evaluator selection still scans every operation and its dependency list

`evaluate_owned_operations` in `net-resolver.c` walks all operations and then each row's dependency range until it finds a changed net. `incremental-nets.c:61` calls it whenever any resolved value changed. Thus net resolution is incremental while operation scheduling is still O(operations + dependency probes).

A net-to-operation reverse index built once at admission would make this proportional to affected operations. It should come after the driver-frontier measurement: today's phase fixture has only two operations/54 dependencies versus 100 drivers and repeated full-driver passes, while a future full board may reverse that ratio.

### 4. Successful publication remains a full net copy, and it is currently a correctness barrier

`publish_incremental` at `incremental-nets.c:51-53` copies both value and conflict for every net on every successful settle, including an idle settle. The measured fixture copies 168 bytes after its 100 driver comparisons.

This loop must not be changed to publish only the final `changed_queue`. A net can change in an early delta and remain stable in the last delta; conflict can also change while the resolved four-state value remains `X`. Nonconvergence deliberately leaves published state untouched while retaining pending/live history. A future sparse publisher needs an accumulated, deduplicated publish frontier across all deltas, comparing both live value and conflict against published state, and must retain that frontier across a nonconvergent return until recovery succeeds.

### 5. Immutable mappings are repeatedly revalidated in the hot path

Admission already establishes a private immutable graph, yet:

- `memory-circuit.c:22-26` rechecks every bank input/output mapping and performs a nested duplicate-output scan on every `settle_memory_circuit` call.
- `phase-circuit.c:56` calls `validate_phase_mapping` on every `begin_latched_memory_clock`, scanning 6 + 7 + 27 + 26 mapping entries.
- `phase-schedule.c:15-21` validates the entire allowed-driver vector, every period descriptor and every update before each schedule run. Validation once per compiled schedule is reasonable; repeating graph invariants per run is not.

Immutable mapping/ownership checks can move into admission or schedule compilation. Dynamic values, lifecycle, bounds and four-state codes must continue to be validated before mutation.

### 6. The per-boundary JS API allocates and copies complete observations

`memory-circuit.js`'s `inspect()` slices published values, conflicts and drivers. `phase-circuit-image.js:46-54` calls it unconditionally after both `beginClock` and `endClock`, even if a caller ignores the return. On the measured 84-net/100-driver fixture that is three ArrayBuffers and 268 bytes copied per boundary, 536 bytes per modeled period, plus result objects. At the document's 9,545,454-period/s target this API shape alone implies about 5.12 GB/s of copied observation bytes before allocation overhead. This arithmetic illustrates why the boundary API cannot be the target runner; it is not a throughput claim.

The compiled schedule amortizes this to one inspection per batch, which is the correct shape. Also avoid using the differential oracle itself as a performance measure: after every boundary it captures the JS graph and `inspectMemory()` copies 32 KiB per bank, intentionally paying for correctness evidence.

## Correctness hazards for the next optimization

1. **Every driver writer must participate.** A producer-maintained dirty-driver queue is correct only if all writes route through one checked helper: schedule inputs (`phase-schedule.c:25`), controller outputs (`phase-circuit.c:43-45`), latch outputs (`:63`), memory output drivers (`memory-circuit.c:34-37`), evaluator commits (`incremental-nets.c:63`), and the JS bulk-input path (`memory-circuit.js:73-78`). Missing one writer produces a silently stale net.
2. **Validate before mutation.** `resolve_dirty` shifts `1u << code` without a local range check because current entry paths guarantee codes 0..3. A new sparse writer must validate ID, ownership and code before changing driver memory or queue state. Duplicate schedule writes currently have ordered last-write-wins behavior; deduplication must preserve that result.
3. **Operation queue bounds need their own proof.** Nets and drivers are capped by `LIMIT`, but operation count is not. Reusing a `LIMIT`-sized affected-operation queue without either a separately admitted bound or caller-owned arena storage would introduce overflow.
4. **Do not schedule on conflict-only changes.** Existing evaluators consume resolved values, not conflict metadata. The current code intentionally publishes a changed conflict diagnostic without scheduling pure evaluators when the resolved value remains the same. Preserve that distinction.
5. **Do not lose changes across deltas or failed convergence.** A sparse publish queue must accumulate final differences from the last published image, not simply concatenate per-delta value changes. A value that changes and changes back needs no final publication; a value changed before a later stable delta does. On nonconvergence, published values/conflicts remain unchanged and the pending frontier must survive for a later recovery.
6. **Admission state is module-global by design.** The static maps/queues are safe only under the present one-private-context-per-Wasm-instance contract. Do not expose or multiplex the instance without making this state per-context.

## Recommended next measured optimization

Take one bounded engine lane: **producer-maintained dirty-driver frontier for the compiled native schedule**, with measurement counters first. Do not combine it initially with sparse evaluator scheduling or sparse publication.

1. Add test-visible counters for driver comparisons, unique value-changing driver writes, dirty-net resolutions/net-driver visits, evaluator rows/dependency probes, staged-driver copies, committed evaluator outputs, publish-net copies and deltas. Keep them out of policy/admission behavior.
2. Record those counters plus repeated wall time on the same frozen Wasm and host for admitted full-scan versus current incremental mode across: idle periods, one host-pin change, memory read/write, controller/latch changes, X/Z and conflict-only transitions, masked same-net changes, and nonconvergence/recovery. Include the existing 8,194-period bounded schedule. Compare full state and memory/phase hashes, not timings alone.
3. Introduce a single native `write_driver(id, code)` seam that validates before mutation, preserves last-write-wins, updates the driver, and enqueues the driver once only when its value changes. Route every native writer listed above through it. The JS full-image entry may retain one O(drivers) comparison; the compiled native schedule should not.
4. Make `resolve_dirty` consume the queued drivers and map them through the already-admitted `driver_net`. Keep the current net queue, changed queue, evaluator scan, staging passes and full publication unchanged for this lane so a regression has one cause.
5. Mutation proof: bypass queue marking independently at schedule, controller, latch, memory and evaluator write sites. Each mutation must fail a named state comparison. Also mutate four-state validation and duplicate-write handling.

Acceptance should be structural and measured: the compiled native schedule performs zero whole-driver discovery scans after admission; examined driver writes scale with unique changed writes; all existing X/Z/conflict, masked-change, initial-image, re-admission and nonconvergence/recovery comparisons remain identical; repeated timing is reported but does not become a full-board capacity claim.

If counters show evaluator dependency probes dominate after that lane, the next item is the admitted net-to-operation reverse index plus sparse evaluator-output staging. Sparse publication should remain last because it carries the most subtle published-versus-live correctness contract.

## Verification limitation

I attempted an independent build into a fresh `/tmp` directory, without modifying the worktree. This host's default Clang 18 cannot find `wasm-ld-18`, so I produced no new executable timing or test verdict. The committed build receipt identifies the owner's working linker explicitly (`-fuse-ld=/tmp/harris-net-kernel.nhKEjD/wasm-ld`) and pins the resulting module as SHA-256 `320f9f70d14df2911faf7de3230b9e9572af79d1ea6dfc86bc965747c3fc3770`; I reviewed that receipt rather than relabeling it as my reproduction. The static 84-net/100-driver fixture census above was derived independently by constructing the existing phase oracle graph and calling `captureKernelEvaluatorImage`; it does not depend on a Wasm build. No source, branch, ref or remote was changed by this review.
