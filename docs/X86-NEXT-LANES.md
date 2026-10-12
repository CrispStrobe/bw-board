# x86 checkpoint and next lanes

Updated 2026-10-11. This is the handoff for the x86 lane, not a claim of complete PC compatibility. Read this file, [current lane evidence](X86-LANE.md), [loading guide](X86-LOADING-GUIDE.md), [compatibility roadmap](X86-COMPATIBILITY-ROADMAP.md), and [oracle strategy](X86-ORACLE-STRATEGY.md) before implementing a task. Refresh the repository's default branch first: historical tested SHAs identify evidence, while a new change needs its own source and artifact identities.

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
   rerun or dispatch this consumed head. Next: implement and review a bounded
   GNU `L` long-name metadata parser in
   `scripts/i80386-cwsdpmi-gnu-longname-materializer/`, then qualify a separately
   admitted source revision. Preserve the four input pins, selected nine roles,
   fixed thirteen hard-link mappings, path rules and archive budgets. Reject
   orphan/repeated metadata, unsafe names, GNU `K`, PAX and symlinks; add
   manufactured boundary and refusal controls before a new frozen-reader and
   one-shot launch review. No actual compatibility is qualified yet. Review corrected a missing final report retaining completion
   and a file limit too small for
   selected tools. The actual job permits 16 MiB file writes and retains smaller
   independent JSON caps; its prospective reader admits at most 512 KiB of ZIP
   evidence. These are distinct bounds. Nine sanitized text roles describe a
   completed actual attempt, with no input archives or tools uploaded. Every
   enabled exact-head source check, a frozen independent original reader and
   one-shot launch reservation must precede the real test; compiler/tool/guest
   execution remains outside it.
   A source policy about read-only modes or omitted alias outputs is
   distinct from a final namespace/mode census; this first test need not claim
   the latter. Record actual member topology, selected output hashes,
   source joins, omitted notices and cleanup. Preserve any refusal; change the
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
