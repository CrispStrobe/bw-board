# Selected QEMU setup-input inventory

This lane supplies missing review inputs for the existing selected-QEMU setup
contract. It is a separate read-only observation, not package installation,
runtime selection or a ring3 guest. The original absent-QEMU observation and
its null candidate remain valid failures. It must never be replayed.

## Scope and ownership

The merged claim owns only the new `scripts/i80386-qemu-setup-inventory/`
controller, independent reader, controls and README, a dedicated initially
false-guarded workflow, and its own documentation/ledger section. PR645 and its
existing sources, workflow and source12 remain with their existing owner.
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

The controller and workflow start disabled. Tiny mocked controls exercise valid
observations, wrong source/job/host inputs, absent fields, duplicate packages,
aliases, changed identities, read/close errors, output limits and coherent packet
mutations. Refuse before unadmitted processes or writes; never invent a guest.
The independent reader imports no producer and supplies no approval capability.

After source review and all enabled exact-head checks, separately select and
admit one hosted metadata-only event. Retain each official original once after
metadata admission and audit the retained bytes independently. Metadata success
establishes only observed inputs; setup policy, complete archive/dependency
closure, privilege and service behavior remain separate decisions. No source-only
result enables PR645 actual execution or the compiler.

## Completion and next handoff

Deliver a source-qualified bounded observer and independently audited original
identifying the selected runner's installed state and helper bytes. Mark missing
or stale identities. Its consumer can propose the exact package transaction and
verified service-denial/cleanup policy, or a separately claimed extraction
architecture with a new runtime contract. Never silently change the old QEMU
path/version/hash or treat it as available. A later setup must freshly verify
its platform and complete inputs; this historical observation cannot approve
another machine.
