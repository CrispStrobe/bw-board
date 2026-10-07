# x86 checkpoint and next lanes

Updated 2026-10-07. This is the handoff for the x86 lane, not a claim of complete PC compatibility. Read this file, [current lane evidence](X86-LANE.md), [loading guide](X86-LOADING-GUIDE.md), [compatibility roadmap](X86-COMPATIBILITY-ROADMAP.md), and [oracle strategy](X86-ORACLE-STRATEGY.md) before implementing a task. Refresh the repository's default branch first: historical tested SHAs identify evidence, while a new change needs its own source and artifact identities.

## Reached checkpoint

- Functional JavaScript remains the user-facing 386 AT baseline. CLI and GUI media loading exist within the [documented format limits](X86-LOADING-GUIDE.md). The wired Harris 286, independent functional 286, JS 386 dispatchers, and diagnostic Bochs addon are distinct paths. There is no wired 386 implementation.
- The native [owned paged page-fault recovery fixture](I80386-PAGED-PAGEFAULT-RESULTS.md) passes: 57 attempted instructions, 56 completed quanta, one PF14/error2 at CR2 `8000`, handler PTE repair, CR3 reload, error discard, IRET, one retry, and final readback. Actual full-state records, ten complete memory pages, board state and independent memory-effect tapes are retained. This finite same-CPL16 fixture does not qualify an OS or every protected-mode mechanism.
- The [code32 REP STOSL page-fault fixture](I80386-CODE32-REP-PF-RESULTS.md) passes its finite JS capture and independent QEMU 8.2.2 486 trace/readback: one PF14/error2 after two completed stores, handler PTE repair and IRETD, then two remaining stores exactly once. The capture retains instruction attempts, full relevant state and memory effects; it does not qualify IRQ delivery or the native CPU3 code32 path.
- The latest [compact native paired result](I80386-COLD-PAIRED-RESULTS.md) passes terminal semantics but fails the speed gate. On the same GitHub runner, AMD EPYC 9V74 with four logical CPUs, native uses **4.397239× execution CPU** and **7.371981× execution wall time** relative to JS. All seven measured pairs favor JS. Configured-clock RTx is **JS 2.229400 / native 0.302415**; it is not a calibrated physical 16 MHz 386DX result.
- The [companion native owned-RAM profile](I80386-COLD-OWNED-RAM-RESULTS.md) passed a local full cold guest comparison against the unchanged callback path: 316,562 N/Q, 16,524 resumes, 16,475 ordered PIO events, full reset/last/final 166-word native state, complete final board and whole RAM hash. A correction also proves that malformed clock/page/scalar callbacks and forbidden PIC ACK cannot acknowledge a pending write before refusal; the full guest retained exact parity. CPU3 still calls JS for every memory effect, which then calls the companion addon. This is a coherence checkpoint, with no direct CPU3 memory path or measured speed improvement. The recorded 167,123 fused memory entries are counts, not measured cost shares.
- Stock xv6 full usertests have historical JS-path acceptance with later PSE/APIC extensions. Keep that evidence separate from strict 386DX behavior and native qualification. Broader OS/application acceptance remains unfinished.

## How to take a lane

Each lane below has an initial deliverable and a completion gate. Work in an isolated branch, inspect applicable repository instructions, and coordinate shared files. Keep the existing JS baseline and previous failure receipts. Record source revision, fixture license/hash, command, host, resource bounds, result and remaining limits. Publish freely licensed/freeware/owned fixtures only; keep other media and their test details in the private repository. Never infer GUI acceptance from a headless adapter test or infer whole-PC compatibility from an instruction fixture.

### 1. Native RAM ownership and coherence

**Repository:** bw-board. **Reached:** a distinct companion N-API profile passed local actual full cold callback parity; direct CPU3 memory ownership remains open.

Read `scripts/bochs-cpu3-native-direct-board/runtime.inc` and `scripts/bochs-cpu3-native-cold-memory-fusion/runtime.mjs`. Create a separate proposed `scripts/bochs-cpu3-native-cold-owned-ram/` profile rather than changing an authenticated older addon in place. Copy admitted cold RAM and immutable ROM into native ownership; initially retain every clock callback and device fence. Limit the first profile to fixed A20, ordinary RAM/ROM, no paging, DMA or MMIO ownership.

