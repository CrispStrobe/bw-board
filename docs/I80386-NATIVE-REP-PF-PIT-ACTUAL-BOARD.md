# Native actual-board compact REP / two-page-fault / PIT gate

**Qualified bounded checkpoint, 2026-10-01.** Public [capture](receipts/2026-10-01-i80386-native-rep-pf-pit-capture.json.gz), [result](receipts/2026-10-01-i80386-native-rep-pf-pit-result.json) and [independent audit](receipts/2026-10-01-i80386-native-rep-pf-pit-audit.json) preserve the evidence.

## Bounded result

The free cold-reset ROM exercises the native Bochs CPU3 adapter against a fresh `ExperimentalI80386ATMachine` board. Node owns physical RAM/ROM, typed data callbacks, port effects, PIC/PIT wiring, all eleven configured chip snapshots, and functional clock/debt accounting. The JavaScript CPU never steps during native execution. No BIOS CPU instructions execute and no guest RAM state is copied or preseeded.

The final source freeze is `cb5c818dd393c03ac562a65b0951f55aef804371`. Fresh formal capture `fe9a1e2d34d7a5b3436e17d33f084dd68a9f5f76b4fc68de6c1104769bf7c09a` and independent repeat `8d62d85ba400bb9c617934f08f9fa5c879a2043e99ffd79472ee94d32eb1eb1b` pass all four successful-work budgets and all native/transport rejections. The independent audit authenticates 206 retained files per capture and the exact 61-input historical source inventory. Native records/state, whole-board host journals and RPC transcripts match exactly. BWS11 streams are byte-identical; full stderr differs only in two Bochs startup configuration/log path lines. Whole captures differ in retained directory paths and artifact digests.

The fixture completes 135 successful work quanta and 137 independent native ticks, with two page faults, one actual PIC IRQ, five successful nonzero REP elements, and 814 functional board clocks: one four-clock hardware reset plus six clocks per successful work quantum. Failed attempts and fault/IRQ delivery earn no work quantum. These are functional charges, not measured processor latency or 135 retired instructions. Terminal device debt is settled without an invented CPU idle step.

Continuous and successful-work budgets 1/2/257 retain all raw evidence. Each arm has 432 requests: 2 executable-page fills, 135 work charges, 137 native ticks, 60 physical writes, 76 physical reads, 21 port outputs, and 1 PIC acknowledgement. Callback execute admissions number 14; page fills are transport payloads, not architectural byte-fetch callbacks. Raw attempts are 135/137/135/135, completed instruction counts are 132, and physical terminal idle cuts are 2/1/1/2. This census is independently checked against both fresh captures.

The mandatory actual-report suite passes 54 tests, zero skips: a genuine captured baseline plus 53 rejection cases. Guards additionally require 19 named native fail-closed aborts, 18 malformed transport aborts, and 11 API probes. The focused suites total 59 passing tests, zero skips (54 report plus five host).

## Guest and interrupt evidence

A free 64 KiB ROM starts at raw physical `0xfffffff0`, enters protected 16-bit code resident in ROM, and enables sparse 4 KiB paging. The fixture uses address16/data32 REP STOSL, four destination elements beginning at `0x4ff8`, a separate ordinary write to initially absent page 6, zero-count REP, and one-element REP. It writes its own GDT, gates, PDE/PTE entries, and handlers' repair state into initially zero RAM. There is no REP table-clear loop, bulk bootstrap copy, or private guest payload.

The actual guest programs cascaded I8259 controllers and I8254 channel 0. Reload six produces the captured active edge at successful Q72, board cycle 436, after ONE successful REP element and before the second element fetch. The raw REP progress there is CX3/DI4ffc. This edge is derived from real PIT state, rational phase, and board deadline/debt handling; it is not a synthetic line/vector or a hardcoded instruction deadline.

The first failed write is the REP destination `0x5000` after Q73. The second is the ordinary destination `0x6000` after Q90. Both retain failed-attempt pagewalk A/D effects, deliver error2, repair the corresponding PTE through guest code, reload CR3, and retry. The frames at stack `0x8ff0` contain error2, EIP `0x22c` or `0x237`, CS8, EFLAGS `0x10046` including RF. An unmapped zero REP performs no destination access and still earns one ordinary successful-work charge.

