# Browser worker and observation boundary

Experimental verification harness, not a production application/pin change.
The worker owns the existing wired board and CPU. It advances actual complete
periods in bounded chunks; it does not replace memory/DMA with host callbacks.
Cancellation and scheduled input are checked at period boundaries. No observer
receives a fabricated trace from architectural accesses.

The browser harness uses the same five owned, media-free workloads
as the Node benchmark, compare state and mapped-memory hashes, and record a
main-thread heartbeat while the worker runs. ROM assembly/construction are
outside the execution timing; reset initialization is included. Observation
and hashing are batched at workload boundaries. Worker chunk/yield overhead
belongs in the end-to-end receipt and must not be called an intrinsic speedup.

Wall-time chunk limits are cooperative, not hard deadlines: one complete board
period cannot be preempted halfway through a write/settle. A debugger stop or
input scheduled by virtual clock is honored before that next period. UI stop
messages are consumed between worker tasks. Keep detailed traces separately
gated; this harness starts with bus tracing off and CPU history on.

The initial all-five-workload smoke run passes: every state and mapped-memory
hash matches the committed Node receipt, and a posted cancellation stops at a
complete period. This is not yet the repeated performance receipt. Run it with:

```sh
CHROME_BIN=/absolute/path/to/chrome HARRIS_BROWSER_REPORT=/new/receipt.json node bench/harris-browser.mjs 3
```

The runner uses a fresh profile, checks hashes of every served source before
accepting the report, and refuses to overwrite an existing receipt. It compares
reference and compiled/scheduled/packed modes after warmup, alternating their
order. All five useful-work/state checks run inside the worker; the host also
checks their hashes against the recorded Node results. UI heartbeat and actual
worker-message cancellation are measured separately. The generic chunk runner
has tests for exact budgets, scheduled input order, cancellation and faults.

A responsive UI, a passing
owned fixture, or a bus-only benchmark does not satisfy the full
[real-time capacity gate](WIRED-X86-PERFORMANCE-PLAN.md). The installed system
Chromium wrapper fails in this container; a separately installed local Chromium
binary is available for a fresh, loopback-only test profile. No guest media,
browser account/profile, remote deployment or new external dependency is needed.
