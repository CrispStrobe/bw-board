# x86 oracles, architecture references and provenance

2026-09-09. Recommendation and implementation plan; the initial PCjs probes
below have now run, but the broader comparisons remain pending. Use multiple references with explicit
scope, not a single emulator treated as universally correct.

## Roles

| Reference | Role | Boundary |
| --- | --- | --- |
| Hardware-generated SingleStepTests | Instruction/state behavior for the exact tested CPU/mode/stepping | Our full 286 real-mode receipt is not protected-mode, peripheral or bus-timing coverage |
| PCjs | 80186/286 functional and protected-mode comparison; JS memory/dispatch architecture | Logical simulation; not a wired DMA timing oracle |
| MartyPC | 8088 bus/prefetch/interrupt timing, PC/XT device behavior and debugging design | Its documented hardware-validated CPU focus is 8088, not a Harris 286 timing model |
| 86Box | Independent whole-machine/peripheral compatibility comparison | Match model, devices, firmware and configuration; software success alone is not pin equivalence |
| Bochs | Later protected-mode and exception cross-checks | Current documented CPU range starts at 386; filter out 286-specific differences |
| v86 | Browser runtime/JIT architecture and broader software comparison | Not an early-x86 timing oracle; documented gaps include 16-bit protected-mode features |
| Our slow wired interpreter | Exact differential reference for compiled-netlist optimization | Shared bugs remain possible; it is not an independent hardware oracle |

The [PCjs CPU source](https://raw.githubusercontent.com/jeffpar/pcjs/master/machines/pcx86/modules/v2/cpux86.js)
explicitly distinguishes logical from physical simulation. It gives the CPU
direct memory-block access, performs DMA immediately rather than interleaving
bus cycles, and updates timer counters on demand. These are useful architecture
lessons for functional execution, not permission to bypass wires in wired mode.

[MartyPC](https://github.com/dbalsom/martypc) describes hardware-based CPU
validation and cycle-level debugging. [v86's architecture documentation](https://github.com/copy/v86/blob/master/docs/how-it-works.md)
explains its browser/Wasm translation approach. Study execution boundaries,
memory layout, event scheduling and instrumentation costs; do not assume a
language change alone will remove our generic-netlist overhead.

## Differential harness contract

1. Pin exact source revisions/build flags and hash binaries, firmware, owned
   guest probes and input schedules. Audit reusable probe licenses separately.
2. Give each adapter explicit CPU/mode/device capabilities. An unsupported case
   is reported as unsupported, never counted as passing or silently substituted.
3. Run identical owned instruction and device probes. Compare registers,
   defined flags, memory changes, exception state and ordered I/O events at
   agreed boundaries. Compare cycle/pin traces only where both models promise
   compatible clock and bus semantics.
4. Record reset state, memory map, A20 behavior, timer rates, keyboard schedule,
   controller programming, disk geometry, and all intentional differences.
   Whole-machine comparisons with different BIOSes use suitable semantic
   landmarks; they must not pretend instruction-by-instruction lockstep.
5. Preserve the first divergence and a replayable seed. Minimize it to a small
   owned regression. Mask only specified undefined fields with a documented
   reason; never broaden masks merely to turn failures green.
6. Resolve disagreements against matching hardware traces/specifications where
   possible. Agreement is evidence, not proof: reused code and shared test
   generators can create correlated failures. Record reference lineage.

Start with PCjs functional probes and our reference-vs-compiled trace harness.
Add MartyPC for applicable 8088 timing cases and 86Box for machine/peripheral
disagreements. Keep Bochs/v86 comparisons scoped to compatible features.
The existing [286 SST receipt](SST286-HOLD-REPORT.json) remains separate.

## Licensing and distribution

Checked upstream source/license pages on 2026-09-09; these are not blanket
clearance for every historical release, bundled ROM or dependency:

- [PCjs LICENSE.txt](https://raw.githubusercontent.com/jeffpar/pcjs/master/LICENSE.txt):
  MIT, explicitly excluding third-party archived programs/images/documentation.
  Its [README](https://github.com/jeffpar/pcjs) also requests visible attribution;
  preserve/review its notices when considering distribution.
- [MartyPC LICENSE](https://raw.githubusercontent.com/dbalsom/martypc/main/LICENSE): MIT.
- [86Box licensing section](https://raw.githubusercontent.com/86Box/86Box/master/README.md):
  GPL-2.0-or-later; optional libraries have their own terms.
- [Bochs repository license](https://raw.githubusercontent.com/bochs-emu/Bochs/master/LICENSE): LGPL-2.1.
- [v86 LICENSE](https://raw.githubusercontent.com/copy/v86/master/LICENSE): BSD-2-Clause;
  additional files/dependencies require their own checks.

Initially use external tools as separate test processes. Code copying/adaptation
requires exact-file provenance, notices and a compatibility review. A worker,
iframe, Wasm boundary or private repository is not by itself license clearance.
Do not publish third-party guest media because its host emulator is open source.

The prior application evaluation recorded PCjs
`c7f21b4fa2bdedac3d5c73094a6402fdc8b24c70` and v86
`d96be774e549a83371b038b86e819804c96b921f` as source-preparation pins, not validated
oracle adapters. Re-verify them or record a new pin before executing comparisons.

## Tracking

- Existing: hardware-generated real-mode SST and owned physical-board tests.
- Initial PCjs adapter: **60/60 owned real-mode single-instruction cases pass**
  ([receipt](PCJS-OWNED-ORACLE-REPORT.json)), across 8086 shared-8088 ISA, 80186
  and 80286 configurations. It checks defined registers/flags and the complete
  1 MiB test memory, requires a clean exact external pin, and preserves first
  per-model differences. Fixtures and local implementation sources are hashed.
  Run `PCJS_ROOT=/path/to/pinned/pcjs node scripts/compare-pcjs-owned.mjs`.
  The local 286 side uses an explicitly architectural generator adapter, not
  a physical motherboard. No I/O, interrupt, timing or protected-mode claim.
- Pending: broader pinned external adapters, normalized fixtures, mismatch minimization,
  and execution receipts. Source inspection is not an oracle-pass claim.
- Expanded architectural iteration: **125/125 pass, zero not-run**, same clean
  PCjs pin ([receipt](PCJS-EXPANDED-ORACLE-REPORT.json)). Added multiply/divide,
  one-bit shifts/rotates, far-pointer loads, sign extension, string directions
  and flag transfers. Undefined arithmetic flags have explicit masks/reasons;
  no timing/I/O/interrupt/protected-mode claim was added. Failure receipts now
  embed initial registers/RAM/opcode bytes and count cases not run after a
  first divergence. Automatic reduction remains pending.
- Performance implementation: [wired performance plan](WIRED-X86-PERFORMANCE-PLAN.md).
