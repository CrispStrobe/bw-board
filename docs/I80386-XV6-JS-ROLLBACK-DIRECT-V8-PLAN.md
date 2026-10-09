# Direct V8 rollback-allocation diagnostic: next source contract

This is an implementation plan, not a qualified profiler result. The first
[hosted support attempt](https://github.com/CrispStrobe/bw-board/actions/runs/37888206087)
stopped before xv6 execution after recording 3,328 dead targets out of 4,096
and both minor and major collections. The [follow-up attempt](https://github.com/CrispStrobe/bw-board/actions/runs/37893388067)
also stopped before xv6: none of its 64 targets became unreachable after six
recorded minor collections. Preserve both original failures and their exact
source heads. Do not turn either into evidence about xv6 allocation cost.

The follow-up's JavaScript `WeakRef` witness is unsuitable for the pinned
Node 20.20.2 engine. Its [object descriptor](https://raw.githubusercontent.com/nodejs/node/v20.20.2/deps/v8/src/objects/objects-body-descriptors-inl.h)
marks the target as a custom weak pointer, but the [default visitor](https://raw.githubusercontent.com/nodejs/node/v20.20.2/deps/v8/src/objects/visitors.h)
and [minor scavenger](https://raw.githubusercontent.com/nodejs/node/v20.20.2/deps/v8/src/heap/scavenger-inl.h)
process it strongly. More nursery pressure cannot establish the required
minor-only target death. Separately, the pinned [Inspector agent](https://raw.githubusercontent.com/nodejs/node/v20.20.2/deps/v8/src/inspector/v8-heap-profiler-agent-impl.cc)
sets `kSamplingForceGC`; profile retrieval can therefore cause a full GC
after the current event window ends. The [sampling implementation](https://raw.githubusercontent.com/nodejs/node/v20.20.2/deps/v8/src/profiler/sampling-heap-profiler.cc)
does distinguish minor- and major-collected samples, but this fixture did not
prove those flags in the hosted runtime.

Implement one small, hosted-only C++ addon using the exact Node 20.20.2 V8
headers. Use the public [sampling API](https://raw.githubusercontent.com/nodejs/node/v20.20.2/deps/v8/include/v8-profiler.h)
in four fresh, isolated support cases: no flags and the minor flag, then no
flags and the major flag. Each of the two sampled xv6 children requests **both**
collected-object bits together. Neither support nor guest sampling sets
`kSamplingForceGC`. Use this same direct sampler for the support and xv6
children. Do not load the addon into the emulator as a guest component or change
the emulator or probe loop. A native profiler control is not a native emulator
speedup. Direct V8 addons need an explicit ABI and build review; compilation
success alone is not admission.

For each support case, create a fixed, small cohort in a single reviewed
allocation factory. Hold the objects strongly across a pre-release profile,
which must contain at least one sample from that factory. Keep a separate
native [weak global handle](https://raw.githubusercontent.com/nodejs/node/v20.20.2/deps/v8/include/v8-persistent-handle.h)
for every target, with a callback that only records bounded primitive facts
and resets its handle. Release the strong handles at a recorded cut. Record
[V8 GC callback types](https://raw.githubusercontent.com/nodejs/node/v20.20.2/deps/v8/include/v8-callbacks.h)
through the [isolate's prologue and epilogue callbacks](https://raw.githubusercontent.com/nodejs/node/v20.20.2/deps/v8/include/v8-isolate.h).
For a minor case, require every target's weak-global callback to be attributable
to a minor collection before any major collection; require no collection between
release and the designated collection. Require the same pre-release sampled
IDs to disappear without the minor flag and to remain with that flag in each
case's post-release profile. Numeric sample IDs are compared within one case,
never across separate processes. For the major cases, require every native
weak callback to be attributable to the designated major collection and no
minor collection between release and that collection, then compare pre/post
IDs without and with the major flag.
Missing samples, callbacks, or a clean collector ordering mean **unsupported**,
not a passing flag. A callback is a collection witness, not a guarantee that
V8 will collect within the bound.

The [V8 profile API](https://raw.githubusercontent.com/nodejs/node/v20.20.2/deps/v8/include/v8-profiler.h)
exposes pre- and post-release sample IDs without requiring a stop between
them. Keep the native GC record open through **both** profile retrievals and
stop/cleanup; reject an unplanned collection or callback in those operations
that could change the attribution. The addon must not allocate, call JavaScript
or read guest state in GC or weak-handle callbacks. Bound cohort size, pressure,
callback/event ring, elapsed time, profile bytes and child processes before
the first hosted run. Persist bounded raw pre/post profiles and primitive GC
facts on refusal as well as success, preserving the first failure.

Keep the qualified workload gate from
[`scripts/xv6-js-rollback-profile/`](https://github.com/CrispStrobe/bw-board/tree/f2971d8ae7bd67a30f13baa45b63956790d9b975/scripts/xv6-js-rollback-profile):
one fresh unprofiled reference plus two fresh sampled children using the same
pinned free MIT xv6 image, ordinary JavaScript CPU and exact reversible probe
loop. Require the same complete reported CPU, RAM/disk hashes, serial/input,
interrupt and device projection in all three; source-bind the derivative and
all inherited helper roles. The direct sampler's profile format needs its own
strict bounded parser and source-role attribution controls. Profile values
are sampled allocation bytes, not total allocation volume or CPU time. Report
unresolved frames separately. A failed support child must stop before guest
children; a failed guest or semantic comparison must retain its original
result and bounded profile evidence.

Before any hosted qualification, pin the exact Node executable/version,
matching official Node 20.20.2 headers, addon C++ source, compiler/linker
versions and arguments, and the built addon's SHA-256 in the source and run
receipts. Admit the entire new source/import/build-input closure and verify the
addon loaded from that one built path. Review exact notices and redistribution
obligations. Retain report-only artifacts: source manifests, build receipt,
bounded profiles and results. Do not upload the `.node` binary, executable,
guest image or raw memory. Run source-only parser/admission adversaries and a
short hosted addon control before a single label-triggered same-workload run.
If the pinned V8 callbacks or sampled-ID comparison cannot establish the
minor case, record that limit and do not claim an all-allocation hotspot or
change the support rule after seeing the result.

## First source checkpoint published; hosted authority still pending

[Draft PR471](https://github.com/CrispStrobe/bw-board/pull/471) at
`ff2b916e1899d6042f9b1a3e2701ea1ec4f708d7` publishes eight files under
`scripts/xv6-js-rollback-direct-v8/`, stacked on the frozen support source.
The addon, four-case fixture, bounded build recipe and pure admission controls
are **source-only, uncompiled and unrun**. Root and a separate Sol reviewer
checked exact source, public API signatures and pure controls. Review corrected
GC export windows, one-shot sampler reuse, source-factory attribution, prior
major-GC exclusion in minor cases, and cleanup of an exited compiler leader's
remaining owned process group. Those controls do not establish native behavior.

Next implement a separately identified report-only hosted authority preflight.
Bind the exact official Node executable/header archives, installed compiler
and linker executable hashes/versions/arguments, source and runner identity.
Retain original refusal records and a closed report-only inventory, then stop
before compilation, addon loading, support sampling or guests. Review and pin
those observed build inputs before a separate first build/control run. The
compiler's version string alone is insufficient executable identity. Only
after the four fresh support cases qualify may the unchanged xv6 comparison
run. Preserve PR471's original source checkpoint and both failed Inspector
actuals; do not relabel them as the direct sampler.