Implement a unique session-bound shadow initialized from the complete owned RAM, a bounded write journal, atomic capacity reservation before mutation, copied drain records and contiguous acknowledgement watermarks. Distinguish an uncommitted effect that may retry from a committed effect that must never repeat. Track executable pages and require code invalidation after their writes. Reconcile the shadow before every observing callback. Reject mismatched epochs, ledger regressions, `Q > N`, changed retry payloads and cross-session shadows.

**First deliverable:** reviewed interface/source and meaningful pure adversaries in proposed `test/i80386-cold-owned-ram-source.test.mjs`. Cover overlapping writes, untouched initial-byte mismatch, tampered journal batches without partial shadow mutation, capacity refusal/retry, code fences, observer reentry/failure, ROM aliases, open bus and whole-span boundaries. An unconnected prototype is not a usable backend.

**Completion gate:** separately built exact profile passes differential owned cold fixtures against the unchanged callback path, with actual reset/last/final 166-word state, whole final board/RAM hash, 16,475 ordered PIO events, exact N/Q 316562 and closed sessions. Retaining callbacks may yield no speed gain; make no gain claim from ownership alone.

The companion result covers that coherence comparison for the fixed ROM-execution cold target. A direct CPU3-to-owned-RAM profile still needs its own adapter, code-write fences and affected guest qualification before treating lane 1 as a crossing-reduction candidate.

### 2. Reduce crossings with explicit clock authority

**Repository:** bw-board. **Dependency:** lane 1 coherence qualification.

Read the MEMORY fusion runtime and `scripts/cold-native-compact-progress-performance/README.md`. Introduce a distinct owned-slice clock lease carrying N/Q, the six-clocks-per-Q ledger, earliest device deadline, mapping/A20 epoch and IRQ state. Do not fabricate the older seven-word JS pre-effect reply or silently skip its callback contract.

Stop at deadline/event, PIO, IRQ eligibility/delivery, HLT, fault, code write, mapping change or journal exhaustion. Define committed-versus-pending return status and reconciliation order; preserve once-only REP elements and fault restart. Refuse a lease when device observation cannot be excluded. Preserve real requested full-state inspection.

**First deliverable:** interface and clock/device adversaries, followed by a small actual differential guest run. **Completion gate:** full cold parity, then a separate same-host comparison using two warm-up pairs and seven alternating measured pairs. Report execution CPU and wall time, whole-child timing, callback counts and host metadata. Adopt only after the existing quantitative gate passes. Profiling must measure cost rather than infer it from callback counts.

### 3. Extend protected-mode differential coverage

**Repository:** bw-board. **Ready to start:** independent of the cold speed lane.

Start with `scripts/bochs-cpu3-native-paged-pagefault/`, `test/i80386-paged-pagefault-native-runtime-driver.test.mjs`, and [oracle strategy](X86-ORACLE-STRATEGY.md). Add one finite owned fixture per change: IRQ during paging, page-faulting REP restart, privilege-changing interrupt/IRET, then TSS/VM86/task interactions as supported. Keep 16-bit and 32-bit frame cases explicit. For JS, inspect `src/experimental/i80386.js` and the corresponding paging, task and VM86 tests.

Compare returned CPU/cache fields, complete selected pages and board state; independently validate each engine's architectural memory effects. Preserve genuine differences in accessed/dirty update timing. Use a pinned independent emulator for disputed architectural behavior and record its version/configuration; generated instruction vectors supplement guest tests rather than replace them.

**First deliverable:** one new source-bound fixture and independent expected trace. **Completion gate:** actual fault/delivery/restart evidence with negative adversaries and retained divergence receipts. Expand the admitted profile only after the added mechanism passes. PSE/APIC-enabled xv6 is a separate profile, not strict 386DX evidence.

### 4. CLI and GUI media/package handling

**Repositories:** bw-board first for shared parsing/adapter behavior; brickwright-lite for UI and exact dependency-pin adoption. **Ready to start:** frontend work can proceed independently of native optimization.

