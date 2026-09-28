# Windows 3.11 code16 block path: current-source no-go

The [media-neutral 60-million-step receipt](receipts/2026-09-28-i80386-code16-windows-current.json)
records one ordinary run and one opt-in code16 WASM diagnostic run at source
`e7434073afc67aa5803c01502315609b49cd108e`. Both used the same pinned
private Windows 3.11 image, ROMs, geometry, empty event replay, and emulator
sources. The reducer compares those inputs privately and publishes no media
identifier or guest text. The selected reported guest fields match: step
count, stop/refusal, the report's CPU subset, delivered events, serial,
text-RAM and VGA plane results. The receipt hashes only these fields.
The console report has no full RAM hash, disk state or complete hidden CPU
state, so this acceptance check does not prove full guest-state equivalence.
The host had four virtual Intel Xeon Skylake CPUs and Node 20.20.2.

| 60M step run | User CPU | Wall | Max RSS |
| --- | ---: | ---: | ---: |
| Ordinary | 78.52 s | 71.53 s | 149,520 KiB |
| Code16 WASM with diagnostics | 392.05 s | 408.58 s | 218,544 KiB |

The diagnostic opt-in cost **4.99 times** the ordinary user CPU. It retired
5,042,482 instructions (8.40% of all step calls) in 2,345,288 block calls,
only **2.15 instructions per call**. The 54,957,518 fallback calls include
27,550,452 unsupported first opcodes, 15,277,507 protected-32 entries,
8,006,100 short blocks, 2,150,307 repeat contexts, and 1,793,047
unsupported memory forms. Among short-block stops, 3,484,531 are terminal
branches. The run enabled form and refusal diagnostics, so its extra cost
cannot be assigned wholly to the executable slice. It is nevertheless an
end-to-end no-go for this diagnostic configuration; the earlier executable
slice also lost at 3.77 times ordinary user CPU with 4.55% retirement.
Neither run is a hardware 386DX RTx measurement.
The `unsupportedFirstOpcodes` keys in the receipt are **decimal byte values**:
`38` means hex `26` (ES prefix), `142` means hex `8E` (MOV segment), and
`102` means hex `66` (operand-size prefix).

The current diagnostic identifies 15,277,507 protected-32 entries and
44,722,493 real/protected16/VM86 entries combined. It does not split the
latter three. An earlier [mode-clock measurement](receipts/2026-09-27-i80386-ordinary-windows-profile-attribution.json)
did split them and attributed 69.8–70.2% of host user CPU to their entry-mode
calls. Even eliminating that entire attributed cost would cap full-run speedup
near **3.31–3.35×** on that measured workload, so a 10× Windows target also
requires substantial protected-32 and board speedup. The mode clock includes
board/runner time and is from an earlier source revision; it is an architectural
bound, not a current CPU-time partition.

The prior [selected-form linked grammar](receipts/2026-09-28-i80386-selected-forms-potential.json)
already covered prefixes, selected memory/ALU forms and actual conditional
successors in an optimistic syntax-only observer. Its Windows mean was **3.20
steps per run**, below the predeclared four-step admission gate. Only
24,837,121 of the 60 million calls lay in its real/protected16/VM86 runs of
at least four steps. Under an illustrative and unjustified equal-cost-per-step
assumption, making those calls free would yield at most 1.71× full-run
speedup. This is **not** a measured CPU-time ceiling: per-step cost varies,
and syntax potential ignores proof, faults and admission overhead. The only
measured broad 16-bit ceiling is the older 3.31–3.35× mode-clock bound.
The [hot-loop audit](I80386-WIN16-HOT-SITE-AUDIT.md) also found a COM1 `IN`
on every traversal of the strongest protected16 loop. A simple branch linker
cannot cross that device read without preserving its I/O and event behavior.

The first credible executable boundary is a bounded trace that can retire
several dependent memory, stack, segment and control-flow instructions per
entry, while checking each instruction's translation/fault point and stopping
before an unhandled I/O, interrupt or device-event boundary. A side-effecting
RAM write must preserve page-table/code coherence before the next fetch.
That needs a deeper event-aware block or JIT architecture and a cheap entry
path; adding an isolated `3C` compare or a narrow Jcc/store form does not
address the observed short calls. This tranche changes no executor code.

The public reducer is
[`scripts/summarize-i80386-code16-windows.mjs`](../scripts/summarize-i80386-code16-windows.mjs).
With privately produced ordinary and `AT_CODE16_WASM=1`,
`AT_CODE16_WASM_DIAGNOSTICS=1`, `AT_CODE16_WASM_FORM_CENSUS=1` reports and
their `/usr/bin/time` outputs, run:

```sh
node scripts/summarize-i80386-code16-windows.mjs ordinary.json optin.json ordinary.time optin.time
```

The reducer refuses different sources, private inputs, step budgets, switch
pairs or selected reported guest fields. Its output is aggregate counts,
source hashes, host and timing metadata, plus a digest of those selected
fields; raw reports stay private.
