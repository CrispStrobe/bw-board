# Code tab: language → toolchain → machine, and how it relates to the existing paths

The engine now has a modular text-source execution path for **asm, BASIC and C**
on **8086 / 80186 / 80286** (`scripts/toolchains.mjs`, `scripts/basic.mjs`,
`scripts/cc.mjs`, `src/i8086-asm.js`, `scripts/run-dos.mjs`). This document says
**how those relate to the block/text paths that already exist in lite** — so the
new work converges with them rather than forking — and specifies the one real GUI
gap that remains.

## The existing architecture (lite = the scratch-gui fork)

lite already has a text/code tab AND a blocks environment. The real code tab is
`packages/scratch-gui/src/components/tw-pseudocode/pseudocode-importer.jsx`
(languages: pseudocode, python, javascript, **c, basic, asm**, micropython;
two-way with blocks for pseudocode/python/js/c/basic). What it does today, per
language, on the i8086 device:

| Lang | Existing lite path | Where | Runs on 8086? |
|------|--------------------|-------|---------------|
| **asm** | text → `requestAssembly` → `src/i8086-asm.js` `assemble()` → `.COM` → `createI8086DosBench` | `bw-asm/assemble-route.js` | **Yes** |
| **C** | blocks→C (`generateC`) / text → `requestCBuild` → **SmallerC-WASM** → NASM → `assemble()` → `.COM` → bench | `bw-asm/assemble-route.js` `compileC8086`, `lib/smallerc-wasm/` | **Yes (browser-only)** |
| **BASIC** | text/blocks → `runBasic()` → a **6502 or Z80 ROM interpreter** (MS BASIC / BBC BASIC) | `pseudocode-importer.jsx` `runBasic()` | **No — 6502/Z80 only** |

All three x86 routes boot the same runtime: `createI8086DosBench({bytes, format,
variant, keys, onChar, onExit})` in `bw-debug/i8086-dos-bench.js`, which runs the
`.COM` on the vendored `bw-board` `I8086Machine` + `createDos8086` DOS layer.

## How the new engine scripts relate

- **asm** — `nasm-native` just wraps the same `src/i8086-asm.js` `assemble()` lite
  already uses. No duplication; it is the CLI face of the existing assembler.
- **C** — `cc-native` (`scripts/cc.mjs`) is a **pure-Node, zero-dependency**
  integer-C→asm compiler. It does **not** duplicate lite's C route: that route is
  **SmallerC-WASM and browser-only** (a lazy WASM `import()`, no Node entry).
  `cc-native` complements it as a CI/CLI-runnable fallback; the real DOS `tcc`
  toolchain covers full C when its binary is present. **In the GUI, C should keep
  using SmallerC** — `cc-native` is a CLI/CI convenience, not a GUI replacement.
- **BASIC** — `basic-native` (`scripts/basic.mjs`) is the **only BASIC→x86
  compiler in any of these repos**. lite's `generateBASIC`/`runBasic` only ever
  targets 6502/Z80 ROMs. This is a genuine gap-filler, not a duplicate: it is the
  first way to run BASIC on the 8086/80186/80286.

The CLI code-tab surface is `scripts/toolchains.mjs` (`codeTabMenu`,
`listToolchains`, `runToolchain`, `buildArtifact`, `FLAVORS`). It is the Node/CLI
counterpart of lite's `assemble-route.js` routing — a parallel backend, not an
import of the browser one.

## Verification (done)

Both the CLI and the **real GUI bench** were exercised (2026-09-19):

- **CLI** (`node scripts/toolchains.mjs run …`): BASIC `sum of squares 1..5 = 55`,
  C `6! = 720`, asm, all on 8086/80186/80286; the real MASM→LINK→EXE2BIN→run DOS
  chain green with the licensed binaries.
- **GUI runtime** (`basicToAsm`/`cToAsm` → the **vendored** `i8086-asm.js` →
  `createI8086DosBench`, i.e. the exact browser bench, driven in Node): BASIC
  `sum =55` and C `6! = 720` on **8086 and 80186**; BASIC `INPUT` read a key from
  the bench queue and printed the result. **80286 is blocked in the GUI** —
  see the vendor-lag note below.

## The remaining GUI gap (a lite change, specified)

To let a learner type BASIC, pick the 8086, and Run — mirroring the C tab exactly:

1. **Vendor** `scripts/basic.mjs` into lite at
   `packages/scratch-gui/src/lib/bw-board/basic-to-asm.js` (a `src/lib` vendored
   tree — the change originates here in bw-board and is copied down, like the
   other `bw-board/*` files).
2. **Add** `requestBasicBuild({source, device})` to `bw-asm/assemble-route.js`,
   parallel to `requestCBuild`: `basicToAsm(source)` → `assemble(asm, {format:
   'com', variant})` → `{bytes, slotId:'com', profile:'dos', format:'com',
   target:'8086'}`.
3. **Branch** the importer's BASIC handling: when the device is i8086, call
   `requestBasicBuild` and dispatch `bw-asm-rom-ready` (the C/asm tab pattern),
   instead of `runBasic()`'s 6502/Z80 ROM path. Keep `runBasic()` for the 6502/Z80
   profiles unchanged.
4. **Machine dropdown**: `createI8086DosBench` already accepts `variant`; pass the
   chosen flavor through the `bw-asm-rom-ready` detail so 8086/80186/80286 select
   the chip (the C/asm tabs can share this).

### Vendor-lag blocker (must fix for 80286 in the GUI)

lite's **vendored `src/lib/bw-board/i8086-asm.js` is stale**: it accepts only
`variant: '8086' | '80186'` and throws `unknown variant "80286"`. The engine
assembler supports 80286 (the SST286 work). So the GUI is limited to 8086/80186
until lite **re-vendors** the current `i8086-asm.js` (and `i8086-machine.js`,
which the bench already threads `variant` into). This is the ordinary
"vendored trees go upstream / a pin bump moves several surfaces" discipline —
the engine is the source of truth; lite must pull the newer copy.

## Scope

Steps 1–4 and the vendor bump are **lite (scratch-gui) work**, governed by lite's
own landing checklist; the engine side (the compilers, the CLI registry, the
browser-safe `buildArtifact`, and this spec) is complete and verified here.
