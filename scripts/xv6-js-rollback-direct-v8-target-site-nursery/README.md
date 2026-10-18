# Direct V8 target-site nursery admission source

This separately named, unexecuted fixture starts at frozen source
`989bdf5ffdcb155aef27e426ce0af91aaaff7082`. It leaves the original target-site
fixture, policy, addon, support runner and workflows unchanged. The original
hosted run remains failed: unobserved weak callbacks do not establish their
cause or an object generation.

Each future fresh child must use pinned Node 20.20.2 and exactly
`--expose-gc`, with the previously admitted executable and unchanged addon.
No semi-space capacity flags are admitted. Admission invokes synchronous
`global.gc()` exactly once before `addon.begin()` and cohort allocation;
the addon observer is not armed during that invocation. Its wall/CPU/output
bounds must come from a reviewed hosted child runner. This source provides
no runner and must not be connected to the old runner implicitly.

The result records only primitive completion and observed counter facts. A frozen
read-only admission status retains the completed invocation when later begin or
facts throws; it is diagnostic and cannot satisfy the grading premise. Original
first failures remain unchanged.
The after-begin and after-snapshot counts, and both release cuts, must be
zero. These facts establish the fixture's zero-observed-prior-GC premise,
not object-generation proof or a promotion diagnosis. A collection during
allocation, snapshot serialization or the retained job crossing causes
failure. No observed ID may be excluded to rescue acceptance.

The copied held-policy predicates retain all 64 weak callbacks at designated
index zero, exactly one completed designated event, the original flag/type
cases, bounded full ancestry, canonical uint64 sample IDs and exact selected
pre/post sets. The explicit new factory authority is this namespace's
`case.mjs`, function `allocateTarget`, line 17. The result schema is
`bw.direct-v8.nursery-admission-case.v1`.

A later connection must launch four independent fresh children, in order:
minor-baseline, minor-enabled, major-baseline, major-enabled. It must seal all
new source roles, independently grade raw result/profile/fact files with
strict schema and exact argument admission, preserve first failures and
partial evidence, enforce the existing child bounds, and require original
packet audit before claiming finite fixture support. The dedicated PR-only workflow runs synthetic JavaScript controls only, with
exact source admission and bounded report-only artifacts. It does not invoke
fixture full GC, compile or load the addon, or execute a guest. No support runner,
support actual or public success status is added here.

`control.mjs` contains synthetic profile/fact adversaries and a mock admission
sequence, including failed full GC, reentry, malformed arguments, nonzero
prior GC and unobserved callbacks. It is intended for a separately reviewed
PR-only hosted pure-control job. It has not been executed locally. This source
has not run with Node, V8, a compiler or a guest, and makes no performance or
workload claim.
