# Register-stack observer: Windows opportunity gate fails

The [default-off register-stack diagnostic](I80386-REGISTER-STACK-ADMISSION.md)
completed serial ordinary observer-off/on pairs from board revision
`aaa0b558bf8f48a744b99ba1979c53408d21e979`. The
[source-bound Windows receipt](receipts/2026-09-30-i80386-register-stack-windows-result.json)
records 60,000,000 completed steps in each arm. The
[stock 4 MiB xv6 `forktest` receipt](receipts/2026-09-30-i80386-register-stack-xv6-result.json)
records 24,338,279 steps per arm. Both reducers verified the complete reported
source inventory against committed bytes and whole parsed report equality after
removing only the observer diagnostic and its explicit flag. That equality
includes selected guest inputs, final RAM and attached-disk hashes, full CPU
instruction snapshot, CPU cycles, and board machine cycles. The reported
opportunity is from completed **ordinary** steps; no trace executed.

The Windows grammar admitted **30,981,123** of **55,316,160** eligible retired
ordinals. It reached **9,616,345** unique ordinals in disjoint runs of at
least eight overall and **8,514,517** in protected16+VM86. The predeclared
**15M overall / 5M protected16+VM86 gate fails**: the overall count is short
by **5,383,655**, although the mode count exceeds its threshold by
**3,514,517**. The unchanged earlier expanded grammar reached 6,098,778 and
5,594,423, respectively, on a different board revision. The additional
register-stack forms increased observed coverage, but did not meet the
necessary overall screen.

| Entry mode | Eligible | Admitted | Unique ordinals in ≥8 runs |
| --- | ---: | ---: | ---: |
| Real | 12,134,947 | 3,960,451 | 586,059 |
| Protected16 | 9,068,664 | 6,181,401 | 3,191,597 |
| VM86 | 20,282,881 | 13,587,985 | 5,322,920 |
| Protected32 | 13,829,668 | 7,251,286 | 515,769 |
| **Total** | **55,316,160** | **30,981,123** | **9,616,345** |

The remaining `unsafe-code` and `unsupported-opcode` refusals and the
unchanged identity, event, paging, data-page, and write cuts can still break a
run. Refusal counts are not additive recoverable coverage: changing one cut
can reconnect runs and alter the denominator. The diagnostic counted
2,436,372 typed candidates rejected by global cuts. Neither admitted
ordinals nor local opcode frequency estimates CPU cost or saved time.

The separate lean stock xv6 pair admitted **14,252,896** of **22,098,966**
eligible retirements, with **967,663** unique ordinals in runs of at least
eight, all protected32. The prior expanded grammar found 317,206 such xv6
ordinals at an earlier board revision. xv6 has **no admission pass threshold**;
its protected32 result cannot substitute for the failed Windows overall gate.
This `forktest` is a stock guest with a later CR4.PSE/4 MiB paging requirement
and the configured board's APIC surface, as described in
[stock xv6 scope](XV6-STOCK.md). It does not qualify an unextended physical
386DX or a strict CPU-level-3 oracle.

Windows [recovery provenance](receipts/2026-09-30-i80386-register-stack-windows-recovery.md)
needs a separate qualification. Its parent process exited
with status **143** after writing both raw reports and six stdout/stderr/time
files; the cause is unknown. The original historical host manifest, artifact
index, comparison, and reducer candidate were never written. A later private
read-only audit bound the original preflight and all eight original file
hashes to the committed protocol, revalidated the full source map and report
parity, and reran the committed reducer. The audit's host and UTC fields are
**postvalidation**, not reconstructed run-start or host-timing facts. The
Windows compact receipt is the reducer output from that audit; the xv6 pair
completed its ordinary protocol normally. Private raw evidence and both exact
protocol versions are archived at private commit
`3e54aed32e2a78bcaf0236241e8222e55799b576`. The Windows and xv6 public
receipt SHA-256 values are, respectively,
`9c6192e1ae526860b07a9025b3b0b19d0d8d353a643851f1a1f19304cda18038`
and
`0e5b0a9613540c7dab1dad790f5c1a1c7a942b2a0a2622e723aab9878d431d65`.
Their raw-report SHA-256 values are retained in those compact receipts; no
licensed media, guest text, or private host paths are published here.

The trace opportunity gate has failed, and no profile or executable trace
proves an avoidable cost or speed gain. A separate
[full-core WASM feasibility note](I80386-FULL-CORE-WASM-FEASIBILITY.md)
remains a source audit. Its next concrete prerequisite is a pinned native
full-CPU checkpoint and ordered memory/port-event oracle at an owned strict
386 fixture. Only after that differential contract passes could an opt-in
full-core candidate be assessed. The unmodified stock xv6 image would then
require a separately labeled later CPU mode with CR4.PSE support, followed by
complete guest-state parity and serial same-host timing pairs. Neither this
observer nor the xv6 count supplies those proofs.
