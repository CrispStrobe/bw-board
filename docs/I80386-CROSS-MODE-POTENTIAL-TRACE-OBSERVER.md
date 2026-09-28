# Cross-mode actual-successor potential trace observer

This is the predeclared observation step in [the broader execution draft](I80386-BROADER-EXECUTION-ARCHITECTURE-DRAFT.md). Set `AT_CROSS_MODE_TRACE_OBSERVER=1` on the ordinary, noninteractive `run-i80386-at-console.mjs` Windows run. It instruments observation around `machine.step()` and leaves the guest executor unchanged. Use the same pinned private Windows source and inputs for an unobserved baseline, with `AT_POST_STEPS=60000000` on both, and private `AT_CONSOLE_REPORT` paths. Keep raw reports and media private. Run the reducer after both complete:

```sh
node scripts/summarize-i80386-cross-mode-potential-trace.mjs observed.json baseline.json > cross-mode-receipt.json
```

The reducer refuses incomplete 60M reports, different execution revisions or complete source-hash maps, changed selected guest results or input pins, changed non-observer report fields, missing or mismatched source bytes, and inconsistent observer partitions. It publishes source and raw-report hashes, per-mode counts, exit/refusal reasons, and opcode counts, without guest text or media IDs. This selected report comparison is not a full RAM, disk, or hidden CPU-state equivalence proof. Instrumented runtime is diagnostic overhead and **must not be used as speed evidence**.

Every completed board step call is classified by its entry mode. A core-cycle increase establishes a completed step call. Calls without a cycle increase and thrown calls have separate counters. The core handles REP strings as interruptible iterations, one per board step; **all REP string/I/O calls are conservatively excluded** from `eligibleRetiredOrdinals`, including the final iteration. Thus `completedStepCalls` and `eligibleRetiredOrdinals` are distinct denominators. No REP call can enter a potential trace or the 30M gate.

The ordinary CPU's successful decode/execute is a **very optimistic syntax and semantics oracle**, so all modeled, actually completed opcode forms may contribute. It does not establish a reusable micro-op grammar for a trace executor. The observer records the bytes fetched by that instruction but decodes no speculative successor. A potential trace follows the actual post-step CS:EIP. It ends on a changed mode, CS, physical code page, CPU/mapping identity, external input, REP iteration, unsafe memory or code access, code/page-table write, delivered fault/interrupt, chip horizon, or the 64-instruction budget. It records a complete disjoint run when closed. Code-page and translation revocations are reported separately; opcode histograms and `outsideBroadGrammarOrdinalsInRunsAtLeast8` show exactly how much long-run coverage comes from forms the earlier broad-block classifier omitted. `controlTransferOrdinalsInRunsAtLeast8` reports admitted branches, calls, returns and interrupt transfers; their observed continuation does not prove an executable fast path. Runs of length at least eight count every eligible ordinal once. The gate requires both 30M such ordinals across all modes and 5M in protected16/VM86.

I/O calls are admitted only under an **optimistic synchronous helper assumption**: a future helper would have to perform the same ordered port access, settle chip effects, and recheck the next boundary. `optimisticIoOrdinalsInRunsAtLeast8` identifies dependence on that unproved continuation. A chip flush during I/O closes the run after that call. An observed successor and same physical page do not prove safe compilation, precise fault order, raw-memory mutation coherence, or a fast implementation. A passing gate is only an upper-bound opportunity screen; it is not executor feasibility. The previous limited-grammar broad Jcc census found only 8,166,828 Windows step calls in runs of at least eight. A larger count here would be a newly measured optimistic opportunity, never a reinterpretation of that result.

## Pinned Windows 60M result (2026-09-28)

The [media-neutral receipt](receipts/2026-09-28-i80386-cross-mode-potential-trace.json)
from board source `7bee0e6a` passes the **opportunity screen**, not an executor
qualification: 38,839,499 distinct eligible retired ordinals are in disjoint
observed runs of at least eight (70.21% of 55,316,160 eligible ordinals);
21,739,881 of those long-run ordinals entered in protected16 or VM86 mode.
The 59,971,215 completed step calls include 4,655,055 REP iteration calls
that the observer excluded from the eligible-retirement denominator. Both
60M-step reports reached the same budget with matched selected guest fields,
input pins, source revision and complete source hashes. Raw reports and
media remain in the private firmware repository.

The long-run count includes 9,410,523 control-transfer ordinals, 9,016,938
ordinals outside the earlier limited broad-block grammar, and 132,449
ordinals under the unproved synchronous I/O-helper assumption. These categories
can overlap; they are not additive. The next step is the small executable
branch + RAM + port-I/O loop proof in the architecture draft, with precise
state/device parity before any full Windows timing trial. The observed run
used 573.49 user-CPU seconds versus 80.59 for its unobserved baseline; this
is measurement overhead from the observer, **not** an emulator slowdown
or a timing A/B.
