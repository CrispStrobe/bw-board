# Code tab → language → toolchain → machine (the lite GUI integration spec)

This is the exact, actionable spec for wiring **lite's Code tab** (the React
`CircuitDesigner`) to the engine's modular execution path, so a student can pick
a **language**, a **compiler/interpreter**, and a **machine flavor**, press Run,
and watch their program execute on an x86 in the browser.

The CLI half is **done and landed** in this engine (`scripts/toolchains.mjs`,
`scripts/basic.mjs`, `scripts/cc.mjs`, `src/i8086-asm.js`, `scripts/run-dos.mjs`);
the user's rule was *"first they must work in CLI, then in GUI."* This document
is the GUI half. It changes **lite only** — no further engine change is required
beyond the browser-safe surface already added here
(`codeTabMenu`, `starterTemplate`, `detectLanguage`, `buildArtifact`, `FLAVORS`).

## 1. The contract the engine already exposes

lite consumes bw-board as a git-sha dependency. Import from `scripts/toolchains.mjs`:

```js
import {
  codeTabMenu,      // the whole menu: languages × toolchains × machine flavors
  detectLanguage,   // 'prog.bas' -> 'bas'
  starterTemplate,  // a runnable skeleton per toolchain (editor preload)
  buildArtifact,    // browser-safe: source TEXT -> { bytes, run } (native only)
} from 'bw-board/scripts/toolchains.mjs';
```

`codeTabMenu({ available })` returns exactly:

```jsonc
{
  "languages": [
    { "id": "asm", "label": "Assembly", "ext": ["asm","s"],
      "toolchains": [ { "id": "nasm-native", "label": "Built-in assembler …",
                        "kind": "native", "starter": "\tmov dx, offset msg\n…" } ] },
    { "id": "bas", "label": "BASIC", "ext": ["bas"],
      "toolchains": [ { "id": "basic-native", …, "kind": "native", "starter": "10 PRINT …" } ] },
    { "id": "c",   "label": "C", "ext": ["c"],
      "toolchains": [ { "id": "cc-native", …, "kind": "native", "starter": "#include …" } ] }
  ],
  "flavors": [
    { "id": "8086",     "label": "8086",                      "variant": "8086",  "preset": "at" },
    { "id": "8088-pc",  "label": "IBM PC/XT (8088-class)",    "variant": "8086",  "preset": "xt" },
    { "id": "80186",    "label": "80186",                     "variant": "80186", "preset": "at" },
    { "id": "80286-at", "label": "PC/AT (80286 real mode)",   "variant": "80286", "preset": "at" }
  ],
  "defaultFlavor": "80286-at"
}
```

**Availability filtering.** In the browser there are no MS-DOS binaries, so pass
`available: new Set()`. The menu then offers **only the native toolchains**
(built-in assembler, BASIC, C) — which are pure JavaScript and run in the
browser. The DOS toolchains (MASM, GW-BASIC, Turbo C) never appear in the GUI;
they light up only in the CLI when their binaries are present. This is why the
availability set is the single switch that keeps the GUI honest: it can only ever
offer what it can actually run.

## 2. The three dropdowns

