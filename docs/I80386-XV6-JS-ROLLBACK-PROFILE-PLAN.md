# Functional-JS rollback allocation diagnostic

Status: reviewed source harness in draft [PR467](https://github.com/CrispStrobe/bw-board/pull/467),
head `3269cf1f2e0c009d8e0a331aa93bee498863bc2a`. Six CPU-free controls,
source identity and syntax checks passed; hosted CI is pending. The dedicated
allocation diagnostic has not run. No profiler support, allocation result or
speed improvement is established. Refresh exact-head checks before execution.
Keep the [CWSDPMI frame qualification](I80386-DPMI-FRAME-ATTRIBUTION-LANE.md) separate.

## Question and fixed workload

Sample allocations by authenticated JavaScript call site during the unchanged
ordinary-JS stock MIT xv6 `forktest` workload. Inspect `_snapshotInstruction`
and its caller in `src/experimental/i80386.js`: the rollback snapshot holds
register/state scalars and six segment-cache references. It does not clone six
segment-cache objects. Neither their allocation cost nor removable CPU cost is
established by source inspection. Allocation samples do not measure the CPU
cost of register/state copying; investigate that work separately if evidence
points there.

The [CPU sampling result](I80386-XV6-JS-SAMPLING-RESULTS.md) mainly identified
instruction execution, translation and address decoding. The [array-only
snapshot experiment](I80386-XV6-JS-SNAPSHOT-RESULTS.md) failed its performance
gate; do not repeat or adopt it. This diagnostic must be able to report that
rollback allocation is not an observed priority.

Freeze one emulator revision, fresh MIT xv6 image and toolchain, free BIOS,
explicit 4 MiB PSE/APIC machine profile, `forktest` command and finite budgets.
This is a later-feature xv6 profile, not strict physical 386DX qualification.
Use an unprofiled reference and at least two fresh allocation-sampled children.
Do not mix dispatcher modes or time profiled children as a speed comparison.

## Implementation ownership

Use an isolated branch and a new `scripts/xv6-js-rollback-profile/` namespace,
its dedicated hosted workflow and CPU-free profile/source controls. Reuse the
reviewed reversible probe-admission pattern from
[PR431](https://github.com/CrispStrobe/bw-board/pull/431); inspect its exact
source and retained limits first. Keep emulator bytes unchanged. Any derivative
probe must have an exact reversible edit limited to profiling setup, guest-loop
boundaries and report collection, with all source/import roles bound to Git.
No guest-loop substitution, changed rollback behavior or alternate guest is
admitted. Do not modify other workers' CPU or UI files.

The harness freezes ordinary-JS emulator `22ca742ed60e1350ed96110986a09b2ce84620ac`
and Node 20.20.2. It requests a 128 KiB sampling interval and caps each raw
profile at 8 MiB. Four separate GC controls compare each collected-object flag
with its baseline; raw profiles and bounded GC/dead-target facts are retained
before causal refusal. Source review and synthetic controls do not prove that
the hosted runtime supports this protocol or that all guest comparisons pass.
The next worker must qualify the exact reviewed head, then audit the original
artifact independently before selecting an optimization.

## Measurement and refusal rules

Use Node Inspector's sampling heap profiler with both
`includeObjectsCollectedByMinorGC` and `includeObjectsCollectedByMajorGC`
requested. The [protocol definition](https://github.com/ChromeDevTools/devtools-protocol/blob/master/pdl/js_protocol.pdl)
says the default retains surviving objects only. Record exact Node/V8 versions,
requested parameters and runtime support; unsupported or unverified flag support
is an explicit qualification failure, never a silent survivor-only fallback.
The [Node Inspector API](https://nodejs.org/api/inspector.html) supplies the
transport; current protocol documentation alone does not prove support in a
pinned older runtime. Include a hosted short-lived-allocation control to check
that collected objects can contribute.

Bound profile depth, node/sample counts, numeric values, artifact size and guest
wall/step budgets before dispatch. Reject duplicate node IDs, cycles, missing
sample references and nonfinite/negative sizes. Attribute a call frame only
when its canonical source role and exact bytes match the frozen inventory;
retain unknown/native frames as unresolved. Preserve raw profiles and failures.
Report sampled allocation bytes/counts and locations, not total allocation,
execution CPU shares or promised savings.

## Completion and subsequent optimization

Require identical complete reported CPU, RAM/disk hashes, serial/input, device
and interrupt outcomes between the reference and each sampled child under a
fixed semantic projection. Preserve the existing distinction between equal
reported hashes and independently reconstructed memory. A failed child or
unsupported profiler cannot produce a successful diagnostic.

Publish exact tested source, host/runtime, input identities, sampling window,
parameters, source attribution, unresolved counts and bounded original evidence.
An independent reader must audit original profiles, manifests and comparisons
without importing producer parsers or replaying the guest. Public summaries use
repository roles and public artifact URLs; private host origins stay private.

Only then select one measured hotspot. Review rollback/reentry ownership and
precise exception behavior before changing snapshot storage or lifetime. Require
an affected fault/rollback oracle and a separate unprofiled same-workload paired
gate with two warm-up pairs and seven alternating fresh-child measured pairs,
following [PR429](https://github.com/CrispStrobe/bw-board/pull/429). Declare the
performance threshold before running; report whole-child CPU/wall ratios and
all individual pairs. This plan establishes no speedup, physical RTx or adoption.
