# Ordinary AT read16 paired source

This candidate specializes only the in-page two-byte `_readLinear` path. Two
ordered masked callbacks keep one translation, fresh callback lookup, physical
wrapping and original side effects/faults. Four-byte and cross-page paths remain
unchanged. Claim [677](https://github.com/CrispStrobe/bw-board/pull/677) merged
before implementation. No gain or guest qualification follows from this source.

The producer's `ACTUAL_ENABLED` and workflow's `paired` guard are **false**.
The source-control job runs only manufactured/mocked controls and small authored
instruction cases. No paired child, guest, installer or profiler runs locally.

The workload was selected before implementation/results: ordinary AT, the
existing freely authored five-op loop, 25,000 throwaway warm-up instructions,
then a fresh one-million-instruction state. Core correctness controls remain
required; this experiment makes no core speedup claim. This is a distinct
contract from the historical code16 24-form pair and reuses none of its
executables, events, source policy or measurements.

There are exactly eighteen fresh serial children: two warm pairs (`ABAB`), then
seven measured pairs (`AB BA AB BA BA AB BA`). Whole-child wait4 user+system CPU
uses A/B ratios: median at least 1.03 and every ratio greater than 1. Whole-child
monotonic wall uses B/A ratios: median at most 1.02. Python preexec resource checks/writes, Node import, setup, warm-up and
observation are included equally. Internal loop nanoseconds are diagnostic.
Failures retain originals and leave the candidate unadopted; do not repeat the
measurement or change the gate after seeing results.

`source-rows.json` freezes both runtime import graphs (35 files each); only CPU
source differs. The base is `1312250f5ef06ecd96b0e40e2926e87312d8f414`, tree
`04839d8ebe47645a452d80e7a532c14dd91e0b3e`. Source and live Git bytes join before
runtime setup and before/after every child. The separately reviewed canonical
`bw.read16-paired-request.v1` selects the exact candidate head/tree, common
fixture/producer/reader/control/workflow bytes and workflow SHA. Its two public
repository variables are `BW_READ16_REQUEST_JSON` and
`BW_READ16_REQUEST_SHA256`. Do not set them or select an event from this draft.
The request selects the open PR number, exact source branch/head, `master`
base and new `x86-read16-paired-v1` label. It also freezes `workflowHead` and
`workflowRef` for the executing PR merge workflow. A data-only `workflow-source`
checkout at the actual `GITHUB_WORKFLOW_SHA` must prove its workflow Git blob is
byte-identical to the selected PR-head file. The request, runtime context,
source packet, independent reader and external official expectation join the
actual SHA/ref; do not relabel the PR head as the executing workflow.

The raw PR event must contain exactly one body marker:

```text
<!-- BW_READ16_PAIRED_REQUEST_SHA256=<canonical-request-sha256> -->
```

That marker freezes the selected request even if repository variables change
before the job starts. Missing, wrong, duplicate or mixed-case markers refuse.
Source or executing-workflow changes require a new head/tree/common-source/
workflow/request binding and marker before selecting an event.

A separately reviewed activation must precede a single selected owner-applied
PR label on the fixed source branch. An inline stdlib bootstrap authenticates the selected request/head/tree and
producer/workflow bytes before executing the producer. Its full source guard checks the actual
CrispStrobe actor and event sender, open same-repository nonfork PR, base,
selected PR number, action/label and exact PR head before Node setup. Checkout
and `BW_EXPECTED_HEAD` use the PR head, not the synthetic merge `GITHUB_SHA`.
The raw labeled event and request remain retained, including failed bootstrap
attempts; cleanup code runs only after source admission succeeds. The
120-second `--admission-wrapper` retains 8KiB stdout/stderr prefixes and
exit/reap status before Node setup. The `--admit` helper writes a bounded
64KiB complete/refusal receipt with first reason, phase, last path and partial
verified facts. A 32KiB append-only progress witness preserves completed rows
if the helper is killed. Git metadata children stay in the helper's process
group and have owned-PID cleanup; a wrapper timeout kills the whole metadata
group. All admission reports keep actual/guest/performance authority false. Workflow Git/file identity
must be independently joined during official metadata admission. Node is
22.23.3, 124827920 bytes, SHA256
`fde6a4bf8d0562f7751d1a2d6cb9b417c4cfe107bbcb0aa3e9a24e125e348f48`.

The host kernel, Git/Python/systemd/loader, official setup action and selected
Node installation remain trusted service boundaries. This finite file readback
is not a whole-host or library-closure attestation.

The service enforces one CPU at 100%/100ms, one fixed effective CPU, 1GiB memory,
no swap, 64 tasks, 23-minute lifetime and control-group cleanup. Each child has
a 60-second deadline, 512MiB Node heap, core/file/FD caps, separate bounded
stdout/stderr (32768/8192 bytes), one session and owned-PID wait4. Every edge
retains the first error, secondary cleanup facts and bounded raw prefixes.
Initial request/event/source/context/runtime originals are retained, each raw
stream prefix is written unbuffered while draining, and completed resource
records are checkpointed after each child so an outer kill retains partial facts.
Direct process, nested/dying group, task and memory-event censuses are checked
before/preexec/after; an outside bounded show-before-stop retains Result/ExecMain* even on failure,
then stop/show require owned PID zero and an inactive/absent-group readback.
Failed-unit state is not automatically collected before that observation.
The client has a 25-minute deadline and a bounded stop path. The original cap
is 2MiB, request 64KiB, event 256KiB and cleanup 64KiB. Pure controls manufacture
a complete successful packet and prove even maximum raw stream bounds fit.

`reader.py` imports no producer or executable helper. It independently checks
canonical raw originals, base64/raw lengths, external expectation hashes,
source35, current runtime readbacks, authored architecture/device goldens,
resources, exact schedule, all ratios and outside cleanup. Manufactured control
packets are inert. The outside expectation must independently admit official
run/job/step/artifact identity and exact source/event/request before acquiring
one original. The reader binds that supplied selection; its
`officialMetadataAuthenticated` remains false because byte equality alone does
not authenticate GitHub metadata. Never obtain authority from a producer report.
Positive and complete performance-failure packets are readable. Other partial
failures remain bounded raw evidence and the success reader refuses them.

Run only the pure controls during source preparation:

```sh
node --max-old-space-size=512 --test --test-concurrency=1 test/i80386-read16-ordered-pair.test.mjs
/usr/bin/python3 -I -B scripts/i80386-read16-paired/controls.py
```

After all exact-head enabled checks, fresh affected clean xv6/protected-guest
qualification, separate event admission and one original acquisition, invoke:

```sh
/usr/bin/python3 -I -B scripts/i80386-read16-paired/reader.py \
  --original paired.original.json --cleanup cleanup.original.json \
  --request selected-request.json --event selected-event.json \
  --expected independently-admitted-expectation.json
```

Even a passing pair does not qualify physical 386 timing, general workload
speedup, full OS support or adoption without those separate gates.
