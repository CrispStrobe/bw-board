# Native end-clock preview/sample/finish seam

2026-09-12. Preparation for the native bus sequencer described in
`NATIVE-RUNNER-NEXT-MILESTONE.md`; **no CPU runner or performance claim**.
The standalone owned memory/controller/latch path remains default-off.

## API and ordering

An instance created with the explicit owned phase descriptor now offers:

```js
kernel.beginClock(driverLevels);
const preview = kernel.previewEndClock();
// A future native CPU/master samples actual nets here, before commands release.
// No CPU sampler is implemented by this API change.
kernel.finishEndClock();
```

`previewEndClock()` captures controller READY once and returns `ready` plus the
existing defensive net inspection. It does not update controller phase or
release command/data drives. `finishEndClock()` consumes that capture, advances
the controller, releases commands when appropriate, and settles resulting memory
edges. A later READY change cannot alter the already captured decision.
As before, READY is sampled only at TC2; other boundaries return `ready: null`.

`endClock()` remains the existing composite preview + finish. Its return and
ordinary begin/end observation behavior are unchanged. Existing bounded fixture
schedules continue using the composite operation.

After successful preview, callers must use `finishEndClock()` or
`abortEndClock()`, not `endClock()` again. Premature/repeated preview, finish,
abort, begin or schedule operations return `CLOCK_ORDER` without poisoning the
instance or replaying memory commitment. A schedule refuses a previewed period
before touching pending driver values.

If a future CPU/master sampler fails, `abortEndClock()` latches the board fault
and discards permission to finish, without releasing commands or committing an
armed memory write. It is an explicit fault transition, **not rollback**: earlier
committed writes remain. Calls thereafter refuse `BOARD_FAULTED`, including
RESET via `beginClock`; reconstruct the board. The caller retains and reports the
original sampling error. Preview input faults also latch the board fault without
a trailing-edge write. Normal RESET on a nonfaulted board still has the existing
write-edge semantics, covered against the reference.

`inspectPhase()` keeps its existing shape. `periodOpen` remains true while a
preview awaits finish/abort; the controller's `open` field likewise remains true
until finish (or can remain true in fault diagnostics after abort). Neither field
is a snapshot/restore contract.

## Native ABI and rebuild requirement

`phase_circuit_version()` is now **2**. The private lifecycle is three u32 words:
`[open, faulted, previewed]`, rather than the previous two. New exports:

- `preview_latched_memory_clock(phaseContext, fault)`
- `finish_latched_memory_clock(phaseContext, fault)`
- `abort_latched_memory_clock(phaseContext, fault)`

The JS phase wrapper refuses phase-v1 binaries with an explicit rebuild message;
old wrappers also refuse a v2 version. Rebuild the module and regenerate its
source/module manifest with `scripts/build-wired-net-kernel.mjs` into a new
directory. Memory-context ABI and standalone phase-component ABI are unchanged.
Native callers must obey the new private lifecycle allocation; raw Wasm memory
is trusted internal state, not a public mutation or third-party module boundary.

The seam is native as well as JS-callable: a later native runner can call preview,
its CPU sampler, then finish internally without adding JS crossings per phase.
No native RAM lookup or completion-triggered write callback is introduced.

## Verification scope

`test/harris-native-phase-end-seam.test.mjs` covers delayed write commitment,
recoverable order errors, repeated finish, captured READY despite a test-only
native net change, abort/input-fault noncommitment, RESET continuation, schedule
preflight while previewed, and explicit stale ABI refusal. Split execution is
compared with the existing composite/reference oracle across reads/writes/waits
using checked, admitted and incremental net paths.

Run with an explicitly built module, for example:

```sh
HARRIS_NET_WASM=/absolute/build/wired-net-kernel.wasm \
node --test test/harris-native-*.test.mjs test/bus-memory.test.mjs
```

Without that environment variable native tests explicitly skip; a skipped run is
not validation. The seam does not qualify CPU execution, snapshots, deployment,
or a 4.77 MHz populated-board capacity claim.

Local verification on 2026-09-12: focused phase/seam/schedule tests **18/18**;
complete native plus registered bus-memory set **73/73**, four suites, no failures
or skips. Build used Clang 18.1.3, module SHA-256
`850ee0b9c751879e1f7c66b83580d9ab227d1cc1ed42bf276c59ad4bc73a18a3`,
artifact `/tmp/harris-phase-end-seam.GI4D4e/wired-net-kernel.wasm` and adjacent
build manifest. These are Node component checks, not a new browser/full-board
benchmark; integration with later P6 source changes requires a fresh build.