STI's successor completes before actual PIC acknowledgement. ACK is exactly vector `0x20`, CS8/EIP `0x255`, N110/Q108. IRQ delivery adds no N or Q; its three-word frame at `0x8ff4` contains EIP `0x255`, CS8, EFLAGS `0x246`. The guest handler and final `RPPT001` E9 marker are executed evidence. The adapter exports raw CPU/cache state and actual eligibility chronology; its hidden `inhibit_mask`/`inhibit_icount` internals are not exported, so this receipt does not claim raw internal STI-shadow parity.

## Explicit differences, retained raw

Full reset parity and full JavaScript/native byte-bus order parity are false. There are no generic masks or write/read sorts. Reset EDX is JS `0x300` versus native zero; native CR0 is `0x7ffffff0` versus JS zero. The guest records both raw reset words at `0x510`/`0x514`. CPU3 `SetCR0` preserves its source-defined OR behavior: guest operands `0x11` and `0x80000011` produce native raw `0x7ffffff1` and `0xfffffff1`, versus JS operand values. Defined PE/PG/ET intent agrees; reserved-bit raw equality is not claimed. Raw table limits, debug registers, segment/system caches, and register provenance are retained and authenticated.

For each successful nonfinal REP element, the native hook exposes decoded-end RIP `0x22f` while JS exposes restart EIP `0x22c`. Attempt bytes, length, start site, and post-CX/DI bind this source-backed staging difference. The final element has decoded-end state in both. Only budget1's two exact effect-free redecodes at Q73/N73/CX2/DI5000 and Q86/N87/CX1/DI5004 are excluded from the comparison projection; their prior one-quantum slice cuts and progress are validated, and raw entries remain in the receipt. No arbitrary REP attempt is discarded.

Three exact same-privilege 32-bit ordinary-RAM delivery frames have a declared order difference: native pushes flags, CS, EIP, then optional PF error, with ascending bytes within each dword; JS commits the assembled frame in ascending addresses. This applies only to the two PF sites and one IRQ site above. The old RAM gate's eight far-CALL exception does not authorize this rule.

Four exact ordinary read sites also differ. At the protected far jump `0x1cd` (post-Q35), JS rereads the eight-byte descriptor at `0x608`; native reads it once. At IRETD sites `0x2ac` (post-Q85/Q101) and `0x2d3` (post-Q119), native reads flags/CS/IP while JS reads IP/CS/flags. All raw ordered reads remain present; all other ordinary and REP data operations are compared strictly in order, with only the named raw reset witness values differing.

Pagewalk callback parity is false. Native combines A/D bits on five first-write translations while JS writes A then D separately: native A/D writes total 36 bytes versus JS56. Native 21 ordered PDE/PTE read pairs are validated against sparse fixture linear-address roles and actual backing; nine whole-dword A/D transitions preserve mapping, permissions, present bits, and monotonic A/D changes. Native raw reads337/writes214 versus JS337/234 are retained, not normalized into callback parity.

## Ownership and scope limits

Execution admission is immutable ROM only, generation0, fixed A20-on/mapping epoch0. RAM execution, self-modifying code, A20 transitions, VGA/MMIO, unsupported ports/spans, DMA/external host mutation, unexpected faults/REP forms, and Bochs RAM/PIO/timer fallback paths fail closed. Data and pagewalk writes are staged then published at their actual ordinary/REP/fault/IRQ/prefetch-pagewalk boundaries. Prefetch publication permits only audited pagewalk A/D writes. No synthetic cache/TLB flush occurs: immutable ROM execution needs no RAM executable-alias repair, and guest MOV CR3 owns translation invalidation. `COHERENCE` rows describe effect publication, not production RAM cache coherence.

The baseline is the source-bound actual JavaScript board oracle, whose validator also performs a cached reexecution through the same JavaScript engine. That reexecution is useful reproducibility evidence, not a third independent CPU oracle. Independent source/ROM, physical backing, ordered bus/RPC, frame, pagewalk, clock, and chip audits add separate checks. This remains one bounded functional fixture: no general backend integration, x86 ISA completeness, Windows/Doom compatibility, RTx, browser speed, or 10× performance claim.

