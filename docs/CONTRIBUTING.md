# Contributing / extending BrickWright — an agent's field guide

Everything you need to extend the codebase without tripping a gate you didn't
know existed. It is written for an agent (or a human) who is about to add a CPU
core, a debug target, a device, a language, an OS, or a ROM — and enumerates the
**registries, contracts and CI gates** each of those touches, because most of
them fail one CI cycle at a time if you discover them the hard way.

## The three repositories

| Repo | What it is | License | How it connects |
|---|---|---|---|
| **bw-board** (this repo) | the emulator **engine** — CPU cores, machines, debug targets, chips, boards | MIT | consumed by lite as an **npm git-sha pin** |
| **brickwright-lite** | the browser **GUI** (Scratch-based) | BSD-3 | pins `bw-board` + `bw-circuit-ui` by sha in `vendor-pins.json` |
| **brickwright-media-lab** | fetchable **content** (OS/language/game bundles) kept out of the app | umbrella GPL-3, per-project licenses | the app *offers* bundles by URL; nothing is imported |

**Cross-repo landing order** (a feature spanning two repos): land bw-board
first (merge to `master`), then bump the lite pin to that sha and wire the GUI.
The real CP/M boot and the RISC-V core both follow this shape: a bw-board
factory/target lands, then a lite pin-bump + `attach` wires it.

---

## bw-board — adding a CPU core

The per-core idiom (see `z80.js`, `m6502.js`, `i8086.js`, `riscv32.js`):

- `src/<cpu>.js` — the CPU: a class with **one instruction per `step()`**, a flat
  little-endian `mem`, no code generation. `step()` returns instructions retired
  (0 on halt) so a loop can stop.
- `src/<cpu>-machine.js` — the machine wrapper: `mem`, `load/reset/step/run`, and
  the machine's I/O (a console, an `ecall` ABI, memory-mapped devices).
- `src/<cpu>-adapter.js` — the debug adapter (see "registering a target").

**Tests** (`test/<cpu>*.test.mjs`):
- **Hand-encode programs from the ISA field layout** — this checks the *decoder
  against the spec*, not against a toolchain that could share an encoding bug
  with it. (Trap: a RISC-V B-type `imm[4:1]` lands in `inst[11:8]` — `<<8`, not
  `<<7`.)
- Commit **real-compiler output as base64 fixtures** (SDCC, clang) so CI needs no
  cross-toolchain. See `test/riscv32-clang.test.mjs` / `-elf.test.mjs`.

---

## bw-board — registering a debug target (there are THREE contracts)

Adding a `kind` to `createDebugTarget` means updating **all** of:

1. **`src/debug-target-factory.js`** — the dispatch (`if (kind === '<kind>') return
   create<Kind>Target(opts)`) **and** the `'<kind>'` string in the *"Unknown debug
   target kind"* error message at the bottom.
2. **`src/target-kinds.js`** — a `getTargetKinds()` picker entry
   `{kind, label, description}`. This module must stay **import-free**
   (`test/target-kinds-leaf.test.mjs` enforces it — it's dynamically imported by
   lite without the debugger backend; importing the factory here drags ~22 KB +
   the whole backend into first load). Do **not** `import` the factory here.
3. **Two exact-set test contracts** — both will red, each with a clear message:
   - `test/debug-factory.test.js` *"returns all target kinds"* — `assert.equal(
     kinds.length, N)` (exact count) + a per-kind `find`. Bump `N`, add your find.
   - `test/m6502-factory.test.mjs` *"getTargetKinds is exactly the list we mean"* —
     an `EXPECTED` array (set-difference). Add your kind.

A console-only machine (no pins) can run in **adapter-only mode**: return
`{ target: null, adapter }`, with `attachBoard` a time-sync stub. See
`riscv32-adapter.js`.

---

## bw-board — booting an OS / RTOS image on a CPU