Use `scripts/run-dos.mjs`, `scripts/run-i80386-at-console.mjs`, [loading guide](X86-LOADING-GUIDE.md), and [Lite GUI guide](https://github.com/CrispStrobe/brickwright-lite/blob/main/docs/I80386-GUI.md). Preserve the distinction between direct DOS services and BIOS disk boot. Audit existing media/config parsers before adding another loader.

First unify DOSBox relative-path resolution and raw-disk geometry validation across CLI and GUI. Then add bounded ZIP/package admission: size/count caps, path traversal rejection, deterministic config/media selection, unsupported-command reporting and no host-shell execution. ISO loading needs an actual CD-ROM/ATAPI device and firmware/guest path; report it as unsupported until that exists. Add explicit disk writeback/export separately, with original images preserved.

**First deliverable:** shared parser fixtures and one freely licensed package exercised in CLI and GUI. **Completion gate:** the same media reaches the functional target in Circuits, Widgets and Code; visible errors survive failure; user input and an observable guest result pass a real browser test. Update the loading guide and matrix from those results. Diagnostic native addons remain unavailable as general media loaders until separately integrated.

### 5. Console, VGA, mouse and large Widgets acceptance

**Repositories:** brickwright-lite UI; bw-board only for shared target/input fixes. **Ready to start:** independent frontend lane; coordinate adapter changes with lane 4.

Read Lite `docs/I80386-GUI.md`, `docs/X86-LOADING-SCOPE.md`, and `docs/generated/LANGUAGE-DEVICE-MATRIX.md`. Inspect Machine Manager and the machine Widgets renderer. Existing headless FreeDOS acceptance and synthetic Chromium input checks do not establish a real FreeDOS widget boot.

Create a bounded real-browser FreeDOS acceptance: media selection, visible prompt/VGA output, focus, key make/break, enabled guest mouse, pane resize, full screen and exit, and continued interaction in all three tabs. Cover drag capture, reserved browser keys, restart/error behavior and media lifetime. For CLI, exercise live TTY input, redraw/exit and mouse-capable terminal handling separately.

**First deliverable:** one reproducible free-media browser scenario with screen/input evidence. **Completion gate:** documented user workflow, actual guest response and restored host terminal/browser state. Publish the exact dependency pin and browser build; update generated matrix inputs through their generator rather than manually asserting support.

**Debugger memory follow-up:** the 386 target's `readMem('mem', ...)` now has a focused VGA aperture and high-physical-RAM regression. Its separate `writeMem('mem', ...)` path still writes the backing array directly; it does not route VGA writes through the 386 bus or its planar aperture. A debugger poke of VGA memory needs its own explicit guest-visible semantics and regression before any GUI memory-edit claim.

### 6. Free OS and application acceptance

**Repository:** bw-board for guests; brickwright-lite for frontend acceptance. **Ready to start:** one bounded guest at a time.

Read [guest acceptance](X86-GUEST-ACCEPTANCE.md) and [compatibility roadmap](X86-COMPATIBILITY-ROADMAP.md). Prioritize FreeDOS plus an owned protected-mode/DPMI fixture, then ELKS and appropriate freely licensed small-Unix fixtures. Revisit MINIX only after verifying the exact release's redistributability and required hardware; the historical `scripts/probe-16bit-os.mjs` probe is not an automatic qualification of every CPU/profile. Treat xv6 as the explicit later-feature machine profile.

For each image, record license/provenance/hash, CPU/board profile, BIOS, geometry, resource budget and observable success criterion. Diagnose the first missing instruction, privilege mechanism or device transaction before broadening the run. Bundle only when the exact image's license permits redistribution; otherwise document reproducible public acquisition/build instructions. Keep restricted guest details in the private repository.

**First deliverable:** one licensed fixture manifest and smoke criterion. **Completion gate:** bounded actual boot plus an application or shell interaction, followed by relevant CPU/device regressions. Do not advertise general application compatibility from a boot screen.

### 7. Comparable RTx and physical calibration

**Repository:** bw-board. **Dependency:** an unchanged qualified workload/profile; can measure the JS baseline now.

Read [RTx platform scope](X86-RTX-PLATFORMS.md) and [10× performance plan](I80386-10X-PERFORMANCE.md). Measure VPS and GitHub CPU runs separately with exact host/CPU allocation, Node/toolchain, source, media and timing windows. CPU emulation does not acquire a GPU speedup merely by running on a GPU host. Additional platforms need an actual run; never fill their cells from a different host's results.

**First deliverable:** raw repeated baseline measurements and a table with unmeasured cells marked unmeasured. **Completion gate:** same-workload comparisons and explicit configured-clock definitions. A physical 16 MHz 386DX comparison additionally needs defensible cycle calibration or reference hardware timings. Keep configured RTx and physical calibration separate.

## Suggested dispatch

Assign one worker to lane 1 and one to lane 3; a coordinator reviews invariants and evidence. Frontend workers can take lanes 4–5 with explicit file ownership. Lane 2 follows lane 1, and each accepted guest in lane 6 supplies a concrete regression workload. Stop each change at its own completion gate, publish the result and refresh this handoff rather than letting a long-running branch's SHAs become implicit authority.