## Source pins

- Bochs revision: `0e45b736ef9792eb9b752b0a35db49eaf2faea47`.
- Qualified r2 executable SHA256: `a00e4cd0232cbcb3ef28ab4ba26a508da36d16052e8ab6a1516d0599f7c30a3e`.
- Build configuration SHA256: `d4945445c2412c0b4e8c5cac80cee28d443bb438c36c9ea6b1bb5196147f1e8c`.
- Runtime include SHA256: `474010ee15c83f2e21edd7478077b3c3adf7f2d61a3cc6d27b727cb3589374ac`.
- Free ROM SHA256: `6fae1b9e92872ec3ae497eb5f9e7b65126409480f37e9126cc42de862f2e570b`.
- Historical JS oracle source: `7891a5c1f9ca242a86a6fcd39a61b5bc29e8d247`; decompressed receipt SHA256 `f2c3187c40173f64b0acb51cd86d0ca9ce8a250b5d634fc4e9a2c3d95c56fe1e`.
- Committed report fixture is the first passing historical native capture from source `59b528bf0a0dbc5dc7bbc0416c9ade035fca78d5`: raw capture SHA256 `9516ac2e3e38a42c52d41c6490f0b90e696afdd3c20137aede753ffc5a406a01`, gzip SHA256 `ae0cd710a942fbd750f6a0e0476fe4d3b033b6bf6016327bc15b22afd841d8f8`. It is distinct from the fresh final formal/repeat captures.
- All twelve transformed upstream files and copied ABI/runtime files are independently regenerated/authenticated in preflight. Exact historical import closure is checked, not a minimum-key subset. Final source inventory has 61 inputs, including the mandatory report test and genuine historical fixture.

Earlier e7 diagnostic captures remain explicitly unqualified: execution completed but the then-current checker had a schema error and lacked subsequent semantic bindings. They are preserved as diagnostics and are not passing receipts. New gzip unvalidated sidecars preserve exact JSON bytes without altering full captures or raw artifacts.


## Replay and next gate

From a clean source checkout and the pinned Bochs source, prepare the bridge, configure CPU3/no-GUI/SMP-off/debugger-off/REP-speedups-off/chaining-off, and build serially as in the [RAM gate recipe](I80386-NATIVE-RAM-COHERENCE-ACTUAL-BOARD.md), using `scripts/prepare-bochs-cpu3-native-rep-pf-pit.mjs`. Then:

```sh
node scripts/run-i80386-native-rep-pf-pit-board-gate.mjs --build /prepared/tree --manifest /prepare.json --out /new/capture
node --test --test-concurrency=1 test/i80386-native-rep-pf-pit-host.test.mjs test/i80386-native-rep-pf-pit-board-gate.test.mjs
```

Historical source objects `7891a5c1f9ca242a86a6fcd39a61b5bc29e8d247` and `59b528bf0a0dbc5dc7bbc0416c9ade035fca78d5` must be available; CI explicitly fetches both. A different compiler/build requires a new source-bound binary audit rather than substituting a hash. The final public gzip is 1902940 bytes, SHA-256 `a13a46bbe7e7a068810cdea52842df74eb25235045e44a80a897e2f9da60f8e5`.

The [next combined gate proposal](I80386-NATIVE-COMBINED-RAM-REP-NEXT-GATE.md) combines protected paging/REP/fault/IRQ boundaries with guest-created executable RAM, self-modification and actual A20 mapping transitions. Flushes must follow executed aliases/mapping changes without introducing per-element REP cuts. Only after that combined qualification should the production in-process/WASM backend and paired guest-workload speed measurements proceed.

The earlier 59-input publication candidate is retained in repository history and local captures. Shallow verification exposed two dynamically read JS oracle seed files outside the native inventory; both now join the 61-input freeze. A hosted general test run also lost details from repeated Git history reads after a passing baseline. The checker now caches immutable commit-qualified bytes and preserves actual Git failure diagnostics; the underlying earlier Git failure cause was not established. The corrected checker passes all 59 focused tests, and both final captures were produced anew.
