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

The separately identified report-only hosted authority preflight below
implements the first prerequisite from this source checkpoint.
Bind the exact official Node executable/header archives, installed compiler
and linker executable hashes/versions/arguments, source and runner identity.
Retain original refusal records and a closed report-only inventory, then stop
before compilation, addon loading, support sampling or guests. Review and pin
those observed build inputs before a separate first build/control run. The
compiler's version string alone is insufficient executable identity. Only
after the four fresh support cases qualify may the unchanged xv6 comparison
run. Preserve PR471's original source checkpoint and both failed Inspector
actuals; do not relabel them as the direct sampler.


## Report-only preflight source checkpoint

[Draft PR473](https://github.com/CrispStrobe/bw-board/pull/473) at
`869c3c72cb40b66c135621f297eb66638166b69d`, stacked on PR471, publishes
the six-path hosted authority-preflight slice. Root and a separate Sol reviewer
checked exact source, syntax and synthetic controls. The [first original hosted preflight](receipts/2026-10-09-direct-v8-preflight/README.md)
failed its header closure check before Node/compiler probes. Node, compiler
and addon runtime support were unqualified at this failed checkpoint; the
single corrected preflight below completed with the separately preserved
silent-component version-probe refusal.

The dedicated workflow authenticates the exact source before and after, fetches
only the pinned official Node/header archives, hashes tool executable targets
around identity probes, retains bounded original failure output, and uploads
a closed report-only inventory. It stops before compilation, addon loading,
support sampling or guests. The first dedicated preflight completed with the retained refusal below.
Preserve its frozen source and original packet. The completed separate header
census and proposed corrected preflight are recorded below. Any new gate needs every
enabled exact-head check to succeed (with only declared optional vectors-full
skips), a single launch and an independent original-packet audit. Complete
observed build authorities remain a prerequisite for the first build/support
workflow.

The first preflight was launched once after all ten enabled checks passed,
with only two declared optional skips. Its original packet and raw log are
independently audited and preserved. That packet alone did not distinguish
the duplicate-name predicate from the aggregate expansion predicate; the
separate census below resolves the first refusal. Do not invoke the addon
from this partial receipt.


## Data-only header census source checkpoint

[Draft PR475](https://github.com/CrispStrobe/bw-board/pull/475), exact
`90c4de590325f59c8d164cefc37fa036740f189a`, publishes six added census paths
stacked on PR473. All 14 inherited roles remain unchanged; source admission
binds 20 Git roles. Root and a separate Sol reader checked source, syntax and
pure controls, including a reproduced escaped-name report-limit failure and
its retained-partial-record fix. All ten enabled exact-head checks passed,
with only the two declared `vectors-full` skips. The label was applied once;
[original census run37911209291](https://github.com/CrispStrobe/bw-board/actions/runs/37911209291)
completed successfully. The [original data-only result](receipts/2026-10-09-direct-v8-header-census/README.md)
identifies the aggregate limit as the first frozen refusal: member index 1,916
raises the regular total to 32,019,993 bytes. Complete reported coverage is
2,908 members and 49,002,796 regular bytes, with no duplicate regular names.

The source downloads only the same pinned 512,152-byte official header archive
on the hosted runner. It records source-order names, types, sizes and hashes
and the first exact frozen admission predicate under a separate 128 MiB
data-only regular-byte ceiling, 20,000-member ceiling, 2,000,000-byte member
ceiling, 8 MiB JSON ceiling and 16 MiB artifact ceiling. It writes no extracted
headers and executes no Node/compiler/addon/guest. The original 32,000,000-byte
admission limit and `build.py` remain unchanged.

The frozen census has been independently audited; do not remove/reapply its
label or launch a second actual. Its packet contains report facts rather than
raw archive/member bytes, so coverage and member hashes remain source-bound
observations. This resolves the original preflight's ambiguous refusal without
qualifying revised admission or any native execution.

[Draft PR477](https://github.com/CrispStrobe/bw-board/pull/477), reviewed head
`61fa4800434301843a648f9ad851067366b5525e`, publishes a separately named
**64 MiB authority preflight** with eight changed paths and 26 source roles.
Source and pure synthetic controls passed root and independent review. All
ten enabled exact-head checks passed, with only two declared optional skips,
before the single [report-only run37919948310](https://github.com/CrispStrobe/bw-board/actions/runs/37919948310)
was launched. The [independently audited original failure](receipts/2026-10-09-direct-v8-64m-preflight-failure/README.md)
admitted the reported header map and Node versions, then refused the silent
`cc1plus --version` probe. Complete tool authority remains unqualified. The [official release
checksum-text comparison](receipts/2026-10-09-node-release-pins/README.md)
independently matches both archive pins, without raw archive or signature
verification. It uses one shared
aggregate budget in preflight and build, retaining exact archive identities,
individual member, count, safe-path, type, duplicate and required-header guards.
Keep build's stricter 4,096-member/depth-12 limits. The full member-hash map also
exceeds the old receipt bound. The revised source supplies a coherent bounded
receipt and closed report-only inventory policy, preserving all original
records and uploading no archives, extracted headers, executable or addon.

The corrected profile has separate source admission, schema, dedicated
label/workflow and pure boundary/adversarial controls. Its shared receipt cap
is 1 MiB; the closed report-only inventory caps each file at 1 MiB and its
total at 2 MiB. Preserve the frozen failed original. Next review a separately named report-only
tool-probe census that retains executable and locator identities before each
probe. Only the observed complete exit-zero, empty stdout/stderr `cc1plus`
case may report `VERSION_UNAVAILABLE_EMPTY`; generic strict probes stay unchanged.
Rehash each tool after its probe and the complete set at the end. Pure controls
must cover other empty outputs, partial failures and identity changes. This is
identity observation with unavailable version output, not validated version support.
Review its exact source and all enabled checks before one distinct actual, then
independently audit original tool/runtime facts. A separate first build
and four fresh support children remain later gates before xv6 allocation
sampling; no allocation hotspot or speedup is established by the census.


## Separate tool census source checkpoint

[Draft PR479](https://github.com/CrispStrobe/bw-board/pull/479), source
`8ffca01b8ca675fcd2a3980ffd0697665b080771`, publishes eight new paths
under `scripts/xv6-js-rollback-direct-v8-tool-census/` and its dedicated
workflow, stacked on frozen PR477. Root and independent review passed the
34-role source closure and pure controls. An initial locator-retention gap
was corrected before publication: the pending role, locator receipt and
selected path now survive later target-identity or compiler-mutation refusal.
The inherited strict probe and all 26 held source roles remain unchanged.

The census records each executable identity before its version probe, rehashes
the target and compiler afterward, and rechecks the complete tool set. Only
the observed complete exit-zero, empty-stdout/stderr `cc1plus` result reports
`VERSION_UNAVAILABLE_EMPTY`; other empty or failed probes refuse. A completed
report is explicitly `TOOL_IDENTITIES_OBSERVED_VERSION_UNAVAILABLE_UNQUALIFIED`,
without validating that component's version or any addon support. Partial
failures preserve the first failure and available records; only a completed
census claims the final source recheck. Reports retain the 1 MiB per-file /
2 MiB total closed inventory bounds.

All ten enabled exact-head checks passed, with only the two declared optional
skips, before the single [report-only run37945340430](https://github.com/CrispStrobe/bw-board/actions/runs/37945340430)
was launched. Its [independently audited original failure](receipts/2026-10-09-direct-v8-tool-census-failure/README.md)
retains cc1plus identity with explicit unavailable version, then refuses
collect2 split stdout/stderr. Independent as/ld roles and final rechecks
remain unreached in that frozen census. The separately named complete-tool-
roster and split-output profile below now has an audited original; advance
its separately admitted first-build gate. Do not retry the frozen preflight or infer a compiler build, profiler support,
allocation costs or a speedup from these report-only observations.


## Separate full tool roster source checkpoint

[Draft PR482](https://github.com/CrispStrobe/bw-board/pull/482), reviewed source
`174767b449b1be4b3e76f41c6e44ffd46ba2edfd`, adds eight new paths under
`scripts/xv6-js-rollback-direct-v8-tool-roster/` and its dedicated workflow,
stacked on frozen PR479. Root and independent source/syntax review and three
CPU-free mock/file controls passed: 42 admitted source roles, all 34 held roles
unchanged, including the ordinary strict probe.

All five compiler-tool locators and executable identities are retained before
any compiler-tool version probe. Only the exact silent cc1plus result records
an unavailable version. Collect2's reviewed split output is explicitly
`SPLIT_OUTPUT_DELEGATION_UNVERIFIED`; its two stderr lines must advertise the
already located ld target. Pre/post hashes of that named target and equality
with a separate direct ld stdout receipt establish output consistency only.
They do not authenticate a delegated subprocess or validate a collect2 version.
Per-probe and final tool/source rechecks, preserved first failures and partial
records, and the closed 1 MiB/file, 2 MiB total report inventory remain required.

All ten enabled exact-head checks passed, with only the two declared optional
skips, before the single [original run37953289876](receipts/2026-10-09-direct-v8-tool-roster/README.md).
Root and independent retained-original audits passed: nine closed members,
42 source roles, exact retained header-map agreement and five tool identity
reports. Silent cc1plus remains version unavailable; collect2's named-ld
pre/post and direct stdout consistency remain delegation-unverified. This is
a completed report-only observation, not a build or profiler qualification.


## Separate pinned first-build source

[Draft PR484](https://github.com/CrispStrobe/bw-board/pull/484), reviewed source
`77fd5fbbc132d48622eb0790c0b2d66a6e66a5a4`, adds nine new paths under
`scripts/xv6-js-rollback-direct-v8-first-build/` and its dedicated workflow,
stacked on frozen PR482. Root and independent authority/source/syntax/workflow/
inventory review and three CPU-free controls passed: 51 admitted roles, all
42 held roles unchanged. Authority pins the audited original run/artifact/
source/report, Node identities, full canonical header-member-map digest and
five compiler-tool hashes/sizes/locators. Device/inode stay same-run facts.

The new runner re-resolves and hashes all five tools on its own runner, admits
the pinned official archives and frozen addon source/arguments, and executes
the explicitly pinned compiler target under a closed environment. It does not
invoke the old unbound `build.py` main path. One compiler child is bounded at
90 seconds / 32 KiB output. All five post-compile observations run even after
compile refusal; the compile failure stays primary and tool errors are retained
separately. Positive output requires matching tools/source and an ordinary
bounded unloaded addon hash/size. Binaries, raw archives, headers, media and
profiles are excluded from the artifact. The only successful status is
`BUILT_UNLOADED_UNQUALIFIED`; no addon load or tool-subprocess provenance follows.

All ten enabled exact-head checks passed, with only the two declared optional
skips, before the single [first-build original](receipts/2026-10-09-direct-v8-first-build-failure/README.md)
at reviewed source `77fd5fbbc132d48622eb0790c0b2d66a6e66a5a4`.
Root and independent retained-original audits passed within its official
**failure** boundary: nine closed members and 51 source roles. The first
failure is `compiler-exit` after a complete exit-1 compiler return, zero
stdout bytes and 8,146 stderr bytes; all five post-compile tool observations
matched. The diagnostics show incomplete `v8::HeapProfiler` and undeclared
`AllocationProfile` declarations. The source omits `v8-profiler.h`, supporting
a narrow header correction, but later compiler results remain untested. No
addon was reported or loaded. Preserve this first
failure; a separately reviewed correction needs a fresh pinned build before
the next support profile. Do not credit compiler-subprocess delegation or
profiler behavior from matching tool identities alone.

The separate [draft PR485 profiler-header correction](https://github.com/CrispStrobe/bw-board/pull/485),
reviewed source `b8ce3eb36d6022eb82415c80fdbcf9b37e23284f`, adds nine new
paths and admits 60 source roles, with all 51 inherited roles unchanged.
Its derived addon adds only `#include <v8-profiler.h>`; both source admission
and the runner reject any other native delta. Root and independent source/
syntax/workflow review and three CPU-free controls passed. Git authenticates
the source module before execution. Compiler/tool/archive/header authority,
closed environment, bounds, first failures and all five post-tool observations
remain required. The final one-line workflow change shortens its launch label
to `xv6-js-rollback-direct-v8-profiler-header-build`, within GitHub’s label
length limit; native and runner bytes remain unchanged. Root and independent
review passed for the one-shot launch guard and the prospective original-result
reader, including CPU-free refusal controls. All ten enabled exact-head checks
passed, with only the two declared optional `vectors-full` skips. The guarded
label was applied once; [corrected unloaded-build run37979252708](https://github.com/CrispStrobe/bw-board/actions/runs/37979252708)
completed successfully. The [original unloaded-build receipt](receipts/2026-10-09-direct-v8-profiler-header-build/README.md)
passes coordinator and independent audit: complete exit-zero compile, empty
streams, matching five post-tool identities and final source recheck. It reports
a 33,896-byte addon explicitly unloaded and not uploaded. Preserve that sole
invocation; do not remove/reapply its label or dispatch a duplicate. This is an
unloaded-build checkpoint; sampler support and performance remain unqualified.

After an audited unloaded-build result, a **separate** support profile must
compile and load the addon in one hosted run: the unloaded binary is not in the
first-build artifact. Materialize and reverify the pinned Node executable from
its verified archive, rehash the same-run addon immediately before loading it,
then run four fresh isolated support children: minor baseline/enabled and major
baseline/enabled. Retain bounded raw pre/post profiles, GC and weak-callback
facts, child failures and a closed report-only inventory; upload no Node or
addon binary. Require all four source-bound lifetime and sample-ID predicates
before attempting the unchanged three-child xv6 comparison. Even a passing
support control does not measure allocation CPU share or establish a speedup.


The separate [draft PR488 corrected support source](https://github.com/CrispStrobe/bw-board/pull/488)
is published at reviewed `ff8038de317569de3df8e7f6743a901a1f530c97`:
ten new paths and seventy admitted roles, with all sixty inherited roles
unchanged. Coordinator and independent source review and four CPU-free Python
control groups passed. It builds the corrected addon and materializes the
pinned Node executable in the same hosted job, verifies pre-child/final leases,
and grades four fresh raw support cases. Its closed inventory excludes binaries.
Load state distinguishes no attempt, an attempt with unknown outcome, and a
verified child load; failures retain their first reason and partial records.
The standalone prospective reader and one-shot launch guard passed coordinator
and independent review with CPU-free synthetic controls. The reader requires
the reported raw case to match all retained observations and independently
grades the four support cases; missing build materialization or added callback
identities cannot receive support credit. The guard rejects a dedicated run on
any earlier branch head, changed source or reader, an existing label and
incomplete checks. All ten enabled exact-head checks must pass, with only the
two declared optional skips, before the label is applied once. The source gates subsequently passed and the label was applied once. The
[original support run38023609973](receipts/2026-10-10-direct-v8-support-failure/README.md)
failed in the first minor-baseline child after a complete successful build. Both
retained-original audits pass within that failure boundary. The raw sample
predicate failed: one of 31 factory-ancestry samples survived despite all 64
weak callbacks in the designated minor-GC event. Broad call-stack attribution
does not identify the adopted object behind each sample. No later child or
guest ran, and no support, allocation hotspot or speedup follows. Develop a
separately named fixture with a dedicated target allocation site, preserving
all lifetime, raw-identity and four-case requirements. Do not exclude the
observed survivor after the fact or rerun/relabel the original.

The separately named [draft PR491 target-site support profile](https://github.com/CrispStrobe/bw-board/pull/491)
is published at `989bdf5ffdcb155aef27e426ce0af91aaaff7082`: ten new files,
84 Git roles with 74 held unchanged. It selects the [PR489 fixture](https://github.com/CrispStrobe/bw-board/pull/489)
through exact source admission, preserves the pinned same-run Node/addon and
pre-child/final leases, independently grades the four ordered raw cases, and
retains first failures in a closed binary-free inventory. Coordinator and
independent source review and four CPU-free controls pass. Its workflow also
runs the fixture's authored JavaScript policy controls before the build.
The standalone prospective reader and one-shot launch guard passed both
reviews and synthetic controls. All enabled exact-head checks must pass
before its label is applied once; no support actual has launched.
