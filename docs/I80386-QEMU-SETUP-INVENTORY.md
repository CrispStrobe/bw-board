# Selected QEMU setup-input inventory

This lane supplies missing review inputs for the existing selected-QEMU setup
contract. It is a separate read-only observation, not package installation,
runtime selection or a ring3 guest. The original absent-QEMU observation and
its null candidate remain valid failures. It must never be replayed.

## Scope and ownership

The merged claim owns only the new `scripts/i80386-qemu-setup-inventory/`
controller, independent reader, controls and README, a dedicated workflow
initially published with a false metadata guard, and its own documentation and
ledger section. PR645 and its existing sources, workflow and source12 remain
with their existing owner.
No current helper, package, CPU or device implementation is edited by this lane.

## Required bounded observation

- Bind selected source files, executing workflow and official run/job/event
  identities. A later event requires separately reviewed source/request/workflow
  selection and every enabled final-head check.
- Record Ubuntu release and image identifiers only from explicitly selected
  fields with provenance. Absent fields are unknown; runner instance IDs are not
  immutable images or promises about later runners.
- Read installed package/control state and selected dependency names as data.
  Preserve versions, architecture, status, dependency declarations and missing
  records. Do not infer a transaction or guess resolution. Recommendations
  remain separately unadmitted.
- Observe fixed service-helper paths and policy inputs using bounded named/held
  regular-file identities, before/after readbacks, hashes and exact text where
  admitted. Refuse or explicitly report aliases, ownership/mode/identity drift,
  short reads and unknown states. Do not execute helpers or claim continuous
  ownership or an atomic machine-wide snapshot.
- Use closed versioned request/original/expectation formats distinct from ring3
  runtime inventory. Fix file/count/aggregate/time limits before activation;
  preserve first failures, bounded partial data and cleanup errors. No secrets,
  private media, private host paths or unselected environment dump.

## Qualification

The disabled observer source landed in PR669 at
`3191cecbe4befc543b9374501f2a1b05a74bbab5`. Activation PR671 landed at
`b73667d4c247863f8e0e69b0f6713f65ed1ffa83` after all 13 enabled checks passed,
with 12 declared skips. It enables only the collector and metadata job.

The separately admitted [metadata run 40041174534](https://github.com/CrispStrobe/bw-board/actions/runs/40041174534)
passed on the frozen reviewed source `87d7ff39e07f48fd4aac8f0a5b2cbaea97324f31`.
Two independent audits checked the retained original against its request,
source files, official producing job, artifact digest and job-setup log.
The observation completed with 1,211 package records and all 22 file roles,
without a collector error. It reported Ubuntu 24.04.5 and image version
`20261012.334.1`. Twelve selected packages were absent: the five QEMU/firmware
packages and seven supporting libraries. The service-policy file was absent;
systemd and the selected helper paths were present.

This qualifies that bounded historical observation. It establishes neither an
immutable image nor the state of a later runner. Package setup, QEMU execution,
guests and PR645 actual execution remain unqualified; all six authority flags
in the original remain false. Preserve the consumed absent-QEMU failure.

The first source candidate kept the controller and metadata job disabled. Tiny
mocked controls exercise valid observations, wrong source/job/host inputs,
absent fields, duplicate packages,
aliases, changed identities, read/close errors, output limits and coherent packet
mutations. Refuse before unadmitted processes or writes; never invent a guest.
The independent reader imports no producer and supplies no approval capability.

The proposed first wire contract limits the immutable request to 64 KiB and the
entire original, including its optional final newline, to 2 MiB. It bounds each
source/host file at 8 MiB, cumulative selected-file hashing at 64 MiB and the
Debian status census at 5,000 unique package/architecture records. CPU10seconds
and wall30seconds are cooperative collector checks; the outer metadata step is
two minutes in a five-minute job. These are not syscall-preemption, continuous
ownership or machine-wide containment claims. Text and binary observations have
separate roles; executable bytes are not included in the report.

Image fields remain attributed environment observations, and official numeric
job identity remains externally selected. The inner reader establishes packet
consistency without authenticating those external facts. Independent official
run/job/artifact admission and, where needed, a retained job-setup log must
corroborate them before any later setup decision.

For any later observation, separately review its source and activation, require
all enabled exact-head checks to pass, and select a distinct admitted event.
Retain each official original once after metadata admission and audit the retained
bytes independently. Do not replay the completed observation. Metadata success
establishes only observed inputs; setup policy, complete archive/dependency
closure, privilege and service behavior remain separate decisions. No source-only
result enables PR645 actual execution or the compiler.

## Completion and next handoff

The bounded observer and independently audited original are delivered. The next
task is the exact package/dependency closure, including transitive dependencies,
versioned providers, archive control scripts, triggers and file conflicts. Use an
explicit recommendations policy. Then review installer privileges, permitted
service-state changes, service-start denial, resource bounds, first-failure
retention and owned cleanup before a distinct setup/runtime qualification.
The consumer can propose the exact package transaction and
verified service-denial/cleanup policy, or a separately claimed extraction
architecture with a new runtime contract. Never silently change the old QEMU
path/version/hash or treat it as available. A later setup must freshly verify
its platform and complete inputs; this historical observation cannot approve
another machine.
