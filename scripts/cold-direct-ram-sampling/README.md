# Cold direct-RAM inspector diagnostic

**SOURCE_ONLY_UNRUN.** This is a diagnostic harness for the already
guest-qualified ABI 5 direct-RAM source and the semantic-gated paired workers.
It changes no CPU3, N-API addon, ordinary JavaScript machine, board provider,
ROM, configuration, or shipped runtime. The direct-RAM profile failed its
ordinary-JavaScript performance adoption gate; this harness does not rerun or
reinterpret that gate.

The dedicated labeled workflow authenticates the paired harness and the exact
qualified source, replays the existing finite reference, and builds or acquires
the same three engine arms. It runs one unprofiled warm-up and two fresh
inspector-profiled children per arm on the same 316,562-Q free-BIOS workload.
Each child retains the paired worker's full reset/final CPU, board, whole RAM,
ordered PIO, source/build/configuration, owner-counter and closure checks. A
profile is summarized only after its child has passed those checks. Nine
children is a diagnostic capacity bound, not a paired timing schedule.

The workers are derived from fixed SHA-256-checked paired source bytes. Only
the existing execution-loop anchors acquire `node:inspector` start/stop; the
plain child retains its original import of the derived plain worker, and the
native child substitutes an authenticated absolute module URL for its held
provider import. The materializer proves the inverse transformation and
records both root-independent normalized bytes and loaded bytes. Profiles
are written after the execution timing interval, including on a failed guest
loop when the profiler can stop; failed semantic children cannot contribute a
profile summary. The parent preserves each bounded child invocation, failure
receipt, profile SHA-256 and host/resource result.

The bounded parser rejects malformed profile graphs, sample references,
timing fields and oversized artifacts. It recognizes the direct provider's
data URL only by the authenticated loaded-module SHA-256, and records raw
profile hashes while keeping repository paths out of the summary. JS
reconciliation, clock callback, board/device, other JS and V8 GC samples are
reported separately. Blank-URL native and builtin frames remain unresolved,
even when their ancestors are JS. The first profile cannot distinguish empty
from nonempty reconciliation batches or attribute CPU3 execution, N-API
crossing and native owner validation precisely. Source review shows a board
generation-Map copy on each reconcile, including empty batches; that is a
candidate to measure, not a proven bottleneck. Inspector sampling overhead
and its sample deltas are not adoption timing or precise CPU cost shares.

`node --cpu-prof` would include startup and settlement, so this lane brackets
the execution loop with Inspector instead. `node --prof` is a possible later
whole-process corroboration, not this gate. The workflow records whether an
unprivileged `perf` task-clock probe is available. It does not install tools,
change kernel policy or record `perf` stacks. Any native attribution beyond
the unresolved bucket needs a separately reviewed diagnostic.

Bounded source-only controls, with no addon build or guest:

```sh
node scripts/cold-direct-ram-sampling/materialize-control.mjs "$PWD"
python3 -B scripts/cold-direct-ram-sampling/profile_control.py
python3 -B scripts/cold-direct-ram-sampling/run_control.py
```