Proven for RISC-V: a real **FreeRTOS** and **RT-Thread Nano** boot on the
emulated SoC. The recipe (see `test/fixtures/riscv-freertos/` and
`test/fixtures/riscv-rtthread/` as worked examples):

- **Loader.** `scripts/riscv-elf.mjs` `loadElfInto(machine, bytes)` auto-detects
  the ELF kind: a **relocatable object** (`ET_REL`, a single `clang -c` output)
  is relocated by the mini-linker `linkElf`; a **fully-linked executable**
  (`ET_EXEC`, real `ld.lld`/`gcc` output) is loaded by its **program headers**
  (`loadExecSegments` — `PT_LOAD` at each `p_vaddr`, `pc = e_entry`). A whole OS
  image is the second kind — do not feed it to `linkElf`.
- **The memory map the machine exposes** (`riscv32-machine.js`, SiFive/QEMU-virt
  layout): flat RAM at **`0x0`** (1 MiB default, `memSize` configurable); **CLINT**
  at `0x02000000` (`mtime` `0x0200BFF8`, `mtimecmp` `0x02004000`); **PLIC** at
  `0x0c000000`; **NS16550 UART** at `0x10000000`. Link the image against this map.
  (Note RAM is at `0x0`, **not** the `0x80000000` a stock `qemu virt` uses — see
  the caveat below.)
- **`ecallTraps` — pick per the RTOS's yield mechanism.** If the port yields via
  **`ecall`** (FreeRTOS), construct the machine with `ecallTraps: true` so `ECALL`
  becomes a real M-mode exception (cause 11) to `mtvec` instead of the Linux
  write/exit hook. If it switches by a **direct `mret`** and preempts off the
  timer trap (RT-Thread), leave `ecallTraps` off — it boots on the plain machine.
- **Startup installs `mtvec`.** Neither the FreeRTOS GCC/RISC-V port nor RT-Thread
  sets `mtvec` — the **BSP/startup must** (`csrw mtvec, <trap_handler>`) before the
  first tick, or the first timer interrupt traps to `0` and re-runs `_start`.
- **The fixture, not the toolchain.** Cross-build with `clang` + `ld.lld` (no
  RISC-V gcc needed; a real `riscv64-unknown-elf-gcc` also works), then commit the
  **stripped** image as base64 (`llvm-objcopy --strip-all` → `base64 -w0`), so CI
  needs no cross-toolchain — the same rule as the core fixtures. A `build.sh`
  **fetches the kernel at a pinned commit** (not vendored) and regenerates it.
- **Reproducibility.** Rebuild must be byte-identical (a check-twin). If the
  kernel banner embeds `__DATE__`/`__TIME__` (RT-Thread does), `export
  SOURCE_DATE_EPOCH=<fixed>` — clang honors it and the build stabilises.
- **libc.** Use picolibc's **headers only** (`-isystem …/picolibc/…/include`); link
  `-nostdlib` and hand-roll the handful of `mem*`/`str*` the kernel calls in a
  `libc_shim.c`. Keeps the image self-contained.
- **Licence.** Record the kernel in `THIRD-PARTY.md` under *"Shipped compiled
  binaries"* (FreeRTOS = MIT, RT-Thread = Apache-2.0). Only the compiled image is
  shipped; the source is fetched, not vendored.

**Caveat — what does NOT fit the current machine.** OSes that assume RAM at
`0x80000000` or boot in **S-mode under OpenSBI** (e.g. NuttX's `rv-virt`, some
Zephyr `virt` configs) need work first: a **configurable RAM base** on the machine
and/or **S-mode + Sv32 + an SBI layer** (the Linux/xv6 tier). A generic M-mode
port whose trap/timer/UART match the map above (FreeRTOS, RT-Thread, and Zephyr's
`qemu_riscv32`) is the tractable class today.

---

## bw-board — CI gates (`.github/workflows/ci.yml`)

