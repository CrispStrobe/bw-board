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

Status: docs-only claim; implementation waits for this claim to merge. Own new
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
