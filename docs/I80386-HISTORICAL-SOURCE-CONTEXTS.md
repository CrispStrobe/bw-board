# Historical 80386 source qualification contexts

The fixed historical source contexts and current inventory correction have passed
finite hosted qualification. The ten historical harnesses use the admitted public
186-row context; current CPU tests and xv6 guests run separately. Original native
pins and captures remain unchanged.

## Reached hosted checkpoint — 2026-10-14

[Run 38524496473](https://github.com/CrispStrobe/bw-board/actions/runs/38524496473)
passed 288 historical tests and 1,556 current tests, with zero failures and 11
reported skips. The six nested PF build controls passed. Their current static
inventory is exactly the original 243 paths plus the admitted bridge; the sealed
metadata sidecar is a separate 245th fixture file.

The event head was `e54bee3f85ecd10d2de15427ee8895b931f9c866`; actual execution used
PR merge source `fe66037e2c1efba68b32fe68f5e40614466414c9`. Its tree
`7cf51dc1` matched the reviewed head and landed merge
`85182a296c6056ee6dba301767103c9818274ec5`. All 12 enabled final checks passed;
two declared optional checks skipped before merge.

The MIT xv6 source `eeb7b415dbcb12cc362d0783e41c3d1f44066b17` built in 4 MiB
and 14 MiB profiles with the unchanged redistributable Bochs BIOS/VGA pins.
Actual reports contain the filesystem marker, 14 MiB boot marker and `fork test OK`,
with protected paging, ring3, exec, syscall and IDE14 observations. These are finite
guest scenarios, not physical CPU timing or complete software compatibility.
The [official receipt artifact](https://api.github.com/repos/CrispStrobe/bw-board/actions/artifacts/11875079753)
is 21,032 bytes, SHA256
`764b4fda9231cae055e97f6f7058c8a0d96dff236ccff8bf05bb5dd118dde467`.
Original job logs remain available through the run; no local origins are evidence links.

The first [xv6 diagnostic](https://github.com/CrispStrobe/bw-board/actions/runs/38517413953)
and [generic CI diagnostic](https://github.com/CrispStrobe/bw-board/actions/runs/38517414012)
failed the obsolete 243-versus-244 inventory assertion at event head `79ebb0d7`.
Historical tests passed there; the current gate failed before guest execution.
Those failures are preserved and do not establish an ISA or guest defect.

## Next bounded work

Keep the [decodeEA16 allocation candidate](https://github.com/CrispStrobe/bw-board/pull/557)
performance-unqualified until its frozen paired benchmark passes. Prepare authentic
43-row source projections for the fixed baseline and candidate, a separately
accounted genuine Git object view, admitted runtime/timer dependencies and original
capture issuance. Preserve the predeclared 18-run order and independent statistical
reader; retain every failed or partial capture without selective retries. Run only
after source preparation and actual launch gates are reviewed. Any newer candidate
needs its own exact source census and affected current guest qualification.

## Problem and boundary

Before isolation, retained report tests compared an original historical source
inventory with the live CPU inventory. Fixed model-profile tests loaded the live
CPU while requiring an exact older source hash. A forward CPU change therefore
failed historical source admission before establishing an architectural difference.
The fixed contexts now authenticate and execute the intended held sources,
while qualifying the current CPU independently. Neither context substitutes for
the other.

Keep the held ordinary CPU SHA256
`6fba681208e1443cc9eff00ae6aba444903d23e5feafe62527b25428e72d60ed`,
the exact CR0 transformation and inverse, native build/source pins, original
report hashes, raw receipts and the PIC compiled 111-source contract unchanged.
Do not update historical pins to whatever current HEAD happens to contain.
These are finite authored mechanism qualifiers, not broader OS compatibility.

## Owned implementation scope

The landed historical-context lane implemented this guide, its
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

The fixed helper, manifest, materializer and owner/Node bridge live in
`scripts/i80386-historical-source-contexts/`. The owned workflow changes prepare
the explicit context and execute historical and current suites separately; all
existing acceptance steps remain enabled. The generic CI extension adds the
exact compatible-context fetch while retaining its existing serial runner.
Future changes outside these paths require a reviewed scope extension.
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
loaders, current CPU and historical pins are unchanged. The source-owned materializer, owner/Node bridge and ten current harnesses are now
connected as source; real hosted materialization and affected xv6 qualification passed within the checkpoint above. Default model/import/actual stubs remain unsealed.

## Fixed materializer source slice

The separate [materializer source contract](../scripts/i80386-historical-source-contexts/MATERIALIZER.md) adds a bounded detached sparse-context adapter using the held 186-row admission and original proofs. Its 41 manufactured controls mock all Git, process and materialization boundaries. The published consistency model and held pins remain unchanged. The fixed owner/Node bridge and ten-harness wiring are connected as source, with 6 owner and 7 bridge mock controls; real hosted materialization and historical harness qualification passed in the finite modern runtime boundary above; this does not certify the original historical runtime or a performance gain.

## Shared CI provider

The generic `.github/workflows/ci.yml` also runs these ten historical harnesses.
Its existing historical-source steps must fetch the exact compatible commit and
execute those suites serially. Its existing serial runner retains the complete
original package test command. The xv6 workflow separately verifies that its
historical and current selections are disjoint and their union is complete. No test exclusions, assertion waivers or hash waivers are allowed.
The ownership extension has merged; only the fixed-commit fetch changes in
generic CI, with its existing serial runner preserved. The separate hosted observations are recorded above; future source changes need their own affected qualification.

### Separately versioned current PF build-control census

The current PF build-control fixture follows current Git and live source bytes. Its source-test imports now add the historical-context bridge to the independently authenticated pre-bridge 243-path census. The narrow inventory lane owns the PF `build-controls.mjs`, its `i80386-paged-pagefault-build-source.test.mjs` harness and an explicit current inventory declaration. Require exactly the original paths plus the named bridge, full current Git/live joins, and missing/extra/wrong-bridge controls. Original native compiled-source proof, its 243 rows, held pins and raw receipts remain unchanged. All six existing nested controls and affected xv6 build/guest gates must run; this correction grants no new native, current guest or performance qualification by itself.
