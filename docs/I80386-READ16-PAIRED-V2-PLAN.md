# Proposed longer read16 pair and parent-host witness

Status: **PROPOSED and unclaimed**. This plan grants no implementation,
selection, profiling, guest or CPU-adoption authority. The
[retained-failure closeout](I80386-READ16-FAILED-ATTEMPT-READER.md) is complete;
its old one-million-instruction failure and both reader refusals remain intact.

## Source and ownership boundary

Refresh then-current `master` and the lane registry before claiming any work.
At planning head `836867513c3e7fac420ddaa32c17e1c7b6d3e513`, all 35 runtime
files match historical baseline `1312250f5ef06ecd96b0e40e2926e87312d8f414`.
The seed comparison arm is unadopted
`55917c48dffe0c7c743388024481ef0a47a7c76c`, whose runtime closure differs
only in the five-line contiguous-page two-byte `_readLinear` specialization.
This is a **35-runtime-file comparison**, not a claim that the two complete
Git trees differ only in CPU source. Their harness, documentation and other
tracked files differ. Freeze the complete arm heads/trees and runtime rows
again at the claimed source; distinguish both arms from the new controller
head/tree and executing workflow. Never relabel the historical arm as current
mainline source.

Proposed ownership is only new
`scripts/i80386-read16-paired-v2/{fixture.mjs,run.py,reader.py,controls.py,source-rows.json,README.md}`,
`test/i80386-read16-paired-v2.test.mjs`,
`.github/workflows/i80386-read16-paired-v2.yml` and matching task/owned registry
prose. Merge a docs claim before code and start every new execution guard
false. Preserve existing CPU, producers, readers, fixtures, workflows, pins,
source policies and spent event identities.

## Proposed work and fixed gate

Predeclare **ten million retired instructions** of the same media-free
five-operation ordinary-AT loop. This is a proposal requiring proof of cap
fit and new independently derived architecture/device goldens. It is not an
implemented or selected workload. Do not scale old PIT/RTC/CGA observations
or learn expected state from candidate output.

Each fresh child retains its 25,000-instruction throwaway warmup before fresh
measured state. Keep the exact eighteen-child order: four unscored warm
children **ABAB**, then seven measured pairs **AB BA AB BA BA AB BA**.
Require whole-child CPU A/B median **at least 1.03** and **every ratio greater
than 1**, and whole-child wall B/A median **at most 1.02**. Keep startup,
setup and warmed-loop diagnostics separate from those ratios. Preserve every
failed pair; no outlier deletion, adaptive iteration count, threshold change
or same-event replay.

Keep one CPU, 1 GiB without swap, 64 tasks, the 60-second child deadline and
existing finite stream, original, request, event, cleanup and outer limits.
Prove that the new host witness and all possible terminal/error branches fit
before activation. A timeout is a retained failed attempt, not permission to
lengthen a bound or repeat the event. Any required cap change needs separate
explicit review.

## Parent host and versioned evidence

Before timing, retain bounded source-bound reported CPU vendor/model/family/
stepping for the selected logical CPU, architecture/OS/official image,
effective affinity/cpuset, quota/period, memory/task limits and exact pinned
Node identity. Preserve partial observations and first/secondary failures.
Exclude hostnames, serial/boot/machine IDs and full secret environments.
Snapshot facts do not prove physical timing or an exclusive-core lease. The
old paired host model remains unknown; the earlier profile's AMD EPYC model
cannot fill that gap.

Use distinct v2 request/child/source/original/expectation and bounded host
witness schemas, plus new variables, marker, label, unit, artifact and reader
identities. Join actual source and Node readbacks, every child, cleanup,
complete physical archive geometry and separately selected official metadata.
Managed checkout and post-action display names can repeat: require an ordered
numeric/source-role roster and full raw step bindings, including legitimate
gaps and known duplicates. Never assume display names are unique or collapse
steps into a name-keyed dictionary.

Automatic controls must detect changed goldens, order/count, swapped arms,
warming-state leakage, a deliberately failing pair, wrong host/model/affinity/
quota/Node/source facts, malformed typed IDs, partial capture, timeout,
overflow, reap/cleanup chronology, hidden ZIP bytes and coherent official-
metadata substitutions. Require all enabled exact-head source checks and
separate immutable source/request/resource/one-shot admission before any
actual comparison. A later CPU adoption additionally requires fresh affected
clean protected-guest results for that exact arm. A longer authored-loop
result grants no general workload, whole-OS or physical RTx qualification.

## Separate later tasks

Do not duplicate the completed [current-AT profile](I80386-CURRENT-AT-COST.md)
or repeat its spent label. A later new CPU proposal may need a separately
claimed and selected profile tied to then-adopted source. Profiled child
timing must never enter paired ratios.

CI path scoping for pure offline auditors is a separate future workflow-owner
claim, with controls for mixed CPU/model/workflow changes. It grants no waiver
of currently enabled checks and changes no workflow in this plan. No new
actual F7/V8 selection belongs to this proposal.