The Code tab today is a single ASM editor with an *Assemble & Run* button (see
the hint at `CircuitDesigner.jsx`, *"…or write ASM in the Code tab and Assemble &
Run"*). Replace that with three selects driven entirely by `codeTabMenu`:

```jsx
const menu = useMemo(() => codeTabMenu({ available: new Set() }), []);
const [langId, setLangId]   = useState('bas');            // Language
const [tcId,   setTcId]     = useState('basic-native');   // Compiler/Interpreter
const [flavor, setFlavor]   = useState(menu.defaultFlavor);// Machine
const [source, setSource]   = useState(starterTemplate('basic-native'));

const lang = menu.languages.find((l) => l.id === langId);

// Language → reset toolchain to the language's first, and preload its starter.
function pickLanguage(id) {
  const l = menu.languages.find((x) => x.id === id);
  setLangId(id);
  setTcId(l.toolchains[0].id);
  setSource(starterTemplate(l.toolchains[0].id));
}
// Compiler → preload that toolchain's starter (only if the editor is untouched
// or the user confirms; keep their code otherwise).
function pickToolchain(id) { setTcId(id); if (isPristine) setSource(starterTemplate(id)); }
```

- **Language** `<select>` ← `menu.languages` (`{id,label}`).
- **Compiler / Interpreter** `<select>` ← `lang.toolchains` (`{id,label}`); this
  is the "masm/nasm/gwbasic/qbasic" picker the user asked for, filtered to what
  runs.
- **Machine** `<select>` ← `menu.flavors` (`{id,label}`), default
  `menu.defaultFlavor`; this is the "flavor of chip" picker (8086 / 80186 /
  80286).

The editor preloads `starterTemplate(tcId)` so a freshly-picked toolchain already
runs. Each language's file extension (`lang.ext`) drives `detectLanguage` when a
file is dropped onto the tab, so opening `game.bas` selects BASIC automatically.

## 3. The Run button (browser path)

Native toolchains build **in the browser** with no filesystem: `buildArtifact`
turns the editor text into machine-code bytes, and the existing machine loader
runs them on the selected flavor. Reuse the `bw-machine-media-load` CustomEvent
the i8086 Machine Loader already listens to — just add `variant`/`preset` from
the chosen flavor:

```jsx
function assembleAndRun() {
  const f = menu.flavors.find((x) => x.id === flavor);
  let bytes, run;
  try { ({ bytes, run } = buildArtifact(tcId, source)); }
  catch (e) { setBuildError(e.message); return; }         // show the compiler error inline
  setBuildError(null);
  window.dispatchEvent(new CustomEvent('bw-machine-media-load', {
    detail: {
      slotId: run,            // 'com' (all native toolchains today)
      bytes,                  // Uint8Array from buildArtifact
      kind: 'i8086',
      variant: f.variant,     // NEW: 8086 | 80186 | 80286  → the DOS runner
      profile: 'dos',         // the chipless DOS bench (as the ASM tab already sends)
      name: `code.${lang.ext[0]}`,
    },
  }));
}
```

**One machine-side change in lite:** the `bw-machine-media-load` handler that
boots the DOS profile must read `detail.variant` and construct the machine with
it — `new I8086Machine({ ...PRESETS[preset], variant })` — instead of always
defaulting to 8086. (The engine already threads `config.variant` into the core;
`runImage(bytes, run, { variant, preset })` is the exact reference
implementation in `scripts/run-dos.mjs`.) With that, the Machine dropdown truly
selects the chip.

Program output (`INT 21h` writes) and the B800 text screen already surface in
lite's Serial/Display widgets via the DOS layer's `onChar`; no extra wiring.

### Input (BASIC `INPUT`, INT 21h keyboard)

`buildArtifact` produces a program that may read the keyboard (BASIC `INPUT`, a C
`getchar`). The DOS runner drinks keystrokes from its `keys` queue; lite should
route the console widget's typed characters into the same queue (the engine's
`createDos8086(machine, { keys })` and `runImage(…, { keys })` show the shape —
a string or byte array). For a first cut, a one-line prompt that pre-feeds a
`keys` string is enough; live typing is the same queue fed incrementally.

## 4. Glass-box (optional, high value)

lite already has `AsmDebugPanel` (token stream / symbol table / listing). The
built-in assembler `assemble(src, { format:'com' })` returns
`{ bytes, symbols, … }`; BASIC and C expose their generated asm
(`basicToAsm(src)`, `cToAsm(src)`) — feeding that asm back through `assemble`
lights up the *same* glass-box for BASIC and C, so a student sees their BASIC
`FOR` loop become real 8086 instructions. This is the pedagogical payoff of
compiling-to-asm rather than interpreting.

## 5. What each toolchain is, in the GUI

| Language | GUI toolchain (native, in-browser) | Covers |
|----------|-----------------------------------|--------|
| Assembly | `nasm-native` (built-in assembler) | full MASM-dialect real-mode asm |
| BASIC    | `basic-native` | integer variables, expressions, `PRINT`, `INPUT`, `IF/THEN`, `GOTO`, `FOR/NEXT`, `REM` |
| C        | `cc-native` | int variables, `+ - * / %`, comparisons, `&& \|\|`, `if/else`, `while`, `for`, `printf("%d/%c")`, `puts`, `return` |

All three run on **8086, 80186, and 80286** (the Machine dropdown). The DOS
toolchains (MASM, GW-BASIC, Turbo C) are **CLI-only** and out of the browser's
reach by design — the availability filter hides them.

## 6. Acceptance checklist (lite side)

1. Three dropdowns render from `codeTabMenu({ available: new Set() })`; defaults
   are BASIC / `basic-native` / `80286-at`.
2. Picking a language switches the compiler list and preloads its starter.
3. Run builds via `buildArtifact(tcId, source)` and dispatches
   `bw-machine-media-load` with the flavor's `variant`.
4. The DOS-profile machine handler honors `detail.variant`.
5. A compile error (`buildArtifact` throws) shows inline, not as a crash.
6. Switching the Machine dropdown to 8086 vs 80286 and running a 286-only
   program shows the difference (e.g. `PUSH imm`, `SHL r,imm`).
7. Output appears in the console widget; `INPUT` reads from it.

Everything above is additive to lite and needs no new engine work beyond the
browser-safe surface already exported here.
