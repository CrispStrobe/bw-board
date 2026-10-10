# Corrected far-attribution CPU and finite xv6 regressions

The first corrected automatic [push run37942619141](https://github.com/CrispStrobe/bw-board/actions/runs/37942619141)
for [draft PR480](https://github.com/CrispStrobe/bw-board/pull/480), source
`6191a70650142ea46552c2d417eb7eb62aa08e38`, passed. Root acquired the
original ZIP and raw log once; root and an independent reviewer audited exact
source, artifact/log identities, TAP titles and finite guest reports without
producer imports or replay. [summary.json](summary.json) records attribution
and official original identities. The earlier [fixture failure](../2026-10-09-far-attribution-cpu-failure/README.md)
remains preserved, with production CPU bytes unchanged by its test-only fix.

All 131 focused controls passed, including 102 authored journal cases, five
boundary, thirteen policy and eleven orchestration cases. Current TAP totals
were 1,695 passed, zero failed and eleven skipped out of 1,706; all 288
historical tests passed. The five-member JSON packet binds the executed
revision directly to the reviewed source. Its three finite 4 MiB/14 MiB boot
and process-exhaustion scenarios retain expected serial markers, user-mode
entries, IRQ/milestone facts and build/probe image identities. Seventy listed
source roles plus the separately checked BIOS role match raw Git bytes.

This qualifies affected finite CPU/xv6 regressions in the existing PSE/APIC
compatibility profile. It does not qualify strict physical 386DX behavior,
the newly attributed AT guest instruction, original task/frame return, native
performance or broad OS/application support. Finish every remaining enabled
exact-head check before implementing a separately admitted connected
diagnostic. Review that new source and all checks before its own single
original guest run. Do not replay or relabel frozen earlier diagnostics.
