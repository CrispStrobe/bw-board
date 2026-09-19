/**
 * toolchains.mjs — the modular language -> tool -> machine execution registry.
 *
 * The code tab picks a SOURCE (its language known from the file), a TOOLCHAIN (a
 * compiler/assembler/interpreter), and a MACHINE FLAVOR (which x86), and this
 * turns the source into something running on that machine. Everything is
 * data-driven: adding a language or a tool is a registry entry, not new control
 * flow. Availability filtering (listToolchains) hides tools whose binaries are
 * absent, so the picker only offers what can actually run.
 *
 *   import { listToolchains, runToolchain, FLAVORS, availableBinaries } from './toolchains.mjs';
 *   const choices = listToolchains('asm', { available: availableBinaries(process.env.MSDOS_BIN_DIR) });
 *   runToolchain('nasm-native', 'prog.asm', { flavor: '80286-at' });
 *
 * @module
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { assemble } from '../src/i8086-asm.js';
import { basicToAsm } from './basic.mjs';
import { cToAsm } from './cc.mjs';
import { runImage, runChain, runDos } from './run-dos.mjs';

/**
 * Machine "flavors" — a chip + board, mapped onto run-dos's variant + preset.
 * A code-tab "machine" dropdown is this list.
 */
export const FLAVORS = Object.freeze({
    '8086':      { variant: '8086',  preset: 'at', label: '8086' },
    '8088-pc':   { variant: '8086',  preset: 'xt', label: 'IBM PC/XT (8088-class)' },
    '80186':     { variant: '80186', preset: 'at', label: '80186' },
    '80286-at':  { variant: '80286', preset: 'at', label: 'PC/AT (80286 real mode)' },
});
export const DEFAULT_FLAVOR = '80286-at';

/** Languages the code tab knows, with the file extensions that select each. */
export const LANGUAGES = Object.freeze({
    asm: { label: 'Assembly', ext: ['asm', 's'] },
    bas: { label: 'BASIC', ext: ['bas'] },
    c:   { label: 'C', ext: ['c'] },
});

/** Detect a source's language from its filename/path extension (null if none). */
export function detectLanguage(nameOrPath) {
    const ext = (String(nameOrPath).split('.').pop() || '').toLowerCase();
    for (const [id, def] of Object.entries(LANGUAGES)) if (def.ext.includes(ext)) return id;
    return null;
}

/** A runnable starter skeleton per toolchain — what the code tab preloads so
 *  a freshly picked toolchain already runs (each language/tool has its own
 *  source shape; the built-in asm is flat, MASM needs SEGMENT..END). */
const STARTERS = Object.freeze({
    'nasm-native': "\tmov dx, offset msg\n\tmov ah, 9\n\tint 21h\n\tmov ax, 4c00h\n\tint 21h\nmsg:\tdb 'Hello from assembly$'\n",
    'masm': 'CODE\tSEGMENT\n\tASSUME CS:CODE,DS:CODE\n\tORG 100H\nSTART:\tMOV DX,OFFSET MSG\n\tMOV AH,9\n\tINT 21H\n\tMOV AX,4C00H\n\tINT 21H\nMSG:\tDB "Hello from MASM$"\nCODE\tENDS\n\tEND START\n',
    'basic-native': '10 PRINT "Hello from BASIC"\n20 END\n',
    'cc-native': '#include <stdio.h>\nint main(void) {\n    printf("Hello from C\\n");\n    return 0;\n}\n',
});
export function starterTemplate(toolchainId) { return STARTERS[toolchainId] ?? ''; }

/**
 * Toolchain profiles. `kind: 'native'` runs in-process (no external binary,
 * always available — CI-runnable); `kind: 'dos'` runs real DOS binaries and is
 * offered only when `tools` are all present. `run` is what to execute at the
 * end ('com' | 'exe' | 'via-tool' for an interpreter that runs the source).
 */
export const TOOLCHAINS = Object.freeze([
    { id: 'nasm-native', language: 'asm', kind: 'native', tools: [],
      label: 'Built-in assembler (NASM/MASM-style) — no DOS toolchain needed',
      build: (src) => assemble(src, { format: 'com' }).bytes, run: 'com' },

    { id: 'masm', language: 'asm', kind: 'dos', tools: ['MASM.EXE', 'LINK.EXE', 'EXE2BIN.EXE'],
      label: 'MASM 1.10 + LINK + EXE2BIN (real Microsoft toolchain)',
      chain: true, run: 'com' },

    // Declared but availability-gated: they light up when their binary is
    // present in the DOS bin dir. The registry is the extension point — adding a
    // language/tool is one entry here.
    { id: 'basic-native', language: 'bas', kind: 'native', tools: [],
      label: 'Built-in BASIC (PRINT subset -> asm) — no interpreter needed',
      build: (src) => assemble(basicToAsm(src), { format: 'com' }).bytes, run: 'com' },

    { id: 'gwbasic', language: 'bas', kind: 'dos', tools: ['GWBASIC.EXE'],
      label: 'GW-BASIC interpreter', interpret: 'GWBASIC.EXE', ext: 'BAS', run: 'via-tool' },
    { id: 'qbasic', language: 'bas', kind: 'dos', tools: ['QBASIC.EXE'],
      label: 'QBasic', interpret: 'QBASIC.EXE', ext: 'BAS', run: 'via-tool' },
    { id: 'cc-native', language: 'c', kind: 'native', tools: [],
      label: 'Built-in C (printf/puts subset -> asm) — no compiler needed',
      build: (src) => assemble(cToAsm(src), { format: 'com' }).bytes, run: 'com' },

    { id: 'tcc', language: 'c', kind: 'dos', tools: ['TCC.EXE'],
      label: 'Turbo C (full C, when installed)', chain: true, ext: 'C', run: 'exe' },
]);