- Jobs: **test** (`npm test` → `test/*.test.js` + `test/*.test.mjs`, Node 22),
  **corpus**, **qualify**, **vectors**, **vectors186** (the last four are
  i8086/perf; unrelated to most changes).
- **`census-covers-the-tree.test.mjs`** (the skip census): a *guard-then-skip*
  test (`{ skip: … }` + `existsSync`) must be named in a census **or** the
  `IN_REPO_DEFENSIVE` set — but that exemption is a **ratchet (exact count)**, so
  adding to it reds a *different* subtest. **Don't guard-skip on committed
  in-repo files.** Read a committed fixture unconditionally — its absence is a
  broken checkout (a hard error), which is the correct behavior.
- **`oracle-census.mjs`** — external oracles (`nasm`/`masm`/`ngspice`) are
  declared; a new external-input probe needs a census row.
- **Fresh-worktree gotcha:** any test that imports `debug-target-factory.js`
  statically pulls **`avr8js`** (an npm dep). A fresh `git worktree` has no
  `node_modules` → *"Cannot find package 'avr8js'"*. **Symlink the main
  checkout's `node_modules`** to run it locally (ESM ignores `NODE_PATH`). CI is
  fine — deps are installed there.

---

## brickwright-lite — extending the GUI

### overlay / packages twinning (read this first)

`overlay/scratch-gui/…` is the **source of truth** (tracked). `packages/scratch-gui/`
is **git-ignored**. So: **edit the overlay file** → `npm run integrate` (copies
overlay→packages) → `git add -f` any **new** packages twin. Gates:
`test/overlay-packages-pairs.test.mjs`, `test/no-dead-overlay-modules.test.mjs`.
Top-level `test/`, `scripts/`, `.github/` are **single-copy** (no twin).

### Bumping the bw-board pin (the ~12-surface ripple)

1. `vendor-pins.json` is **the authority**. Move it and derive
   `package.json`/lockfile in one step: `npm run pin:packages -- --set
   bw-board=<40-hex-sha>` (runs `npm install`).
2. **Regenerate every derived surface** against the new sha. Enumerate them
   first: `grep -rln <old-sha> . | grep -v node_modules`. They are, with their
   generators:
   - `docs/generated/bw-board-census.json` + `overlay/.../bw-matrix/census-snapshot.js`
     → `node scripts/gen-bw-board-census.mjs --dir <a real bw-board checkout AT the sha>`.
   - `docs/generated/I8086-CAPABILITY-REPORT.md` → `gen-i8086-capability-report.mjs --dir <checkout>`.
   - `static/roms/i8086-bios.provenance.json` → `sync-i8086-bios.mjs --dir <checkout> --write`.
   - `static/roms/i8086-demos.provenance.json` → `sync-i8086-demo-roms.mjs --dir <checkout> --write`.
   - `static/licenses/bw-packages.sources.json` → `package-upstream-notices.mjs`.
   - `overlay/scratch-vm/.../bundled-upstream-pins.json` → `scripts/spike/vendor-bundles.mjs`.
   - `docs/generated/LANGUAGE-DEVICE-MATRIX.md` → `npm run gen:matrix`.
   - **Hand-edit** the `bwBoardPin` field in `static/roms/free-386-bios.provenance.json`
     and `static/dos/msdos200-base.provenance.json` (no generator; the ROMs are
     unchanged so only the sha field moves — confirm with `git diff --stat
     <old>..<new> -- roms/ rom/` in bw-board being **empty**).
3. **Use a real bw-board checkout at the sha for `--dir`** (a worktree checked
   out to it) — **not** `node_modules/bw-board`, which is npm-extracted with no
   `.git`, so `git -C` there resolves the *lite* repo and the census refuses.

### Registries you touch to add a device / language / ROM to the GUI

- **`overlay/.../bw-matrix/capabilities.js`** — the device registry (`dev(id,
  label, group, coreKind, {…})` entries) and compiler routes. Drives the picker
  and the matrix; `verify-matrix-ui` asserts the picker and panel expose the same
  device set.
