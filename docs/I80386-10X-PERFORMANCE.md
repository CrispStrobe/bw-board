# Experimental 80386 speed path

External licensed-guest notes and historical context are retained in the [private documentation archive](https://github.com/CrispStrobe/brickwright-firmware-private/tree/master/public-documentation-archive/2026-10-04). Public examples and instructions use freely licensed or freeware software.

The latest [compact-progress paired result](I80386-COLD-PAIRED-RESULTS.md#compact-progress-candidate-keep-plain-js) retains the plain-JS baseline. All eighteen semantic proofs passed, but native used 4.397239× execution CPU and 7.371981× execution wall, losing all seven measured pairs on one GitHub AMD EPYC 9V74 host with four logical CPUs. No old-scalar-versus-compact comparison was run; reducing the return schema has no measured causal gain here.

The [scalar-ledger semantic qualification](I80386-COLD-LEDGER-SCALAR-QUALIFICATION.md) passed its first single-child checkpoint with independent audit. Its separate [paired comparison](I80386-COLD-PAIRED-RESULTS.md#scalar-ledger-candidate-keep-plain-js) failed: scalar native used 5.251347× execution CPU and 8.943299× execution wall against JS on the same host, with all seven pairs unfavorable. Keep plain JS; no held-fusion-versus-scalar comparison was measured.

The retained [execution-window Inspector diagnostic](I80386-COLD-EXECUTION-PROFILE-RESULTS.md) independently passed guest/profile checks despite an original post-child hosted metadata failure. Its main-isolate samples are diagnostic, not speed qualification; plain JS remains the baseline.

[The private span CPU gate failed](I80386-OWNED-SPAN-CPU-RESULTS.md): 4.221876% nominal mean process-CPU reduction and five of seven favorable pairs, below the required ≥10% and all-seven criterion. All 18 semantic comparisons passed; keep unchanged `fe1`, with no adoption or physical-clock claim.

[Private span native parity](I80386-OWNED-SPAN-PARITY-RESULTS.md) passes three fresh hosted cells against unchanged compiled fe1/103: whole stored166-word snapshots, boards/RAM, ON journal and both full1,649,271-row canonical traces. Runtime116 remains distinct from compiled103. The subsequent [paired CPU gate failed](I80386-OWNED-SPAN-CPU-RESULTS.md); the span candidate is not adopted.

[Private span hosted source controls](I80386-OWNED-SPAN-SOURCE-RESULTS.md) pass 232,337 checks in ten cases, with unchanged compiled inputs. Subsequent [native parity passed](I80386-OWNED-SPAN-PARITY-RESULTS.md); no performance result or broader guest admission follows.

[Private per-word dispatch source experiment](I80386-OWNED-DISPATCH-SOURCE-WIP.md) passes 14 differential factory controls with frozen runtime106/unchanged compiledfe1/103 inputs. [Three native parity cells](I80386-OWNED-DISPATCH-PARITY-RESULTS.md) now pass against fe1, including canonical chronology through the null-sink branch; [the hosted paired CPU gate failed](I80386-OWNED-DISPATCH-CPU-RESULTS.md): 1.719745% nominal mean reduction and four of seven favorable pairs, below the ≥10%/all-seven requirement. All 18 children retained semantic parity; keep `fe1`, with no adoption, retry or RTx claim.

[Baseline profiling preparation](I80386-OWNED-BASELINE-PROFILE-WIP.md) records the source-only preparation stage after the failed bulk gate. The subsequent [actual baseline profiling results](I80386-OWNED-BASELINE-PROFILE-RESULTS.md) retain one phase-bounded fixture diagnostic; it is not a speed gate or a new speed result.

The earlier [fixed 8042 self-test source proposal](../scripts/bochs-cpu3-native-owned-8042/README.md) passes 106 device/provider controls and a 28-step JavaScript ROM probe. That source stage established no native qualification, broader AT admission or speed result.

The subsequent [fixed 8042 native qualification](I80386-OWNED-8042-NATIVE-RESULTS.md) passes its first pinned build and separate OFF/ON cells: all 166 native words at every instruction, complete board state, eight PIO events and raw whole RAM agree. This qualifies the 28-instruction self-test fixture only, with no performance result or broader native AT admission.

The separate [ordered AA/AB interface-test qualification](I80386-OWNED-8042-INTERFACE-NATIVE-RESULTS.md) passes its first hosted build and OFF/ON cells: 38N/Q, 40 saved full166 boundaries, all 39 emitted CPU blocks, 11 PIO events and whole raw RAM. This advances fixed-device admission only; cold BIOS/AT boot, speed and adoption remain open.

The [private uniform-page span preparation](receipts/2026-10-02-owned-span-source-preparation/README.md) records the stage before differential controls ran against unchanged fe1. The subsequent [hosted source controls passed](I80386-OWNED-SPAN-SOURCE-RESULTS.md); this source-only evidence establishes no adoption, speed result or broader AT admission.

The [single complete hosted bulk-clock gate](I80386-OWNED-CLOCK-BULK-RESULTS.md) does not qualify adoption: 5.4576% lower mean process CPU and five of seven favorable pairs, against the required 10% and seven of seven. All 18 child semantics pass independent audit. Keep fe1; this is fixed-fixture CPU accounting on a GitHub runner exposing four logical AMD EPYC 7763 CPUs, not physical 386DX RTx or a cumulative gain.

All four complete reports matched after removing only
the opt-in flag, but the predeclared retention gate failed. No xv6 timing pair
was run and no speed benefit is claimed.

The [private span native parity packet](../scripts/owned-span-parity-ci/README.md) now has [actual three-cell results](I80386-OWNED-SPAN-PARITY-RESULTS.md). Its separate [paired CPU gate has now failed](I80386-OWNED-SPAN-CPU-RESULTS.md); this establishes no adoption or broader AT admission.

## Current checkpoint (2026-10-05)

The [stock xv6 full usertests result](receipts/2026-09-29-xv6-stock-224m-full-suite.json) completed 7,203,922,011 guest steps within its pinned 10-billion-step budget. That configured compatibility result uses later PSE/APIC extensions and does not qualify strict 386DX or the newer Bochs addon.

The 10× target and physical 16-MHz 386DX calibration remain open. The latest same-host compact gate measured mean execution CPU of 0.296865714 s for JS and 1.305389571 s for native, with mean elapsed time 0.141994227 s and 1.046778696 s. Six functional clocks per Q at 6 MHz give configured virtual-time/mean-wall ratios of 2.229400498 and 0.302415402. These finite-fixture ratios are not hardware calibration or broader guest benchmarks.

Later cold native RAM profiles passed finite parity but failed speed adoption against ordinary JavaScript; see the [current lane decisions](X86-NEXT-LANES.md). Keep ordinary JS and stop that cold native performance experiment. Next sample functional-JS rollback-object allocation on the unchanged xv6 workload, following the [allocation-profiling contract](I80386-XV6-JS-ROLLBACK-PROFILE-PLAN.md). Investigate register/state-copy CPU work separately if evidence points there. Select a bounded optimization only after observing its cost, then require an affected correctness oracle and a separate same-workload paired timing gate. Callback counts are not measured CPU cost shares. Native full-OS loading remains experimental; public guest regressions use freely licensed software and owned fixtures.

The [fixed protected DS/SS and stack run](I80386-PROTECTED-STACK-RESULTS.md) independently passes 30 N/Q, 32 saved raw 166-word boundaries, 13 cuts and three complete copied pages. PUSH/POP and CALL/RET effects, strict descriptor phases and settled RAM hash agree. Its scope is fixed same-ring stack correctness; full OS, speed and adoption remain open.

The [fixed nonidentity paging run](I80386-NONIDENTITY-PAGING-RESULTS.md) independently passes 34 N/Q, 36 saved raw 166-word boundaries, seven complete physical pages and explicit code/data A/D effects. It preserves two declared unmatched transition phases and qualifies only this finite strict-386 path; exception frames, full OS, speed and adoption remain open.

The [MEMORY clock-fusion paired gate](I80386-COLD-PAIRED-RESULTS.md#memory-clock-fusion-candidate-keep-plain-js) keeps plain JS: same-host fusion used 5.139261× execution CPU and 8.873322× execution wall, losing all seven measured pairs while all 18 terminal proofs passed. Actual fused-effect and outer-entry counts remain separate from logical transfers; no old-native-versus-fusion gain, adoption or physical-386 calibration follows.

The [typed-state paired gate](I80386-COLD-PAIRED-RESULTS.md#copied-uint32array-candidate-keep-plain-js) also keeps plain JS: same-host typed batching used 4.063470× execution CPU and 6.888317× execution wall, losing all seven measured pairs. All 18 children passed fixed terminal proofs. This did not compare old native arrays against typed exports; no adoption or broader guest/physical-386 speed claim follows.

The [completed cold E16 paired gates](I80386-COLD-PAIRED-RESULTS.md) keep the plain-JS baseline: native batching passed against native one-Q, but used 4.116236× execution CPU against plain JS and lost all seven measured pairs. The separately hosted results do not establish default adoption, physical386 RTx or broader guest/full-boot speed.

The [native cold BIOS E16 diagnostic](I80386-NATIVE-COLD-BIOS-E16-RESULTS.md) now passes the fixed checkpoint: 316,562 completions, 400 REP elements and 16,475 ordered PIO events, with independent audit evidence. This is a correctness diagnostic, not full boot, speed qualification or adoption.

The [three-arm semantic qualification](I80386-COLD-THREE-ARM-RESULTS.md) now independently passes plain JS, native one-Q and native batched at the same E16 checkpoint and complete 16,475-event PIO tape. Batched reaches 316,562 N/Q in 16,524 resumes; one-Q uses 316,562. The earlier [inspect-schema](I80386-COLD-THREE-ARM-FIRST-FAILURE.md) and [live-slice type](I80386-COLD-THREE-ARM-CORRECTED-FAILURE.md) failures remain retained. This is terminal/PIO semantic qualification with unchanged source, not a paired speed result or broader guest/broader game 10× claim.

The [first cold-BIOS paired attempt](I80386-COLD-PAIRED-FIRST-FAILURE.md) stopped after one qualified native one-Q warmup child: the parent failed constructing its progress-file path. Batched never started and no measured pairs ran. The source correction does not establish a paired speed result; the independently qualified three-arm checkpoint remains unchanged.

The [undefined-OF diagnostic](I80386-NATIVE-COLD-BIOS-UNDEFINED-OF.md) records the historical sixth attempt, which stopped after 4,709 completions before the reviewed ownership policy was added. The [first 124-input build](I80386-NATIVE-COLD-BIOS-BUILD-RESULTS.md) remains historical static evidence.

The [fixed 8042 native self-test](I80386-OWNED-8042-NATIVE-RESULTS.md) and subsequent [ordered AA/AB interface-test](I80386-OWNED-8042-INTERFACE-NATIVE-RESULTS.md) pass their first reviewed builds and both native modes. These 28- and 38-instruction fixtures advance device admission; the 10× speed goal and broader native BIOS/AT boot remain open.

## Previous checkpoint (2026-10-02)

The 10× goal and physical 16 MHz 386DX calibration remain open. Those results do not qualify the newer full-CPU native experiment.

The [private main-thread native diagnostic](I80386-NATIVE-OWNED-MAIN-WIP.md)
passed a single predeclared gate: 26.3289% lower mean process CPU than its
H4 predecessor, with all seven measured pairs favorable and full fixed-ROM
snapshot/device/RAM parity in all 18 children. This corresponds to about
1.35738× fixture work at an equal CPU budget. It was measured on the shared
four-vCPU KVM Skylake VPS with Node 22.23.3, not on GitHub/Kaggle or a physical
386. It is separate from the older native xv6 executor and its measurements.

The subsequent [allocation candidate](I80386-NATIVE-OWNED-CLOCK-ALLOC-WIP.md)
failed its unchanged gate: nominally 5.5614% lower mean CPU, but only five of
seven pairs favorable. It is not adopted. Nested timing instrumentation does
not establish removable CPU shares. The subsequent [bulk-clock trial](I80386-OWNED-CLOCK-BULK-RESULTS.md) failed at 5.4576% nominal mean reduction with five of seven favorable pairs; the [dispatch trial](I80386-OWNED-DISPATCH-CPU-RESULTS.md) failed at 1.719745% with four of seven. Neither is adopted.

The [ABI4 byte-IN experiment](I80386-NATIVE-OWNED-IN8-WIP.md) adds narrowly
admitted PIT/PIC reads. The pinned CI rebuild and fresh production capture-OFF/ON
comparison passed the bounded fixture: 445 resumes, both PIT witness bytes,
complete native mode parity, and 1,649,271 canonical rows. Independent ON audit
passed 520,820 checks. The documented reset-profile/RAM policy retains raw
states and hashes; this extension has no speed gate. No cumulative speedup is calculated from
these different sources, fixtures, or executors.

## Previous checkpoint (2026-09-30)

The 10× performance goal remains open. The
[audited stock xv6 full usertests pass](receipts/2026-09-29-xv6-stock-224m-full-suite.json)
completed 7,203,922,011 guest steps within its pinned 10-billion-step budget;
it is a compatibility result, not a throughput comparison. The rejected
[plain RAM read trial](I80386-PLAIN-RAM-READ-NEGATIVE.md) adds no retained
speed change. Neither result calibrates speed against a physical 386DX.

Separate entry-mode CPU sampling in the
same receipt attributes about 70% of measured user CPU to real,
protected16 and VM86 calls, and about 30% to protected32. These are
different instruments and cannot be multiplied into a speed estimate. A
route confined to 16-bit execution cannot meet the 10× goal on that
workload. The [current packed-native xv6 profile](receipts/2026-09-28-i80386-current-packed-v8-profile.json)
finds 46.82% of all-process samples in ordinary CPU fallback but only 5.50%
in the direct fetch/decode functions, below the predeclared 15% screen for
a narrow fetch/decode cache.

It **failed** the unchanged 15M overall / 5M
mode gate. The ordinary stock xv6 `forktest` pair reached 967,663 long-run
ordinals, all protected32, with no xv6 pass threshold. No
comparative host timing follows from that recovery.

1. Build on the completed owned contracts from the
   [branch-to-I/O fixture](I80386-WIN16-IO-BOUNDARY-ORACLE.md), the merged
   [`8E` ES load fixture](I80386-8E-SEGMENT-LOAD-CONTRACT.md), and the
   [ordered CALL/RET and `FF /2` fixture](I80386-CALL-RETURN-ORDERED-CONTRACT.md). The [combined ES, CALL/RET, and I/O contract](I80386-COMBINED-ORDERED-STATE-CONTRACT.md)
   from [PR #151](https://github.com/CrispStrobe/bw-board/pull/151) also
   pins owned commit, fault, and chip/IRQ ordering. The
   [selected register-stack contract](I80386-REGISTER-STACK-ORDERED-CONTRACT.md)
   from [PR #153](https://github.com/CrispStrobe/bw-board/pull/153) pins
   additional `50–5F` stack effects across modes. Broader branch, device,
   fault, and mapping combinations remain unproved. Preserve code/page-table
   writes and chip/IRQ cuts in any revised grammar.
2. The selected `50–5F` register-stack
   extension then reached 9.62 million overall and 8.51 million in those
   modes at a later revision, still failing the overall gate. The separate
   stock xv6 census rose from 317,206 to 967,663 long-run ordinals, all
   protected32, with no xv6 pass threshold. Attribute the affected path to nonoverlapping, all-process CPU samples
   before treating step coverage as a speed opportunity. That follow-on
   profile screen has no completed result for this grammar. The
   [ordinary-core audit](receipts/2026-09-28-i80386-ordinary-core-other-audit.md)
   calls for at least 15% in an avoidable path; entire interpreter
   functions are not savings estimates.
4. Only if those screens pass, build an opt-in executor with dynamic
   per-instruction translation and fault checkpoints, exact event exits, and
   ordinary fallback.

The register-stack grammar also failed the overall gate. No CPU-cost gate has
passed and no broader trace executor is justified by this evidence. A separate
[full functional 386 core feasibility note](I80386-FULL-CORE-WASM-FEASIBILITY.md)
is currently a source audit, not a backend or performance result. Its next
necessary proof is a pinned native full-CPU checkpoint plus ordered bus-event
oracle on an owned strict-386 fixture. Stock xv6 uses later CR4.PSE/4 MiB
paging and would need a separately labeled later CPU mode; its current board
result cannot qualify a strict 386 backend. The new
[aligned native/JavaScript paging comparison](I80386-BOCHS-CPU3-PAGING-IDTR-ALIGNED-COMPARISON.md)
now matches selected integer/system fields and three RAM words using an
explicit guest IDTR load. It adds no backend or speed result; broader fault,
task-memory and bus-boundary proofs remain unfinished. The sections below are a dated experiment ledger;
their historical “next” recommendations describe their source revisions.

## Measured checkpoint (2026-09-28)

The 10× goal is still open. On the VPS (four KVM Skylake vCPUs, Node
20.20), a complete stock-xv6 `forktest` retires 24,338,279 guest steps.
The [three-run xv6 baseline](receipts/2026-09-28-x86-vps-throughput.json)
has a 25.16-second median user-CPU time for the ordinary JS executor; its
opt-in native executor has an 18.21-second median. Both produce the same
serial output, final RAM hash, and 163,891,880 board cycles. These are host
execution times from source `8261e891`; 27.315 seconds at the configured
6 MHz board clock is *virtual* time. Neither ratio is a measured speed
relative to a physical 16 MHz 386DX.

A later [same-page write optimization](receipts/2026-09-28-i80386-same-page-write-performance.json)
improved a paired three-run ordinary-executor mean from 24.53 to 23.55
user-CPU seconds (1.042×), with the complete guest result unchanged. These
different-source samples should not be spliced into an invented cumulative
RTx figure. The [cross-platform benchmark](X86-RTX-PLATFORMS.md) now has
VPS, Kaggle CPU-host, and [GitHub-hosted](receipts/2026-09-28-x86-platform-gh.json)
receipts. The GitHub runner's AMD EPYC 7763 measured 4.05 million 386-core
and 2.24 million 386-AT instructions/s on its fixed real-mode benchmark. The three hosts ran identical benchmark source files, but these short
media-free probes are not xv6 or broader guest workloads. Their reported 386
factors use configured virtual time and explicitly are not physical-386 RTx.

The [reference-emulator audit](I80386-REFERENCE-EMULATORS.md) identifies the
useful design gap: QEMU TCG translates and chains host-code blocks; Bochs
caches decoded traces; this board still pays much of the JavaScript decode,
translation, event, and JS↔WASM dispatch cost. A
[full-xv6 native fallback census](receipts/2026-09-28-i80386-native-entry-negative.json)
found 16.43 million native instructions in 4.00 million calls and 7.91 million
JavaScript steps. Raising the block budget and caching program transfers
preserved guest state but gained only 1.6% in one pair and 0.8% across two
pairs, respectively; both were discarded. The published
[fallback observer](../scripts/observe-i80386-native-fallback.mjs) identifies
executed memory, string, TEST and branch forms for a grouped, page-safe
coverage experiment. Its five selected forms are only 11.0% of all xv6 steps,
so they cannot alone deliver 10×. A subsequent
[grouped 32-bit trial](receipts/2026-09-28-i80386-native-coverage-no-go.json)
retired 579,024 more xv6 instructions natively yet gained only 0.22% mean
user CPU across three pairs, with one reversal; its executable changes were
discarded. Neither result supports another narrow opcode
addition. The [bounded dynamic-memory slow-exit contract](I80386-DYNAMIC-MEMORY-SLOW-EXIT.md)
now demonstrates two narrow memory forms without wiring them into the normal
dispatcher. A [full-xv6 fallback-span census](receipts/2026-09-28-i80386-dynamic-span-no-go.json)
then found **zero** four-instruction runs of those exact forms. Even a much
broader syntax-only grammar reached 2,101,670 fallback steps in runs of at
least four, below its predeclared 2.4-million-step gate. The observer left
the complete guest report and RAM hash unchanged; no grouped executor was
retained or speedup claimed. Separately, an [owned protected-16 executable
trace](I80386-CODE16-OWNED-IO-TRACE.md) retires three fixture instructions
in one call and exits before a device read, with ordinary-state parity and
QEMU/Bochs witnesses. It is outside the AT dispatcher and has no broader guest
speed result. A [V8 short-span profile](receipts/2026-09-28-i80386-short-span-cost-model.json)
then motivated packing each decoded protected-32 native block's IR once. The [retained packed-entry change](receipts/2026-09-28-i80386-packed-entry-performance.json)
cut mean full-xv6 user CPU from 18.26 to 16.40 seconds across three serial
pairs, a **10.19% reduction** on the opt-in native path. Every pair favored
the candidate; all six complete guest reports, native statistics and RAM
hashes matched. This is one VPS/workload result, not broader guest performance or
physical 386DX RTx. The measurements below continue the dated ledger.

The direct stock-xv6 `forktest` A/B from `2feb23a3` to `bc539d33` took 39.655
versus 29.575 user-CPU seconds for 24,338,279 guest steps (1.341×). The later
IOAPIC pending-mask experiment measured another 1.078× on the same workload.
These are bounded measurements, not evidence of the requested 10× overall
speedup. Reproduction details and hashes are in the dated receipts.

It still executed every instruction through the ordinary
interpreter, so that prototype is a no-go. Two smaller CPU changes were
retained instead. Coalescing a four-byte immediate fetch only from ordinary
same-page RAM improved paired xv6 user CPU by 10.7% and 5.2%; direct register
field access improved it by 8.4% and 5.4% on the resulting board. Each pair
retired the same 24,338,279 guest steps with identical serial output and final
RAM hash. The full 386 suite
passed 494 tests with four skips after each qualification. Raw reports, timings,
profiles, and negative results are kept under
`brickwright-firmware-private/performance/2026-09-28`. These are bounded xv6
host-CPU gains, still far short of the 10× target or a hardware RTx calibration.

The `probe-xv6-stock.mjs` runner can now set `XV6_LEAN=1` to omit its
per-instruction milestone, user-mode, and recent-instruction records while
retaining the serial command, stopping condition, interrupts, display, and
final CPU state. One normal and two lean full `forktest` runs took 27.88 versus
26.24 and 26.48 user-CPU seconds, respectively. This isolates roughly 1.5
seconds of diagnostic-runner cost; it is **not** an emulator improvement. Use
the lean mode for future paired performance tests and the normal mode for
diagnosis. The [lean-probe receipt](receipts/2026-09-27-i80386-lean-probe.json)
pins the media and complete-run result.

A direct-RAM byte-read shortcut in the AT board preserved the complete lean
`forktest` report but changed one adjacent user-CPU pair from 26.64 to 26.16
seconds (1.018×). That is below the predeclared 5% board-only retention
threshold, so the candidate was discarded. The [negative read-path receipt](receipts/2026-09-27-i80386-at-readfast-negative.json)
pins both source variants and the identical guest result.

An inline decoder for common 32-bit memory `MOV 8B` and `LEA 8D` forms also
preserved the complete xv6 guest report, but two alternating A/B pairs averaged
27.405 versus 27.05 user-CPU seconds (1.013×). The individual pairs disagreed
on the winner, and the mean was below the predeclared 10% threshold for
duplicating effective-address logic. That source experiment was discarded;
the [negative MOV/LEA receipt](receipts/2026-09-27-i80386-mov-lea-fastpath-negative.json)
records the measurements. A broad block executor with memory, branches and
strings remains the next CPU speed project.

An [opt-in shared WASM RAM backing](I80386-SHARED-RAM.md) now passes a complete
xv6 `forktest` with identical guest state. It removes the need to copy guest
RAM at every future native-block boundary, but still runs the JavaScript CPU
for every instruction; its 27.45-second run is not a speedup claim. The native
block executor, decoder coverage and exact fault/device exits remain unbuilt.

An architectural reference is [v86's own description of its hot-page
x86-to-WASM compiler](https://github.com/copy/v86/blob/master/docs/how-it-works.md):
it profiles hot pages, emits blocks, and keeps physical-page translation,
MMIO and code-write invalidation in a fast TLB path. This is a design reference,
not evidence that v86 is a drop-in backend or that our 386 will reach 10×.
Its [documented missing CPU features](https://github.com/copy/v86/blob/master/Readme.md)
include task gates and some 16-bit protected-mode behavior that our accuracy
lane explicitly tests. For our board, a future fast path must also retain the
AT chip event contract and Debugger single-step behavior.

A final-source V8 sample over the xv6 run attributed 17.7% of time to
`_stepInstruction`, 7.1% to `_fetchN`, 5.0% to `_decodeEA`, 7.8% to
`_translate`, 6.1% to `_read386`, and 6.1% to `_serviceInterrupts`. The
instrumented probe script itself accounted for about 2.85 seconds. Removing
`_fetchN`, `_decodeEA`, and `_fetch8` entirely would save only 14.4% of sampled
time, an optimistic 1.17× ceiling for a decode-only cache. Removing all of
those plus `_linear`, `_translate`, and `_read386` would save about 31%, an
optimistic 1.45× ceiling; those latter functions also serve data accesses, so
the actual cache ceiling is lower. The baseline's roughly 40-second run would
need to reach roughly four seconds for 10×, while this probe's own sampled
work already uses most of that budget.

Executed CS:EIP pairs repeated 24,322,722 times after 12,329 first visits:
99.95% of decoded instructions revisit an address. The hot opcode mix matters
more than the hit rate. `8B` register-from-memory and `8D` LEA account for
about 18% of instructions and are entirely memory-address forms in this xv6
run. `AB` STOS accounts for 8.9%; short JE/JNE for 12.2%. Six register-form
families (`89`, `39`, `85`, `81`, `C1`, `83`) total about 28.1% of executed
instructions. A narrowly cached register template can test feasibility, but
it cannot by itself reach 10×. If its paired CPU-time gain is below 10% or
within run-to-run noise, stop widening the JS template set.

That bounded trial cached register-form `89`/`39`/`85` on extended RAM code
pages with version checks for guest, host and DMA writes. Two adjacent xv6 A/B
pairs took 27.925 seconds baseline versus 27.25 seconds candidate on average:
1.025×, or about 2.4%. Complete guest reports matched except their worktree
paths. The source experiment was discarded under the stopping rule; the code
coherence and precise-fault tests remain. The dated negative receipt records
the measurement.

The next architectural experiment should use a static, CSP-safe decoder into
compact typed-array basic blocks, with no `eval` or `new Function`. Populate a
block only from instruction bytes already fetched during successful execution
or from side-effect-free RAM after the first fetch has passed ordinary segment
and paging checks. Stop a block at a code-page boundary, branch, I/O,
privilege/control-register change, REP iteration, or any operation whose
fault/restart behavior is not yet covered. A per-physical-code-page version
must change on CPU, host, and DMA writes; CR0/CR3/CR4, A20, segment reloads,
and page-table writes must invalidate or fail a cache key. Executing a cached
instruction still has to preserve the one-instruction snapshot, partial
memory effects, trap flags, and interrupt boundary. The board may batch only
up to its next scheduled chip event and must break immediately when an IRQ,
NMI, HLT, fault, or shadow transition requires service.

If that bounded block interpreter cannot substantially cut total time, a
static WebAssembly executor backed by the same RAM buffer is the likely next
route. It must run multiple safe instructions per JS↔WASM crossing and return
at exact device/event boundaries; one crossing per byte or instruction would
erase the benefit. The repository's `src/riscv-cc-wasm.js` already shows a
bundled module loader. A 386 module would need the site's explicit Wasm CSP
allowance and a CLI loading path; it must not use runtime JavaScript code
generation. These are design requirements, not a claim that the 10× goal is solved.

A [static WASM block spike](I80386-WASM-BLOCK-SPIKE.md) now proves the toolchain
and an event-budgeted multi-instruction call, but its register-only instruction
set is too narrow to integrate. On the complete xv6 `forktest`, only 1,019 of
3,657,970 eligible runs had at least two instructions; these covered just
2,066 of 24,338,279 guest steps. The [negative feasibility receipt](receipts/2026-09-27-i80386-wasm-safe-run-feasibility.json)
records exact counts and hashes. The production executor was not changed.
For a 10× total speedup, Amdahl's law requires moving at least 90% of total
runtime even if the moved work becomes infinitely fast. At 20× faster native
execution, the required share rises to 94.7%, before board/device overhead.
Guest instruction coverage is not CPU-time coverage, so the next trial must
measure both full-workload time and the share spent at block exits.

The [opt-in board block contract](I80386-RUN-BLOCK-CONTRACT.md) now defines a
bounded entry and exact chip-event exit using the existing per-instruction
step. It covers memory and branches semantically but has no fast backend and
claims no acceleration. It is a baseline against which a native executor can
be tested.

A [source-bound opcode-run trace](receipts/2026-09-27-i80386-hot-opcode-runs.json)
now measures the complete xv6 `forktest` with the ordinary CPU left intact.
Its broad memory/ALU/branch/stack opcode set accounts for 84.8% of retired
instructions, or 73.1% after removing string operations. These are
optimistic opcode-family matches, not valid compiled blocks. Only 56,064
instructions, 0.230% of all retirements, fit complete 64-instruction spans in
the broad non-string runs, even before a branch, fault, code page, device, or
chip event splits them. Repeated strings account for most of the apparent
long-run opportunity. Four-instruction spans cover at most 53.0% of retired
instructions in the same optimistic non-string set; eight cover 29.8%, and
sixteen cover 7.4%. Each count ignores branches as block boundaries and is
therefore only a ceiling for unlinked blocks. The next executor should use
short blocks and cheap branch linking, with a separate interruptible REP
path. A design that requires long straight-line runs cannot deliver the 10×
end-to-end target on this workload.

The static [WASM block spike](I80386-WASM-BLOCK-SPIKE.md) now links
prevalidated JZ/JNZ/JMP targets inside a bounded call. A CMP/JNZ loop matches
the JavaScript 386 at a five-instruction event exit, and an invalid target
exits without committing the branch. This established the control-flow
contract; that predecessor had no guest memory access.

The [shared-RAM load spike](I80386-WASM-BLOCK-SPIKE.md) now lets the native
module read the AT board's live RAM without a copy. A prevalidated 32-bit
physical load matches a JavaScript 386 `MOV` in a focused test, and an invalid
end-of-RAM load exits without changing state. This removes one prerequisite
for a fast CPU backend; paging, MMIO, writes and exact fault exits remain to
be implemented before it can run xv6 instructions. The spike remains
disconnected from the AT board's execution path and changes no end-to-end
speed.

The native spike now also evaluates register-based SIB addresses at runtime,
and a host helper admits a physical RAM page only from an existing 386 TLB
entry. A protected-mode test maps a high virtual page to low physical RAM,
matches the JavaScript 386 for MOV/LEA, and rejects the window after a board
page-table write. This establishes a side-effect-free read admission and
remap exit for one page, not a general native paging implementation. A
decoder, wider opcode coverage, precise writes/faults and a measured AT
integration remain necessary for 10×.

The full xv6 [read-window trace](receipts/2026-09-27-i80386-read-window-admission.json)
shows that 92.6% of attempted `MOV 8B` memory reads use an already cached,
flat DS or SS mapping to plain RAM above 1 MiB. The complete guest report
matches the ordinary probe. This makes dynamic RAM reads a credible component
of a broad native block executor, but `MOV 8B` is only about 10.8% of retired
instructions and no guest opcode was accelerated by that trace.

An [opt-in real-byte native probe](receipts/2026-09-27-i80386-native-byte-block-negative.json)
now decodes a narrow subset of paged 32-bit guest code and executes bounded
MOV/CMP/TEST/LEA/NOP/JZ/JNZ blocks against the board's shared RAM. On the full
stock xv6 `forktest`, 5,131,681 of 24,338,279 guest instructions retired in
2,076,324 WASM calls. Every ordinary guest-report field matched the paired
JavaScript run, including CPU, serial, interrupts and 24,338,279 total steps.
The native run took **46.31 user CPU seconds versus 25.82 seconds** for the
ordinary lean run on the same host. This is a 1.79× slowdown, not a speedup.
The typical call retired only 2.47 instructions; the runner also checks code
bytes, mappings, events and state on every entry. A 10× target needs much
broader opcode coverage and cheaper block entry, plus precise writes and
fault exits. The production CPU and ordinary probe remain unchanged.

A second [real-byte A/B](receipts/2026-09-27-i80386-native-immediate-direct-state.json)
adds 32-bit register-immediate MOV and CMP, including sign-extended `83 /7`,
and copies CPU state directly to and from the shared WASM memory. The full
guest report still matches. The new path retires 5,202,654 instructions in
2,111,674 calls and takes 42.23 user CPU seconds; the paired ordinary run
takes 25.82 seconds. Direct state transfer cut the expanded path from 48.83
to 42.23 seconds, but the overall native path is still 1.64× slower. Reusing
the last loaded WASM program was also tested and removed after it measured
49.37 seconds on the earlier opcode set versus 46.31 without that cache.
These measurements point to the per-call boundary and short blocks as the
dominant problem; adding rare forms alone will not deliver 10×.

The [numeric block-cache A/B and opcode-form trace](receipts/2026-09-27-i80386-numeric-cache-and-opcode-forms.json)
removed a string allocation from each of roughly 21 million native lookup
attempts. Two complete native `forktest` runs then took 26.50 and 27.17 user
CPU seconds, versus 26.89 and 27.99 for the ordinary lean path. All four
guest reports and the instrumented trace match. This is around parity, not
a robust speedup; the 10× target remains open.

The same trace identifies the next high-volume forms: REP STOS (`AB` with
`F3`) retires 2,168,824 iterations; register SHR immediate (`C1 /5`) retires
1,200,526; register AND immediate (`81 /4`), ADD immediate (`81 /0`), AND
EAX immediate (`25`) and OR immediate (`83 /1`) each retire about 0.49–0.55
million. These are observed retired forms, not proof that a native block can
execute them safely. Register shifts and immediate ALU operations are the
next bounded decoder candidates. REP STOS needs an interruptible write path
with code/page-table coherence and precise event exits.

The [register ALU and shift A/B](receipts/2026-09-27-i80386-native-register-alu-shift.json)
adds 32-bit register ADD/OR/AND immediate, `AND EAX, imm32`, and SHL/SHR
immediate to the opt-in WASM blocks. On two full xv6 `forktest` runs, the
native path retires 8,813,759 of 24,338,279 guest instructions (36.2%) in
1,874,330 calls, about 4.70 instructions per call. Every ordinary guest-report
field matches. Native user CPU time is 22.87 and 22.49 seconds, versus 26.89
and 27.99 seconds for the recent ordinary runs. That is an observed roughly
1.2× gain for the opt-in probe on this host, still far from 10× and still not
integrated into normal CLI or GUI stepping. The next substantial coverage
requires precise native writes for REP STOS and common memory ALU forms.

The [bounded REP STOSD A/B](receipts/2026-09-27-i80386-native-rep-stosd.json)
adds native writes only to already cached, writable, dirty ES pages in plain
high RAM. It rejects page-table pages, the current code page, A20 gating,
MMIO, unvalidated translations and page crossings; other writes fall back to
the JavaScript CPU. The runner also now checks whether PIC or IOAPIC edges
are *deliverable*, matching the AT board's IF, APIC handoff and IOAPIC mask
rules. On full xv6 `forktest`, 2,145,309 REP STOSD iterations retire natively,
98.9% of the 2,168,824 REP STOS events observed in the earlier opcode trace.
Overall native retirement reaches 11,298,966 of 24,338,279 guest steps
(46.4%), at 5.43 instructions per block call. Two native runs take 20.02 and
19.72 user CPU seconds; recent ordinary runs take 26.43 and 26.77 seconds.
The final 4 MiB RAM SHA-256 matches exactly, as do CPU, serial, interrupts,
screen and milestones. This is an observed roughly 1.3× end-to-end gain for
the opt-in xv6 probe on this host, still far from 10×. Production CLI and GUI
stepping do not use this backend yet.

The code window admitted 44.67 million, but the diagnostic decoder recognized
the first opcode at only 19.14 million steps. Conservative observation credited
18.05 million retired steps in disjoint decoded blocks, including 10.83 million
in blocks of at least two instructions. No guest instructions ran through this
decoder. Memory operands, prefixes and unsupported opcodes stop many blocks;
the high code-window admission rate alone is therefore not an acceleration
result. The paired private 60-million-step ordinary/native comparison took
81.12 versus 87.43 user CPU seconds with matching guest state. A narrow
16-bit dispatch bypass also showed no repeatable gain. The next performance
experiment must measure CPU time by execution mode and block-exit reason,
then test broader memory, prefix, branch and string execution over multiple
instructions per native call. The 10× target remains open.

An [opt-in entry-mode CPU sampler](I80386-MODE-CPU-PROFILE.md) now measures
process CPU over completed AT-console step calls, flushing its clock at each
mode change. No clock window mixed modes. The four paired control/profile runs
had identical normalized guest output; the sampler added 2.41–2.86 user CPU
seconds, or about 3.4% on average. These mode shares include board and runner
work and are not strict retired-instruction costs. Even if 16-bit mode became
free, the observed share implies only a 3.31–3.35× overall ceiling for this
workload. A 10× path must accelerate substantial 32-bit work too. Pinned media,
raw reports, timing files and source hashes live in the private fixture repo.

The [opt-in code16 WASM block slice](I80386-CODE16-WASM-BLOCK.md) can execute
read-only `8A`/`8B` memory loads and a few register, immediate and branch
forms. It took 295.91 user CPU seconds against 78.40 for ordinary
execution, a 3.77× slowdown, and remains off by default. A later opt-in
[refusal census](receipts/2026-09-27-i80386-code16-wasm-diagnostics.json)
accounted for all 57.27 million fallback calls: unsupported first opcode
(29.85 million), 32-bit mode (15.28 million), short block (8.01 million),
repeat context (2.15 million), and unsupported memory form (1.81 million)
dominated. Data-proof refusals numbered only 13,319. These are dispatcher
calls, not unique retired instructions or CPU-time shares. The immediate
priority is to identify complete prefixed and stack/control instruction
forms and find a way to keep useful blocks running across branches.

The existing decoder returned null at 10.06 million entries; another 3.06
million produced only a single-instruction candidate. Of 1.81 million
retired `8B` instructions, 0.96 million had a single-instruction candidate,
0.59 million a multi-instruction candidate, and 0.26 million no candidate. No newly missing narrow opcode family reached the preset 1.5-million
retirement threshold. This census preserves the ordinary guest report and
does not measure native speed. Its counts favor broad grouped-form coverage
and cheaper entry/continuation over a small isolated opcode addition.

An independent
[native-dispatch profile](receipts/2026-09-27-i80386-native-dispatch-profile-negative.json)
put all native-specific self samples at only 8.90% of its measured run,
below the preset 10% threshold for a narrow entry/cache patch. These
different profiles cannot be multiplied into a speedup estimate.

The code16 slice later added ES-prefixed reads and a proved, terminal
plain-RAM word store. It took 303.48 versus 79.20 user CPU seconds, a 3.83× slowdown. This
write contract is useful correctness groundwork, not a faster path.

Three execution-neutral probes then measured the possible length of broader
blocks before implementing them. Following only [actual conditional-Jcc successors](receipts/2026-09-27-i80386-broad-jcc-linked-potential.json)
raised those means to 2.56 and 3.58.

A parallel [selected-form syntax scenario](receipts/2026-09-28-i80386-selected-forms-potential.json)
then included read-only byte compares/tests, accumulator immediate ALU,
`F6/F7 /0` TEST and `0F B6/B7` MOVZX in the observed grammar. Both full guest reports and the preexisting census views matched exactly. The predeclared gate required at least 50% potential coverage and four
steps/run on *both* workloads. broader guest fails, so no executable path follows
from this selected set. These are optimistic syntax counts, not code/data
proofs, CPU-time shares or measured acceleration.

Adding another isolated opcode to the current code16 WASM dispatcher is not
supported by these measurements. Identity/replay checks can only reduce those shares, so a proposed 50%
per-mode hot-trace gate fails without another full probe. A path toward 10×
must instead handle more control, stack, segment and string boundaries per
entry, or cut entry cost enough that short runs become worthwhile. Any
executable prototype must preserve guest state and beat ordinary execution
in serial paired full-workload CPU-time tests. The 10× target remains open.

An opt-in [observed backward-Jcc locator](I80386-HOT-LOOP-LOCATOR.md) then
measured actual branch recurrence without changing execution. Long traversal sums overlap at nested branches
and are not disjoint executable coverage. The strongest xv6 protected32 exact-identity site
repeats 8,961 times at 25 steps. Neither single site can deliver a whole-run
10× gain.

Targeted ordinary-step body traces exposed why those sites cannot yet be
batched. The [xv6 proof audit](receipts/2026-09-28-i80386-xv6-hot-loop-prototype-no-go.json)
found a 25-step page-table-writing `mappages` loop, an 18-step loop with a
PDE-dependent PTE read, and a nine-step loop with dependent reads and a
write. Current entry-only code/data windows cannot admit these without
losing translation coherence or precise later-instruction faults. That
initial audit stopped without executable work or CPU-time A/B.

A follow-on [dependent-read observation](receipts/2026-09-28-i80386-dependent-read-xv6-observation.json)
admitted 51,150 of 51,200 reached second-read attempts using cached RAM
proofs. A guarded [two-phase xv6 prototype](receipts/2026-09-28-i80386-deallocuvm-two-phase-negative.json)
then preserved the full guest report and RAM hash while retiring 1,038,726
instructions natively. Serial user-CPU pairs were 27.90/31.39 and
26.55/32.92 seconds for ordinary/opt-in: the opt-in mean was 18.11% slower.
The full-workload no-regression gate failed, so its executable changes were
discarded. Those native retirements cover 4.268% of completed step calls;
that is not a measured CPU-time share.

## Native bridge checkpoint (2026-10-01)

The bounded free protected-mode workload now has [H2 cost profiling](I80386-NATIVE-HOT-NAPI-COST-WIP.md), [H3 key reuse](I80386-NATIVE-HOT-PROPERTY-KEYS-WIP.md) and [H4 packed scalar evidence](I80386-NATIVE-HOT-PACKED-SCALAR-WIP.md). H3 reduced median adapter wall time by 7.83% in its seven-pair comparison. H4 reduced mean process CPU cost by 13.37% against H3 in a separate seven-pair comparison, with all pairs favorable and complete canonical trace/journal parity. These percentages use different metrics and must not be combined. The 10× target, physical 386DX RTx calibration and full-guest native admission remain open.

## Conditional argument checkpoint (2026-10-02)

[H5 conditional arguments](I80386-NATIVE-HOT-CONDITIONAL-ARGS-WIP.md) preserved all bounded semantic controls and complete canonical trace/journal parity, but its seven-pair CPU gate failed: mean process CPU increased 0.20115% against H4, with three pairs favorable. All 18 children passed semantic checks. Retain H4 as the baseline; H5 provides no measured CPU gain or progress claim toward 10×.

## Clock witness checkpoint (2026-10-02)

The [fenced H4 diagnostic](I80386-NATIVE-CLOCK-FENCED-WITNESS-WIP.md) passed all 439 resume-pair fence checks and full canonical trace/journal/state parity using the unchanged held H4 engine. Its source-owned offline witness preserves independent native ticks and successful quanta. No native batching or performance backend is implemented, and diagnostic timing does not establish progress toward 10×.

## Owned replay checkpoint (2026-10-02)

The [private worker ownership/replay proof](I80386-NATIVE-OWNED-CLOCK-REPLAY-WIP.md) reproduced all 439 historical resumes and 209,839 logical host rows, six real-board checkpoints and entire RAM. This supplies an owned host boundary for later native work; it runs no addon/CPU and provides no native batching or speed result. H4 remains the baseline and the 10× target remains open.

## Native clock and snapshot checkpoint (2026-10-02)

The [actual private-worker clock batching](I80386-NATIVE-OWNED-CLOCK-WIP.md) now matches the full fixed-ROM CPU/device chronology and all six checkpoints, with 33 runtime controls passing. Its seven-pair process-CPU gate failed: 9.2997% more CPU than H4, only one pair favorable. Fewer crossings did not yield a retained speed improvement. Subsequent diagnostic wall buckets identify snapshot serialization and messaging as possible costs, without establishing removable CPU shares.

The [first structured-snapshot cost screen](I80386-NATIVE-OWNED-DTO-COST-WIP.md) also rejected its descriptor-heavy validator before native execution. A lighter private-channel schema passed 39 source controls, but the subsequent complete MessageChannel reply exercise also cost 35.56% more CPU than JSON, with all three rounds unfavorable. Object DTO development stopped before native integration. A fixed packed snapshot format also failed the subsequent all-costs source comparison, using 162.77% more CPU than JSON with every round unfavorable. Both transports stopped before native integration. The next source candidate runs the same addon/provider and full fixed-ROM scheduler inside a closed fresh child on its main thread, with separate ownership/provenance proof, actual parity checks and a predeclared CPU gate required. H4, the 10× target and the unqualified full-guest native scope are unchanged.

The [closed fresh-child main-thread topology](I80386-NATIVE-OWNED-MAIN-WIP.md) now retains all 439 native snapshots, six whole-board checkpoints, complete CPU/host chronology and RAM parity, with 13 main-specific lifecycle controls passing. It reuses the unchanged compiled ABI3 addon and private provider while removing internal Worker IPC/JSON replies. Runtime bab/95 and compiled 7df/86 identities remain separate; merged-main qualification is not inferred. The fixed 18-child paired process-CPU gate passed: mean H4 503,081.571 µs versus main-thread ABI3 370,625.714 µs, a 26.3289% reduction with all seven measured pairs favorable and full semantic parity in every child. Independent result audit passed **318,736 checks**, authenticating all 18 complete captures, source/build bindings, resources, CPU arithmetic and the predeclared gate. This qualifies an isolated fixed-ROM candidate, not merged-main runtime, full guests, physical-clock RTx or the 10× target; prior failed Worker/transport gates remain unchanged.

The [main-thread attribution diagnostic](I80386-NATIVE-OWNED-MAIN-WIP.md#main-thread-attribution-2026-10-02) retained full fixture state and physical-counter parity. Its overlapping wall buckets point to ordered clock replay for source review, without establishing CPU shares. The next source-only candidate removes per-word arrays and closures from private clock methods while preserving guards and journals; no further speed result is claimed.

The [private clock allocation candidate](I80386-NATIVE-OWNED-CLOCK-ALLOC-WIP.md) preserves complete capture-OFF snapshots and capture-ON CPU/journal chronology against qualified main-thread `bab`, with 33 source controls passing. It specializes only private capture-OFF N/Q methods; provider dispatch and generic H4 remain unchanged. The third trace-ON/journal-OFF cell also matches every canonical CPU row and full guest state, with 1,666,954 independent checks; it exercises the fast path through source-bound null-sink admission. The fixed 18-child CPU gate against `bab` failed: MAIN mean 379,478 µs versus ALLOC 358,373.714 µs, a nominal 5.5614% reduction with only five of seven favorable pairs, missing the ≥10%/all-seven requirement. All 18 semantic checks passed; independent result audit passed 319,728 checks and confirmed the failed gate. The candidate is not adopted or retried. Qualified main-thread `bab` remains the baseline; its earlier H4 comparison is not combined with this rejected screen.

The [fixed PIC IMR compatibility prototype](I80386-NATIVE-OWNED-PIC-IMR-WIP.md) adds masked master/slave IMR reads to a distinct free ROM. Its [actual native OFF/ON qualification](I80386-NATIVE-OWNED-PIC-IMR-RESULTS.md) now passes full stored snapshots, six checkpoints, RAM policy and complete PIO/NQ chronology. This remains a fixed-fixture compatibility extension with no CPU speed claim or general AT admission.

The [owned baseline Inspector diagnostic](I80386-OWNED-BASELINE-PROFILE-RESULTS.md) supplies qualitative execution-window stack ranks with full fixed-fixture parity. Its logical clock words are distinct from physical transfers; it establishes no CPU shares or new speed result.