/** The uppercased basenames of the DOS binaries present in `dir`. */
export function availableBinaries(dir) {
    if (!dir || !existsSync(dir)) return new Set();
    return new Set(readdirSync(dir).map((f) => f.toUpperCase()));
}

/**
 * The toolchains a code tab should offer: those matching `language` (or all)
 * whose tools are available. Native toolchains are always listed; DOS ones only
 * when every required binary is in `available`.
 */
export function listToolchains(language, { available = new Set() } = {}) {
    return TOOLCHAINS.filter((t) => (!language || t.language === language)
        && (t.kind === 'native' || t.tools.every((bin) => available.has(bin.toUpperCase()))));
}

/**
 * The whole code-tab menu in one call: each language with its available
 * toolchains (id/label/kind + a runnable starter) and the machine flavors. The
 * GUI renders the compiler dropdown from a language's `toolchains`, the machine
 * dropdown from `flavors`, and runs the picked (toolchain, flavor) via
 * runToolchain — nothing GUI-specific lives here, so the CLI and the code tab
 * share exactly this surface.
 */
export function codeTabMenu({ available = new Set() } = {}) {
    return {
        languages: Object.entries(LANGUAGES).map(([id, def]) => ({
            id, label: def.label, ext: def.ext,
            toolchains: listToolchains(id, { available }).map((t) => ({
                id: t.id, label: t.label, kind: t.kind, starter: starterTemplate(t.id),
            })),
        })),
        flavors: Object.entries(FLAVORS).map(([id, f]) => ({ id, label: f.label })),
        defaultFlavor: DEFAULT_FLAVOR,
    };
}

/**
 * Run a source through a toolchain on a machine flavor. Returns
 * { ok, toolchain, flavor, artifact?, ran?, stages? } — the same shape whether
 * the path was native, a DOS chain, or an interpreter.
 */
export function runToolchain(id, source, opts = {}, hooks = {}) {
    const tc = TOOLCHAINS.find((t) => t.id === id);
    if (!tc) throw new Error(`unknown toolchain '${id}' (see listToolchains)`);
    const flavor = opts.flavor && FLAVORS[opts.flavor] ? opts.flavor : DEFAULT_FLAVOR;
    const m = FLAVORS[flavor];
    const run = opts.run !== false;
    const common = { variant: m.variant, preset: m.preset, max: opts.max || 40_000_000 };
    const base = { toolchain: id, flavor };

    if (tc.kind === 'native') {
        const artifact = tc.build(readFileSync(source, 'utf8'));
        const r = run ? runImage(artifact, tc.run, common, hooks) : null;
        return { ...base, ok: true, artifact, ran: r ? r.result : null };
    }
    if (tc.chain) {
        const c = runChain({ source, ...common, bin: opts.bin, exe2bin: tc.run === 'com', run }, hooks);
        return { ...base, ok: c.ok, artifact: c.bin || c.exe, ran: c.ran, stages: c.stages };
    }
    if (tc.interpret) {
        // An interpreter runs the source directly: mount it, invoke the tool
        // with the source name as its argument.
        const bin = opts.bin || process.env.MSDOS_BIN_DIR;
        const stem = source.replace(/.*[\\/]/, '').replace(/\.[^.]+$/, '').toUpperCase();
        const name = `${stem}.${tc.ext}`;
        const r = runDos({ ...common, program: `${bin}/${tc.interpret}`, args: name,
            files: [`${name}=${source}`], keys: opts.keys || '' }, hooks);
        return { ...base, ok: r.result.terminated, ran: r.result };
    }
    throw new Error(`toolchain '${id}' has no runnable definition`);
}

// ── CLI: list what's available, or run a source through a toolchain ─────────
if (import.meta.url === `file://${process.argv[1]}`) {
    const [cmd, ...rest] = process.argv.slice(2);
    const flag = (name, def) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : def; };
    if (cmd === 'list') {
        const available = availableBinaries(process.env.MSDOS_BIN_DIR);
        for (const t of listToolchains(rest[0] || null, { available })) {
            process.stdout.write(`${t.id.padEnd(14)} ${t.language.padEnd(4)} ${t.kind.padEnd(7)} ${t.label}\n`);
        }
        process.stdout.write(`\nmachine flavors: ${Object.keys(FLAVORS).join(', ')} (default ${DEFAULT_FLAVOR})\n`);
    } else if (cmd === 'menu') {
        // The JSON the code tab renders its language/compiler/machine pickers from.
        process.stdout.write(JSON.stringify(codeTabMenu({ available: availableBinaries(process.env.MSDOS_BIN_DIR) }), null, 2) + '\n');
    } else if (cmd === 'run') {
        const [id, source] = rest;
        if (!id || !source) { console.error('usage: toolchains.mjs run <toolchain> <source> [--flavor F]'); process.exit(64); }
        let r;
        try { r = runToolchain(id, source, { flavor: flag('--flavor', DEFAULT_FLAVOR) }); }
        catch (e) { console.error(`toolchains: ${e.message}`); process.exit(66); }
        process.stderr.write(`\n[toolchain] ${id} on ${r.flavor}: ${r.ok ? 'built' : 'FAILED'}${r.ran ? ` — ran: exit ${r.ran.exitCode}` : ''}\n`);
        process.exit(r.ran ? (r.ran.terminated ? r.ran.exitCode : 2) : (r.ok ? 0 : 2));
    } else {
        console.error('usage: toolchains.mjs list [language] | menu | run <toolchain> <source> [--flavor F]');
        process.exit(64);
    }
}