- **A shipped ROM/binary**: `static/roms/<x>.bin` (+ a `<x>.provenance.json`);
  **name it in `THIRD-PARTY-NOTICES.md`** — `notices-coverage.test.mjs` requires
  every shipped, licensed ROM be named. Binary extensions are exempt in
  `no-nul-in-text.test.mjs` `BINARY_BY_ROLE` (`bin/rom/com/exe/uf2` already
  listed; add a new ext there if you introduce one).
- **A Playwright `verify-*.mjs` not wired into CI** must be listed in
  `gate-coverage.test.mjs` `KNOWN_UNWIRED` with a one-line reason.
- **Boot wiring**: `debug-runner.js` `attach<CPU>()` reads `bootMedia`
  (`slot`/`profile`/`bytes`); `activate.js` `SLOT_PROFILE` maps a boot-slot id →
  `bootMedia.profile` (e.g. `cpmsys → 'cpm-system'`).
- **i18n**: component (`.jsx`) `title`/`aria-label`/`placeholder` strings are
  gated by `test/i18n-no-hardcoded-strings.test.mjs`. **Lib-module TEXT is not
  auto-gated** → route it through `makeT` + a message table (see `docs/I18N.md`,
  *"a module with no props at all"*); provide `en` + `de`.

### Browser gates (Playwright)

`verify-*.mjs` run against a served build (`packages/scratch-gui/build`) in CI's
browser jobs — **not on the memory-starved dev box** (they OOM). Template:
`scripts/verify-basic-run.mjs`. Four traps that cost real time to learn:

1. `waitForFunction` over a **predicate reading a known element's
   `textContent`**, never a `text=` locator (a locator matches the app's own
   prose, e.g. the first "A>"-looking status message, not your panel).
2. Assert a `page.on('pageerror', …)` collector **as its own check** — a boot
   that dies of a JS error can leave *stale* text, so this is what makes "X
   present" mean "X *produced*".
3. Wait for **stability** (sample `textContent`, sleep ~300 ms, sample again),
   not the first match — streamed output arrives in pieces.
4. Serve with a **multi-threaded** server; `python3 -m http.server` is
   single-threaded → `ERR_ABORTED` on the app's parallel chunk requests → a blank
   page that looks like a boot failure. (Node's `http.createServer` is fine.)

Run one browser, `headless` with `--no-sandbox --disable-dev-shm-usage`,
`close()` in a `finally`.

---

## brickwright-media-lab — adding content

**No CI.** A project is `projects/<name>/`: a `README.md` (provenance), a
`fetch.sh` (download + `sha256sum -c` verify) *or* committed binaries when the
license permits, a `brickwright-media.json` (machine + slots + `expect` + license
+ components), and a `LICENSE`. The **run-proof lives in bw-board's suite**
(`runMediaBundle` / the CPU benches), not here. Docs are honest and
**license-first**: mark *proven* vs *proposed* explicitly. See `docs/MATRIX.md`,
`CANDIDATES.md`, `RUNNING.md` for the house style.

---

## Testing philosophy (project-wide)

- **Assert on the runtime's actual output/state**, never a harness that would
  produce the answer regardless: a non-boot must leave the captured output
  *empty* and red the test. (A test that drives the CPU *and* checks something
  the harness computes is the "UART-tick" false-green — avoid it.)
- Prefer **committed fixtures** (base64) over a toolchain at test time.
- The dev box is **memory-starved**: run **targeted** `node --test <file>`, never
  the full suite (it OOM-kills), and push heavy validation to CI. CI watchers can
  themselves be OOM-killed — verify PR status by polling on demand, not by
  holding a long `--watch`.
- Register new evidence gates **once** and honestly; a picker/registry entry for
  something nobody can select (or a gate nothing runs) is a lie the tooling tells
  for you.
