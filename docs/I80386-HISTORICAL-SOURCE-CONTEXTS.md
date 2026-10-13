# Historical 80386 source qualification contexts

This documentation-only ownership claim proposes isolation of retained historical
qualification fixtures from the current ordinary CPU. The claim has merged and its source-context design was reviewed. A first helper
slice now validates fixed metadata and manufactured context joins; actual
materialization/import routes and the ten harnesses remain unconnected. No new
qualification result is claimed.

## Problem and boundary

Retained report tests currently compare an original historical source inventory
with the live CPU inventory. Fixed model-profile tests also load the live CPU
while requiring an exact older source hash. A forward CPU change therefore fails
historical source admission before it can establish an architectural difference.
The correct response is to authenticate and execute the intended held context,
while qualifying the current CPU independently. Neither context substitutes for
the other.

Keep the held ordinary CPU SHA256
`6fba681208e1443cc9eff00ae6aba444903d23e5feafe62527b25428e72d60ed`,
the exact CR0 transformation and inverse, native build/source pins, original
report hashes, raw receipts and the PIC compiled 111-source contract unchanged.
Do not update historical pins to whatever current HEAD happens to contain.
These are finite authored mechanism qualifiers, not broader OS compatibility.

## Owned implementation scope

Branch `lane/386-historical-source-contexts-20261013` owns this guide, its
`LANES.md` entry and the following ten test harnesses for context selection:

- `test/i80386-native-cold-reset-report.test.mjs`
- `test/i80386-native-combined-paging-ram-board-gate.test.mjs`
- `test/i80386-native-ram-coherence-report.test.mjs`
- `test/i80386-native-rep-pf-pit-board-gate.test.mjs`
- `test/i80386-native-owned-pic-imr-profile.test.mjs`
- `test/i80386-nonidentity-paging-source.test.mjs`
- `test/i80386-paged-int-iret-source.test.mjs`
- `test/i80386-paged-pagefault-source.test.mjs`
- `test/i80386-protected-ram-source.test.mjs`
- `test/i80386-protected-stack-source.test.mjs`

A small fixed source-context helper and manifest namespace, if needed, is limited
to `scripts/i80386-historical-source-contexts/`. Coordinate its exact file list
and any changes to `.github/workflows/x86-xv6.yml` before implementation. Workflow
changes are limited to explicit context preparation and separate execution of
historical and current suites; all existing acceptance steps remain enabled.
Existing production CPU, native/model-profile loaders and validators are not
owned for modification by this claim. A required change there needs a reviewed
scope extension first.

The five fixed-oracle groups are protected RAM, protected stack, nonidentity
paging, paged INT/IRET and paged page-fault repair. They share the held CPU/CR0
profile. Their no-caller-core, no-caller-ROM and source-owned lifecycle contracts
remain intact. Historical report positives cover cold reset, RAM coherence,
REP/PF/PIT and combined paging/RAM. The PIC profile requires its distinct exact
compiled source context, including the fixed 111-source admission.

## Source-context design review before code

Choose between bounded Git-object fixture materialization and isolated CI
checkouts only after reviewing each context's actual transitive source graph.
Record explicit public commit IDs, relative paths, Git blob identities, byte
extents and SHA256s. Do not infer a complete graph from one CPU hash or directory
prefix. Authenticate the full source census and all runtime imports/data before
loading the context. Reject missing, extra, substituted, cross-context or dirty
inputs, and preserve applicable licences and notices.

Use fixed internally selected source roots and manifests. Do not accept caller
code, URLs, arbitrary roots, CPU classes, factories or replacement pins. Do not
switch or rewrite the caller checkout. Owned temporary contexts have explicit
cleanup ownership; source acquisition is limited to admitted public Git objects,
not tool binaries or guest media. CI must fetch exact required historical commits
rather than assume they exist in a shallow current checkout.

Report validation must retain the original report digest and its committed
source-map proof. When the validator performs a same-engine checkpoint replay,
that replay must use the exact held transitive engine from the report's admitted
context. A current-engine replay cannot be relabeled historical. Reading an
original report alone does not require a replay or create a new execution pass.
Preserve the original historical Node/runtime contract; a modern interpreter
running a fixture is a distinct validation observation, not replacement evidence
for the historical runtime.

The PIC fixture must exercise a clean context compatible with the fixed compiled
revision `a6f605280f778b2bc409ef97ac3b40e15874530c`. Keep dirty-source and
unsupported-CPU rejection controls. Do not widen the live-input allowance to
admit a changed CPU into that old compiled profile. Adoption of a new native PIC
source/build would require a separately named actual qualification.

## Acceptance and current CPU separation

Require source-only controls for missing blobs, altered extents/hashes, incomplete
transitive census, cross-context imports, root substitution and dirty contexts.
Verify historical contexts remain identical when the current CPU changes.
Retained report positives and every existing mutation/refusal test must still run;
no skip, filter, assertion removal or weaker source comparison replaces them.
Preserve first failures and identify which exact context each test executed.

Run current CPU tests on current source: the twelve authored effective-address
checks and eight nearby CPU suites currently total 98 tests, plus the remaining
unpinned current CPU regressions. Require the affected exact-head hosted xv6
build/guest acceptance steps to complete. Historical context passes do not qualify
a candidate's current guest behavior. Do not infer a guest result from a job that
stopped in source-profile tests before its build or guest steps.

The effective-address performance lane remains separate. Its predeclared paired
semantic and CPU/wall gate is still mandatory before performance-only adoption;
this isolation work claims no measured gain, native adoption, physical timing or
new guest compatibility.

## First helper slice

The [fixed helper](../scripts/i80386-historical-source-contexts/README.md) retains
186 source/data rows, original report/source descriptors and closed support-module
selectors. Seventeen tiny controls exercise mocked joins and refusals. Production
loaders, current CPU and historical pins are unchanged. Actual materialization,
harness/workflow wiring and affected hosted qualification remain future work.

## Fixed materializer source slice

The separate [materializer source contract](../scripts/i80386-historical-source-contexts/MATERIALIZER.md) adds a bounded detached sparse-context adapter using the held 186-row admission and original proofs. Its 41 manufactured controls mock all Git, process and materialization boundaries. The published consistency model and held pins remain unchanged. Real hosted materialization, the fixed Node import bridge and ten-harness wiring remain pending; this source slice does not qualify historical runtime or the current CPU candidate.
