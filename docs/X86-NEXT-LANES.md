# x86 checkpoint and next lanes

The next connected compiler-provisioning task is the
[operational integration contract](X86-PROVISIONING-OPERATIONAL.md). It specifies
the missing launch, source-approval, child-context and original-report joins;
implementation begins after its lane claim and the observation reader merge.

The [2026-10-14 historical/xv6 checkpoint](I80386-HISTORICAL-SOURCE-CONTEXTS.md)
is complete within its finite boundary: 288 historical tests, 1,556 current passes,
zero failures, 11 reported skips, and actual 4 MiB filesystem, 14 MiB boot and
forktest scenarios. The exact 244-path current census and separate metadata fixture
are permanent controls; original native 243-row proofs remain unchanged. Next,
complete reviewed source projection and original-capture issuance for the frozen
paired benchmark. The [allocation candidate](https://github.com/CrispStrobe/bw-board/pull/557)
has no measured gain or performance adoption; keep current guest qualification
separate and refresh its exact source before any newer experiment.

Updated 2026-10-14. This is the handoff for the x86 lane, not a claim of complete PC compatibility. Read this file, [current lane evidence](X86-LANE.md), [loading guide](X86-LOADING-GUIDE.md), [compatibility roadmap](X86-COMPATIBILITY-ROADMAP.md), and [oracle strategy](X86-ORACLE-STRATEGY.md) before implementing a task. Refresh the repository's default branch first: historical tested SHAs identify evidence, while a new change needs its own source and artifact identities.

## Reached checkpoint

- Functional JavaScript remains the user-facing 386 AT baseline. CLI and GUI media loading exist within the [documented format limits](X86-LOADING-GUIDE.md). The wired Harris 286, independent functional 286, JS 386 dispatchers, and diagnostic Bochs addon are distinct paths. There is no wired 386 implementation.
- The native [owned paged page-fault recovery fixture](I80386-PAGED-PAGEFAULT-RESULTS.md) passes: 57 attempted instructions, 56 completed quanta, one PF14/error2 at CR2 `8000`, handler PTE repair, CR3 reload, error discard, IRET, one retry, and final readback. Actual full-state records, ten complete memory pages, board state and independent memory-effect tapes are retained. This finite same-CPL16 fixture does not qualify an OS or every protected-mode mechanism.
- The [code32 REP STOSL page-fault fixture](I80386-CODE32-REP-PF-RESULTS.md) passes its finite JS capture and independent QEMU 8.2.2 486 trace/readback: one PF14/error2 after two completed stores, handler PTE repair and IRETD, then two remaining stores exactly once. The capture retains instruction attempts, full relevant state and memory effects; it does not qualify IRQ delivery or the native CPU3 code32 path.
- The historical [compact native paired result](I80386-COLD-PAIRED-RESULTS.md) passes terminal semantics but fails the speed gate. On the same GitHub runner, AMD EPYC 9V74 with four logical CPUs, native uses **4.397239× execution CPU** and **7.371981× execution wall time** relative to JS. All seven measured pairs favor JS. Configured-clock RTx is **JS 2.229400 / native 0.302415**; it is not a calibrated physical 16 MHz 386DX result.
- The [companion native owned-RAM profile](I80386-COLD-OWNED-RAM-RESULTS.md) landed in [PR417](https://github.com/CrispStrobe/bw-board/pull/417) and passed a local full cold guest comparison against the unchanged callback path: 316,562 N/Q, 16,524 resumes, 16,475 ordered PIO events, full reset/last/final 166-word native state, complete final board and whole RAM hash. Its admission correction proves that malformed clock/page/scalar callbacks and forbidden PIC ACK cannot acknowledge a pending write before refusal; the full guest retained exact parity. CPU3 still calls JS for every memory effect, which then calls the companion addon. This is a coherence checkpoint, with no direct CPU3 memory path or measured speed improvement. The recorded 167,123 fused memory entries are counts, not measured cost shares.
- The [ABI 5 same-DSO direct-RAM profile](I80386-COLD-DIRECT-RAM-RESULTS.md), published in [PR420](https://github.com/CrispStrobe/bw-board/pull/420), passes actual full cold direct/companion/callback parity at source `acdb5dcef438c0ac7bc3c7794d43af4371d6e0d1` in run 37605762900. Independent raw audits replay all 91,958 writes from the initial 16 MiB RAM and reproduce the final hash; actual CPU/owner/provider/board sessions close cleanly. JavaScript physical-memory entries are zero, but 233,122 clock transfers remain. The PAGE clock/admission conflation was fixed and both prior failures retained. Its separate [paired timing](I80386-COLD-DIRECT-RAM-PAIRED-RESULTS.md) passes all 36 children but fails adoption: direct/JS execution CPU 5.035176× and wall 9.870393× on EPYC 9V45 with four logical CPUs; 0/7 CPU pairs favor direct. The companion comparison is mixed and descriptive. This finite ROM-only result has no broader OS claim. Lane 2 has a separate, unconnected clock-authority model.
- The [authenticated direct-RAM sampling diagnostic](I80386-COLD-DIRECT-RAM-SAMPLING-RESULTS.md) passes nine semantic children and six profile audits. Reconciliation is a sample hotspot; blank native/builtin leaves remain unresolved. The [empty-journal Map correctness result](I80386-COLD-DIRECT-RAM-EMPTY-RESULTS.md) passes actual run 37623392361 at `74ed000b13800725c9f33baa1213ebaf84d3ded6`, with independent full-state and 16 MiB write-replay audits. Its [separate paired timing](I80386-COLD-DIRECT-RAM-EMPTY-PAIRED-RESULTS.md) now passes 36 semantic children but fails native adoption: 2.9052% lower execution CPU than unchanged direct, yet 5.4971× execution CPU and 10.3769× execution wall time versus ordinary JS. Stop the cold native performance experiment; retain ordinary JS.
- The [386 debugger VGA read correction](https://github.com/CrispStrobe/bw-board/pull/416) landed separately. `readMem('mem', ...)` observes the 386 VGA aperture without changing VGA latches and preserves high physical address handling. The separate VGA debugger-write semantics remain open in lane 5.
- Lite's [actual FreeDOS browser acceptance](https://github.com/CrispStrobe/brickwright-lite/blob/main/docs/I80386-FREEDOS-INTERACTION.md) passed at tested source `8cdb766042d5fec01afa167bf53b0c9c95e9c90b` in run 37588422649. It covers Widgets boot, C: listing, keyboard make/break, guest hardware mouse packets, resize/fullscreen and continued guest activity through Circuits/Code tab switches. It does not qualify direct Circuits input, browser-reserved keys/drag-out behavior or a real guest mouse-driver application. Its bw-board pin remains `a1126312288867127343c2f9bbdfcd2856a18508`; later engine fixes and this native profile are not automatically adopted.
- Stock xv6 full usertests have historical JS-path acceptance with later PSE/APIC extensions. Keep that evidence separate from strict 386DX behavior and native qualification. Broader OS/application acceptance remains unfinished. The [paired JS accelerator result](I80386-XV6-JS-PAIRED-RESULTS.md) passes actual run 37627659600 at tested source `22ca742ed60e1350ed96110986a09b2ce84620ac`, with two independent original-packet audits: all 18 reported outcomes agree, and all seven measured CPU pairs favor the existing protected32 dispatcher. Whole-child dispatcher/ordinary ratios are 0.762593 CPU and 0.674137 wall on EPYC 9V45/four logical CPUs/Node 20.20.2, approximately 1.31x CPU and 1.48x wall speedup for this free xv6 `forktest`. These include startup/report generation, are not physical 386DX RTx, and do not change the default. The [functional sampling](I80386-XV6-JS-SAMPLING-RESULTS.md) is complete; a [one-array instruction-snapshot experiment](I80386-XV6-JS-SNAPSHOT-RESULTS.md) preserved 18 guest outcomes but failed its paired CPU gate at 1.001349 candidate/baseline and 3/7 favorable pairs. Keep that candidate out of master. The two [rollback support attempts](I80386-XV6-JS-ROLLBACK-PROFILE-PLAN.md) refused before guest execution. The [direct V8 sampler and native lifetime witness](I80386-XV6-JS-ROLLBACK-DIRECT-V8-PLAN.md) now have source-only drafts PR471/PR473. The [first original preflight](receipts/2026-10-09-direct-v8-preflight/README.md) failed header closure before runtime probes. The [original data-only census](receipts/2026-10-09-direct-v8-header-census/README.md) completed and independently identifies the aggregate cap as the first refusal; complete reported regular data is 49,002,796 bytes. The separately named [draft PR477 shared-64-MiB authority preflight](https://github.com/CrispStrobe/bw-board/pull/477) passed all ten enabled checks before its single [original run37919948310](receipts/2026-10-09-direct-v8-64m-preflight-failure/README.md) reported matching headers/Node versions and refused silent `cc1plus --version` output. Root and independent original audits passed within that failure boundary. The separate [draft PR479 tool census](https://github.com/CrispStrobe/bw-board/pull/479) is published at source `8ffca01b8ca675fcd2a3980ffd0697665b080771`: eight new paths, 34 admitted source roles, root/independent source and pure-control review passed; all ten enabled exact-head checks passed with only the two declared optional skips, before its single [original run37945340430](receipts/2026-10-09-direct-v8-tool-census-failure/README.md) retained cc1plus identity and refused collect2 split-output. Root and independent audits pass within that failure boundary. The separate [draft PR482 complete-tool-roster/split-output profile](https://github.com/CrispStrobe/bw-board/pull/482), reviewed source `174767b449b1be4b3e76f41c6e44ffd46ba2edfd`, is now published: eight new paths, 42 admitted roles, root/independent source and CPU-free controls passed. All five tool identities precede compiler-tool version probes; collect2 delegation remains explicitly unverified, with named-ld hashes and direct stdout consistency only. All ten enabled exact-head checks passed before the single [original run37953289876](receipts/2026-10-09-direct-v8-tool-roster/README.md), whose root and independent audits passed within the report-only boundary. The separate [draft PR484 pinned first-build source](https://github.com/CrispStrobe/bw-board/pull/484), reviewed `77fd5fbbc132d48622eb0790c0b2d66a6e66a5a4`, is published with nine new paths / 51 roles, all 42 held unchanged, and passing root/independent source and pure controls. It executes the rechecked compiler target under a closed environment and retains all five post-tool observations on compile failure. All ten enabled exact-head checks passed, with only two declared optional skips. Its single [first-build original](receipts/2026-10-09-direct-v8-first-build-failure/README.md) failed after a complete exit-1 compiler return (zero stdout, 8,146 stderr bytes); root and independent original audits passed within the failure boundary. All five post-compile tool observations matched, but no addon was reported. The diagnostics support a narrow missing-`v8-profiler.h` correction; further compilation and delegated-subprocess behavior remain unqualified. The separate [draft PR485 profiler-header correction](https://github.com/CrispStrobe/bw-board/pull/485), reviewed `b8ce3eb36d6022eb82415c80fdbcf9b37e23284f`, adds nine paths / 60 roles, all 51 inherited roles unchanged, and only one include to its derived addon. Root and independent source review and three CPU-free controls passed. The final workflow-only change uses the bounded launch label `xv6-js-rollback-direct-v8-profiler-header-build`; native and runner bytes are unchanged. The one-shot launch guard and prospective original-result reader also passed root and independent CPU-free review. All ten enabled exact-head checks passed, with only the two declared optional skips. The label was applied once; [corrected unloaded-build run37979252708](receipts/2026-10-09-direct-v8-profiler-header-build/README.md) completed successfully and passes two original-packet audits. It reports a complete exit-zero compile and an explicitly unloaded 33,896-byte addon; no load or sampler support is qualified. Do not remove/reapply its label or dispatch a duplicate. After an audited unloaded build, a separate same-run build-and-load support gate must materialize and reverify the pinned Node executable, rehash the newly built addon, and run four fresh minor/major baseline/enabled children with bounded raw profiles, callback facts and a closed report-only inventory before any unchanged-workload xv6 sampling. Preserve the completed tool-roster authority and the earlier strict-refusal originals. The separate [draft PR488 corrected four-case support source](https://github.com/CrispStrobe/bw-board/pull/488), reviewed `ff8038de317569de3df8e7f6743a901a1f530c97`, publishes ten paths / seventy roles with all sixty held unchanged and passing coordinator/independent source review and four CPU-free controls. It requires same-run build, pinned runtime/addon leases and a closed raw-report inventory, retaining attempted/unknown/verified load state correctly. The standalone prospective reader and one-shot launch guard passed coordinator and independent CPU-free review. All ten enabled exact-head checks passed before the label was applied once. Its [original run38023609973](receipts/2026-10-10-direct-v8-support-failure/README.md) failed in the first minor-baseline child after a complete exit-zero build; both original audits pass within that failure boundary. One selected factory-ancestry sample survives despite 64 designated weak callbacks. Next, prepare a separately named dedicated-allocation-site fixture and full source/lease/raw-grade admission; preserve all four-case lifetime predicates and the original failure. No later child or guest ran; do not rerun or relabel this attempt. No allocation hotspot or new speedup is established. Investigate register/state-copy CPU work separately if evidence points there, inspect segment-cache updates only if observed, and review rollback ownership before selecting another change.
- The [owned DOS/32A LE client](I80386-DOS32A-OWNED-LE-RESULTS.md) passed a finite FreeDOS and independent QEMU application gate at source `f8748bcf8dc5c20b37fe62340b7ea42a048cb144` in run 37648932918. The AT observed 32-bit protected entry, arithmetic, DOS print, zero exit and returned shell; QEMU produced the same output and return files. This does not qualify mouse, DPMI, strict 386 hardware, complete machine-state parity or speed.

## How to take a lane

Each lane below has an initial deliverable and a completion gate. Work in an isolated branch, inspect applicable repository instructions, and coordinate shared files. Keep the existing JS baseline and previous failure receipts. Record source revision, fixture license/hash, command, host, resource bounds, result and remaining limits. Publish freely licensed/freeware/owned fixtures only; keep other media and their test details in the private repository. Never infer GUI acceptance from a headless adapter test or infer whole-PC compatibility from an instruction fixture.

### 1. Native RAM ownership and coherence

**Repository:** bw-board. **Reached:** both the [companion profile](I80386-COLD-OWNED-RAM-RESULTS.md) and the [ABI 5 same-DSO direct profile](I80386-COLD-DIRECT-RAM-RESULTS.md) passed their actual finite cold parity gates. Direct tested source is `acdb5dcef438c0ac7bc3c7794d43af4371d6e0d1`; its original source, failed attempts and actual artifact remain immutable evidence. **Timing reached:** both the [original direct paired gate](I80386-COLD-DIRECT-RAM-PAIRED-RESULTS.md) and the [empty-journal paired gate](I80386-COLD-DIRECT-RAM-EMPTY-PAIRED-RESULTS.md) pass semantics but fail adoption against ordinary JS. The latter measured a 2.9052% execution-CPU reduction from one provider change on its host, while candidate/JS remained 5.4971×. Keep ordinary JS and stop this cold native performance lane. Preserve its correctness oracle, source identities and raw failures; do not expand the cold native interface or repeat an unchanged guest merely to refresh documentation. The source-only clock-authority model in lane 2 remains separate and unintegrated.

Start at `scripts/bochs-cpu3-native-cold-direct-ram/`, its result receipt, and the separate `scripts/cold-direct-ram-paired/` timing harness. The direct profile copies one RAM/ROM session into the CPU3 addon and routes physical RAM/ROM/open-bus effects to C++ without a JS memory callback or shared pointer to a second DSO. It preserves compact progress and the existing JS clock, ROM-page, PIO and device callbacks, transferring the clock tape before a memory effect. It remains fixed-A20, ordinary-memory and ROM-execution-only; MMIO ownership, paging, DMA, executed RAM writes and a clock lease are outside this profile. Its PAGE clock flush and actual page callback have separate boundary kinds; retain that regression and strict page tickets.

Preserve the implemented distinct, authenticated ABI and addon identity. ABI4's memory callback lacks the trusted N/Q required by `Session::write`; the ABI5 callback receives the source-validated N/Q after clock transfer and returns exact observed bytes and decode/effect/generation/epoch/A20 metadata, distinguishing a pre-effect full-journal retry from a committed effect. Keep the source CPU's pending-write/generation ledger consistent with the owner session. At every clock, page, PIO or paused observer, deliver a copied bounded journal batch with session identity and contiguous sequence/effect/N/Q/epoch/generation/before/after fields. Preflight callback reason, phase, complete tape, page and scalar arguments, reentry and the known forbidden PIC ACK **before** journal acknowledgement or board effect. Validate the whole batch against the JS board shadow before mutation; commit the shadow and native acknowledgement once, with no arbitrary reentrant owner calls. `Session::before_observer` currently acknowledges before calling its observer, so it cannot be inserted unchanged at this seam. A full journal must refuse before mutation, reconcile, then retry only the identical uncommitted effect; a committed write must never replay. Preserve the valid `[Q, N]` tape order while requiring `Q <= N` on its completed ledger.

**First deliverable (reached):** exact source/ABI/build identity and pure C++/NAPI bridge adversaries. Prove copied initialization, one-thread/session ownership, whole-span ROM aliases and open bus, MMIO/code-write refusal, overlapping writes and generations, full-journal reservation/retry, wrong batch or cross-session shadow, observer failure/reentry, and malformed clock/page/scalar denial with one pending write and zero acknowledgement, board-shadow or N/Q effect. Keep the predecessor's premature-acknowledgement failure as a regression. Static build admission alone is not guest qualification.

**Correctness gate (reached at the source above):** at a clean exact source head, run the full free-BIOS cold guest against both the merged companion and unchanged callback paths. Compare a semantic projection of raw reset/requested-last/final 166-word CPU state, 316,562 N/Q, 16,524 resumes, complete final board and whole 16 MiB RAM hash, all 16,475 ordered PIO events, zero fallback and closed sessions. Independently check copied journal watermarks, exactly-once ordered memory effects and ROM-page admission. Report direct-memory and clock/observer entry counters separately: unlike semantic state, bridge counts should change. Preserve raw failures and do not infer a speed gain from the 167,123 historical fused-memory count. Replacing a fused memory entry with a retained clock entry does not remove that outer JS entry.

**Timing gate (run 37609656584: semantic PASS / performance FAIL):** preserve the result. For any later profile, only after correctness, run separate same-host direct-versus-companion and direct-versus-plain-JS comparisons on the same fixed workload, with two warm-up pairs and seven alternating measured pairs of fresh children. Retain exact source/addon/configuration identities, CPU allocation, execution and whole-child CPU/wall windows, bridge counts and every child's semantic proof. The existing adoption bar remains at least 10% lower mean execution CPU than plain JS with all seven measured pairs favorable; report the actual result even if it fails. Configured-clock RTx is not physical 16 MHz calibration. Keep functional JS as the user-facing baseline until that gate passes.

### 2. Reduce crossings with explicit clock authority

**Repository:** bw-board. **Dependency:** lane 1 coherence qualification is reached for the finite cold-ROM profile; its paired timing passed semantics and failed adoption against ordinary JS. Preserve that profile and failed result; introduce clock authority separately.

Read the MEMORY fusion runtime and `scripts/cold-native-compact-progress-performance/README.md`. Introduce a distinct owned-slice clock lease carrying N/Q, the six-clocks-per-Q ledger, earliest device deadline, mapping/A20 epoch and IRQ state. Do not fabricate the older seven-word JS pre-effect reply or silently skip its callback contract.

Stop at deadline/event, PIO, IRQ eligibility/delivery, HLT, fault, code write, mapping change or journal exhaustion. Define committed-versus-pending return status and reconciliation order; preserve once-only REP elements and fault restart. Refuse a lease when device observation cannot be excluded. Preserve real requested full-state inspection.

**First deliverable:** a pure two-ledger model separating logical source N/Q from published JS-board N/Q, with an issued session/phase/epoch/A20/IRQ/deadline token and bounded tape/journal. Prove complete preflight before acknowledgement, exact uncommitted retry, ROM-page tickets, reentry denial and revocation at every observer/device/code/map boundary. Then integrate a separately identified interface and run a small actual differential guest. **Completion gate:** full cold parity, then a separate same-host comparison using two warm-up pairs and seven alternating measured pairs. Report execution CPU and wall time, whole-child timing, callback counts and host metadata. Adopt only after the existing quantitative gate passes. Profiling must measure cost rather than infer it from callback counts.

### 3. Extend protected-mode differential coverage

**Repository:** bw-board. **Ready to start:** independent of the cold speed lane.

The [finite paged IRQ0/IRET result](I80386-PAGED-IRQ-RESULTS.md) passes actual run 37622795990 at `8f1be780b191176ff1d3789b38e2c73e48041198`, with independent original-packet audits. It covers same-CPL0 code16 delivery, one genuine zero-Q IRQ cut, handler marker, IRET and one interrupted store, with ten-page replay. Four original failures and two unmatched memory phases remain preserved. Do not repeat that unchanged fixture. Next add one privilege-changing interrupt/IRET or restart fixture, keeping code16/code32 frames explicit; TSS, VM86 and task interactions remain separate gates.

Start with `scripts/bochs-cpu3-native-paged-pagefault/`, `test/i80386-paged-pagefault-native-runtime-driver.test.mjs`, and [oracle strategy](X86-ORACLE-STRATEGY.md). Use the reached paged IRQ and JS/QEMU code32 REP page-fault fixtures as references. Add one finite owned fixture per new mechanism: privilege-changing interrupt/IRET, native code32 REP restart, then TSS/VM86/task interactions as supported. Keep 16-bit and 32-bit frame cases explicit. For JS, inspect `src/experimental/i80386.js` and the corresponding paging, task and VM86 tests.

Compare returned CPU/cache fields, complete selected pages and board state; independently validate each engine's architectural memory effects. Preserve genuine differences in accessed/dirty update timing. Use a pinned independent emulator for disputed architectural behavior and record its version/configuration; generated instruction vectors supplement guest tests rather than replace them.

**First deliverable:** one new source-bound fixture and independent expected trace. **Completion gate:** actual fault/delivery/restart evidence with negative adversaries and retained divergence receipts. Expand the admitted profile only after the added mechanism passes. PSE/APIC-enabled xv6 is a separate profile, not strict 386DX evidence.

### Ordinary-JS ring-changing INT/IRETD fixture

**Status:** ownership claim [PR643](https://github.com/CrispStrobe/bw-board/pull/643)
is merged. Implementation [PR645](https://github.com/CrispStrobe/bw-board/pull/645)
remains draft at published checkpoint
[`ba90a2ea`](https://github.com/CrispStrobe/bw-board/commit/ba90a2ea).
The implementation files are on that draft, not the default branch. Refresh its
head, base and enabled checks before continuing; use its reviewed source rather
than reconstructing already completed adapters.

**Completed source checkpoints:** deterministic ROM and architectural goldens,
bounded runner and original-only validation, dropped preparation and bootstrap
adapters, immutable request/event admission, fixed Git blob transport and
fresh readonly installation. The
[subsequent prerequisite checkpoint](https://github.com/CrispStrobe/bw-board/commit/e99d28c7dd29e5a73059df039564c4242c875a8d)
connects fresh setup to a separate independently implemented readonly observer,
then drops to the invoker identity before fixed original retention, independent
prerequisite admission and bounded versioned log publication. The seven-mode
CLI has 198 runner controls and five independent reader control methods; all
prior 193 test bodies and twenty reader functions are unchanged. Seventeen
additional source mutations are detected. The observer checks source12, five
installed inputs and all five resource groups; write-only kill controls are
metadata-only. Its mocked peak is eleven descriptors under the unchanged cap.
These are mocked source-boundary results, not actual resource ownership.

The [runtime source checkpoint](https://github.com/CrispStrobe/bw-board/commit/337c8169)
adds an immutable external superset gate before and after runtime discovery,
independent stable-graph admission and a separate fixed metadata inventory
endpoint. Its source and workflow guards remain false. The runtime expectation
is versioned separately from raw ASLR-bearing observations, which remain retained.
205 runner controls, seven independent runtime methods and the five prerequisite
methods pass; the prior 198 runner bodies are held. Seventeen additional runtime
source mutations are detected. None of these mocked controls is a hosted result.

The [execution-delivery checkpoint](https://github.com/CrispStrobe/bw-board/commit/ba90a2ea)
connects the admitted runtime to concrete preparation, bootstrap and controller
descriptors, explicit phase v4 and an independent V8 original reader. The guarded
`actual` job selects `--hosted-runtime-actual`, sets up the existing selected Node
version and exports only the twenty original packet roles. Prerequisite/runtime
originals remain in the separately capped versioned log. The online verdict
always leaves official qualification false; only the independent offline reader
joins original official workflow, log and artifact identities.

Independent controls pass 205 runner methods, seven runtime methods, five
prerequisite methods and seven delivery methods. A complete manufactured V8 log
and artifact also pass the unchanged twenty-role architectural predicates.
Peer review found four accepted malformed census cases; all now refuse while
the positive still passes. No emulator, QEMU, kernel-resource or guest operation
ran in these controls; only the tiny authored ROM byte builder ran in Node.
Both inventory and actual remain source/workflow disabled at this checkpoint.
Fixed Git/checkout/setup/sudo and pre-admission interpreter startup are trusted
hosted platform boundaries, not complete executable or whole-host attestation.

Start with the immutable
[source README](https://github.com/CrispStrobe/bw-board/blob/ba90a2ea/scripts/i80386-ring3-int-iret/README.md)
and the existing adapters in `scripts/i80386-ring3-int-iret/run.py`.
The remaining tasks below stay within the owned fixture paths. A CPU/device,
unrelated workflow or dependency change needs a separately reviewed scope.

Concrete remaining tasks, in order:

1. **Independent observer and failure collector: source delivered.** Continue
   the existing `--hosted-prerequisites` path and independent reader modes;
   do not reconstruct them. The new eight-original prerequisite protocol is
   distinct from the twenty guest packet roles and older V7. Controls cover
   ownership/cap drift, write-only metadata, bounded proc reads, partial reads,
   close failures, irreversible drop, first errors, fixed retention and log
   framing. Actual setup/process observations remain part of the final hosted
   qualification; this source checkpoint alone provides no such evidence.
2. **Observe and independently admit the hosted runtime.** The separate
   `reader.py --inventory-runtime` endpoint is implemented and disabled.
   Review a metadata-only activation of its source guard and `runtime-inventory`
   job, keeping actual false. Freeze the activation head's twelve-file manifest
   and `bw.ring3.inventory-request.v1`, set the externally selected request
   digest and immutable event payload, then admit one own-PR
   `x86-ring3-runtime-inventory` label. Acquire the official original once and use
   the standalone inventory reader; no producer imports or guest replay.
   Historical Node/QEMU bytes must match before metadata probes. Current hosted
   QEMU and already-enabled parent cpu/memory/pids controllers are unestablished
   prerequisites; missing or changed inputs must produce a retained refusal.
   Do not install a fallback, write shared parent controllers or silently repin.
   The inventory candidate is not automatic approval: independently freeze the
   stable selected superset, aliases, tools, package data and probe descriptors;
   keep raw ASLR-bearing probe originals separate.
3. **Versioned standalone reader: source delivered.** Continue the explicit V8
   path in `reader.py`; take externally selected request/source/runtime
   pins and expected event/job/configuration as inputs. Join request, raw event,
   installation, independent observer, runtime, phase and generator originals in
   an explicit new version of the original-only validation path. Preserve older
   reader predicates, twenty packet roles and existing caps. Completion requires
   independent positive and wrong-pin, rehashed-conflict and dropped-identity
   adversaries, with no producer imports or guest replay.
4. **Execution adapters: source delivered.** Continue the concrete
   `--hosted-runtime-actual` endpoint and its admitted preparation/bootstrap/
   controller modes. Deliver those admitted expectations
   through deliberately versioned closed parent/preparation/bootstrap/controller
   descriptors. Reuse the captured plan; preserve drop-before-decode, fixed Node
   generation/golden readback and bootstrap migration/drop/exec. Keep exclusive
   staging, exact preparation membership and first/partial failures. Completion
   has a coherent full mocked CLI chain reaching the new reader and protected-edge
   negatives. The legacy install-only refusal remains separately unchanged.
   Do not reconstruct the completed adapters or infer actual execution from them.
5. **Review and activate separately.** Freeze the final committed twelve-file
   source manifest, including the workflow, complete runtime input and request
   digest selected by prior independent review. Join the exact executing
   workflow, event, job and configuration; review root installation, outside
   collection and the 900-second job envelope including Node setup. Actual
   preinstalled QEMU and parent-controller admission remain mandatory; source
   plumbing does not provision them. A repository variable and immutable
   event transport the request identity; neither self-approves it. Only a separate
   reviewed source/workflow change may remove both false guards. Do not populate
   approval configuration or consume the label during source development.
6. **One hosted qualification and result.** After every enabled exact-head check
   succeeds, separately admit one hosted event. Acquire each official original
   once after metadata admission, independently audit provenance and raw guest
   effects against the architectural goldens, then publish the bounded result
   or preserved failure. Affected clean actual guest evidence is required before
   merging PR645; the mocked prerequisite controls do not meet that gate. A later candidate needs its
   own source/admission, not a retry of a consumed attempt.

This is the next software-interrupt mechanism fixture after the reached
same-CPL0 paged IRQ/IRET result. It does not repeat that fixture or adopt a
native backend.

**Owned files:** new
`scripts/i80386-ring3-int-iret/{fixture.mjs,probe.mjs,run.py,reader.py,controls.py,README.md}`,
`test/i80386-ring3-int-iret.test.mjs`,
`.github/workflows/i80386-ring3-int-iret.yml` and
`docs/I80386-RING3-INT-IRET-RESULTS.md`, with this subsection and its registry
entry. Existing CPU/device code, runners, fixtures, tests, workflows, pins and
other owners' surfaces remain outside scope. Stop and propose a separately
reviewed ownership extension if the first mismatch requires a product repair.

**Initial deliverable:** a small self-authored MIT 64 KiB reset ROM, emitted by
a deterministic closed byte builder without an external assembler or compiler.
Read the existing authored-ROM
[`code32 REP/PF fixture`](../scripts/i80386-code32-rep-pf-oracle.mjs) and
[QEMU boundary](../scripts/run-i80386-code32-rep-pf-qemu.mjs) as references; keep
their source and accepted inputs unchanged. Freeze the final ROM, payload,
relocations and symbols before execution. Use the same original ROM in both
engines. No DOS, extender, filesystem, disk image or downloaded guest is needed.

Run the ordinary `ExperimentalI80386` with `cpuProfile: "strict386"`, hardware
reset and ordinary `step()` calls over a fixed owned memory bus. Paging stays
off; CR4/PSE, APIC, native blocks and injected interrupt/state callbacks are
not used. The reset payload initializes its own writable GDT, IDT and 32-bit
TSS, masks external PIC sources and enters ring3 through guest instructions.
This is a CPU/software-interrupt fixture, not a new whole-board acceptance.

Use the original Intel 80386 Programmer's Reference Manual (1986), available
in a public transcription: [section9.6](https://www.scs.stanford.edu/05au-cs240c/lab/i386/s09_06.htm)
for interrupt-procedure frames and IF behavior,
[INT](https://www.scs.stanford.edu/05au-cs240c/lab/i386/INT.htm) for the current-TSS
inner-privilege stack and twenty-byte 32-bit frame,
[IRET](https://www.scs.stanford.edu/05au-cs240c/lab/i386/IRET.htm) for the outer-level
return, and [section7.1](https://www.scs.stanford.edu/05au-cs240c/lab/i386/s07_01.htm)
for the TSS privilege-stack pointers. These define the architectural goldens;
engine agreement alone does not define them. INT describes selector slots as
padded, without specifying zero high words. Retain every raw frame byte but
grade the defined low selector words separately from those padding bytes.

Freeze one positive trajectory:

1. Establish flat kernel CS/SS selectors `0x08`/`0x10`, user CS/SS selectors
   `0x1b`/`0x23`, TSS selector `0x28`, kernel ESP0 `0x8000` and user ESP
   `0x9000`. Enter 32-bit ring3 with EFLAGS `0x202` (IF set, IOPL0; NT, VM,
   RF, TF and DF clear). Load independently chosen nontrivial general-register
   values using guest instructions. Freeze their exact constants and symbol
   addresses in the reviewed fixture contract.
2. Execute the owned two-byte `INT 0x80` at ring3 through a present DPL3
   32-bit interrupt gate targeting kernel CS. At actual handler entry require
   CPL0, SS `0x10`, ESP `0x7fec`, IF clear and the original register values.
   The twenty-byte frame has five four-byte slots, from low to high addresses:
   return EIP, old CS, saved EFLAGS `0x202`, old ESP `0x9000` and old SS. Require
   the low words of the CS/SS slots to equal `0x1b`/`0x23`; retain their high
   words as raw padding observations without requiring zero, unchanged sentinel
   bytes or cross-engine equality. Thus byte offsets6,7,18,19 from entry ESP are
   outside the architectural value projection, with their positions fixed before
   execution. There is no error-code dword for this software interrupt.
3. Copy the actual frame and entry registers to a fixed guest evidence area
   before handler pushes, reporting or later frame reuse. Preserve guards around
   the admitted kernel/user stack windows. Apply one declared EAX response,
   preserve all other general registers and execute actual IRETD over that same
   five-dword frame. Do not synthesize an accepted return from a final marker.
4. At the first returned ring3 instruction require the frozen continuation,
   CPL3, CS/SS `0x1b`/`0x23`, ESP `0x9000`, restored IF and exact returned
   register values. Guest instructions save those original returned values and
   flags to distinct evidence slots before any reporting changes them.
5. Only then execute a separately identified one-way `INT 0x81` reporter. Source
   review must establish that its data reads serialize actual frame/register/
   memory records copied before pushes, reporting changes or frame reuse, rather
   than expected literals. Bind those reviewed ROM bytes to the launched input
   and original evidence. The reporter uses the owned debug port and finishes
   through the existing QEMU debug-exit interface. Its own frame is distinct;
   only the first INT80/IRETD roundtrip is graded. No ring3 I/O privilege is
   required. Output bytes alone cannot distinguish this execution from a
   byte-identical literal replacement; execution-origin credit additionally
   depends on the frozen source/ROM and launch-provenance joins.

The JavaScript observer captures source-bound before-INT, handler-entry,
pre-IRETD and first-returned-instruction CPU contexts, raw frame bytes and
fixed memory ranges without editing CPU state or driving a callback in place
of an instruction. The QEMU TCG `pc`/`486` control boots the same ROM and emits
the original copied records. Use the existing reviewed QEMU8.2.2 acquisition
and executable/package identity policy read-only, retaining notices. Its later
CPU and different board are an independent compatibility oracle for the named
386 instructions, not a strict386 implementation or complete state-parity claim.
No new arbitrary executable, URL, command, loader or firmware fallback is exposed.

**Independent expectations and refusal controls:** before guest execution,
review/disassemble every authored instruction and freeze a separate declarative
expected register set, exact frame layout/bytes, stack guard bytes, selected
memory extents and expected guest writes. The independent stdlib reader must
not import the byte builder, probe or producer grader. Recompute ordering and
all raw fields; a producer `passed` value or emitted success string is insufficient.
Manufactured controls must reject changed return EIP, swapped/missing defined
frame fields, wrong saved SS/ESP or IF, wrong entry/return CPL, altered registers
or guards, missing observation stages and malformed/truncated evidence. Cover
reporter substitution through refusal of changed frozen ROM/source or missing
launch-provenance joins, without claiming that identical output bytes reveal
literal substitution. Verify the declared selector-padding projection separately
from defined-field and guard mutations. Include a true positive and fully
rehashed semantic negatives so failures cannot be explained only by stale hashes.
No local emulator, QEMU or guest execution is needed for these pure controls.

**Final hosted gate:** freeze the complete source/import/data graph, ROM/input
bytes, observed runtime identities, closed role/event schema, independent
reader and official one-shot admission before launch. Run the two fresh guest
children serially, JavaScript then QEMU, under one logical CPU, 1 GiB RAM,
zero swap and 64 PIDs per owned envelope. Each child has a 120-second wall
limit; JavaScript additionally has a two-million ordinary-step-call limit.
The controller has 600 seconds and the job 15 minutes. Bound stdout and stderr
to 128 KiB each per child, optional QEMU diagnostic trace to 1 MiB, each JSON
role to 1 MiB and the expanded packet to 16 MiB. Freeze the actual finite role
count and worst-case sum before execution. Resource setup/readback, first-error
retention, reaping and empty owned terminal censuses are acceptance conditions.
A missing limit or observation refuses; these proposed bounds are unqualified
until the reviewed finite profile and actual resource audit pass.

Keep unexpected faults, unsupported instructions, shutdown, timeout, partial
output, process/cleanup uncertainty and the earliest failure. Never reset,
continue a refused session, substitute a second capture, widen goldens or
weaken a bound to obtain success. Require all enabled final-source CI checks
and enclosing workflows before one separately admitted hosted attempt. Acquire
the official originals once after metadata admission, then perform two
independent original-only audits without producer imports or guest replay.
A failure selects the first narrow boundary for a new reviewed candidate; it
never authorizes rerunning or relabelling the consumed actual.

Success would establish this one CPL-changing software INT80/IRETD trajectory,
its actual stack/frame/register/memory effects and finite process cleanup. It
would not establish hardware IRQ delivery, IOPL isolation, paging/restart,
VM86/task switching, general DPMI, strict whole386DX/AT, OS/game compatibility,
physical timing, performance or an installed consumer.

### 4. CLI and GUI media/package handling

**Repositories:** bw-board first for shared parsing/adapter behavior; brickwright-lite for UI and exact dependency-pin adoption. **Ready to start:** frontend work can proceed independently of native optimization.

Use `scripts/run-dos.mjs`, `scripts/run-i80386-at-console.mjs`, [loading guide](X86-LOADING-GUIDE.md), and [Lite GUI guide](https://github.com/CrispStrobe/brickwright-lite/blob/main/docs/I80386-GUI.md). Preserve the distinction between direct DOS services and BIOS disk boot. Audit existing media/config parsers before adding another loader.

First unify DOSBox relative-path resolution and raw-disk geometry validation across CLI and GUI. Then add bounded ZIP/package admission: size/count caps, path traversal rejection, deterministic config/media selection, unsupported-command reporting and no host-shell execution. ISO loading needs an actual CD-ROM/ATAPI device and firmware/guest path; report it as unsupported until that exists. Add explicit disk writeback/export separately, with original images preserved.

**First deliverable:** shared parser fixtures and one freely licensed package exercised in CLI and GUI. **Completion gate:** the same media reaches the functional target in Circuits, Widgets and Code; visible errors survive failure; user input and an observable guest result pass a real browser test. Update the loading guide and matrix from those results. Diagnostic native addons remain unavailable as general media loaders until separately integrated.

### 5. Console, VGA, mouse and large Widgets acceptance

**Repositories:** brickwright-lite UI; bw-board only for shared target/input fixes. **Ready to start:** independent frontend lane; coordinate adapter changes with lane 4.

Read Lite `docs/I80386-GUI.md`, `docs/I80386-FREEDOS-INTERACTION.md`, `docs/X86-LOADING-SCOPE.md`, and `docs/generated/LANGUAGE-DEVICE-MATRIX.md`. The bounded actual FreeDOS browser scenario above is reached; preserve its source, dependency pin, screen/input records and previous failed harness evidence.

**Next deliverable:** exercise direct Circuits guest input, drag capture outside the pane, reserved browser keys, restart/error handling and a real guest mouse-driver/application response. [Lite PR707](https://github.com/CrispStrobe/brickwright-lite/pull/707) owns the direct Circuits input gate. Its first two attempts stopped before guest launch on installed-source origin and build-identity checks. The [third run 37632115411](https://github.com/CrispStrobe/brickwright-lite/actions/runs/37632115411) reached guest boot, listing and PS/2 setup, then failed because the Controller canvas covered the VDP parent click point; it did not prove direct guest keys. The fourth [run 37640159639](https://github.com/CrispStrobe/brickwright-lite/actions/runs/37640159639) at source `2befc3bd` physically selected Debugger and focused the VDP, then failed its prior-output pixel assertion before sending Circuit keys. Its screenshot visibly retains `PS2 DONE`; investigate the pixel observer against the actual renderer rather than replacing it with guest-memory acceptance. Corrections retain exact repository/commit/package-byte admission; direct Circuits guest input remains unqualified until an actual result passes. Do not infer acceptance from its source controls. Preserve Widgets fullscreen/resize and Code tab behavior. For CLI, separately exercise live TTY input, redraw/exit, restored host terminal state and mouse-capable terminal handling. Do not infer those results from tab switching, synthetic DOM input or a hardware mouse packet alone.

**Completion gate:** one reproducible free-media scenario with an observable guest response for each newly claimed interaction. Publish the exact dependency pin and browser build; update generated matrix inputs through their generator rather than manually asserting support. Engine fixes require explicit consumer adoption and installed/browser qualification.

**Debugger memory follow-up:** the 386 target's `readMem('mem', ...)` now has a focused VGA aperture and high-physical-RAM regression. Its separate `writeMem('mem', ...)` path still writes the backing array directly; it does not route VGA writes through the 386 bus or its planar aperture. A debugger poke of VGA memory needs its own explicit guest-visible semantics and regression before any GUI memory-edit claim.

### 6. Free OS and application acceptance

**Repository:** bw-board for guests; brickwright-lite for frontend acceptance. **Ready to start:** one bounded guest at a time.

Read [guest acceptance](X86-GUEST-ACCEPTANCE.md), [compatibility roadmap](X86-COMPATIBILITY-ROADMAP.md), and the reached [owned LE application result](I80386-DOS32A-OWNED-LE-RESULTS.md). The owned DPMI client has reached the finite gates below. Next qualify its selected allocation frame and a free application with an observed input/device response, then ELKS and appropriate freely licensed small-Unix fixtures. Revisit MINIX only after verifying the exact release's redistributability and required hardware; the historical `scripts/probe-16bit-os.mjs` probe is not an automatic qualification of every CPU/profile. Treat xv6 as the explicit later-feature machine profile.

For each image, record license/provenance/hash, CPU/board profile, BIOS, geometry, resource budget and observable success criterion. Diagnose the first missing instruction, privilege mechanism or device transaction before broadening the run. Bundle only when the exact image's license permits redistribution; otherwise document reproducible public acquisition/build instructions. Keep restricted guest details in the private repository.

The next free/owned application suite is a sequence of distinct gates, not a present compatibility claim:

1. The **owned minimal 32-bit LE client** reached a [finite FreeDOS and QEMU DOS/32A gate](I80386-DOS32A-OWNED-LE-RESULTS.md): protected entry, arithmetic, DOS output, zero exit and shell return were observed. The extender `binw/dos32a.exe` at revision `06d8e3a0b2397d872205d6c99a7de0d6b8628bcc` has SHA-256 `d189be603e72f79d3c2f68114eb34d0cab8bd9744ef0f327497d57bcd8e16817`; it was acquired and executed with its license and acknowledgment retained in the evidence, but **not bundled** here. Allocation above 1 MiB and timer service remain separate gates. DOS/32A compatibility does not itself prove original DOS/4GW compatibility.
2. The separate owned DJGPP/CWSDPMI client reached a bounded [AT completion result](I80386-DPMI-AT-COMPLETION-RESULTS.md): checked allocation/readback, one simulated timer call, exact output, zero exit and shell return. Its source [PR456](https://github.com/CrispStrobe/bw-board/pull/456) is still draft here. The separate new client passed its first [QEMU high-linear-memory and advancing-timer gate](I80386-DPMI-HIGHMEM-QEMU-RESULTS.md) at draft [PR458](https://github.com/CrispStrobe/bw-board/pull/458). The same client then passed its first [finite AT high-linear-memory/timer gate](I80386-DPMI-HIGHMEM-AT-RESULTS.md) at draft [PR459](https://github.com/CrispStrobe/bw-board/pull/459); the [contract](I80386-DPMI-HIGHMEM-TIMER-PLAN.md) links the [next single-allocation frame-attribution lane](I80386-DPMI-FRAME-ATTRIBUTION-LANE.md). Neither finite result establishes physical placement, calibrated RTx or interrupt/callback ownership. The subsequent [owned 0501 task-core outcome](receipts/2026-10-09-0501-task-outcome/README.md) records normal return into ring0 while preserving the frame guard refusal; exact original task/frame resumption remains the next bounded diagnostic. The [task-excursion CPU prerequisite](receipts/2026-10-09-task-excursion-cpu/README.md) passed three finite xv6 regressions and 94 focused controls at draft PR472; the separate same-machine diagnostic source is published in draft PR474, whose 12 enabled checks passed before the single [diagnostic run37907258126](https://github.com/CrispStrobe/bw-board/actions/runs/37907258126) was launched. The [original diagnostic](receipts/2026-10-09-task-excursion-at/README.md) captured two committed task transfers before its protected-only observer refused after PE cleared; original-task resumption and owned frame return remain unqualified. The separate mode-recorder CPU source is published in [draft PR476](https://github.com/CrispStrobe/bw-board/pull/476), with 14 new authored controls. Its [first CPU-control failure](receipts/2026-10-09-task-mode-cpu-failure/README.md) preceded xv6 build; the test-only in-range fixture correction is pushed and the [corrected original hosted CPU/xv6 result](receipts/2026-10-09-task-mode-cpu-success/README.md) passes root and independent audit; all twelve enabled exact-head checks passed with only the two declared optional skips. The separately named bounded guest diagnostic is published in [draft PR478](https://github.com/CrispStrobe/bw-board/pull/478), reviewed source `f2fb33f921bf99b23d1e88ee889512d5d4ee6318`: ten new paths, 215 admitted roles, 64 import-graph nodes and passing pure controls. All ten enabled checks passed with only two declared optional skips before the [independently audited original run37938657230](receipts/2026-10-09-task-mode-at/README.md). It records two task transfers and source-attributed PE clear/set changes, then refuses an unhooked CS-context reload; original-task resumption and frame return remain unqualified. The bounded CS-transfer source is now published in [draft PR480](https://github.com/CrispStrobe/bw-board/pull/480), reviewed `33a8f62a8ac3613007e80f2f3ee066d6ea987edf`: three paths, source/syntax review passed, 17 new authored controls; the [first original hosted run37940838674](receipts/2026-10-09-far-attribution-cpu-failure/README.md) failed 16 fixture setup cases before xv6 build/boot. The test-only correction `6191a70650142ea46552c2d417eb7eb62aa08e38` preserves CPU bytes. The [first corrected original run37942619141](receipts/2026-10-09-far-attribution-cpu-success/README.md) passed independent and root audits: 131 focused controls and three finite xv6 scenarios. All twelve enabled exact-head checks passed with only two declared optional skips. The separate [draft PR483 connected far-reload source](https://github.com/CrispStrobe/bw-board/pull/483), reviewed `72d0b32e8bd7d658447745129119e2300ad6bec1`, is published: eight new paths / 224 roles / 64 recursive JS nodes, root/independent source and CPU-free controls passed. Its bounded grader joins two committed task transfers, decoded PE clear/set and the adjacent source-issued CS ticket with full context agreement, while preserving strict frame refusal and null return. All ten enabled exact-head checks passed, with only two declared optional skips. Its single [far-reload original](receipts/2026-10-09-far-attribution-at-failure/README.md) failed with the frozen exact-two attribution grader refusing a bounded 15-transfer/15-mode-change tape; root and independent original audits passed within that failure boundary. The MOV CR0 steps 47/442 and source-issued EA step 443 are an observed prefix, not whole-tape qualification. Strict frame refusal and null return remain. The separate retained-original prefix audit now confirms all five source-record-consistent CR0/far triplets without qualifying the whole task-return chain. A later uncommitted step-1859 vector-14 fault fact does not establish servicing, cause or a CPU defect; the separately admitted fault-outcome connection is next after its CPU prerequisite qualifies. The frozen PR478 runner must not be reused for this changed source. Preserve frozen earlier results and strict frame rules.
3. Boot the [FreeDOS Boom package with Freedoom](https://www.ibiblio.org/pub/micro/pc-stuff/freedos/files/distributions/1.2/repos/html/en/games/boom/20220217.0/index.html); require level entry, visible frames, live input and a repeatable timedemo. Audit the package's component notices before redistribution. The [original Boom 2.02 documentation](https://github.com/rlsosborne/doom/blob/master/doc/boom.txt) specifies a 486DX/33 and 8 MiB minimum: review the exact binary and choose an explicit compatible application profile or a separately qualified 386 engine build. Do not treat this package as a strict 386DX/4 MiB qualification.
4. Use the [Norton-style QSORT application](https://github.com/sdancer75/DOS-GUI-Norton-Style) for text windows, keyboard and an actual guest mouse-driver response. `qsort/QSORT.EXE` at revision `e85a53dd0dac6d474da90bfc285675d6eb381a41` has SHA-256 `88e93682f1fe30a4e40aa77c01758e5b3b4d4f1c3b87cae337d209de42da9609`; it is acquired but **not executed or bundled**. A hardware packet alone cannot satisfy this application gate.

[DOS4GigaBytes](https://github.com/sdancer75/DOS4GigaBytes) is a secondary protected-memory mechanism probe, not an established DOS/4GW substitute. Shareware titles can extend the suite only after checking each archive's exact rights and obtaining a repeatable guest observation; keep nonredistributable assets private.

**First deliverable (reached for one client):** an authenticated fixture manifest and [bounded actual application result](I80386-DOS32A-OWNED-LE-RESULTS.md). **Completion gate for the wider suite:** each additional application needs bounded boot and interaction, followed by relevant CPU/device regressions. Do not advertise general application compatibility from one client.

### 7. Comparable RTx and physical calibration

**Repository:** bw-board. **Dependency:** an unchanged qualified workload/profile; can measure the JS baseline now.

Read [RTx platform scope](X86-RTX-PLATFORMS.md) and [10× performance plan](I80386-10X-PERFORMANCE.md). Measure VPS and GitHub CPU runs separately with exact host/CPU allocation, Node/toolchain, source, media and timing windows. CPU emulation does not acquire a GPU speedup merely by running on a GPU host. Additional platforms need an actual run; never fill their cells from a different host's results.

For the [same-workload xv6 paired run 37627659600](I80386-XV6-JS-PAIRED-RESULTS.md), each arm reports `163,891,880` functional machine cycles at configured 6 MHz: `163891880 / 6000000 = 27.315313333` simulated seconds. Divide by the seven-pair mean **whole-child wall** seconds (ordinary `6.609801972285717`, dispatcher `4.455912592`) for configured RTx. Arithmetic renormalization of that unchanged cycle count to 16 MHz uses `163891880 / 16000000 = 10.2432425` seconds, not a measured physical 386DX timing model.

| Headless xv6 path | Configured 6 MHz RTx | Same cycle count normalized to 16 MHz |
| --- | ---: | ---: |
| Ordinary JS | 4.132546398× | 1.549704899× |
| Opt-in protected32 dispatcher | 6.130127728× | 2.298797898× |

These are the same EPYC 9V45/four-logical-CPU, Node 20.20.2 GitHub measurements; they are distinct from the EPYC 7763 native empty-journal run. Physical 16 MHz 386DX performance remains unknown because the functional cycle accounting is not calibrated to that processor's instruction timings. A game timedemo and frame rate are separate acceptance measurements.

**First deliverable:** raw repeated baseline measurements and a table with unmeasured cells marked unmeasured. **Completion gate:** same-workload comparisons and explicit configured-clock definitions. A physical 16 MHz 386DX comparison additionally needs defensible cycle calibration or reference hardware timings. Keep configured RTx and physical calibration separate.

## Suggested dispatch

The lane 1 cold native performance decision is reached and fails adoption; lane 3 finite paged IRQ is reached. Assign one worker to measured functional-JS application costs and the free/owned extender suite, and one to direct GUI input and live CLI acceptance; a coordinator reviews exact source, invariants and original evidence. The [lane 2 clock-authority draft](https://github.com/CrispStrobe/bw-board/pull/423) remains an unconnected source-only model, with no performance integration authorized by the failed native gate. Frontend workers can take lanes 4–5 with explicit file ownership. Each accepted guest in lane 6 supplies a concrete regression workload. Stop each change at its own completion gate, publish the result and refresh this handoff rather than letting a long-running branch's SHAs become implicit authority.


The DPMI fault-outcome prerequisite is now [draft PR486](https://github.com/CrispStrobe/bw-board/pull/486)
at reviewed `33d53542aa4375f9eb4c3c508ecf9bc8b1bba0d9`: a separate default-off
recorder, twenty authored tests and a diagnostic README, with root/independent
static review passed. The [original hosted qualification](receipts/2026-10-09-pf-outcome-cpu/README.md)
passes root and independent audit: all twenty new tests, 131 related focused
controls and three finite free xv6 scenarios. All twelve enabled exact-head
checks passed, with only the two declared optional skips. Its next worker must
follow the [fault-outcome connection contract](I80386-DPMI-TASK-EXCURSION-LANE.md#separate-page-fault-delivery-outcome-source),
including the explicit pre-continuation arm gate and distinct attempted/committed
counter binding. The separately named [draft PR487 connection](https://github.com/CrispStrobe/bw-board/pull/487),
reviewed `6c342303f619035b5037426cef335d059628e3dc`, adds twelve paths with
238 admitted Git roles and 71 recursive JavaScript nodes. Coordinator and
independent source review and Python controls passed; JavaScript mock controls
are authored but were not run locally. The final grading correction preserves
disabled-delivery recorder facts while refusing positive PF-call credit. The
standalone prospective reader passed both reviews and five positive / 47
negative synthetic cases; its one-shot launch guard also passed both reviews.
All ten enabled exact-head checks passed before the label was applied once.
The [original run38023601004](receipts/2026-10-10-pf-connected-control-failure/README.md)
failed in mock controls before guest execution; both original audits pass
within that refusal boundary. First qualify corrected arm/continuation mock
ordering in a separately named hosted control-only gate, then develop a new
source-admitted connected profile. Do not rerun or relabel the original. No PF
report or frame-return result exists.

The next admitted profiles are [PR492](https://github.com/CrispStrobe/bw-board/pull/492) (PF mock-corrected, four new files / 243 roles / 71 import nodes) and [PR491](https://github.com/CrispStrobe/bw-board/pull/491) (target-site support, ten new files / 84 roles, 74 held). Both pass coordinator/independent source review and CPU-free controls. The PF mocks have separate hosted control-only qualification; both profiles have independently reviewed prospective readers and one-shot guards. The PF guard also binds the prior hosted-mock audit receipts. Require all enabled exact-head checks before their distinct labels are applied once. At that prepared-source checkpoint, neither new profile had an actual result; preserve the failed originals and their unqualified boundaries.

The next DPMI worker must follow the [conditional post-PF implementation gate](I80386-DPMI-TASK-EXCURSION-LANE.md#next-implementation-gate-after-the-connected-pf-result): correct a pre-guest failure narrowly, or audit the same-session PF call before developing a separately qualified post-PF continuation observer. The existing runner drains its private token; a returned report cannot authorize extra guest steps. The CPU-only prerequisite is now published below; the connected continuation and frame return remain proposed.

The prepared originals have now completed: [PR492 PF call](receipts/2026-10-11-pf-mock-fixed-call/README.md) establishes a finite returned, non-shutdown delivery call under preserved strict failure; [PR491 target-site support](receipts/2026-10-11-target-site-support-failure/README.md) fails its first minor case with no observed weak callbacks. Both pass independent original-byte audits within these boundaries. Next source lanes are the default-off private post-PF handoff prerequisite and a separately named zero-prior-GC sampler fixture. The post-PF CPU prerequisite is published in [draft PR494](https://github.com/CrispStrobe/bw-board/pull/494), source `b9fe9370ff61472a310587fc311bf6004a0a5742`, with coordinator/independent static reviews passed. Its [first hosted result](receipts/2026-10-11-post-pf-cpu-first-failure/README.md) failed six IRQ fixture controls before xv6; the test-only incoming-task IF repair is pushed. Its [corrected original38145633988](receipts/2026-10-11-post-pf-cpu-corrected-success/README.md) passes both original-byte audits, current/historical controls and three finite free xv6 regressions; all twelve enabled exact-head source checks now pass, opening the separately reviewed connection source preparation. Follow its [source checkpoint and next acceptance gate](I80386-DPMI-TASK-EXCURSION-LANE.md#post-pf-cpu-source-prerequisite-checkpoint). Actual post-PF guest continuation and the sampler fixture remain unqualified.

The separately named sampler fixture is now [draft PR493](https://github.com/CrispStrobe/bw-board/pull/493), exact `79f1f13b6037265785e18342ca06b04eec2ab475`, with six new paths and reviewed PR-only hosted mock controls. Its [single hosted mock original38121297221](receipts/2026-10-11-nursery-mock-controls/README.md) and both original-byte audits pass; all eleven enabled source checks have passed, with only the two declared optional skips. No actual GC fixture/support result exists. Follow its [source checkpoint contract](I80386-XV6-JS-ROLLBACK-DIRECT-V8-PLAN.md#zero-prior-gc-fixture-source-checkpoint) before developing a new connected support profile.


The separately named nursery support runner is now [draft PR495](https://github.com/CrispStrobe/bw-board/pull/495), source `52f418a9b82e8355a12de053e3498adcc0bc00c1`: ten new paths, 90 held/100 total roles, static source review and four Python synthetic suites passed. The [first hosted mock](receipts/2026-10-11-nursery-support-mock-first-failure/README.md) failed a redundant Git transfer before controls; workflow-only fix `21eef8f700132f2df90564fbf3661467a2275b64` is pushed; the [corrected mock original38147244263](receipts/2026-10-11-nursery-support-corrected-mock/README.md) passes both original-byte audits. All eleven enabled exact-head source checks pass, with only the three declared optional/label-only skips. The prospective reader now passes coordinator and independent review plus 13 stdlib synthetic controls, and its exact-source manifest is frozen; the separately reviewed one-shot guard is now sealed after complete official census and exact-source verification. After the missing-label refusal and independently reviewed single-use recovery, the first successful application launched [original38151633427](https://github.com/CrispStrobe/bw-board/actions/runs/38151633427), now failed before compilation or support cases. Follow the [support source checkpoint](I80386-XV6-JS-ROLLBACK-DIRECT-V8-PLAN.md#nursery-support-runner-source-checkpoint); retain and independently audit its single original packet; do not rerun or relabel it. No actual fixture result or performance gain exists.


The post-PF connection is now published as [draft PR497](https://github.com/CrispStrobe/bw-board/pull/497),
exact `b3abd80ba462f4319c9a635088604a6b9f8421c9`: twelve new paths,
278 unchanged/290 total roles and 181 JavaScript graph nodes. Static reviews
and Python controls pass; its first hosted mock failed in the positive grader fixture, and remaining
source checks are pending. Follow the [connected observer next-worker contract](I80386-DPMI-TASK-EXCURSION-LANE.md#post-pf-connected-observer-source-checkpoint)
for the standalone original reader, failure controls and one-shot launch guard.
No connected guest run, frame return, new OS result or speed claim exists yet.


The first originals are preserved: [sampler staging38151633427](receipts/2026-10-11-nursery-support-first-actual/README.md)
failed at the executable file-size cap before build/cases; [post-PF mock38151969796](receipts/2026-10-11-post-pf-connected-first-mock/README.md)
passed source/orchestration controls before its positive fixture omitted a
required false ownership fact. Both original-byte audits pass within these
failure boundaries. Next qualify the scoped staging-cap correction and the
one-line fixture repair at new exact sources, then prepare the independent
readers and one-shot guards. Preserve both originals; neither supplies guest
completion, frame acceptance or a speed measurement.


The fixture-only repair is now [draft PR498](https://github.com/CrispStrobe/bw-board/pull/498),
exact `79dfbd223a579bd9aba43be39e8ebdbb046eea5c`, with coordinator and
independent static reviews passed. Its [corrected mock failed at a frozen-result
negative-fixture mutation](receipts/2026-10-11-post-pf-corrected-mock/README.md).
Preserve both originals. The one-assignment mutable manufactured replacement
is now [draft PR500](https://github.com/CrispStrobe/bw-board/pull/500), exact
`e1f44e70bd21e4f3b146d0c0e00da141eb045182`; both static reviews pass. Its
[automatic mock passed its synthetic controls](receipts/2026-10-11-post-pf-mutability-corrected-mock/README.md);
all eleven enabled source checks now pass, with three declared skips. Actual observer execution stays disabled until
the independent reader, source freeze and one-shot guard qualify.


The scoped sampler staging repair is now [draft PR499](https://github.com/CrispStrobe/bw-board/pull/499),
exact `3a0e595c7b813a753fd79c436bfafe2c20cea690`: three reviewed paths,
finite executable-only soft-limit change and unchanged raw-result acceptance.
The [corrected mock original passed both audits](receipts/2026-10-11-nursery-staging-corrected-mock/README.md);
all11 enabled source checks passed. The reader and constant-only guard bindings
are frozen after both reviews; revised metadata normalization passed nine groups.
Two fresh complete authenticated captures admitted the one-shot handoff.
[Actual run38158179633](https://github.com/CrispStrobe/bw-board/actions/runs/38158179633)
completed successfully at the same source, attempt1. Its
[original artifact and both audits](receipts/2026-10-11-nursery-staging-actual-support/README.md)
qualify the finite four-case sampler fixture only. Next connect a separately
reviewed profile to actual guest allocation sites before a paired workload
measurement; no guest, speed or default adoption follows. Follow
the [staging correction acceptance contract](I80386-XV6-JS-ROLLBACK-DIRECT-V8-PLAN.md#nursery-support-original-binary-staging-cap-mismatch)
for the new source freeze, reader and one-shot guard. Verify the opt-in label
exists before consuming launch authority; do not alter the original failed
packet or reuse its consumed state.


The next reader checkpoint has a finite independently recomputed held PF
predicate draft: ten manufactured control methods and six coordinator
adversaries pass. Complete peer review and the remaining compile/input,
post-PF raw-record and failure-stage contracts in the
[reader implementation checkpoint](I80386-DPMI-TASK-EXCURSION-LANE.md#reader-implementation-checkpoint).
Initial receipts cannot substitute for absent final leases. This does not
qualify a connected guest run, frame return, an OS or a speed increase.


## Unconnected source units and concrete next work

Two separately reviewed source units are published as drafts, stacked on their
held prerequisite branches. Neither changes the CPU, guest runner, GUI package
pin or default behavior. Hosted controls are pending; do not treat the drafts
as integrated compatibility or performance improvements.

- [PR501](https://github.com/CrispStrobe/bw-board/pull/501), source
  `6a546e19350e013d69f7f5b236a7a64c08115a39`, adds the
  [guest snapshot cohort seam](https://github.com/CrispStrobe/bw-board/blob/6a546e19350e013d69f7f5b236a7a64c08115a39/scripts/xv6-js-rollback-direct-v8-guest-site-cohort/README.md).
  It preserves the original method call and privately captures at most64 roots,
  with descriptor ownership, reentry and once-only extraction fences. Eighteen
  synthetic tests are authored; independent static source and final-test review
  passed. The new PR workflow runs only synthetic objects, not a CPU or guest.
- [PR502](https://github.com/CrispStrobe/bw-board/pull/502), source
  `f04f4e8dd9d30cc0439e78ed801fb26c3027adf3`, adds
  [fixed tool boundary receipts](https://github.com/CrispStrobe/bw-board/blob/f04f4e8dd9d30cc0439e78ed801fb26c3027adf3/scripts/i80386-cwsdpmi-0501-boundary-receipts/README.md).
  Fifteen manufactured filesystem controls and three independent adversaries
  passed. The unit observes nine fixed roles and preserves bounded partial
  diagnostics; it neither executes nor modifies the held compiler helper.
  Serialized pair consistency is not live-session or continuous-identity proof.

Work these tasks in order within each lane:

1. **Qualify each source unit.** Audit its one automatic hosted control artifact
   against the exact source and declared file envelope. Preserve failures; a
   correction needs a new source result. Require every enabled exact-head check
   before any merge, and retain the draft's held prerequisite and attribution.
2. **Compiler receipt connection.** Derive a separately named profile from PR500
   and PR502. Admit the canonical supplied root before tool observations, place
   receipts outside it, connect before-probe and after-link/failure observations,
   and retain the original compiler failure when diagnostic writing fails.
   Sanitize writer errors into fixed codes. Add independent typed validation,
   bounded input observations and failure controls before freezing the reader.
   Final tool observations alone do not close final input filesystem identity.
3. **Guest-site connection.** Derive a separate profile from PR499 and PR501.
   Authenticate exact CPU/source/live instance before installing the seam, then
   capture actual rollback roots while preserving callback/reset fences. Retain
   unarmed nursery admission, all64 weak callbacks and exact sample-lifetime
   predicates in four fresh guest children. Compare the complete reported
   CPU/RAM/disk/serial/input/IRQ/device outcomes against a fresh ordinary free
   xv6 reference. No connected launch is authorized by a synthetic seam result.
4. **Measure only after parity.** Run paired unchanged-workload timing after the
   connected sampler qualifies; distinguish nested snapshot allocations from
   returned root objects. Report sampling overhead and configured-clock RTx
   with actual host/runtime information. No new RTx is available at this point.

The post-PF reader remains a finite, unintegrated diagnostic validator. Its
held-PF, post-PF, partial compile/input and failure-stage controls have separate
reviews. A further finite reported MZ/COFF extent check passes seven manufactured
methods and eight peer adversaries; this does not inspect binary bytes or close
archive, implicit-input, environment or final filesystem admission. Keep full
compile/input, frame-return and launch qualification false until those gates
actually close. These tasks precede broader protected-mode application claims.


### Connection preparation checkpoint

Preparation for the next connections is now published separately, without
enabling production or adopting either prerequisite source unit:

- [Draft PR503](https://github.com/CrispStrobe/bw-board/pull/503), exact
  `4badb1905033d58d14e9e2f19fc589b708259a10`, contains the
  [disabled compiler phase preparation](https://github.com/CrispStrobe/bw-board/blob/4badb1905033d58d14e9e2f19fc589b708259a10/scripts/i80386-cwsdpmi-compile-tool-boundary/README.md).
  Nine manufactured phase methods and three independent adversaries pass at
  final source. Root review caught a malformed intermediate edit; the corrected
  final source passes its AST/control checks. Secondary diagnostic failures
  cannot replace the original error, and illegal order forbids later callbacks.
  The compiler raises unconditionally before loading helpers or making output.
  The descriptor-route owner is now prepared in PR505 below. Next admit its
  caller-supplied workspace roots and exclusive output files, then connect pair
  validation and bounded input observations. Existing diagnostic reads are partial, not
  complete filesystem admission. Do not remove the production disable until
  source, input, reader and reviewed launch gates close.
- [Draft PR504](https://github.com/CrispStrobe/bw-board/pull/504), exact
  `98d4d16a161bf8bf587d45eeed793997b4806fc4`, contains the
  [synthetic guest-site controller](https://github.com/CrispStrobe/bw-board/blob/98d4d16a161bf8bf587d45eeed793997b4806fc4/scripts/xv6-js-rollback-direct-v8-guest-site-controller/README.md).
  Nineteen tests are authored and locally unrun; independent static source/test
  review passes. Closed own-key/descriptor fences, private cohort cleanup and
  board/stop invocation accounting address the review findings. No Node or
  guest has executed for this slice. Next qualify the synthetic controls, then
  provide an exact-source-owned machine/reset/callback factory and genuine
  event-loop/pressure ports in a separately admitted driver. Full guest outcomes,
  weak sample predicates and resource limits still need independent acceptance.

PR503 is stacked on PR502; PR504 is stacked on PR501. Each adds only its lane
claim and new preparation paths. Normal hosted checks and prerequisite pure
controls remain pending. Preserve the original sampler support result; do not
replay it to qualify these new sources. No new guest, frame-return, RTx, default
or GUI package result follows from this preparation checkpoint.

### Root-route and runtime-port source checkpoint

Two further unconnected draft units are published:

- [PR505](https://github.com/CrispStrobe/bw-board/pull/505), exact
  `6f6f1babc5f19a043bb0fe12dc079b3e75830fc5`, adds
  `scripts/i80386-cwsdpmi-compile-root-routes/`. Thirteen manufactured
  filesystem methods pass with independent review. Bounded no-follow ancestor
  observations retain descriptors, reject evidence routes inside the tool tree,
  preserve the first refusal and report uncertain cleanup. They do not certify
  caller root ownership, continuous identity or output-file admission.
- [PR506](https://github.com/CrispStrobe/bw-board/pull/506), exact
  `2275fc5eb9d0c27a197a5256239cbbefa8d8cabe`, adds
  `scripts/xv6-js-rollback-direct-v8-guest-site-runtime/` and
  `test/xv6-guest-site-runtime.test.mjs`. Root and independent static review pass;
  sixteen authored tests remain locally unrun, but now pass in the independently
  audited [original hosted CI report](receipts/2026-10-11-runtime-source-controls/README.md).
  Captured turn and private pressure
  mechanics reject injection and preserve original scheduling failures. Runtime,
  source-instance and guest qualification remain false.

PR505 is stacked on PR503; PR506 is stacked on PR504. They do not change the
held producer, controller, default execution path or GUI dependency pin.
The prerequisite pure-control runs
[38161363012](https://github.com/CrispStrobe/bw-board/actions/runs/38161363012) and
[38161385871](https://github.com/CrispStrobe/bw-board/actions/runs/38161385871)
subsequently passed at their original attempt-1 heads. The
[retained source-control originals](receipts/2026-10-11-source-unit-controls/README.md)
record 18 cohort and 15 tool-boundary tests. No duplicate run was launched.
These finite synthetic results do not qualify PR503–PR506 or a later connection;
refresh all enabled exact-head checks before any merge.

The next bounded work is:

1. **Compiler workspace and writer admission:** in a separately named profile,
   establish source-owned tool/evidence roots and connect the prepared PR507
   writer below. Admit parent context and complete input-alias checks; existing
   route/writer observations cannot grant those facts.
   Connect pair validation and final input observations only after those controls
   pass. Keep the production compiler's unconditional disable.
2. **Runtime controls and driver admission:** hosted synthetic runtime controls
   now pass. Build the exact-source machine/reset/callback factory and connect the
   controller to admitted turn/pressure ports. Retain designated-GC, root-lifetime,
   sample ancestry, full parity and resource acceptance; helper mechanics alone
   cannot grant those facts.
3. **Original-result reader:** the two prerequisite artifacts are retained once
   and their finite original reports pass root and independent admission. Use
   separately frozen admission for later source heads.
   Preserve failures and the earlier sampler support boundary. Do not replay
   the sampler or grant post-PF frame return from workflow success.

No new guest completion, frame return or measured RTx follows from these units.

### Retained-descriptor writer checkpoint

[Draft PR507](https://github.com/CrispStrobe/bw-board/pull/507), exact
`26c50cd43a28a8d357206bc9ab2b4ad2b421f00b`, adds only
`scripts/i80386-cwsdpmi-evidence-descriptor-writer/` and its lane claim, stacked
on PR505. Root and independent review pass; sixteen manufactured filesystem
methods and two additional independent boundary adversaries pass. The unit
privately composes the exact root-route source and writes fixed diagnostic
names through its retained evidence-directory descriptor. Exclusive no-follow
creation, bounded short writes/readback, named identity/extent and route checks
refuse collisions, aliases, content tampering and reentry. The original write
failure is latched before cleanup; close uncertainty remains recorded.

This prepares diagnostic output mechanics only. Payloads are reported bytes,
not admitted compiler receipts. Source-owned workspace creation, complete input
alias admission, continuous identity and compilation remain unqualified. The
production compiler stays unconditionally disabled. Hosted controls for this
new unit and every enabled final-head check remain required before integration.

The workspace creator described here is now prepared in PR508 below. These
were its source-only acceptance requirements:

- Own the parent route internally after separate parent-context admission;
  choose one private session name and create exactly a session directory plus
  `tool` and `evidence` siblings using descriptor-relative operations.
- Bound creation to three directory attempts with no alternate-parent or name
  retry; retain partial creation and identity facts on refusal. Keep handoff to
  the route/writer internal, without accepting or returning public raw FDs.
- Test parent replacement/symlinks, collisions, reentry, second-child failure,
  sibling identity aliases, close uncertainty and repeated/stale handoff.
  Cleanup must preserve foreign, replaced and nonempty directories.
- Record finite source actions separately from parent trust, OS/mount integrity
  and runtime/source admission. Do not copy tools, extract archives, compile
  clients or enable production merely to exercise the creation controls.

After creation controls qualify, connect workspace, route and writer ownership
in a separate profile, then close pair/input observations and the independent
reader. No new guest, frame-return or performance claim follows from PR507.

### Workspace creator checkpoint and connection work

[Draft PR508](https://github.com/CrispStrobe/bw-board/pull/508), exact
`a3f4e0c2e6b5132bc91adb161365dcdc49213c5a`, adds only
`scripts/i80386-cwsdpmi-workspace-creator/` and its lane claim, stacked on PR507.
Root and independent source review pass; fifteen manufactured filesystem methods
and two additional independent adversaries pass. The creator generates one
private session name, consumes at most three descriptor-relative directory
attempts, checks bounded parent/created routes, and preserves partial artifacts
and uncertain cleanup. It implements no deletion, rollback or writer handoff.

Post-mkdir identities are named/held observations. Because mkdir returns no
inode or descriptor, replacement before the first observation can be
indistinguishable; those identities do not prove which inode the call created.
The authored control preserves this boundary. Parent trust, source ownership,
continuous identity and compiler qualification remain false. The
[original hosted four-unit controls](receipts/2026-10-12-workspace-source-controls/README.md)
now pass at their pinned source; ordinary CI success alone must not be described
as executing other standalone Python methods.

Next implement the separately reviewed connection, with these entry points:

1. Freeze exact source roles for the creator, route owner, evidence writer and
   compiler phase owner; qualify their standalone controls on the hosted runner
   without compiling a client or launching a guest.
2. Admit the parent/source context in the owning profile. Join the creator's
   retained private directory context to the exact route/writer composition
   once, without caller-supplied FDs, paths, callbacks or manufactured authority.
   Keep creation observations distinct from parent/context trust.
3. Test stale/repeated handoff, creation/route replacement, observer reentry,
   original-error retention and ownership/close ordering. Preserve every partial
   output; the writer must finish before terminal route cleanup closes its FD.
4. Only then connect pair and final input observations, the independent reader,
   format/archive/environment/media gates and the separately reviewed launch.
   Keep the production compiler disabled until all required gates close.

PR506's separately audited hosted synthetic runtime controls passed at their own
source. They do not qualify this workspace connection or a live guest driver.
No new guest completion, post-PF frame return, default adoption or RTx is claimed.

### Hosted four-unit control profile

[Draft PR509](https://github.com/CrispStrobe/bw-board/pull/509), exact
`0c3b43c1e99403d87622748a2171a23824fad5ce`, adds
`scripts/i80386-workspace-source-controls/` and
`.github/workflows/i80386-workspace-source-controls.yml`, stacked on PR508.
Root and independent review pass. Seven manufactured admission methods and an
independent file-replacement adversary pass. The sole automatic attempt-1
[source-control run38173075353](https://github.com/CrispStrobe/bw-board/actions/runs/38173075353)
passed all 53 methods and six job steps. Coordinator and independent original-byte
audits pass; see the
[closed original receipt](receipts/2026-10-12-workspace-source-controls/README.md).
No manual dispatch, duplicate run or replay was used.

The job admits thirteen immutable unit paths and three profile paths, then runs
phase9, route13, writer16 and creator15 methods in isolated Python. Pinned
actions, Ubuntu24.04, bounded Git/file reads, per-stage timeouts, core/file limits
and ten fixed text artifact roles preserve complete or failed phases. It does
not compile a client, import the disabled compiler, copy tools, launch a guest
or grant parent/workspace/source authority. The original source, job, inventory
and full four-suite reports are now independently audited. Preserve that
standalone result; later composition needs its own exact-source qualification.

The next handoff should privately compose the exact creator, route and writer
revisions rather than reopening paths:

- Admit the parent context separately. Bound parent paths to30 components and
  4046 UTF-8 bytes before creation; the generated session/evidence suffix must
  still fit the existing route owner's32-component/4096-byte limit.
- Retain the creator's parent/session/tool/evidence rows. Seed the fresh private
  route owner's two chains with those rows, sharing ancestors but retaining one
  unique descriptor ownership ledger. Prove that the before phase opens no
  replacement route descriptors.
- Prepare and validate every chain copy and private state binding before
  transferring ownership once. Test interrupted transfer, allocation failures,
  stale/repeated use and unique cleanup; never let both owners close the same FD.
  Return no creator, route, writer, caller FD, path or source ticket.
- Poison the active inner owner immediately on outer reentry, so swallowed
  status/close callbacks cannot allow further mkdir/stat/write/read calls.
  Test this during creation, route checks and writer readback.
- Keep the first-observation replacement limit and all parent/source authority
  refusals. Preserve partial creation/output; write before terminal route cleanup.
  Pair/input/reader and reviewed launch gates follow separately.

The retained-descriptor source unit is published as
[draft PR510](https://github.com/CrispStrobe/bw-board/pull/510) at exact source
`ffb413624f4814f906d22129b7e0aa85ca145a5b`, under
`scripts/i80386-cwsdpmi-owned-workspace-evidence/`. Coordinator and independent
source review pass, together with all 23 manufactured filesystem methods and
three independent registration/cleanup/transfer adversaries. These are local
finite controls. The [original hosted composition controls](receipts/2026-10-12-owned-workspace-controls/README.md)
now pass at their pinned source, with coordinator and independent original-byte
audits. The acceptance items above remain the contract for later integration.
Production compilation remains disabled; no guest or speed claim follows.


### Retained composition checkpoint and next qualification

The parent-only `OwnedWorkspaceEvidence(parent)` API first calls `prepare()`,
then `before(bytes)` and exactly one `terminal('after-link' | 'failure-final',
bytes)`. It returns bounded status facts, without transferring raw descriptors,
paths, callbacks or inner owners. Both seeded route chains retain the creator's
directory handles. One canonical ledger owns at most 34 unique directory handles;
writer output close accounting stays separate. Terminal writing precedes route
release, and cleanup preserves the first operation failure and uncertain close
outcomes. Partial directories and files remain present.

Controls include a real 30-component / 4,046-byte parent with all 34 retained
handles and both writes, valid 31-component / 4,047-byte refusal, session
replacement before output, exclusive-file preservation, and reentry during
mkdir/open/route checks/write/readback/terminal cleanup. Interrupted registration,
creator append, preparation and transfer recovery are tested at specific points;
this does not establish safety at every Python bytecode or authenticate parent,
loader, mount or runtime source authority. The post-mkdir first-observation
substitution limitation remains. All authority/compiler/guest/performance flags
remain false; no product path or dependency pin adopts this unit.

[Draft PR511](https://github.com/CrispStrobe/bw-board/pull/511), exact source
`2e185b4b8732957783958500183e3863c8047216`, publishes
`scripts/i80386-owned-workspace-source-controls/` and its dedicated workflow.
Coordinator and independent source review and seven manufactured admission
methods pass. Twelve fixed creator/route/writer/composition roles and three
profile roles bind the exact own PR head. One automatic attempt-1 job runs only
the 23 composition methods, with bounded isolated Python and four fixed text
artifact roles. Its sole [run38199386713](https://github.com/CrispStrobe/bw-board/actions/runs/38199386713)
passed all 23 methods and six job steps. All eleven enabled exact-head checks
passed, with only two declared optional vectors-full skips. Coordinator and
independent audits pass for the [original four-member receipt](receipts/2026-10-12-owned-workspace-controls/README.md).
No manual dispatch, duplicate or replay was used. Preserve both this composition
original and the earlier standalone run38173075353; later integration needs
its own exact-source qualification. Next close the owning profile's
source/input/pair/reader/format/archive/environment/media and launch gates.
Production compilation stays disabled throughout this source checkpoint.


### Retained fixed-role tool observation

The source-only preparation is published in
[PR512](https://github.com/CrispStrobe/bw-board/pull/512), exact head
`473b90ea27529e576775ae5864a7fd2a4f3f9237`, under
`scripts/i80386-cwsdpmi-retained-tool-observer/`. The earlier fixed-tool observer
reopens its supplied root by pathname; the qualified workspace composition
retains directory handles but writes supplied bytes. The new observer supplies that missing retained-root observation seam.

The unit supplies a parent-only factory that privately creates the pinned
workspace owner, then observes the nine fixed tool roles through its retained tool handle.
Expose no caller descriptor, root, pin, receipt or provisioning callback. Walk
only fixed relative paths with no-follow directory/file checks, bounded reads,
exact hashes and before/opened/after/named metadata fences. Reserve each known
file extent before opening or reading content: at most 16 MiB per role and
64 MiB per observation. Recheck the full retained route around observations;
temporary handles have separate bounded close-once ownership, and the borrowed
root is never closed by the observer.

Write only internally issued, closed complete or partial receipts, at most
32 KiB, through the existing evidence owner. Validate a complete pair from
private same-session, same-source, correctly ordered nine-role observations,
without accepting caller dictionaries. An empty new tool directory must refuse
the first missing role. Preserve that original exception and partial prefix;
healthy routes may permit fixed before/failure diagnostics without a second
tool observation. Fresh reentry immediately poisons active inner owners and
permits cleanup only. Secondary diagnostics or cleanup never replace the
original failure, retry a consumed output or credit a complete pair.

All 28 manufactured controls passed locally, with independent source review
and two additional independent adversaries. They cover retained-root use, hash/extent/
aggregate limits, swaps and aliases, changed pairs, strict schemas/phases,
read/open/close/writer reentry, interrupted local ownership and uncertain cleanup.
Positive test fixtures use explicitly synthetic files/pins through private test
access; they do not qualify actual tool bytes or archive materialization.
Source review must preserve the disabled compiler and all held helper bytes.
The [original PR514 observer result](receipts/2026-10-12-retained-tool-controls/README.md)
now qualifies all 28 synthetic controls with independent packet review. The
earlier 23-method original qualifies only the workspace composition.
Parent/source ownership, implicit compiler inputs, archives, environment, binary
formats, media, reader and actual launch remain external gates; there is no
compiler, guest, default-adoption or performance qualification in this unit.

### Hosted retained-observer source-control profile

[PR514](https://github.com/CrispStrobe/bw-board/pull/514), exact source
`3dd5092128996733f3f71c0ec640f2126010dea8`, supplies the next hosted
qualification step under `scripts/i80386-retained-tool-source-controls/` and
`.github/workflows/i80386-retained-tool-source-controls.yml`. Fifteen fixed
dependency and observer paths plus three profile paths bind exact Git/live
bytes. Nine manufactured admission controls and independent review passed.
The bounded own-repository, exact-head, attempt-one PR job runs only the
28 observer controls and retains four text reports. It has no manual-dispatch
entry and changes no inherited profile, helper, compiler or consumer pin.

The sole attempt-one [run38207264678](https://github.com/CrispStrobe/bw-board/actions/runs/38207264678)
passed all 28 controls. Frozen reader/job admission and a separate original-byte
review verified the four-member artifact, exact source report and all 18 Git
roles. [The public receipt](receipts/2026-10-12-retained-tool-controls/README.md)
retains original reports and official origins. All eleven enabled exact-head
checks passed, with only two declared optional vectors-full skips. This finite
synthetic result qualifies neither actual tools nor later integration. Preserve
the sole original; do not replay or reacquire it to read the evidence.
Next proceed to the input/archive,
implicit environment, compiler process, output formats, media, full reader and
launch integration gates. The production compiler remains disabled; no new
actual-tool, guest, performance or default-adoption result is claimed.

### Selected-role materialization and the next integration gates

[PR515](https://github.com/CrispStrobe/bw-board/pull/515), exact source
`a5fd036bda8b34ed8c50551713b4f0ecca219d20`, adds
`scripts/i80386-cwsdpmi-retained-tool-materializer/`. Its parent-only owner
authenticates four fixed immutable archive byte inputs before parsing or workspace
preparation, inventories a bounded strict TAR/ZIP subset, joins four runtime
roles to their source archive and writes only the nine selected files through
retained directory handles. All 31 manufactured controls passed with independent
review. The original hosted controls also passed; actual archives remain
unqualified.

The parser rejects unsafe or conflicting names, unsupported members, truncated
or concatenated streams and inventory-count drift. Selected extents are reserved
before content reads; the aggregate decoded budget includes headers, padding,
tails and ZIP envelopes. Cleanup uncertainty includes nested directory and
evidence-output ownership. Closing prevents later authentication or parsing.
Notice facts are bounded counts/hashes with explicit omissions, not retained
notices or redistribution clearance. Immutable input bytes are not filesystem
leases; nine selected files are not a complete toolchain. Production compilation
remains disabled, and this source checkpoint changes no defaults or consumer pins.

[PR517](https://github.com/CrispStrobe/bw-board/pull/517), exact source
`7fcfec51cc4fd25ee5959e54ae4c99a4c3480a7e`, adds the separate
`scripts/i80386-cwsdpmi-fixed-alias-materializer/` derivative. Its fixed table
admits exactly thirteen reported alias headers only after eleven ordinary
file targets match pinned extents/hashes. No physical links or alias files are
created. Root and independent reviews passed all 42 manufactured controls,
including per-alias omissions, duplicates and changed targets; independent
alias-parent and self-target adversaries also refused before preparation.
The original report supplies normalized inventory facts, with no raw archive
body or proof of header spelling. Hosted derivative controls also passed, as recorded below. Actual archive
compatibility and complete toolchain provisioning remain unqualified.

The ordered follow-up tasks are:

1. **Hosted materializer controls.** The profile is published in
   [PR516](https://github.com/CrispStrobe/bw-board/pull/516), exact head
   `5b670bee8a8f2da149f8ab30e825c13370d56762`, under
   `scripts/i80386-retained-materializer-source-controls/` and its matching
   workflow. Nine manufactured admission controls and independent review passed;
   the sole attempt-one [run38215450971](https://github.com/CrispStrobe/bw-board/actions/runs/38215450971)
   passed all 31 controls. The [original receipt](receipts/2026-10-12-retained-materializer-controls/README.md)
   retains four byte-exact reports and official origins; frozen reader and job
   admission and independent original-byte review passed. It supplies a bounded own-repository,
   exact-head, attempt-one source-control profile. It freezes the eighteen unit paths
   (creator, routes, writer, workspace composition, observer and materializer)
   plus three profile paths; it runs only the 31 manufactured controls. Independently
   freeze the original-result reader before acquisition. Accept only the original
   complete transcript, exact Git/live role hashes, closed text artifact and
   successful official job steps. Preserve earlier observer receipts unchanged.
   The derivative's separate hosted profile is now published in
   [PR518](https://github.com/CrispStrobe/bw-board/pull/518), exact head
   `5d05e17d6c11cf6a901fce85bf880f13e7eb55ac`, under
   `scripts/i80386-fixed-alias-source-controls/` and its matching workflow.
   Twenty-one immutable unit roles plus three profile roles bind the 42-control
   suite. Nine manufactured admission controls and independent review passed;
   the sole attempt-one [run38217466511](https://github.com/CrispStrobe/bw-board/actions/runs/38217466511)
   passed all 42 controls. The [original receipt](receipts/2026-10-12-fixed-alias-controls/README.md)
   preserves four byte-exact reports and official origins. Frozen-reader,
   separate job admission and independent raw-original audits passed, binding
   all twenty-four source roles. General CI checks remain a separate integration
   gate; the finite synthetic result does not qualify actual archives.
2. **Actual archive materialization only.** First close the known alias blocker:
   the [retained acquisition inventory](receipts/2026-10-12-tool-archive-alias-inventory/README.md)
   reports thirteen hard-link aliases, rejected by the current strict parser.
   PR517 supplies the fixed-alias source revision. Its acceptance must be qualified
   against actual inputs before it can admit exactly those metadata rows and
   their already observed ordinary targets with pinned extents/hashes, create
   no links or alias outputs, and preserve all nine selected files as single-link
   files. Reject unexpected, missing, repeated or changed alias/target rows.
   Then qualify the revised parser against the
   four pinned public tool/source archives without invoking any executable. Reuse
   retained original inventories where available; new qualification must bind its
   own source and inputs. Prepare a bounded runner that retains the two raw
   nine-role observations and materialize/close statuses from the same private
   instance. [PR519](https://github.com/CrispStrobe/bw-board/pull/519), exact source
   `91cc44717820e0b02efd7a31b4384d98b1025590`, supplies this source preparation
   in `scripts/i80386-cwsdpmi-fixed-archive-materialization/`. Root and independent
   review passed all 22 manufactured controls, with additional Boolean-count and
   swallowed-reentry refusals. It consumes one materialization/capture/close
   attempt, requires two valid complete nine-role reports before completion,
   and preserves the original error through secondary observation/cleanup failures.
   Reports are source-reserialized content, not original writer bytes. The
   disabled compiler is inspected by source hash/AST only; there is no fetch,
   CLI, subprocess or tool launch. [PR520](https://github.com/CrispStrobe/bw-board/pull/520),
   exact head `bdd2f33545f12e9b9ce8551af42d44a8e7b3ce5d`, supplies the separate
   `scripts/i80386-materialization-runner-source-controls/` hosted profile:
   twenty-five fixed unit/compiler-source paths plus three profile paths, running
   only the 22 manufactured controls. Nine admission controls and independent
   review passed. Its sole attempt-one [run38222745175](https://github.com/CrispStrobe/bw-board/actions/runs/38222745175)
   passed all 22 controls, and all eleven enabled exact-head checks passed with
   two declared optional vectors-full skips. The [original receipt](receipts/2026-10-12-materialization-runner-controls/README.md)
   retains four byte-exact reports and official origins. Frozen-reader, separate
   job admission and independent raw-original/Git audits passed, binding all
   twenty-eight source roles. The real acquisition adapter and independent
   original reader/launch gates remain unfinished. [PR521](https://github.com/CrispStrobe/bw-board/pull/521),
   exact source `9329da5b683563d85c6548f848a5f1f7141d5a6f`, prepares the acquisition
   adapter in `scripts/i80386-fixed-archive-acquisition/`. Root and independent
   reviews passed all 20 manufactured controls plus two independent HTTP-error
   reentry/absent-report adversaries. Four fixed public URLs, extents and hashes
   total 86,048,982 bytes; all authenticate before runner construction. Reads
   are bounded, redirects use a closed HTTPS policy, responses close once and
   original errors survive cleanup failures. An absent report remains absent.
   Inputs stay private in memory, with no archive staging or upload. The
   observed deadlines and byte limits are not hard process-memory/time guarantees.
   The first actual attempt failed before workspace creation or selected writes. [PR522](https://github.com/CrispStrobe/bw-board/pull/522),
   exact source `b281e779266f6d225d91a88750c85a36e858042e`, prepares the hosted
   profile in `scripts/i80386-fixed-archive-materialization-hosted/` and
   `.github/workflows/i80386-fixed-archive-materialization.yml`. Coordinator and
   independent review passed 20 manufactured admission/controller controls.
   Admission binds 28 unchanged inherited paths and four profile paths. An
   automatic job runs the adapter's 20 manufactured controls; a separate actual
   job admits only the applied `x86-fixed-archive-materialization` label and
   was initially **unarmed**. All eleven enabled exact-head source checks passed, with two
   declared optional vectors-full skips and the unarmed actual job skipped. Its
   sole attempt-one [run38237893493](https://github.com/CrispStrobe/bw-board/actions/runs/38237893493)
   passed all 20 synthetic controls. The [original receipt](receipts/2026-10-12-fixed-archive-acquisition-controls/README.md)
   retains five byte-exact text reports. Coordinator frozen-reader, separate
   official-job and independent raw-original/Git audits passed, binding all
   32 source roles. After independent reader and one-shot guard reviews, a fresh
   source and complete official-state census admitted one label application.
   The sole [actual run38253971654](https://github.com/CrispStrobe/bw-board/actions/runs/38253971654)
   **failed** at the same exact head; its actual job ran and its synthetic
   job skipped. The run identity was bound before original body acquisition.
   The [preserved failure receipt](receipts/2026-10-12-fixed-archive-materialization-failure/README.md)
   contains nine byte-exact text reports. Coordinator frozen-reader, official-job
   and independent raw-original/Git audits confirmed preservation of this
   unqualified result. All four input extents/hashes were reported authenticated
   before `archive-type`; zero workspace creation, selected writes or observations
   were reported. The precise refusing header/rule is absent from the report.
   GNU/PAX explanations remain hypotheses. Do not dispatch, relabel or rerun
   this head. Actual materialization, compiler, guest and performance remain
   unqualified. The next source revision must report bounded fixed reason/header
   ordinal, decoded offset, type byte and magic class without member names or
   archive bodies, preserving all acceptance rules and input pins. A future
   actual attempt requires separate reviewed source, frozen reader and one-shot
   launch state. [PR524](https://github.com/CrispStrobe/bw-board/pull/524), source
   `e5cbd37186aa9bf834be9fa1a6b4a9011e1acc69`, now prepares that diagnostic in
   `scripts/i80386-cwsdpmi-archive-refusal-diagnostic/` with v2 propagation and
   35-role source admission. Coordinator and independent source reviews passed
   30 combined manufactured controls, 22 runner controls and 20 admission/executor
   controls. TAR logic matches the held parser after removing diagnostic
   bookkeeping. Inherited name/canonical/BZ2 refusals remain unannotated. Exact-head
   prelaunch hosted checks passed: all 11 enabled checks succeeded, with two
   optional vectors-full skips and the initial unarmed actual-job skip. The automatic
   [run38266000394](https://github.com/CrispStrobe/bw-board/actions/runs/38266000394)
   passed its 30 controls; coordinator frozen-reader, official-job and independent
   raw-original/Git audits passed the
   [five-report original](receipts/2026-10-12-archive-refusal-diagnostic-controls/README.md),
   binding all 35 source roles. The actual job stayed skipped and unarmed.
   New control/actual readers and a separate one-shot guard passed manufactured
   review. Independent filled-bindings review and fresh source/complete official
   state checks admitted one diagnostic label application. The sole
   [actual run38276900168](https://github.com/CrispStrobe/bw-board/actions/runs/38276900168)
   failed at materialization. Its sole original passed frozen-reader and independent
   raw-original/Git preservation audits; the
   [negative receipt](receipts/2026-10-12-archive-refusal-diagnostic-failure/README.md)
   retains all nine text reports. The source reports GNU `L` at header 102,
   decoded offset 5,634,048; its type is rejected independently of mode. Input
   archive bodies were not retained, so this is not an independent header rehash.
   No workspace, selected write or observation was reported. Do not relabel,
   rerun or dispatch this consumed head. The bounded GNU `L` derivative is now
   published in [PR525](https://github.com/CrispStrobe/bw-board/pull/525), source
   `c9a22a1b173aa5f2fc41f8edf4a97a8fbfab5cc2`, in
   `scripts/i80386-cwsdpmi-gnu-longname-materializer/`. Coordinator and independent
   reviews passed 46 combined manufactured controls, 22 runner controls and 20
   admission/executor controls, plus two independent counter/pending adversaries.
   All 34 fixed hashes matched; v3 source admission binds 38 roles. Input pins,
   selected nine roles, fixed thirteen hard-link mappings and held parsers remain
   unchanged. The subset requires an empty following prefix and short field equal
   to the pending name's first 100 bytes; this is a deliberate stricter admission
   rule, not a general GNU requirement or an observation of the next real header.
   Orphan/repeated metadata, unsafe names, GNU `K`, PAX and symlinks still refuse.
   Next: finish every enabled exact-head hosted check; freeze new v3 control and
   actual original readers and review their manufactured adversaries; bind complete
   official history and a separate one-shot launch guard before any real attempt.
   The new control and actual original-reader algorithms have now passed
   coordinator and independent manufactured review: 11 control-reader tests plus
   three independent refusal cases, and 14 actual-reader tests plus three cases.
   The separate launch guard passed 11 tests and four independent history cases.
   Readers bind v3, 38 source roles and the 46-test transcript; successful actual
   reports additionally require bounded equal GNU header/consumed-name counts and
   no pending name, alongside all existing input, nine-role, session and cleanup
   joins. Negative copied facts remain unqualified. Guard preparation includes all
   five known workflow runs, preserving both failed predecessors. These are
   preparatory algorithm results. The automatic
   [control run38279833708](https://github.com/CrispStrobe/bw-board/actions/runs/38279833708)
   has now passed its 46-test suite; its six control-job steps succeeded and actual
   job stayed skipped. Coordinator frozen-reader and independent raw-original/Git
   audits passed the [five-report original](receipts/2026-10-12-gnu-longname-materializer-controls/README.md).
   All 11 enabled exact-head source checks now succeeded, with three declared
   skips. Final coordinator and independent binding reviews passed after complete
   official checks, label and workflow-history admission. The one-shot reservation
   for this source head is consumed: the sole
   [actual run38287531384](https://github.com/CrispStrobe/bw-board/actions/runs/38287531384),
   attempt 1, completed successfully. Coordinator frozen-reader, coder and
   independent original-byte/Git audits passed the
   [nine-text-member original](receipts/2026-10-12-gnu-longname-materialization/README.md)
   for finite reported nine-role materialization consistency. All six actual-job
   steps succeeded and its 46 controls passed. The report records all four input
   pins, 157 GNU name substitutions with no pending name, nine selected writes,
   13 validated aliases against 11 targets, four source-origin joins and zero
   reported close refusals. Its 11 processed notice hashes cover 142,595 bytes,
   with reported omissions zero; this does not mean all notices or notice bodies
   were retained. Physical aliases remain omitted. Do not rerun, relabel or
   dispatch this head, or reacquire either predecessor or this original. Preserve
   both predecessor negative originals and consumed launch states. Continue with
   the full-tree provisioning acceptance in lane 3; filesystem leases, namespace,
   complete toolchain, compiler, guest and performance remain unqualified.
   Review corrected a missing final report retaining completion
   and a file limit too small for
   selected tools. The actual job permits 16 MiB file writes and retains smaller
   independent JSON caps; its prospective reader admits at most 512 KiB of ZIP
   evidence. These are distinct bounds. Nine sanitized text roles describe a
   completed actual attempt, with no input archives or tools uploaded. Every
   enabled exact-head source check, frozen original reader and one-shot launch
   reservation preceded this test; compiler/tool/guest execution remained outside it.
   A source policy about read-only modes or omitted alias outputs is
   distinct from a final namespace/mode census; this finite result does not claim
   the latter. The receipt records member topology, selected reported output hashes,
   source joins, notice observations and cleanup. Preserve any refusal; change the
   parser only through a separately reviewed source revision. This task does not
   authorize a compiler connection or a binary bundle.
3. **Complete compiler provisioning.** Use the observed archive topology and
   historical compile-only implicit-role evidence to define a complete retained
   tool tree, including executable helpers, headers/runtime inputs and admitted
   aliases. Resolve remaining input leases, source/environment/process delegation,
   output formats, media and independent reader/launch gates before enabling a
   separately named compiler profile. Then compile the owned free DPMI client and
   qualify its observable service result in an independent oracle and the AT guest.
   Compilation alone does not qualify DPMI execution, applications or RTx.

   The next source slice should provision a fixed required tool tree without
   enabling compilation. Historical inventory and compiler plans identify `cc1`
   and `collect2` beyond the selected nine. The reported `cc1` extent is
   32,316,120 bytes, exceeding the current 16 MiB per-file and actual-process
   write limits. This requires a separately versioned resource profile, not a
   change to the selected-nine limits. The reported full inventory contains
   1,196 files, 78 directories and 13 hard-link aliases; that inventory does not
   establish that every file is needed by the owned C client.

   Source preparation is split into focused PRs:
   [standalone writer PR526](https://github.com/CrispStrobe/bw-board/pull/526),
   [authenticated TAR bridge PR527](https://github.com/CrispStrobe/bw-board/pull/527),
   and [selected-notice connection PR529](https://github.com/CrispStrobe/bw-board/pull/529).
   The writer's [20 manufactured controls passed on GitHub](https://github.com/CrispStrobe/bw-board/actions/runs/38298598139);
   the bridge's [25 manufactured controls passed on GitHub](https://github.com/CrispStrobe/bw-board/actions/runs/38299860676),
   as did the notice connection's [20 extractor and 15 coordinator controls](https://github.com/CrispStrobe/bw-board/actions/runs/38306188271).
   These prepare source policies only: none has provisioned the actual full
   tree or enabled compilation. PR526, PR527 and PR529 are merged after their
   enabled exact-head checks passed. The reviewed merge trees were verified.
   Their source composition remains distinct from actual full-tree qualification.
   Do not adopt the older broad source stack to integrate these small modules.

   The [bounded packet writer PR530](https://github.com/CrispStrobe/bw-board/pull/530)
   prepares nine-role text serialization and declared failure-stage role sets.
   Its source includes 25 manufactured controls for caps, immutable admission,
   exclusive outputs, readback, partial retention and cleanup refusal. Exact-head
   hosted checks passed and PR530 is merged with its merge tree verified. This serializer cannot authenticate an event or
   job; complete profile-source admission, raw trap/log provenance and independent
   original-artifact integration remain separate unfinished tasks.

   [Source-position and Git-plumbing PR531](https://github.com/CrispStrobe/bw-board/pull/531)
   prepares a separately versioned descriptor/table/snapshot gate, independent
   reader and unconnected bounded Git adapter. Its source includes 21 gate,
   16 reader and 23 temporary-repository adapter controls. Hosted checks on the
   expanded source head passed and PR531 is merged with its merge tree verified. The standalone gate seal is unset and its production
   Git stub refuses; adapter tests do not enable source admission or provisioning.
   The adapter checks the index and explicit admitted files. Unrelated worktree
   and untracked cleanliness remain outside that boundary.

   Continue with the remaining integration tasks:

   - Bind an externally approved source head and descriptor through a reviewed
     supervisor outside the commit. Embedding a digest of a descriptor containing
     the same commit's head creates a circular dependency.
   - Enumerate and review the complete transitive runner/executor/workflow graph.
     Join the bounded Git adapter to the separately versioned gate; role kinds
     and matching hashes alone cannot prove that every runtime dependency is listed.
   - Enforce process, memory, output and storage budgets in the actual executor.
     Preserve raw trap and failure logs; the packet's conservative fact-log grammar
     is insufficient for original stderr provenance.
   - Finish the independent official event/job/step/terminal-artifact reader and
     sole-run launch guard before any actual provisioning attempt. Keep compiler
     execution disabled through this provisioning checkpoint.

   The next provisioning checkpoint needs a separate bounded hosted profile and
   independent reader. Complete these tasks before acquiring its actual inputs:

   - Admit the runner, workflow, source table and artifact writer alongside all
     inherited parser/writer sources. Bind the exact reviewed head and observe
     those bytes before and after the attempt; inherited source hashes alone do
     not admit the new execution path.
   - Define a closed event receipt, exact exit/phase status and bounded control
     and execution logs. Preserve first failures and partial results. Assemble
     the nine text roles once: `source-before.json`, `source-after.json`,
     `event.json`, `report.json`, `control.stdout`, `control.stderr`,
     `run.stdout`, `run.stderr` and `status.txt`. Set explicit per-role and total
     limits before execution.
   - Review the reader without importing producer helpers. Require exact nested
     schemas, input order/pins, manifest-derived counts, cleanup joins and false
     qualification flags; reject inconsistent positive reports.
   - Bind the sole actual run, attempt, named jobs/steps and terminal artifact
     metadata before reading its original artifact body. Join event, source,
     status, logs and report semantics; a consistent report alone cannot qualify
     an official execution.

   Keep this profile limited to provisioning and selected-notice consistency.
   A successful result does not establish full compiler closure, complete notice
   coverage, guest compatibility or improved RTx.

   Continue by validating the closed DJGPP ZIP source joins and the three
   selected notice bodies, then authenticate the two separately sourced GCC
   notice bodies. A reported hash table or caller-supplied matching bytes does
   not establish an extractor-issued handoff. Require all four archive pins
   before parsing, full bounded ZIP structure/body closure, and rejection of
   reentry before later processing or retention. Preserve raw notice bytes;
   these five selected notices remain incomplete coverage. Only after the
   reviewed parser, writer, notice inputs and resource profile are connected
   and independently qualified should a new compiler profile be considered.

   A fresh implementation must satisfy these acceptance criteria:

   - Freeze exact required paths, kinds, extents and hashes, including executable
     helpers and transitive header/runtime inputs. Planning prefixes are not an
     open admission rule. Authenticate all four fixed archives before parsing;
     normalized inventory does not prove raw GNU-header compatibility.
   - Define alias identity explicitly. The historical compiler resolver uses
     `samefile`; omitted or copied aliases cannot qualify that relationship.
     Any physical-link policy must account for changed link counts and preserve
     the existing canonical nine-file observation profile.
   - Calculate maximum file, aggregate retained-tree, memory and write budgets
     from the fixed required manifest. Test missing/extra members, ancestor
     conflicts, wrong hashes/extents, over-budget writes and partial cleanup.
   - Retain required notices byte-for-byte, including formfeeds and notices
     larger than the current 32 KiB notice cap. Omitted/hash-only notice records
     do not establish complete notice retention or redistribution permission.
   - Keep the compiler disabled in this provisioning slice. A later separately
     reviewed compiler profile needs input/source leases, closed environment and
     helper/host-loader delegation, raw output-format and media joins, independent
     readers and launch gates. Qualify the free client in an independent DPMI
     oracle and the AT guest after compilation; report those outcomes separately.


### Unarmed offline supervisor checkpoint

[PR534](https://github.com/CrispStrobe/bw-board/pull/534) is merged after all
eleven enabled checks passed; its reviewed merge composition was verified.
The [offline supervisor](../scripts/i80386-unarmed-supervisor/README.md) joins
verified bootstrap components, real Git observations in tiny manufactured
repositories, separate full-profile source positions, a fixed bounded child,
raw output storage and an acquisition-refused fact packet. Its fifteen supervisor
and twenty-one admission controls pass locally. The controls copy the fourteen
inherited source files as metadata; they do not execute those programs.

This checkpoint does not enable provisioning or compilation. External approval
remains unset. The child deadline covers drain and wait after launch returns;
whole-supervisor startup and filesystem bounds remain a separate requirement.
The independent reader integration adds manufactured consistency controls and
two whole-path fixture cases; these must qualify their own published source.
Next, qualify the reader and its exact source bindings, then prepare the externally bounded,
source-admitted actual profile and its official event/job/artifact and single-run
gates. Preserve prior failures and require that launch review before acquiring
inputs. Compiler closure and free protected-mode application tests follow the
actual provisioning result; no new compatibility or performance result is claimed.


### Actual-run outer boundary acceptance

The actual profile needs an externally owned deadline and containment that covers
all its processes, including new sessions created by Git or the fixed child.
Killing only the supervisor process group cannot establish that boundary.
Start the deadline before bootstrap and retain the original bounded output
prefixes, external exit/timeout facts and cleanup outcome. An interrupted inner
report or missing source-after observation must remain a refusal.

Before an actual launch, prove timeout during startup, a child that starts a new
session, and a partial-output failure inside owned containment. Verify that no
owned process remains; uncertain cleanup must refuse and must not affect unrelated
processes. Bind the containment/tool identities, limits and exact source to the
external approval. This is an unfinished implementation contract, not evidence
that containment, storage quotas or an actual provisioning run already work.

### Outer supervisor containment controls

The [fixed outer-boundary profile](../scripts/i80386-supervisor-outer-boundary/README.md)
adds nineteen pure mock controls and five fixed hosted Linux fixtures. Source
review and local mock controls passed. All five fixed hosted observations passed
in [original run 38361521769](https://github.com/CrispStrobe/bw-board/actions/runs/38361521769)
on tested source `80a19c789b350be3a10bf3443f14a3fb34e948b3`; the durable result
record is published separately in [PR538](https://github.com/CrispStrobe/bw-board/pull/538). The dedicated PR workflow tests normal completion, startup stall,
detached-session stall, original binary stderr followed by a stall, and setup
refusal. It retains original bounded output and tool/source hash observations.
Production remains unsealed, and no archive, compiler or guest is launched.

The fixture timer starts before namespace creation and Python bootstrap. Passing
containment requires admitted namespace/PID1 handles, terminal PID1, reaped owned
launcher, pipe EOF and two complete bounded namespace censuses. Observer startup
and source admission have separate hosted bounds; this is not a universal hard
deadline or a security sandbox for arbitrary root programs.

Continue in order: inspect the original exact-head hosted artifact and every
enabled check; resolve any failure while retaining the first diagnostic; integrate
the independently reviewed lifecycle reader; then bind the actual provisioning
profile to its official event, jobs, steps, artifact and single-run gate. Keep
compilation disabled until that provisioning result is independently qualified.
After compiler closure, test a freely licensed protected-mode client against an
independent DPMI oracle and the AT guest. This preparatory checkpoint adds no RTx
measurement or broader 386/operating-system compatibility claim.

### Fixed provisioning transport checkpoint

Reader [PR536](https://github.com/CrispStrobe/bw-board/pull/536), containment
[PR537](https://github.com/CrispStrobe/bw-board/pull/537), and original hosted
results [PR538](https://github.com/CrispStrobe/bw-board/pull/538) are merged.
The [durable result record](X86-OUTER-BOUNDARY-RESULTS.md) preserves the tested
source and finite fixture boundary.

The new [transport slice](../scripts/i80386-full-tree-provisioning-launcher/README.md)
ports the fixed six public input bindings into a portable module. Twenty-nine
manufactured controls passed locally, including failure at each input, response
cleanup, redirects, deadlines and reentry. An independent request-construction
reentry finding was corrected and retained. Hosted source controls still need
qualification. Both public acquisition entries refuse before network opener or
clock work; no real inputs, archive parser, compiler or guest run is added.

Continue by qualifying this published source, then connect the existing admission
and Git adapter to the fixed downloader and coordinator. Freeze the complete
source graph, externally reviewed approval bytes and exact contained resource
policy before enabling the actual path. Install and observe limits inside PID1
before bootstrap; shell limits before privilege changes are insufficient evidence.
Define the separate full-source/raw-output envelope and its independent reader,
then bind the official event, jobs, steps, terminal artifact and single-run gate.
The compiler remains disabled through this provisioning slice. No new RTx or
broader protected-mode compatibility result is claimed.

### Provisioning source-admission connection

The [unarmed controller](../scripts/i80386-full-tree-provisioning-launcher/CONTROLLER.md)
connects the held Gate and bounded Git adapter to the fixed transport and notice
coordinator. Bootstrap checks every declared executable and data component before
loading modules. A complete source-before position precedes transport admission;
all six inputs must authenticate before one coordinator call. Source-after and
cleanup observations determine the controller's finite completion result.

Full-profile source snapshots remain separate from the derived inherited fourteen
rows. The source-control fixtures use tiny repositories, mocked HTTP bodies and
an explicitly separate tiny completion predicate. They establish orchestration
consistency, not actual archive or compiler compatibility. Default approval is
unset and execution refuses before filesystem, Git or network work.

Qualify the transport parent and this controller's published controls separately.
Then implement the fixed contained resource entry, with limits installed and
observed in PID1 before bootstrap. Bind externally reviewed approval bytes to the
consumed launch record; mutable configuration values alone are not authority.
Finish the separately versioned full-source/raw-output envelope, independent
original reader and official event/job/step/artifact/single-run joins before the
first actual provisioning attempt. Compilation and guest testing remain later
gates; this connection adds no RTx or operating-system qualification.

### PID1 process-limit preparation

Transport [PR539](https://github.com/CrispStrobe/bw-board/pull/539) is merged.
Controller [PR540](https://github.com/CrispStrobe/bw-board/pull/540) is merged
after the corrected source controls and all enabled checks passed. Its first hosted fixture failed because checkout omitted the
workflow file read by that fixture; the checkout input was corrected without
changing the controller algorithm or limits. The original failure is preserved.

The new [PID1 limits unit](../scripts/i80386-provisioning-pid1/README.md) prepares
the literal process policy: CPU 180 seconds, address space 2 GiB, per-file size
64 MiB, 256 descriptors and no core dump. Eighteen local mock controls and two
independent refusal checks passed. Each installation has an immediate readback,
followed by a final recheck of all five limits. Partial installation and first
errors remain explicit; there is no rollback or sufficiency claim.

The actual entry remains unsealed. Tests mock the resource operations and do not
alter real provisioning limits or create namespaces. Linux/PID1/root/GitHub
context observations alone do not prove owned namespace or official host identity.
Process limits are not aggregate namespace budgets or disk quotas.

Next, qualify this source and the controller separately, then connect the fixed
limits entry before product bootstrap inside the admitted namespace. Extend the
explicit source graph and independent actual envelope to retain resource facts,
original output prefixes and conservative partial failures. Bind the containment
observer, externally reviewed approval and official single-run record before
acquiring inputs. Compilation, protected-mode application tests and RTx remain
later gates; no operating-system compatibility result is added here.

### Fixed contained-entry source checkpoint

The [unconnected entry](../scripts/i80386-provisioning-contained/README.md)
connects the fixed limits source to a versioned resource handshake and delayed
controller loading. Twenty-one mock controls and two independent refusal checks
passed with the workflow's Linux system Python. Its source-control environment
requires `os.pidfd_open`; these tests mock it and establish no real handle or
namespace behavior.

The entry admits literal parent component pins, verifies all resource facts,
freezes the bounded packet before opening handles, and requires exact send and
ACK before reading or executing controller source. Duplicate or partial handles,
negative controller results, reentry and close uncertainty remain refusals with
preserved partial facts and first errors. Actual entry, channel and external
metadata remain unsealed or unconnected. Parent controller and limits sources
must qualify separately; composing their branches is not adoption evidence.

Next, integrate the external observer with this new resource-packet protocol;
the older fixture observer cannot automatically admit it. Bind namespace/PID1
identity, exact resources, source, timeout and original-output caps before ACK.
Finish the separate actual envelope and independent original reader, then the
externally reviewed approval and official single-run gate. Keep the compiler
disabled until actual provisioning is independently qualified. No real limits,
namespace/socket probe, archive, guest or RTx result is added by this checkpoint.

### Resource-handshake observer admission

The [observer admission unit](../scripts/i80386-provisioning-observer/README.md)
independently decodes the contained entry's bounded resource packet. It reuses
the exact held namespace/PID1 admission code, joins kernel sender credentials
to the received handles, and reads each literal process limit using the
read-only, two-argument `prlimit` operation. PID1 terminal checks surround those
reads; namespace identity is checked again before ACK.

Successful admission retains its received namespace and PID1 handles until
explicit close. Packet, ancillary-descriptor, resource, identity, reentry and
cleanup failures refuse admission and preserve partial observations. An ACK
attempt may escape even when sending subsequently fails; that uncertainty
cannot be rolled back or used to claim the contained controller stayed blocked.

The actual entry and channel remain unconnected. Twenty-eight mocked controls passed under the
workflow interpreter and bounds, including the exact held helper connection.
Local controls mock kernel, resource, descriptor and socket operations. These are
finite observations, not
a continuous PID ownership lease, resource-sufficiency result or official host
qualification. Per-process limits do not establish aggregate budgets or disk
quotas. No actual provisioning, compilation, guest or RTx result is added.

Next, qualify this source and its parent entry separately. Integrate retained
handles with the full observer lifetime, bounded startup and execution time,
original stdout/stderr caps, PID1 terminal observation and conservative census
cleanup. Freeze the complete executable/data source graph, then implement the
separate actual envelope and independent original-artifact reader. Bind external
approval to the official event, job, step, artifact and single-run record before
an actual attempt. Keep the compiler disabled until provisioning passes those
independent gates.

### Observer lifetime and original-output preparation

PID1 resource preparation [PR541](https://github.com/CrispStrobe/bw-board/pull/541)
is merged after all enabled exact-head checks passed. Its actual resource and
namespace operations remain unqualified.

The [lifetime unit](../scripts/i80386-provisioning-observer-lifetime/README.md)
is a separate unconnected source slice around the held resource admission. Its
39 mocked controls passed under the workflow interpreter and bounds, including
the exact admission unit's positive and ACK-failure connections. Controls use a
private manufactured launch/channel route, with kernel, process, socket,
descriptor and clock operations mocked. The source captures original
stdout/stderr prefixes of at most 64 KiB each; overflow preserves the prefix and
refuses completion. Original bytes, observed counts and EOF facts stay separate
from process return status.

The proposed startup, execution and total observation budgets are eight, 480 and
488 seconds respectively. They constrain cooperative observations; synchronous
setup, launch or kernel work still needs an enclosing supervisor for a hard
timeout. Source-only checks do not establish that these budgets are sufficient
for actual provisioning.

A positive finite observation requires both pipe EOFs, terminal admitted PID1,
owned launcher reaping and two complete empty namespace censuses while handles
remain retained. The admission unit is the sole close owner of those handles.
Failure cleanup may signal only a retained, unconsumed admitted PID1 handle.
Historical admission or an escaped ACK cannot authorize reuse of a closed
descriptor; enumerated PIDs never become signal targets. Missing or uncertain observations, expired cleanup
budgets, reentry and close failures retain the first error and refuse completion.
Actual launch and channel remain unconnected. No namespace lease, official host
authority, actual acquisition, compilation, guest or RTx result is added.

Next, qualify this unit and its parent source separately. Bind the complete
executable/data graph and enclosing timeout before actual integration. Define
the separate full-source/resource/raw-output envelope and an independent reader
that checks originals without importing producer validators or replaying guests.
Bind externally reviewed approval to the consumed official event, exact head,
attempt, job, steps and terminal artifact before a single actual provisioning
run. Keep compiler activation and guest tests behind that qualified checkpoint.

### Fixed enclosing launch preparation

The [launch preparation unit](../scripts/i80386-provisioning-enclosing-supervisor/README.md)
prepares the fixed command graph and socket/pipe handoff around the held lifetime
source. Its contained bootstrap is explicitly unarmed: it does not provide an
operational entry CLI, resource handshake or controller approval. Actual entry
and the private creation/launch route remain unconnected. Twenty-eight mocked
controls passed under the workflow interpreter and bounds, with two independent
refusal checks. Local controls mock all kernel, socket, pipe, descriptor,
credential and process operations.

Preparation observes Linux root-credential eligibility before source loading or
descriptor creation. Privilege acquisition must happen in an enclosing bootstrap
before those descriptors exist; the contained command starts directly with the
proposed 480-second timeout and namespace creation. A separate 488-second timeout before observer
bootstrap remains a future integration; this unit does not construct or run that
observer bootstrap or enclosing timer. Timer, interpreter, bootstrap, argument,
environment and descriptor identities must be admitted together. Command
preparation does not qualify installed tools, privilege behavior or a working
hard timeout. If the outer timer kills the observer, final cleanup and census
observations remain unknown.

Created endpoints and pipe ends have one close owner. Every returned resource
must be retained before post-hook refusal, with null stdin, only the child channel
explicitly inherited, standard output/error mapped to descriptors 1/2, and
close-once transfer to the held lifetime. Before namespace admission, launch
or descriptor facts cannot invent PID or process-group cancellation authority.
Original errors, partial returns and closure uncertainty remain visible; no
provisioning completion can be inferred from an unarmed bootstrap's refusal.

Next, qualify this source and its parents independently. Freeze the complete
bootstrap/tool/source graph and implement the separate raw-output/resource/full-
source envelope with an independent original-artifact reader. Bind external
approval and official event, head, attempt, job, steps, terminal artifact and
single-run consumption before any operational connection. Qualify the enclosing
timeout and owned namespace behavior with explicit hosted evidence. Keep actual
acquisition, compiler activation, guest compatibility and RTx claims behind
their own observed checkpoints.

### Independent observation-envelope reader

The [observation envelope](../scripts/i80386-provisioning-observation-envelope/README.md)
defines a separate staged wire contract. Its assembler accepts exact member bytes
and emits a fixed-order STORED ZIP; it returns no validation verdict. The standalone
reader accepts original ZIP bytes through `audit(raw_zip_bytes,
declared_sha256=None)`. It imports no producer validators and performs no source
execution, Git operations, downloads, process operations or guest replay. A
declared digest checks byte consistency only; it is not an official artifact seal.

The nine permitted roles contain the envelope, original stdout/stderr prefixes,
projected status, reported source-before/source-after snapshots, descriptor, role
table and resource packet. Framing, extents, CRCs, member hashes, closed types and
stage dependencies must agree. Prefixes retain original bytes, including binary
output; stored length, observed length and EOF are separate facts. Missing
handshakes and source-after snapshots remain absent in partial diagnostics.

The reader checks the reported full source table, its genuine inherited fourteen
pins, a separately derived fourteen-role projection and four checked component
pins. This is reported metadata consistency, not proof that the actual transitive
executable/data graph was consumed. It checks resource, admission and lifetime
joins without importing their implementation. Original failure codes, signed
launcher exits and diagnostic limit readbacks remain visible. Historical admission
and an ACK that may have escaped do not grant usable handle authority after close.

`diagnosticValid` means the supplied diagnostic packet is internally valid.
`completeReportedConsistency` additionally requires the complete set of joined
source, resource and clean terminal observations. Both results keep every
approval, official binding, source ownership, namespace lease, hard deadline,
resource sufficiency, actual acquisition, compiler, guest and performance
qualification flag false. Manufactured byte controls cannot qualify an actual
host or guest.

Thirty-seven manufactured controls passed under the workflow's interpreter and
resource bounds. Independent standard-ZIP packets also checked binary prefixes,
hidden framing, regular-file modes and refusal before hashing oversized input.
These checks establish the finite reader boundary only.

Next, independently audit the frozen reader and malformed-input controls. Admit
the complete operational bootstrap/tool/source graph and externally approved
launch separately. Bind one consumed official event, head, attempt, job, steps
and terminal artifact; audit the original packet without replay. Actual
provisioning must pass those gates before enabling the compiler or making new
guest compatibility or speed claims.

### Ordinary code16 public paired measurement

Prepare one separately named public measurement for the sixteen-bit effective-
address allocation candidate. Use freely authored bytes and ordinary
`I80386.step()` through real memory/bus callbacks; no native accelerator,
restricted input, BIOS, disk, emulator image or OS workload is needed. This
measurement does not replace the earlier benchmark contract, satisfy its
acceptance gate or grant adoption of the performance-only CPU change.

The [lane claim](../LANES.md#ordinary-code16-public-paired-measurement--2026-10-14)
owns only `.github/workflows/i80386-code16-paired.yml`, the new
`scripts/i80386-code16-paired/` fixture/runner/policy/controls/README files and
`test/i80386-code16-paired-fixture.test.mjs`, plus these contract/registry texts.
The documentation claim is merged; the dedicated implementation source is
prepared for review. Existing CPU code,
correctness fixtures, CI/native workflows, dependency pins and original reports
remain outside this ownership.

Freeze two exact ordinary source contexts: baseline
`0d306c5c67e4843e24a05d54da72d21cd56119e4` and candidate
`fa296c62cf4fad8f25dc5d3e9ae532e0d94e1015`. Authenticate all 43 selected source
rows from public Git objects and live bytes; the CPU file is the only allowed
source difference. Admit the new common fixture and complete transitive runtime
imports separately rather than silently expanding that historical census.
Freeze identical new fixture, runner, policy and measurement-wrapper source
roles separately from those 43 engine rows; none may differ between arms.
The same fixture must run in both contexts, with every native, WASM, grouped,
block or opt-in execution accelerator disabled. Fix Ubuntu 24.04, Node 20.20.2,
ordinary JS, one CPU, at most 1 GiB, a 60-second per-child deadline and a
30-minute job bound before any actual measurement. Enforce a single logical
CPU affinity and an owned cgroup v2 with `cpu.max` of `100000 100000`,
`memory.max` of `1073741824` bytes and `memory.swap.max` of `0`; the memory
limit includes the measurement wrapper and its children. Preserve cgroup
membership, effective affinity and limit readbacks before each child, together
with runtime/tool identities. Refuse if these bounds cannot be enforced.

The proposed fixed work unit is 100,000 complete passes of a 24-instruction
memory-addressing sequence: exactly 2,400,000 retired memory instructions per
child, with no early completion or variable-duration loop. Cover every mod/rm
memory form, signed disp8 and disp16 arithmetic, direct mod0/rm6 addressing,
sixteen-bit wrap, DS versus BP-based SS selection and all segment overrides.
Choose destinations that preserve BX/BP/SI/DI address bases, or account for
every base update in the independent oracle. Freeze the final instruction/fetch/work
census and independently authored expected addresses, segment selections,
reads/writes, fetches and final CPU/memory checks before running;
no count is an actual observation until the source is qualified. Include
correctness/fault and semantic-mismatch controls without timing their assertions.
Do not substitute a direct `_decodeEA()` call loop for the whole ordinary step
workload. Retain final CPU state, memory digests, exact work and observable bus
counts without a per-instruction allocation-heavy trace in the timed path.

Run four warmup children in A,B,A,B order, then exactly seven measured pairs in
AB,BA,AB,BA,BA,AB,BA order on the same hosted runner. Measure each whole Node
child with an independently reviewed `wait4` wrapper: user plus system CPU and
wall for that same process interval. Keep timing separate from guest semantics;
no Docker-client wall or inner JavaScript stopwatch may stand in for CPU time.
Retain every original stdout/stderr/timer/source admission and exit/timeout/
cleanup observation. Stop at the first failure; do not retry, replace, drop or
reorder a child. Require exact semantic equality across arms and against the
frozen authored work, excluding only authenticated arm source identities.

The predeclared gate requires median baseline/candidate CPU ratio at least
1.03, each of the seven ratios strictly greater than 1, and median candidate/
baseline wall ratio at most 1.02. Report all ratios and the conditional
99.21875% minimum-ratio bound with its independent, continuous and exchangeable
pair assumptions. Reject missing, duplicate, wrong-order, nonfinite, zero,
identity-mismatched, timed-out or semantically different records. No sampled
profile, configured RTx or full-OS conclusion follows from this fixture.

Root and independent source review precede one exact-source hosted run. A
public fixture result is scoped to its authored instruction mix. The original
benchmark inputs and gate remain separately pending, and no gain is claimed
until the new original paired evidence passes an independent audit.

The first [public run 38546501084](https://github.com/CrispStrobe/bw-board/actions/runs/38546501084)
at [source 7803a634](https://github.com/CrispStrobe/bw-board/commit/7803a6341d319b30da2bcd4065e5c8005940687f)
passes all 18 semantic checks and the seven-pair gate. Root and an independent
peer verified the sole original packet. CPU A/B ratios (rounded) are
1.207300, 1.213405, 1.176528, 1.253893, 1.279204, 1.234022, 1.254363:
median 1.234022, minimum 1.176528, all 7 wins; median B/A wall 0.811306.
Node 20.20.2 ran on EPYC 7763 with affinity CPU 0, one-CPU quota, 1 GiB and no swap;
owned cleanup was observed. Original
[artifact 11886116162](https://api.github.com/repos/CrispStrobe/bw-board/actions/artifacts/11886116162)
SHA256 is `4e102fd18dca6f7dbc58ffb0b8b2b6bed121e07f4d80e524e1c69a2fcbb38cfd`.
[PR573](https://github.com/CrispStrobe/bw-board/pull/573) is merged; ordinary
CPU adoption is unchanged. This gain covers only the authored 24-form public
mix, not the original benchmark gate, adoption, physical RTx or OS compatibility.

## Ordinary code16 V8 profile diagnostic

After the ownership claim merges, implement exactly three new files:
`.github/workflows/i80386-code16-profile.yml` and
`scripts/i80386-code16-profile/{profile.py,README.md}`. Freeze and independently
review their source before the first implementation-branch push. The dedicated
workflow accepts only that branch in this repository and attempt one; it must
not duplicate a pull-request or dispatch run.

Keep publication `7803a6341d319b30da2bcd4065e5c8005940687f`, baseline
`0d306c5c67e4843e24a05d54da72d21cd56119e4`, candidate
`fa296c62cf4fad8f25dc5d3e9ae532e0d94e1015`, all 43 selected rows per arm and
eight common publication roles immutable. Authenticate Git/live source and Node
identity before and after each child, plus the separate new diagnostic graph.
Run one fresh Node 20.20.2 child A then B using the unchanged public fixture:
2.4 million instructions, golden CPU/memory/bus checks, accelerators disabled,
`--cpu-prof-interval=1000` and bounded per-arm profile output. These fresh
processes are not JIT-warmed by earlier children. No replacement or retry.

Use hosted Ubuntu 24.04 with one logical CPU/one-CPU quota, 1 GiB cgroup memory
and no swap for wrapper and children. Observe actual membership, affinity,
cpuset, limits and memory events before/pre-exec/after each child; reap each
owned child once. Preserve its original stdout/stderr, usage, resource facts,
profile bytes/digest and observed owned-service/cgroup cleanup. Enforce a
60-second child deadline, at most 8 MiB profile, 256 KiB stdout and 8 KiB stderr;
enforce the smaller stream caps during capture, refuse missing enforcement and
preserve the first error. Do not modify the
paired runner's smaller hard file limit to accommodate profiles.

Bounded parsing must validate duplicate keys, finite/type/size constraints,
node IDs, sample references and sample/delta cardinality. Report total samples
and represented decoder/step/byte-callback/GC or compilation weights with source
roles; unresolved frames remain explicit. Samples are approximate diagnostic
observations, not exact CPU cost shares, allocation counts or physical clocks.
The profile covers its recorded sampling interval in each fresh process,
including represented startup, source checks, setup and final hashing.
Whole-child wait4 timing is separate; no complete startup coverage is assumed.

Acceptance is independent audit of one original two-child packet with both
semantics and source/resource/cleanup checks passing. Preserve failed captures;
never substitute profiled timings into the original seven-pair result. This
locates costs only in the authored MOV workload. It grants no CPU adoption,
original-gate replacement, physical RTx or operating-system compatibility.


### First audited V8 profile result

The first [capture 38599162864](https://github.com/CrispStrobe/bw-board/actions/runs/38599162864)
at [source 52d31962](https://github.com/CrispStrobe/bw-board/commit/52d319621027db67d0be09006cd02ff0daff2def)
passed root and independent peer original-only audits: both golden semantic
reports, source identities, zero memory events and owned cleanup match.
On EPYC 9V74, Node 20.20.2, CPU0/one-CPU quota and 1 GiB/no swap, A has 648
samples and B 547. GC samples are 84 and 14 respectively. B's leading engine
functions, aggregating leaf samples across call sites, are `_stepInstruction`
(129), `_fetchN` (119), `_decodeEA` (68). Eight unresolved samples per arm remain
accounted for. These fresh fixed-order profiles give approximate diagnostic
weights, not exact CPU shares, allocation counts or a paired speed estimate.
The unprofiled 1.234022 median speedup remains a separate EPYC 7763 result.
Original [artifact 11913418970](https://api.github.com/repos/CrispStrobe/bw-board/actions/artifacts/11913418970)
ZIP SHA256 is `0bbfb5ec839ead27ae7249a2dc83be0c55d5211cff0914d6f148637bbaf99f7e`.
[PR576](https://github.com/CrispStrobe/bw-board/pull/576) is merged after all
eight current enabled gates passed. No CPU adoption, original-gate replacement, physical RTx or OS claim
follows. No profile capture was repeated.

## Guarded two-byte instruction-fetch specialization

Claim577 merged; [PR579](https://github.com/CrispStrobe/bw-board/pull/579) merged
at `c2f0936d5fcc22e3757531eeaa30828413a6ede7` after all eight latest CI
successors passed. The ordinary JS word-fetch change is adopted in board master;
all 43 selected source rows match measured B. Own only
`_fetchN` in `src/experimental/i80386.js`, new
`test/i80386-fetchn-specialization.test.mjs` and this registry/task text.
Use the refreshed ordinary master baseline; do not silently include the
unadopted address-decoder candidate. The sampled MOV mix uses `_fetchN(2)`,
so first test a specialization of the existing guarded two-byte loop that
avoids its loop/exponent overhead. Leave four-byte/RAM32 admission and the
existing bytewise fallback unchanged. Exact-candidate hosted guest checks passed;
the separately audited paired gate below measured a gain only for its authored
public mix.

Preserve per-byte fetch address/order/masking, EIP and instruction-byte updates,
including the state visible inside callbacks. Preserve throws after either
byte, segment/page crossings, the 15-byte limit, unsigned return value and
instruction rollback. Do not cache callbacks, remove protection checks or
change instruction/bus clocks, profile flags, helpers or dependency pins.
Use focused event/state adversaries and existing opcode/fault regressions,
then affected hosted guest qualification with exact source identities.

Freeze the source candidate before introducing a separately scoped versioned
unprofiled comparison. Historical source maps, fixture CLI and paired policy
are immutable; do not rewrite them to admit the new candidate. Any new gate
harness requires a merged scope extension. The new gate and guest checks passed;
matched-head merge is complete. Lite retains its earlier board pin, so no GUI
adoption is implied. This claim does not
adopt PR557 or replace its original benchmark gate, nor establish physical
RTx, whole-AT speed or operating-system compatibility.

## Guarded word-fetch public paired measurement

Status: claim581 merged at `f1b669b3`. [Merged PR582](https://github.com/CrispStrobe/bw-board/pull/582) published the harness; its first push measurement succeeded. Root and independent peer original-packet audits passed. [CPU PR579](https://github.com/CrispStrobe/bw-board/pull/579) merged at `c2f0936d`; ordinary JS word-fetch is adopted in board master. PR582 merged at `3a1285f9160472d86fa061eda6f0e1053c12c4e8` after all nine latest enabled checks passed.

Own only new `.github/workflows/i80386-fetchn-paired.yml`,
`scripts/i80386-fetchn-paired/{fixture.mjs,run.py,policy.py,controls.py,README.md}`,
`test/i80386-fetchn-paired-fixture.test.mjs` and the matching `LANES.md` entry.
Use `lane/386-fetchn-public-paired-20261014`. Preserve every existing CPU,
fixture, policy, source map, workflow, consumer pin and receipt unchanged.

Freeze A at `c847c0470cfaf4ad3c781ce7a83a35b939497533`, CPU SHA256
`6fba681208e1443cc9eff00ae6aba444903d23e5feafe62527b25428e72d60ed`,
and B at `e2c537affb6e0e56194429723abeb356095a3607`, CPU SHA256
`2303557f35ad56d8101eb96ffc8749fa4d64338425726027d70bd64a6b10d4ba`.
Build fresh Git/live length-and-digest admissions for the same 43 selected
engine paths; require all 42 non-CPU rows identical, including package resolver
metadata. Any other difference blocks execution. The separately gated scalar
address-decoder candidate is neither the baseline nor a combined candidate.

Copy the authored 24-form workload algorithm and independent golden semantics
from [PR573](https://github.com/CrispStrobe/bw-board/pull/573), changing only
explicit admission, schema and experiment names. Use the named
`FETCHN_TWO_BYTE_PUBLIC_CODE16_24_FORM_MACRO` and new child/result schemas.
The original fixture embeds its old admissions and cannot accept these arms
unchanged. Authenticate the new fixture, runner, policy, controls, README,
fixture test, workflow and publication package metadata separately against
one exact publication commit, identically for both arms. Any reused executable
helper belongs in that frozen graph. Do not import an existing evaluator or
runner for its execution side effects.

Retain ordinary `I80386.step()` and the actual byte-memory bus, with all
accelerators disabled. Run 100,000 passes of 24 instructions: 2,400,000 retired
instructions, eight million fetched bytes, 4.8 million read bytes and no writes.
The timed work includes identical setup, host EIP rewind, checks and hashing.
Tiny fixture controls must prove the copied workload and independent oracle;
policy controls must reject source drift, partial sequences and resource or
cleanup uncertainty without running a full macro locally.

Use Ubuntu 24.04 and Node 20.20.2 with authenticated executable bytes. Enforce
one logical CPU/affinity, an owned wrapper-and-child cgroup-v2 CPU quota
`100000 100000`, memory limit 1 GiB and no swap. Preserve membership, limits,
affinity and pressure-event observations before/pre-exec/after each child.
Measure whole-Node wait4 user-plus-system CPU and matching monotonic wall.
No profiler is active. Preserve the existing bounded child/service deadlines,
original stdout/stderr, exit/reap/EOF facts and explicit owned cleanup evidence.

Four ABAB warmups precede seven measured pairs in AB, BA, AB, BA, BA, AB, BA
order. Require all 18 independent golden semantic checks; median CPU A/B at
least 1.03, every measured CPU ratio above one, and median wall B/A at most
1.02. No dropping, replacing, retrying or selecting runs. Preserve every raw
pair and the conditional minimum-ratio bound with its statistical assumptions.
A speed rejection remains a failed result even if semantics and cleanup pass.

Before the sole branch-push hosted actual, freeze the full graph and obtain
root and independent source reviews plus affected exact-candidate CPU/xv6
success. Do not duplicate measurement on pull requests or manual dispatch.
After terminal metadata admission, acquire the original packet once and audit
it independently without producer imports or replay. Record exact source,
hardware/runtime, artifact digest, resource/cleanup and semantic/performance
conclusions in public evidence. This gate qualifies only this authored public
mix; performance alone neither replaces the original benchmark gate nor grants CPU adoption,
physical RTx, full AT or operating-system compatibility.


The original [run38616216653](https://github.com/CrispStrobe/bw-board/actions/runs/38616216653)
used [source acb31651](https://github.com/CrispStrobe/bw-board/tree/acb31651502cfbc78ab63dceb4f70ccfe0d3e5f6/scripts/i80386-fetchn-paired).
All 18 semantic checks passed; seven CPU A/B ratios were
1.1154440791, 1.1354655299, 1.1733682216, 1.1795911323, 1.0941048878,
1.1257919362 and 1.1042339567 (median 1.1257919362, minimum 1.0941048878).
Median wall B/A was 0.8918089672. EPYC7763/four-logical-CPU runner,
CPU0 affinity/one-CPU quota, 1 GiB/no swap and Node20.20.2 were observed;
common eight roles, both 43-row admissions and owned cleanup passed.
[Original artifact11919902462](https://api.github.com/repos/CrispStrobe/bw-board/actions/artifacts/11919902462)
is 140770 bytes, SHA256 `fb01d418a37f4ed9b3455a378803a161874169cc2912e4021f45215187273ccc`.
This isolated fetch result cannot be multiplied by the isolated scalar-EA result
or credited to a combined candidate; the scope limitations above remain.

The adopted fetch change measured approximately 12.6% higher whole-Node CPU
throughput in this authored mix only. Lite pin/installed GUI adoption is separate;
PR557 and its original gate remain unchanged.


The latest [media-free platform diagnostic](X86-RTX-PLATFORMS.md#hosted-ordinary-js-diagnostic--2026-10-14)
records current-source timed-loop core/machine rates separately from this
whole-Node paired gate. Next work is coordinated Lite pin/installed-consumer
qualification and a separately scoped AT-platform profiling hypothesis;
the core/AT gap is not an established CPU cost share. Neither next task is
implemented or qualified by this diagnostic.

## Ordinary-JS 386 AT platform profiling

Status: finite capture and original audits passed; [PR587](https://github.com/CrispStrobe/bw-board/pull/587)
merged at `819b297ed00f63c03cf49091109236159a151de2` after all nine latest
enabled checks passed. The contract below records the admitted experiment. Sources:
`.github/workflows/i80386-at-profile.yml`,
`scripts/i80386-at-profile/{fixture.mjs,profile.py,reader.py,README.md}` and
`test/i80386-at-profile-fixture.test.mjs`, plus this section and its registry
entry. Coding branch: `lane/386-at-platform-profile-20261015`. No existing CPU,
device, scheduler, clock, benchmark, workflow, dependency pin or receipt edits.

Diagnose the core-versus-AT paths using the freely authored media-free
five-instruction loop described in [the platform record](X86-RTX-PLATFORMS.md).
Do not rerun the completed throughput capture. Freeze one exact current source
commit and complete executed import/package-data closure, identical workload
bytes and Node20.20.2 executable identity before the new capture. Use ordinary
`I80386.step()` versus `I80386ATMachine.step()`, with native/block accelerators
disabled while preserving each original constructor's software translation-cache
and fault-delivery defaults;
retain their existing one/six synthetic scheduling charges. One fresh profiled
child per path runs one million instructions, core then AT. Record setup and
the V8 sampling interval explicitly; whole-child metadata is separate. No BIOS, disk,
network input, licensed media, native backend or OS boot is involved.

Require the independently known five-operation final AX65534/BX65535/IP0/
memory-word65535 oracle, exact retired work and core/AT charge totals. The AT
fixture must additionally check actual elapsed device ticks, PIT channel state,
PIC request/mask/in-service state and CPU interrupt eligibility against a
source-derived golden expectation. Distinguish pending IRQs from delivered
interrupts: this loop does not enable IF and cannot qualify interrupt delivery.
A distinct authored IF-enabled IRQ/EOI fixture is a separately scoped next
phase only if needed to select an optimization; it is not required for this
first attribution diagnostic. Never infer IRQ delivery from device progress.
Preserve observable device state rather
than merely comparing the two arms or hardcoding zero events. Tiny semantic
and negative controls precede hosted execution; no full workload locally.

Use Ubuntu24.04, Node20.20.2, one observed logical-CPU affinity, an owned cgroup
quota `100000 100000`, memory1GiB/swap0 for wrapper and children. Authenticate
source/runtime bytes before and after each child, and resource membership,
limits, affinity and pressure counters before/pre-exec/after. Reuse immutable
reviewed capture/resource helpers only with explicit source hashes in the
frozen graph; never invoke another experiment's main or evaluator. Bound each
child to 60 seconds, profiles to 8MiB, streamed stdout to 256KiB and stderr to
8KiB, with fixed service/job bounds and observed owned-unit/cgroup cleanup.
Retain original prefixes, first failures, exit/reap and uncertain cleanup facts;
client timeout or pipe EOF is not proof of child termination.

An independent stdlib byte-only reader must validate original source/resource,
semantic and profile joins without producer imports or replay. Bound duplicate-
free profile JSON, node IDs/references, sample/timeDelta cardinality and finite
recorded timestamps; retain unknown frames and unusual signed deltas explicitly.
Report samples and recorded sampling-interval weights separately for CPU,
AT scheduler/devices, GC and unknown frames, with raw originals. Samples are
not exact CPU cost shares, causation, allocations or whole-process startup;
whole-child wait4 CPU/wall metadata stays separately labeled. No profiling
number enters either unprofiled paired gate or grants a gain, optimization,
clock change, physical RTx, full-AT or OS claim. Completion requires exact-head
hosted semantics/resource/cleanup success and root plus independent original-
packet audits. One branch-push diagnostic only, no PR/dispatch duplicate.

### First audited ordinary core/AT profile

The sole [capture 38676056750](https://github.com/CrispStrobe/bw-board/actions/runs/38676056750)
ran at diagnostic source `baf67b9f17e3db25c0346e06575b64e4bf4f112a`, with
engine source `4d17e27c6bb1b3b329ccb53620d342c3b031e672`. Root and peer
independently checked original source/runtime bindings, CPU/device goldens,
resource limits, child CPU-time sums, raw service cleanup and profile accounting.
Original [artifact 11945903631](https://api.github.com/repos/CrispStrobe/bw-board/actions/artifacts/11945903631)
is 44,497 bytes, ZIP SHA256
`07e1710a1730b0f0156f1d09163551919efaa29ad3c3342356ca5638386f7e46`.

The host was EPYC 7763, Node 20.20.2, one-CPU affinity/quota and 1 GiB/no swap.
All leaf samples remain accounted for, with no nonpositive deltas:

| Sample role | Core | AT |
|---|---:|---:|
| CPU source | 298 | 190 |
| AT scheduler/device source | 2 | 40 |
| GC | 9 | 11 |
| Node builtins | 58 | 47 |
| Fixture | 17 | 20 |
| Unresolved | 14 | 8 |
| Total | 398 | 316 |

Aggregating names across call sites, core leaders include `_stepInstruction`
(120), `step` (48), `maskFor` (31) and `_decodeEA` (29); AT leaders include
`_stepInstruction` (60), `maskFor` (31), `step` (22) and `_fetch8` (22).
Recorded sampling intervals are 476,751/387,322 microseconds and include
represented startup, source loading, setup and compilation. They are not a
paired speed comparison, exact CPU cost shares or allocation counts. They also
do not replace the distinct Node 22 timed-loop throughput record. No capture
was repeated. The width-mask hypothesis below requires its own current-baseline
unprofiled gate; it has no measured gain or adoption from these samples.

## Ordinary-JS width-mask literal specialization

Status: claim591 merged; [CPU PR594](https://github.com/CrispStrobe/bw-board/pull/594)
merged as `bfe99d562e9b57a819ec92025faafba271b8751c` after all eight enabled
checks passed, adopting only the isolated literal-mask change on `bw-board/master`.
Its [new paired result](I80386-WIDTH-MASK-PAIRED-RESULTS.md) passed the named
gate and both root/independent peer original audits. Measurement PR601 merged as
`503ab56359f4968ea59deaf77933102cd0bc7a41` after all nine enabled checks passed;
No installed consumer pin is updated or qualified. Own only `maskFor` in `src/experimental/i80386.js`, new
`test/i80386-width-mask-specialization.test.mjs`, this section and its registry
entry. Use `lane/386-width-mask-specialization-20261015`. All other CPU methods,
decoders, device/scheduler/clock code, existing tests, benchmarks, policies,
workflows, pins and historical receipts remain outside scope.

The concrete hypothesis is to return literal `0xff`/`0xffff` for widths8/16
instead of computing `2 ** width - 1`; retain the existing unsigned 32-bit mask
`0xffffffff` and unchanged arithmetic fallback for every other width. Do not
introduce a lookup allocation, widen accepted instructions, export the helper,
cache callbacks or reorganize `_stepInstruction` dispatch. Existing sampled
CPU/width-helper frames motivate inspection, not an exact cost or gain claim.
This single helper feeds arithmetic, logic and shifts, so a small patch still
requires independent architectural coverage.

Freeze a fresh ordinary board-master baseline containing adopted word-fetch
CPU SHA256 `2303557f35ad56d8101eb96ffc8749fa4d64338425726027d70bd64a6b10d4ba`,
and authenticate the tested candidate separately. Do not include unadopted
PR557 scalar-EA changes or use its `ce19` CPU as baseline. Preserve its original
private gate and all old paired source admissions; no isolated gains are
multiplied or credited to a combined candidate.

Authored tests must independently calculate 8/16/32-bit unsigned results,
carry/borrow, overflow, auxiliary carry, sign/zero/parity and high-bit masking.
Cover ADD/ADC/SUB/SBB/CMP and logic/shift/rotate consumers, zero/masked counts,
operand-size overrides and register/memory forms. Retain untouched register
halves, exact read/write/fetch order and original exception identity. Include
first/second-byte operand faults and memory-write refusal with source-defined
rollback/partial effects; never invent an internal counter or memory rollback.
Check fallback widths through existing internal consumers without exporting
new test-only authority. Run affected existing width/flags/opcode/fault suites;
full source CI requires `ci:full` and affected hosted xv6/guest acceptance with
exact source bindings. Tiny authored tests only locally, no full guest/build.

After source/semantic review, a separate merged measurement scope must freeze
current baseline/candidate source maps and identical new workload/runner roles
before one unprofiled hosted paired capture. Preserve ABAB warmups, seven
fixed measured pairs, whole-child CPU/wall, original semantics, one-CPU/1GiB
resource enforcement and explicit cleanup. Require median CPU ratio at least
1.03, all seven ratios above one and wall median no worse than1.02; no retry,
dropping or replacement. Old fixture CLIs/policies stay immutable. A failed or
unmeasured gate means no adoption. No 10x target, exact cost share, physical
RTx, OS, GUI/CLI consumer or original-private-gate qualification is claimed.

## Ordinary-JS byte-register selection experiment

Docs-only claim. Merge ownership before coding. Freeze an independently reviewed
ordinary-instruction workload and semantic goldens before CPU implementation.
The baseline is the adopted literal-mask CPU, SHA256
`8f92cc4f8117d2371b493a7ee5a49dbf0245d1367f050194680f68a1454a9846`;
freeze the exact source revision and complete source map before execution rather
than following later main changes silently. The retained AT profile predates
this CPU and does not establish a current byte-register cost share or gain.

Own only `_reg8` and `_setReg8` in `src/experimental/i80386.js` and new
`test/i80386-byte-register-specialization.test.mjs`. Investigate explicit scalar
selection only for strict literal numeric indices 0 through 7, covering
AL/CL/DL/BL/AH/CH/DH/BH. Preserve the original
fallback exactly: `_reg8(8)` reads the high byte of ESP, whereas `_setReg8(8, v)`
writes AH in EAX. An `index & 7` rewrite is not equivalent. Keep string, boolean,
fractional, NaN, BigInt, Symbol and object index behavior, including original
errors and coercion side effects. Preserve upper register bits and unsigned
storage. Preserve evaluation order: read the old register before `value & 255`;
do not hoist value coercion or cache fields across observable coercion hooks.
No other method, fetch/decoder/flags behavior, device or scheduler is included.

Before CPU implementation, require either a current adopted-CPU scoped profile
supporting this investigation, or a predeclared representative ordinary AT
machine paired control alongside the byte mix. Freeze the control's unchanged
workload, independent semantics, candidate comparison, resources and explicit
no-material-regression acceptance bounds before implementation. Adoption must
satisfy that AT non-regression requirement as well as the byte-mix gate; a
selected byte-register mix alone cannot justify whole-AT speed claims. The
pending unpaired operational AT run is not a paired candidate control and must
not be duplicated for this purpose.

Focused controls enumerate all eight byte registers, high-bit values and
high/low aliasing; run the new tests against baseline and candidate. Add
nonstandard index and value-coercion adversaries, including register mutation
inside object coercion. Existing ALU/vector regressions, faults and an affected
clean free-guest result remain mandatory. Host controls alone do not qualify
CPU adoption.

Own new `scripts/i80386-byte-register-paired/{fixture.mjs,run.py,policy.py,reader.py,controls.py,README.md}`,
`test/i80386-byte-register-paired-fixture.test.mjs` and
`.github/workflows/i80386-byte-register-paired.yml`. Independently freeze a
balanced all-eight-byte-register ordinary `CPU.step` stream, including register
and memory operands and meaningful unchanged 16/32-bit controls. Independently
compute per-step registers/flags, callbacks, work counts and full-memory digest.
Do not time direct helper loops, select a winning mix after seeing results or
reuse previous benchmark bodies as new observations.

Use separately named admissions/schema and fresh complete source maps with a
CPU-only arm difference, common workload roles and a fixed runtime. Preserve
ABAB warmups then seven fixed AB,BA,AB,BA,BA,AB,BA pairs, all 18 whole-child wait4
CPU/wall records, owned one-CPU/1 GiB/no-swap resources, affinity and observed
cleanup. Gate unchanged at median CPU A/B at least 1.03, every measured pair
above 1, and median wall B/A at most 1.02. Preserve the first failure and all
original captures; no selective retry. Actual workflow is push-only on the
owned measurement branch, first attempt, after source review and affected guest
success; no duplicate PR or manual measurement dispatch.

Keep source and measurement candidates draft until their required gates pass.
Any adoption is a separate combined admission of source, semantic, free-guest,
latest enabled CI and this new performance gate. Do not edit old experiment
maps/workflows or PR557's original gate, multiply earlier ratios, claim a
composite candidate, move a consumer pin or infer physical RTx/full-OS support.

## Mixed-width ALU public paired measurement

Status: claim597 merged; [PR601](https://github.com/CrispStrobe/bw-board/pull/601)
published the separately versioned harness. The sole [original result](I80386-WIDTH-MASK-PAIRED-RESULTS.md)
passed all 18 semantics and the CPU/wall gate (median 1.213153522442 CPU ratio,
minimum 1.1923036855965443, wall median 0.8269209820340158). Root original audit
and independent peer audits passed. PR601 merged as
`503ab56359f4968ea59deaf77933102cd0bc7a41` after all nine enabled checks passed.
CPU PR594 merged as `bfe99d562e9b57a819ec92025faafba271b8751c` after all eight
enabled checks passed; adoption is limited to `bw-board/master`, not an installed
consumer pin.
Owned paths:
`.github/workflows/i80386-width-mask-paired.yml`,
`scripts/i80386-width-mask-paired/{fixture.mjs,run.py,policy.py,reader.py,controls.py,README.md}`,
`test/i80386-width-mask-paired-fixture.test.mjs`, this section and its registry
entry. Use `lane/386-width-mask-public-paired-20261015`. Do not edit any existing
paired fixture, admission, policy, workflow, CPU, device, clock, pin or receipt.

Freeze A at `3646417a959b5aa9f93ac446398ea9cacd5a6da5`, CPU SHA256
`2303557f35ad56d8101eb96ffc8749fa4d64338425726027d70bd64a6b10d4ba`, and
B at `f6863484d02b4c4b0ce56415054f2e6a0c154097`, CPU SHA256
`8f92cc4f8117d2371b493a7ee5a49dbf0245d1367f050194680f68a1454a9846`.
Authenticate fresh Git/live extent-and-SHA maps for the same 43 selected engine
paths, including package resolver metadata; all 42 non-CPU rows must match.
Also authenticate identical new fixture, runner, policy, independent reader,
controls, README, test, workflow and package roles against one exact publication
commit. Every reused executable helper needs an immutable pin in that graph;
never invoke an old runner/evaluator main or change its admissions. PR557's
unadopted scalar-EA candidate and original private gate remain separate.

Name this `MIXED_ALU_WIDTH_PUBLIC_24_INSTRUCTION_MACRO`, with separately
versioned child/result schemas. Ordinary `I80386.step()` runs actual authored
code and byte-memory callbacks; no direct helper-call microbenchmark or native/
block/cache opt-in. Per pass execute ADD/SUB accumulator pairs for widths8/16/32,
ADD/SUB memory pairs at DS:2000 for each width, paired XOR sign-bit toggles for
each accumulator width, then three width-specific CMP and three TEST operations.
The proposed stream is 106 bytes/24 retired instructions, with explicit66
operand-size overrides. Initialize EAX=`0x12345670`, DS=`0x0000`/CS=`0x1000`, and bytes
`0x10/0x32/0x54/0x76` at `0x2000`. Independent expected end state restores EAX and memory,
ends IP106/EFLAGS2, and leaves all other registers unchanged. Host rewind of
IP is common timed work; 100000 passes means 2.4M actual instructions.

Before fixture freeze, tiny authored per-instruction byte-bus controls must
reconcile the proposed 106 fetched bytes, 14 operand-read bytes and 14 written
bytes per pass, exact addresses/order, flags and register-half preservation.
These counts are design expectations until independently checked, not results.
Derive a full-memory digest and instruction/work/address sums from the authored
initialization; both arms must match that independent oracle, not merely each
other. Include width/override/read-write-fault/refusal controls without running
the full macro locally. Preserve error identity and genuine partial effects.

Use Ubuntu24.04/Node20.20.2 with executable bytes checked before/after children.
The wrapper and children share an observed owned cgroup: one logical-CPU
affinity, cpu.max `100000 100000`, memory.max `1073741824`, swap.max0;
verify membership, affinity, limits and zero pressure events before/pre-exec/
after each child. No 1GiB virtual-address-space limit. Reuse reviewed bounded
wait4/stream/owned-cleanup mechanics transparently. Keep 60-second child and
fixed service/job deadlines, original capped stdout/stderr and exact owned
unit/cgroup cleanup facts; EOF/client timeout cannot establish termination.

Four ABAB warmups precede seven fixed measured pairs AB,BA,AB,BA,BA,AB,BA.
Whole-Node wait4 user+system CPU and matching monotonic wall include setup,
rewind, checks and hashing. No profiler is active. Require all18 independent
semantics, median CPU A/B at least1.03, every CPU ratio strictly above1 and
median wall B/A at most1.02. Preserve all ratios and conditional99.21875%
minimum-ratio assumptions; no retry, dropped/replaced rows or cherry-picking.
The independent original-only reader imports no producer validators or replay
code and rejects partial/source/resource/semantic/cleanup mismatches.

The sole branch-push hosted actual waits for root/peer frozen-source and reader
review, tiny controls and affected exact-candidate hosted CPU/guest correctness,
including required full-CI and latest transition gates. No duplicate PR/manual
measurement. Root/peer admit terminal metadata and audit the sole original
packet before conclusions. A failed/unmeasured gate means no PR594 adoption.
This named ALU mix cannot replace the original private gate, multiply isolated
EA/fetch gains, establish a combined candidate, physical RTx, OS or consumer
qualification, or support an unmeasured 10x claim.


## 386 debugger capture and capability correction

Status: the correction merged in [PR599](https://github.com/CrispStrobe/bw-board/pull/599)
at `05123db4`; the separate finite subscribed free-guest qualification below
also passed. Consumer adoption and installed-GUI qualification remain pending.
The following scope and requirements are the regression contract for that
landed correction, not an unimplemented task.

Historical branch: `lane/386-debugger-capture-20261015`. Scope: new `src/i80386-debug.js`,
new `test/i80386-debug-capture.test.mjs`, the 386-only composition in
`src/debug-target-factory.js` and narrow capture/address/capability seams in
`src/i8086-debug.js`, preserving all 8086 defaults and other target behavior.
Also own only the unsigned 32-bit memory-address normalization seam in
`src/instruction-debug-events.js`, preserving all other target defaults and
event formats. This section and the matching registry entry complete the scope. CPU execution,
devices, clocks, supplier pins, workflows and performance experiments stay
unchanged; the separately owned width-mask CPU work must not be included.

Before the correction, the factory composed the 386 adapter with the shared
8086 debugger and its event capture called the AT's rejected legacy register
snapshot. A subscriber could throw before an instruction retired. That original
failure remains preserved. The dedicated 386 wrapper now supplies read-only
forward capture and explicit capability limits; the former AX projection,
20-bit addressing and 8086 decoder do not qualify protected-mode debugging.

Retain the read-only, source-owned 386 register snapshot and event capture
without calling the rejected legacy snapshot or mutating the machine.
Expose full-width EAX–EDI/EIP/EFLAGS and relevant architectural mode/segment
state with unambiguous linear versus physical/code-address meaning. Derive
addresses from actual cached segment state and EIP; do not reconstruct them
from visible selectors or truncate them to 20 bits. Publish only supported
address ranges and operations. Preserve existing event ordering, breakpoint
semantics, instruction clocks and original fault behavior. The shared event
module formerly used bitwise address masking, which made addresses above
2 GiB signed when given a 32-bit mask. Keep admitted 386 memory facts normalized
to unsigned 32-bit values at their source; do not repair already truncated
facts with a post-hoc target wrapper.

Mode-aware instruction disassembly and step-over/out must either be correct
for the supported 386 mode or explicitly unavailable/refused. In this first
phase, gating unsupported protected-mode/32-bit decoding is acceptable;
feeding it to the 8086 decoder under a 386 label is not. No full disassembler
rewrite or generic debugger framework is required. Keep 386 architectural
checkpoint/restore/replay refused; forward capture does not grant reverse
execution or a continuous machine-state lease.

Retain the owned controls mapping a 64 KiB NOP ROM at the real reset alias and
proving subscriber/no-subscriber parity: one NOP retires once, EIP advances,
faithful before/after events are emitted and no legacy capture exception
occurs. Check high register halves, reset CS cached base, addresses above
1 MiB/high EIP and memory facts above 2 GiB (including a signed-negative
regression adversary), real/protected mode distinctions, explicit unsupported decoder
and step-over/out refusals, and faults/partial state without invented rollback.
Verify unchanged 8086 register/event/breakpoint/disassembly behavior and
checkpoint admission. Preserve the original subscriber failure separately;
never hide it by removing the listener or replacing actual CPU execution.

Freeze the source and pass focused controls and existing affected debugger/
opcode regressions before hosted affected free-guest qualification with exact
source identities. All enabled exact-head CI must pass before normal matched
merge. A later coordinated Lite supplier update and installed free-client
journey must verify visible completion/input, pause/breakpoint/step, register
and memory inspection, resume and pane switching. This claim does not own
Lite's shared package files or qualify its current installed package. No new
media acquisition, licensed guest, performance gain, physical RTx or whole-OS
compatibility follows from this correction.

## Subscribed 386 free-guest debugger qualification

Observed checkpoint: the sole corrected-source [run38716662156](https://github.com/CrispStrobe/bw-board/actions/runs/38716662156)
passed original-byte review: byte-identical MIT xv6 control/subscribed reports,
64 consecutive retirements including five actual protected 32-bit ring-3
instructions, and 206 physical memory facts. See the [finite result](I80386-DEBUG-GUEST-RESULTS.md).
PR599 and PR607 merged after all enabled checks passed. The debugger merge is
`05123db4` and the harness merge is `efe62e46`; the final harness merge preserves
all 88 reviewed source and qualification identities and the six tested harness
files. Consumer pin adoption and installed-GUI qualification remain pending.
This does not qualify an actual IRQ-event window, checkpoint replay or timing.

Status: ownership claim602 and the source/harness changes are merged. The
finite subscribed free-guest result above is observed; installed-consumer
adoption remains separate.
Own only new `scripts/i80386-debug-guest/{observer.mjs,reader.py,README.md}`,
`test/i80386-debug-guest-observer.test.mjs`,
`.github/workflows/i80386-debug-guest.yml`, the narrow opt-in integration in
`scripts/probe-xv6-stock.mjs`, this section and its registry entry. Use
`lane/386-debug-guest-20261015`. The five runtime debugger files published in
[PR599](https://github.com/CrispStrobe/bw-board/pull/599) remain unchanged;
no product adapter, CPU/device/scheduler, package pin, existing workflow,
MIT guest source, Bochs firmware or media changes are owned.

Run one separately named hosted qualification pair: an unobserved control and
an observed run on identical authenticated source, unchanged existing free
xv6/Bochs inputs and one fixed established 4M marker or14M boot invocation.
Select and freeze the exact invocation before execution, not whichever passes.
Keep original guest code/bytes, command injection, stop conditions, wall/step/
memory limits and native-block settings identical. Preserve their original
reports plus a separate bounded observer receipt; do not modify guest success
criteria or invent baseline evidence from a historical receipt. Existing
completed diagnostics are not replayed just to read them.

The source-owned observer composes the actual guest machine with
`createI80386DebugTarget({machine})`. It must preserve and chain existing serial,
port and interrupt hooks. Install the subscription at the first predeclared
eligible boundary: PE true, VM false, cached CS default32, CPL3, not halted.
The probe's normal `machine.step()` and its existing loop/budget accounting
remain the execution authority. Do not substitute `target.step`, `runFor`, an
extra CPU step or different tick budget; target construction/subscription and
observation must not advance the guest.

Count actual completed instruction events and validate their before-state
mode; an interrupt between eligibility and CPU execution must not be relabeled
as a ring3 retirement. Retain at most64 completed-instruction observations,
1024 memory facts and a fixed1MiB observer-byte cap. Require at least one
actual protected32 ring3 retirement; missing eligibility/window completion
within the unchanged original bound refuses. Preserve mixed-mode events
honestly if an interrupt occurs. Stop collection and unsubscribe after the
ordinary machine-step boundary, not midway through event publication. Latch
observer-cap/refusal facts without silently dropping them or changing guest
execution to make a diagnostic pass; always attempt unsubscribe in finally.

At the window boundaries, copy direct architectural/control/segment-cache,
CR2, device clock/debt, VGA latch and translation-cache metadata scalars; avoid
snapshot/I/O operations that flush clocks or walk pages. Compare captured
full-width registers and linear PC with actual cached CS-base plus EIP. Check
unsigned physical memory facts, without requiring this guest to access above
2GiB naturally (tiny high-address controls cover that). A source-owned regs
and safe known-RAM/VGA read observation must leave those fields/latches and
memory unchanged. Do not claim arbitrary MMIO reads nonmutating or copy all
RAM per instruction. Preserve original faults and source-defined partial
state; forward capture grants no checkpoint/replay authority.

The complete ordinary guest reports must agree control versus observed,
including serial/input, milestones, CPU/control/cache snapshot, ATA/PIC/PIT/
other device facts, screen, step counts and original success criteria. Freeze
any necessary source-identity-only projection explicitly; no arbitrary field
exclusions or regenerated successful reports. An independent byte-only reader
imports no producer validators and joins original reports, observer prefix/
count/digests, mode/address/register facts, source/runtime/media bindings and
capture/unsubscribe/refusal state. Partial/capped/uncertain originals never
promote qualification. Root and peer admit official metadata and audit the
sole original packet without replay before conclusions.

Freeze the exact complete transitive import/data/runtime source graph before
Node loads the observer, including the newly fixed observer/target/helper
roles and unchanged guest/build/firmware identities. Review consequences for
existing fixed source inventories before coding; no blind count/pin update,
source-row omission or old-proof waiver is allowed. Any needed changes outside
the paths above require a separately reviewed ownership extension first.
Meaningful tiny source-owned observer/reader controls run before hosted work;
no full guest, resource setup or build locally. One attempt1 branch-push hosted
pair after frozen source/reader reviews, no PR/dispatch duplicate or retry.
All enabled exact-head CI and affected debugger/8086 regressions remain required.
This is finite subscribed free-guest acceptance, not installed Lite GUI/CLI,
mode-aware disassembly, whole-OS compatibility, performance or physical RTx.


## Explicit raw HDD export and reload

Reached source and finite CLI checkpoint: detached Buffer/subarray ownership
[PR612](https://github.com/CrispStrobe/bw-board/pull/612) merged at `3ab0ac59`,
the synchronous master-only idle-copy helper
[PR616](https://github.com/CrispStrobe/bw-board/pull/616) at `27f69c31`, and
exclusive CLI `--hdd-output`
[PR618](https://github.com/CrispStrobe/bw-board/pull/618) at `3e9429f2`, after all enabled CI checks, including the existing affected guest
regressions. The helper is in
[`src/i80386-adapter.js`](../src/i80386-adapter.js); the console route is in
[`scripts/run-i80386-at-console.mjs`](../scripts/run-i80386-at-console.mjs).
These phases are completed; preserve their detached copies, exact CHS/extent,
64 MiB preallocation cap, ATA-idle checks and unchanged command/timing behavior.

The deferred paused-target snapshot API qualified and merged in
[PR623](https://github.com/CrispStrobe/bw-board/pull/623) at `48635add`; optional
floppy boot qualified and merged in
[PR620](https://github.com/CrispStrobe/bw-board/pull/620) at `6bbec520`. Consumer
adoption and installed-GUI qualification remain pending. A target snapshot must establish its stopped
ordinary-JS boundary, return detached bytes and copy-time counters, and keep
later digest completion distinct from live state. Device quiescence alone does
not prove the target is paused. No physical durability or architectural
checkpoint claim follows.

The merged CLI creates an exclusive verified raw output, preserves input bytes
and first errors, and reports input and stored-output identities separately.
Retain existing/symlink/same-input refusal and partial-file failure behavior;
no autosave or implicit writeback. A stopped budget or user quit plus a verified
copy is not guest completion or filesystem-flush evidence. Existing historical
write/readback receipts keep their original scope. The separately admitted
[run38806122785 result](I80386-HDD-PERSISTENCE-RESULTS.md) now qualifies the finite
guest-write/close/export/fresh-CLI readback route. [PR625](https://github.com/CrispStrobe/bw-board/pull/625)
merged at `cb5058e5` after all nine enabled checks passed, with all 87 tested
source rows retained. Coordinated supplier adoption and genuine installed-GUI
download/chooser reload remain the next consumer gates.

Meaningful controls cover Buffer/subarray aliasing, absent/busy media, copy
bounds, CHS mismatch, existing destination, symlink and same-input refusal.
The qualified bounded hosted scenario uses unchanged freely licensed firmware/guest
inputs and an authored marker: guest writes and closes a file, reaches a
safe observable boundary, exports, then a fresh machine with that exact raw
image and geometry reads the marker. Bind original input unchanged, exported
hash/length, both guest results and source/runtime/media identities. A byte-only
independent reader audits the sole original packet; do not replay old successful
diagnostics just to read them. All enabled exact-head checks and affected guest
qualification precede merge. Lite separately qualifies genuine browser download
and chooser reload after coordinated supplier adoption.

The finite raw-HDD acceptance may use new
`scripts/i80386-hdd-export/probe.py` as a dependency-free standard-library PTY
transport and orchestrator, with new `controls.py` for manufactured disk and
mock-PTY controls. Preserve the already owned `probe.mjs`, independent
`reader.py`, `README.md` and dedicated workflow roles. Existing PTY harnesses
remain unchanged. Reuse their reviewed
terminal lifecycle ideas transparently, not their old guest success as evidence.
The ownership extension merged in [PR622](https://github.com/CrispStrobe/bw-board/pull/622)
before implementation. The new [helper guide](../scripts/i80386-hdd-export/README.md)
describes the implemented runner, directory consistency mode, original-artifact
admission mode and fixed free input policy. Local manufactured byte and mock-PTY
controls and hosted helper qualification passed. Root and independent original
reviews admitted the sole corrected guest write/export/fresh-process reload;
the first failed run and all raw flags remain preserved.

Preserve the qualified two-process recipe: an admitted free boot floppy plus
required authored master data disk, then that same floppy with the exact
exported master. The first writes and closes a new marker, observes its contents
and a later prompt, then creates an exclusive verified HDD output. The second
only reads the marker and returns to a prompt. Require complete bounded PTY and
stderr originals, input transcript, separate CLI reports, source/runtime/media
identities, exact exit/reap/EOF and owned cleanup; EOF or timeout alone is not
termination. Preserve both original inputs and all first failures. A strict
independent disk proof must check initial marker absence, final directory/FAT
chains/data and all permitted byte differences, not only file-name matches.
A disk-byte consistency result is not full acceptance: terminal, process,
source/runtime and official-original joins remain separate mandatory gates.

Before the sole bounded hosted actual, qualify the optional-floppy CLI source
and its parents, freeze the complete new transport/reader/workflow and executed
source graph, independently review the original-byte reader and controls, and
admit exact existing free media with component notices and license obligations.
Do not acquire or bundle images implicitly. No local guest/build, CPU/device
change, broader OS, installed GUI, physical timing or crash-durability claim is
introduced by this transport scope.

## Bounded DOS package admission

This follows disk export/reload and has its own source, tests and acceptance.
[Initial PR637](https://github.com/CrispStrobe/bw-board/pull/637), at
`a4decd3e3a8e3efe9c2462defd09ef3a78e1e0ee`, introduced a separate pure policy,
Node ZIP adapter, CLI and hosted acceptance candidate without changing shared
package dependencies. [PR646](https://github.com/CrispStrobe/bw-board/pull/646) integrates the
manifest-ordering repair with main. Its fixed authored package passed the
[hosted CLI acceptance](#dos-package-cli-hosted-pty-acceptance); broader packages
and installed GUI use need their own qualification.
Select one explicit config, or one unambiguous supported default; never guess among
multiple runnable configurations. Preserve full canonical archive paths and
resolve media relative to the chosen config. Basename matching is insufficient.

The initial candidate admits only one raw HDD with exact CHS for the functional
386 AT. DOS-service COM/MZ virtual files remain future work. Its exact closed
command grammar is documented in the candidate; the existing runners keep
their separate parsers and interfaces. Reject unknown commands, command chaining, external host paths/URLs, ambiguous mounts or entry
points and unsupported devices. Do not execute package JavaScript, scripts or
arbitrary autoexec. A DOS-service route is not an extender-capable DOS boot.

Preflight original ZIP local/central records before a decoder can sanitize or
collapse names. Bound compressed input, entry count, decoded per-file and total
bytes, expansion ratio, config size and extraction work; verify CRC and topology.
Reject traversal, absolute/UNC paths, duplicate/case aliases, conflicting ancestor
paths, links, encryption, unsupported ZIP64/multidisk/descriptors or malformed
extents. The initial candidate is STORED-only; DEFLATE remains unsupported.
Use an immutable in-memory asset map, not filesystem extraction or network fallback.
Browser and Node codecs must enforce the same policy; a decoder's final object
map alone cannot establish original-name safety or memory bounds.

Authored tiny archives exercise exact bytes, config-relative subdirectories,
file lookup, collisions, truncation, CRC, caps, ambiguity and unsupported commands.
Then qualify the same free/authored package through CLI and the actual installed
GUI, with selected target/media identity, visible output/input and retained
failure UI/session behavior. Integrate existing runners only through their
reviewed interfaces; claim any additional runner changes before coding. Keep
existing 8086 and wired routes distinct. No dependency pin change belongs here.

ISO/CD-ROM is a later device lane: it requires an actual ATAPI command/data/IRQ
path plus firmware and guest support before a picker can promise it. An ISO
extension or renamed raw HDD cannot supply that implementation. A future ISO
lane needs separately merged ownership and authored/free acceptance fixtures.

The [hosted PTY acceptance](#dos-package-cli-hosted-pty-acceptance) below records
the completed finite CLI result and its remaining limits.

## DOS package CLI hosted PTY acceptance

Status: finite authored-package CLI acceptance REACHED at the source below.
Integration still follows the live PR and all enabled exact-head checks.

The [PR646 hosted run](https://github.com/CrispStrobe/bw-board/actions/runs/38937680307)
at source `cbcfff7e3b143dc07af9c2807055d0ca5556ce9d` passed the unchanged
standalone reader and a second independent original-byte audit. The sole
23-role packet has SHA-256
`68799e1dbc3e023c39829c1e2b24737644375c8f8bedee53ea9e4e1f6e453953`.
The authored `a` and `b` sessions displayed their distinct predicted responses;
their CLI processes exited with status zero after the fixed step budget.
Malformed-package and focus-loss cases refused with status one. All four fresh
serial cases ended with the original terminal settings; terminal groups were empty and no
new OOM events were observed. The 57 source files and retained runtime identities
matched before and after execution.

This qualifies the fixed authored package and finite CLI behavior. It does not
qualify guest completion, a DOS kernel, protected-mode software, general DOSBox
packages, installed GUI behavior, listener enumeration or performance/RTx.
The accepted actual is consumed: preserve it and all prior failed/refused events;
never repeat its label, dispatch, run or artifact/log download. Refresh the
[live PR646 integration status](https://github.com/CrispStrobe/bw-board/pull/646)
and every enabled final-head check before a source merge.

The [ownership extension PR638](https://github.com/CrispStrobe/bw-board/pull/638)
merged before implementation. Initial PR637 failed before guests; PR640 reached
one response but failed its terminal deadline; PR641 completed its cases but
failed reader manifest ordering. PR644's sole label has no observed run and its
integration conflict was confirmed. PR646 preserves those originals and uses
a distinct admitted event, with the manifest repair and current main included.

The [PR641 attempt-1 run](https://github.com/CrispStrobe/bw-board/actions/runs/38913512631)
completed all four fresh cases: the authored `a` and `b` responses with natural
zero exits, and the expected malformed-path and focus-loss refusals. All four
ended with the original terminal settings; source/runtime identities matched
before and after, with empty terminal groups and no observed OOM events.
All 22 manifest rows had the expected bytes and hashes, but `Path` sorting put
`inputs/authored.zip` and `inputs/malformed.zip` before `inputs.json`, contrary
to the reader's lexical string order. Preserve that refusal and original packet.
PR644 sorts the completed rows without changing file traversal, role hashes,
reader assertions, fixtures or limits. Earlier PR637 and PR640 failures remain
preserved. Source controls and official workflow success alone do not complete
the original-reader acceptance gate.

No other runner, policy, parser, dependency, pin or other-owner change belongs
to this acceptance task. GUI adoption and its consumer prerequisites remain
separate.

Freeze the exact finite protocol and artifacts before launch. Generate a tiny,
deterministic MIT-authored bootable raw HDD, exact CHS, supported config,
license text and STORED ZIP. Independently review the bootstrap bytes and
expected visible/input-dependent actions. Admit fixed external BIOS/VGA hashes
and lawful acquisition/publication limits separately; do not bundle restricted
media or add a network fallback. The authored bootstrap provides no DOS kernel,
protected-mode, whole-disk, full DOSBox, physical timing, installed GUI or RTx
claim.

The completed protocol uses four fresh, serial hosted cases through the actual
unmodified CLI:

1. The admitted package with live keyboard `a`, actual observed readiness
   and a later distinct authored, key-dependent guest response.
2. The same initial package with live keyboard `b` and its independently
   predicted different response. Initial terminal focus-in must remain a
   positive control, and accepted make/break chronology must be observable.
3. A newly authored malformed ZIP with explicit visible package refusal and
   failure exit; source-order controls separately check pre-import admission.
   The actual PTY does not trace runtime module imports.
4. An admitted package followed by terminal focus loss, with explicit refusal,
   no resumed input session and restoration observations. This negative does
   not claim runtime modifier release or full focus-resume interaction.

The Python producer must launch the real CLI through a hosted PTY, with fixed
argv, firmware and original input bytes. Retain raw PTY input/output and input
chronology, actual terminal modes, visible guest action, final report, first
execution error and secondary capture/cleanup/retention errors. Retain actual
executable/runtime observations, source before/after, exit/wait/reaping facts,
process-group and cgroup cleanup, memory/CPU/output counters and OOM deltas.
A manufactured report, accepted input alone or a controller budget stop cannot
substitute for actual guest consumption and resulting visible action. Preserve
ordinary machine scheduling and the approved scan pacing. Do not use sleeps
or retries to select a passing guest.

Before implementation is admitted for actual execution, freeze exact schemas,
fieldsets, artifact roles, path sets, byte/count/output/PID caps, readiness and
key/quit/cleanup rules. Freeze the full Git/live static and dynamic source/data
closure, including the seven candidate blobs, canonical parser, terminal helper,
functional machine/profile, controller, workflow and runtime/input identities.
Freeze official event/head/tree, attempt 1, sole actual trigger, job/step/artifact
joins and external approval/admission fields. Distinguish the tested checkout
from any later integration tree. Proposed bounds are one CPU, 1 GiB memory,
no swap, 120 seconds and 50 million total ordinary step calls from reset per
child, a 600-second controller and a 15-minute job. These are UNQUALIFIED until
the exact finite profile and resource/cleanup audit pass for this task.

The separate standard-library-only reader must never import the producer,
policy, ZIP adapter, CLI, emulator or an old acceptance reader, and must never
replay the guest. Independently parse the retained original package topology,
names/attributes/extents/CRC/caps, closed config, selected config-relative image,
CHS and frozen bootstrap bytes. Join original source/runtime/input identities,
raw PTY bytes, accepted scan spacing, terminal restoration, visible guest action,
failure chronology, resources and official event/job/step/artifact metadata.
Reject missing, extra or aliased roles and all source/input/runtime drift.

First run authored pure helper controls and independently reviewed reader
controls, including fully rehashed semantic mutations of commands, geometry,
member/role/CRC/topology, source/runtime identities, key order/consumption/response,
premature readiness, stop/refusal, restoration, official joins, OOM, status,
reaping and cleanup. These controls run locally without starting a PTY,
emulator, guest, QEMU, browser, compiler, build or installer. All enabled final
source checks and independent source/reader/envelope approval must succeed
before one hosted actual is authorized. Never repeat a failed actual merely
to obtain a selected pass.

After that sole actual ends, independently admit terminal run/job/step/artifact
metadata before acquiring each original artifact and log once. Require two
independent original-byte audits and every enabled exact-head check before
normal `--match-head-commit` merge, then verify actual tree and ordered parents.
Preserve first failures and uncertainty; no successful original is downloaded
or replayed again just to read it.


## Owned LE keyboard challenge/response

Reached a [finite owned LE keyboard result](I80386-DOS32A-KEYBOARD-RESULTS.md) in [run 38849884458](https://github.com/CrispStrobe/bw-board/actions/runs/38849884458) at tested source `c65edcb2cbbd45f19d1150e2461877f130ff1847`. Four fresh target/QEMU cases observed completed readiness, hardware input, exact key-dependent result files, zero exit and a separate shell return. The source is in `scripts/i80386-dos32a-input/`, `test/i80386-dos32a-input.test.mjs` and `.github/workflows/i80386-dos32a-input.yml`; the original [LE arithmetic result](I80386-DOS32A-OWNED-LE-RESULTS.md) remains separate.

One new owned 32-bit LE client consumes a real keyboard key after an observed, completed, unredirected `BW-LE-INPUT-READY` boundary. Fixed inputs are lowercase `a` and `b`; compute unsigned `(key * 0x01010101) ^ 0x5A5A5A5A` and retain `RESULT.BIN` as key byte plus little-endian result: `613b3b3b3b` and `6238383838`. The file must be absent initially. Check DOS create/write-count/close failures and return nonzero on failure; require zero exit before a separate shell verification command and fresh return marker/current prompt. Do not redirect readiness, stuff DOS buffers, mutate guest memory, or credit key acceptance alone.

Use four fresh serial executions: target/a, QEMU/a, target/b, QEMU/b, with identical newly authored client and initial media. Target evidence binds PE, CS.D and authenticated owned linear code at entry, consumption and response; do not demand an owned PC while DOS services are blocked. QEMU retains independent readiness VGA snapshots, QMP key events, disk result bytes and process outcomes; historical `pc`/`-cpu 486` is a 386-class compatibility oracle, not strict 386DX or matching architectural-state evidence. Compare exact result/exit/return files per input, not whole disks or clocks. Preserve ordinary target `machine.step` scheduling.

Freeze current Git/live import and data closure, generator/client hashes, independent arithmetic/encoding goldens, Node/QEMU/runtime observations, fixed FreeDOS/DOS32A/firmware identities and notices before execution. Preserve DOS/32 Advanced custom-license acknowledgement and firmware obligations; no new media bundling or blanket redistribution clearance. Reuse immutable public helpers only through exact reviewed identities; historical LE pins and results stay unchanged. Require independent original-byte reader checks, including wrong/stale/pre-ready input, missing release/consume, wrong mode/code, reused or identical responses, preexisting files, nonzero exit, stale prompt, missing shell return, QEMU substitution, source/media drift, missing roles and cleanup failures. Semantic mutants must be rehashed rather than rejected only by stale hashes.

The reached execution used four serial children, each bounded to 600 seconds (target additionally 120 million ordinary step calls), one CPU and 1 GiB/no swap, with an enclosing 2500-second controller and 45-minute job. The original ZIP contains 43 admitted roles and an unchanged 352-row source census; selected original FAT/root/file-cluster evidence and owned cleanup pass. Whole-disk byte proof remains false, and the raw FreeDOS acquisition archive/receipt was not retained. No performance, mouse/IRQ fidelity, DPMI, full OS, physical timing or installed GUI qualification follows. A next separately claimed owned LE32 fixture should check file reopen/read/seek/EOF, exact counts and buffer canaries; preserve existing arithmetic and CWSDPMI/high-linear gates.

## Owned LE file readback, seek and EOF

**Reached, finite application boundary.** [Source PR635](https://github.com/CrispStrobe/bw-board/pull/635)
landed at `1fbb9e64` after the sole
[hosted actual](https://github.com/CrispStrobe/bw-board/actions/runs/38860693983)
and independent original-byte reviews passed. The
[results](I80386-DOS32A-FILE-READBACK-RESULTS.md) record full reads of 17/31,
seeks to 12/26, short reads of 5 and EOF returns of zero, with actual protected
buffers/guards/counts in 155-byte proofs. The tested source is `a6671819`, tree
`078c09c4`; landed tree `3a3733d7` preserves the complete x86 runtime closure
while adding unrelated labwired work. The tested 353-row snapshot is not a
whole-merged-tree observation. The contract below describes this admitted gate;
it does not authorize repeating the successful actual or creating new ownership.
See [LANES.md](../LANES.md) for its nine paths. This successor extends the
[keyboard/write result](I80386-DOS32A-KEYBOARD-RESULTS.md) without repeating
LE arithmetic, CWSDPMI allocation or timer gates.

Generate one new 8192-byte LE32 client, without MZ stub or extender bytes. Use
identical client/initial media in four fresh serial processes: target/a, QEMU/a,
target/b, QEMU/b. After completed unredirected `BW-LE-FILE-READY`, offer case
key `a` or `b` with make and release through the guest keyboard interface.
No DOS-buffer stuffing, guest-memory injection or redirected readiness.

| Case | N | Payload byte at zero-based i |
| --- | ---: | --- |
| `a` | 17 | `(37*i + 0x11) & 0xff` |
| `b` | 31 | `(53*i + 0xa7) & 0xff` |

Initially and at READY, `DATA.BIN`, `RESULT.BIN`, `KEYOK.TXT`, `KEYFAIL.TXT`
and `RETURN.TXT` must be absent. Use explicit `C:` paths; the caller may remain
on `A:`. Require this guest sequence:

1. Create `C:\DATA.BIN`, write N payload bytes with checked carry/count, check
   close and reopen the same file read-only. Preserve the returned live handle.
2. Prefill a distinct 64-byte protected full-read buffer with `CC`; request N
   bytes, require carry clear/count N and exact payload, and preserve bytes N
   through 63 and both guards.
3. Seek that handle with origin zero and actual offset N-5; check the returned
   position. Prefill a separate 16-byte tail buffer with `CC`; request 8 bytes
   and require carry clear/count 5, exact last five payload bytes, eleven
   unchanged bytes and intact guards. This read crosses EOF.
4. Prefill a third 16-byte EOF buffer with `CC`, request one byte and require
   carry clear/count zero with the whole buffer/guards unchanged. Check close
   of the reopened handle.
5. Create `C:\RESULT.BIN` from actual returned buffers/guards, check its exact
   155-byte write and close, then exit zero. Preserve the first failure through
   secondary close/cleanup failures; errors must not produce success proofs.
6. The batch checks zero error level and writes `KEYOK.TXT` as
   `BW-FILE-EXIT-0\r\n`; require no failure marker and a current prompt. Only
   then offer `C:\VERIFY.BAT`, writing `RETURN.TXT` as
   `BW-FILE-SHELL-RETURN\r\n`, and require a fresh current prompt.

Each buffer has prefix and suffix `A5 5A A5 5A 3C C3 3C C3` (8 bytes each)
and must not alias another buffer, expected payload or proof. Serialize exactly:
ASCII `BWFR1` (5 bytes); case key, N, full count N, tail count 5, EOF count 0,
success byte `A5` (6 bytes); actual full/tail/EOF buffers (64/16/16 bytes); then
actual full prefix/suffix, tail prefix/suffix, EOF prefix/suffix (48 bytes).
The three count bytes must serialize saved ACTUAL DOS full/short/EOF returns,
after complete ABI-defined return-register checks and before narrowing to bytes,
joined to the immediate post-call witnesses. Their accepted values are N/5/0;
hardcoded expected counts or truncated unchecked registers are not provenance.
Freeze independent exact byte/opcode/branch goldens. The reader constructs exact
bytes independently, not from producer hashes. Never replace returned buffers
with golden data or serialize a static expected proof. Review/freeze the actual
DOS/32A calling convention, carry/count/seek fields and pointer interpretation.

Target preserves ordinary `machine.step`. Authenticate generated initial payload
and client, PE/CS.D and owned linear-code witnesses at entry, write-close,
reopen, read calls/returns, seek, closes and exit. Before every read retain the
original DOS service, live handle, requested count, DS:EDX-derived owned linear
destination, prefill and guards; after the real call returns capture original
carry/count and buffer/guards before validation or later stores. Before seek
retain original service, live handle, origin zero and ABI-frozen actual offset
N-5; after return retain carry and returned position. Before read-handle close
retain original service/handle and then its actual result. Join every such
handle to the successful read-only reopen result; recording counts or seek
results alone is insufficient. Bind segment identity, extents, nonaliasing and
causal order; an owned PC or final file alone is insufficient. Do not require
an owned PC while DOS is blocked.

QEMU TCG `pc`/`486`, 4 MiB with independent BIOS/VGA remains a compatibility
oracle. Retain actual QMP inputs, VGA boot/READY/response/final cuts, selected
original files and process outcomes; do not invent target registers for QEMU
or assert matching architectural state. At EVERY cut retain both FATs/root and
only clusters for the five owned names. Validate all current root chains and
admit EVERY selected cluster against copied immutable initial FAT before ANY
selected data copy. Deleting an initial foreign root entry does not authorize
its old clusters. The predecessor selector lacks `DATA.BIN`; new extractor and
reader must close the complete set. Independently prove initial/READY absence,
response data/proof/zero exit before VERIFY and final return. Exclude full disks,
client/extender binaries and boot-media sectors. Observed whole-image hashes
are not an independently rehashed whole-disk proof.

Freeze held helper identities at merged predecessor
`c0c880b6838ac118f36eac7eab7747d24535f9a8`: old
`scripts/i80386-dos32a-owned/{oracle.py,media.mjs,keyboard.mjs,acquire.py}`,
`scripts/lib/i80386-free-bios-fat16.mjs` and reviewed lifecycle/resource
primitives in `scripts/i80386-dos32a-input/source.py`. Authenticate exact Git/live
bytes before import. Do not use the old run/inventory/selector or reader to
qualify the new namespace. Keep old helpers/pins/CPU/devices/gates unchanged;
missing shared features need separate ownership. Freeze complete new Git/live
engine/import/data closure before imports and after all cases; identify/review
inherited main/model changes. Preserve fixed FreeDOS/DOS32A/firmware identities,
DOS/32 Advanced custom license/acknowledgment and firmware notices. Observe
runtime identities without complete dependency-authenticity claims. Do not
claim raw acquisition-archive/member proof when archive/receipt was not retained.
Previous successful guests/originals remain immutable references, never rerun
or reacquired. Only a separately admitted new actual stages fixed inputs for
this new client; no new binary bundle.

Before launch require CPU-free authored controls, exact source functions with
mocked boundaries, a complete manufactured packet/ZIP positive through a new
standalone standard-library reader and fully rehashed semantic negatives. Cover
omitted/reordered reopen/read/seek/close, wrong service/handle or seek request,
wrong counts/seek result, static/stale/wrong-case proof, mode/code/pointer or
buffer alias, changed canaries/untouched tails, nonzero EOF/modified EOF buffer,
early input/VERIFY, preexisting files, missing release/return and wrong exit.
Include a rehashed proof-header count versus immediate post-call count mismatch,
and correct seek result paired with wrong origin/offset or handle requests.
Also reject initially allocated foreign clusters at ANY screen/final cut before
any selected copy, malformed FAT/JSON/ZIP, missing/extra/duplicate roles,
source/media/runtime drift, engine substitution, official identity mismatches,
quota/OOM and cleanup errors. Include valid full/short/EOF positives so disabling
all reads cannot pass. Reader imports no producer/emulator; directory mode
proves consistency only. Finite success needs independent official/source/
runtime/original-role admission. Acquire each new original ZIP/log once after
metadata admission and audit unchanged bytes without guest replay.

Root/independent source/reader review, manufactured positives/rehashed negatives
and all enabled exact-head CI preceded the sole hosted actual. It completed four
serial children within 600 seconds each, one logical CPU/100% quota, 1 GiB
RAM/zero swap; targets also had 120 million ordinary steps, with a 2500-second
owned controller and 45-minute job. These bounds apply to this finite result,
not arbitrary clients. Preserve streams, wait4 status,
first errors, before/after/between-case resources and empty owned process-group/
cgroup proof; failed queries/reads reject cleanup and collected units require
the known wait. Require attempt-one job/prelaunch guards and exact head/event/
job/workflow/artifact/cleanup joins. No retry/relabel for a passing result.
Local work is tiny source controls only; guest/QEMU/build/acquisition runs are
hosted. Merge source only after original guest qualification and all enabled
final-head checks, with matched head and actual tree/parents verified. No
strict-386DX, DPMI/high-linear/timer, full-OS, whole-disk, mouse/IRQ, physical
timing, performance/RTx, installed-GUI or license-clearance claim follows.

The next dependency gate is the existing Lite HDD/GUI handoff, including its
unmerged [runner prerequisite PR986](https://github.com/CrispStrobe/brickwright-lite/pull/986),
consumer-owned checks, explicit dependency adoption and fresh installed acceptance.
The unrelated WeDo inventory policy failure was repaired on Lite main by
[PR998](https://github.com/CrispStrobe/brickwright-lite/pull/998), merged as
`d413bd2d`. The integrated PR986 and
[PR989](https://github.com/CrispStrobe/brickwright-lite/pull/989) heads have all
enabled checks successful as of 2026-10-16; those checks do not prove the
supplier API was adopted or the optional GUI persistence scenario ran.
[Proposed handoff PR1006](https://github.com/CrispStrobe/brickwright-lite/pull/1006)
records the remaining coordinated supplier/lock ownership, exact qualified
Board adoption and genuine installed download/chooser-reload gates. It transfers
no implementation or pin ownership. No consumer pin/notice change or repeated
supplier guest follows from this result; general DOS error-path behavior also
remains outside this finite qualification.

## Explicit 386 physical-memory capability metadata

Docs-only claim, after PR599 merge and explicit target-owner handoff. Own the
optional `spaces.mem` descriptor in `src/i80386-debug.js` and new
`test/i80386-debug-memory-capabilities.test.mjs`; leave the existing capture
test, CPU/devices and ordinary 8086 behavior unchanged. Coordinate the separately
reviewed Lite capability-normalization extension before consumer adoption.

Declare `read: true`, `write: false`, `passiveRead: true`,
`addressSpace: 'physical'`, `addressMin: 0`, `addressMax: 0xffffffff` and
`maxReadBytes: 1048576`. Inclusive byte bounds describe the physical bus domain,
not mapped RAM, readable hardware at every address or write permission. Code
run-to bounds are linear addresses and must not substitute for this descriptor.
`write: false` is the single read-only authority; do not add contradictory flags.

Reads require safe-integer addresses and nonnegative safe-integer lengths.
Preserve the existing empty-read boundary: address may equal `addressMax + 1`
only when length is zero. This endpoint is not an addressable byte; nonempty
ranges must stay within the inclusive byte bounds. UI jumps and page starts
must remain at or below `addressMax`.
Before declaring passive reads, verify unchanged CR2/fault state, translation
metadata, device state and VGA latches using owned controls. Test zero, high-bit
and final-byte reads, zero-length reads including the one-past endpoint, final
short pages, invalid/overflowing ranges and write
refusal. Source tests do not qualify an installed consumer.

Legacy targets with no new descriptor keep their current behavior. Consumers
must distinguish absent optional metadata from malformed explicit metadata:
the presence of any new metadata field selects complete strict descriptor
validation. Partial or malformed explicit metadata fails closed rather than
falling back to an editable 64 KiB window.
The later installed free-guest journey must use the qualified supplier revision;
this claim moves no app pin or lockfile and grants no GUI or full-OS qualification.

## Adopted literal-mask operational throughput observation

The sole [operational run38711737457](https://github.com/CrispStrobe/bw-board/actions/runs/38711737457)
on merged `bfe99d562e9b57a819ec92025faafba271b8751c` passed original-byte review.
Its [four-path checkpoint](X86-RTX-PLATFORMS.md#adopted-literal-mask-operational-checkpoint--2026-10-15)
records Node 22.23.3 on EPYC 7763: 386 core 6.486167 million instructions/s and
AT machine 2.662167 million instructions/s. Configured factors 0.405385423 and
0.998312612 use synthetic one/six-cycle charges, not physical timing. Hardware
differs from the older operational run; no gain/regression ratio follows.
This does not replace the separate paired gate or qualify an installed app.
Continue current source-owned debugger and media acceptance before consumer
adoption; future optimization hypotheses require current evidence or a
predeclared representative AT paired non-regression control.


## Optional floppy boot for master-HDD persistence

Source [PR620](https://github.com/CrispStrobe/bw-board/pull/620) is qualified and
merged. The existing free DOS recipes boot a floppy and mount an authored master
data disk; they do not establish a bootable HDD. The optional `--floppy-image FILE`
in `scripts/run-i80386-at-console.mjs` keeps the pinned HDD and exact CHS
mandatory. Admit the floppy with the existing `readPinned` pattern and an
explicit expected SHA-256, record its extent/hash separately, and insert a
detached copy into FDC drive 0. Support only the adapter's existing 360 KiB
(40/2/9) and 1.2 MiB (80/2/15) geometries. With the option present, use the
existing qualified Bochs recipe's CMOS boot-order byte `0x3d = 0x21`; preserve
HDD CMOS geometry and all unrelated settings. Without it, preserve the current
console path exactly. Do not add fetching, image conversion or a bootable-HDD
claim.

The [existing public receipt](receipts/2026-09-28-i80386-free-bios-freedos.json)
records a 1,228,800-byte external FreeDOS 1.4 floppy (SHA-256
`03df6088be016e57a6c44275f5bb9ab0244db71de1360957fd76ba83243b6a77`),
Bochs BIOS and VGA firmware, and an authored 306/4/17 FAT16 master data disk.
Use its public [source recipe](../scripts/run-i80386-free-bios-freedos.mjs) and
[image builder](../scripts/lib/i80386-free-bios-fat16.mjs) as source evidence;
leave them and their historical results unchanged. The old directory marker
was prebuilt: it does not prove a guest write, exported image or fresh reload.
The 360 KiB API case needs authored controls; this receipt qualifies only its
specific 1.2 MiB input. Re-admit exact cached inputs and component obligations
before hosted use. FreeDOS distribution components and LGPL firmware have
separate notices/source obligations; no image or executable bundling is implied.

Own new `test/i80386-at-console-floppy.test.mjs` for option parsing, required
identity, exact geometry, independent floppy/HDD input preservation, boot-order
selection and unchanged no-option behavior. Reject malformed or unpinned images
without relaxing native/code16 exclusions, existing source inventories or output
refusals. The coordinated new raw-HDD probe/reader/workflow must freeze its exact
source/runtime/media graph, commands, keyboard schedule, bounds and independent
original-byte acceptance before a hosted launch; no old probe ownership is
inferred.

Acceptance is two fresh ordinary CLI instances with the same admitted floppy.
The first boots, writes and closes a new authored file on C:, observes its exact
contents and shell prompt, then stops at a reviewed idle boundary and creates
an exclusive verified `--hdd-output`. The second mounts those exact exported
bytes and CHS, reads the marker and returns to the prompt without running its
writer. Join output extent/hash to the second input, prove both original inputs
unchanged, preserve failures and independently audit the original reports and
bounded raw output. A stopped budget or user quit alone is not a guest flush.
Keep guest execution hosted and bounded. No new media acquisition, OS
completeness, installed GUI, ISO/CD, physical timing or durability beyond this
finite acceptance is claimed.


## Live console keyboard pacing

The first [FreeDOS persistence run](https://github.com/CrispStrobe/bw-board/actions/runs/38790214003)
at source `50b5a3a75e7a856412b0dd54d1195526d6969b5a` failed before the readback
session. It delivered all 84 recorded scan bytes, but the final guest screen
showed a truncated ECHO command without its completing prompt. The exported
master image matched the initial image. Cleanup completed without a timeout or
OOM. This does not prove a disk-write fault or completed persistence.

The follow-up spaces accepted live keyboard scan bytes by 65536 machine-step
calls so a pasted command does not flood a slower consumer. Mouse polling and
refused-byte retries retain their 1024-step service interval; a refused byte
neither leaves the queue nor consumes the longer interval. Static scheduled
input events and CPU/device timing remain unchanged. This interval is a host
input policy in the CLI step domain, not a physical keyboard timing calibration.

Authored controls execute the actual input queue and demonstrate the old burst
policy losing bytes with a bounded slow receiver, then the paced policy keeping
all bytes in order. That receiver is not a BIOS model. The original guest
failure remains authoritative. The separately reviewed
[corrected-source run38806122785](I80386-HDD-PERSISTENCE-RESULTS.md) reached the
complete command, TYPE response, explicit quit, export and fresh-process readback.
Its success does not prove the suspected BIOS/queue-overrun cause. Preserve
the same marker, geometry, input
hashes, resource limits, causal reader and step budget; do not weaken acceptance
or claim a speedup from this change.
