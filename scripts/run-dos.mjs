#!/usr/bin/env node
/**
 * run-dos.mjs — a DOSBox-shaped terminal front end for the 8086/286 DOS tier.
 *
 * It ties the pieces that already exist (I8086Machine + the createDos8086
 * INT 21h/10h/16h service layer) into the one thing missing: a single command
 * that takes a .COM or .EXE, runs it on a chosen machine, streams its DOS
 * character output to the terminal, and prints the final 80x25 text screen for
 * programs that draw straight to B800h. It is not a cycle-accurate PC; it is
 * the fast functional tier, the same one the widgets pane runs.
 *
 *   node scripts/run-dos.mjs PROGRAM.COM|.EXE [options]
 *
 *   --variant 8086|80186|80286   CPU core (default 8086; 80286 runs it on the
 *                                real-mode 286 that grades to zero SST286 fails)
 *   --preset  at|xt              machine board (default at = DOSBOX8086; xt =
 *                                DOSBOX8086_XT, the XT-class board)
 *   --max     N                  instruction budget before giving up (default 20M)
 *   --keys    "text"             preload keystrokes (INT 16h / buffered input)
 *   --screen                     always print the 80x25 text screen at the end
 *   --dosbox-conf FILE           import a dosbox.conf: its [dosbox] machine,
 *                                [cpu] cycles and [autoexec] mount+program map
 *                                onto the run (the program positional then
 *                                becomes optional — the conf's autoexec supplies it)
 *   --quiet                      suppress the trailing status line
 *
 * Exit status is the program's DOS exit code (AH=4Ch), or 2 if it never
 * terminated within the budget.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, dirname, resolve, join } from 'node:path';
import { I8086Machine } from '../src/i8086-machine.js';
import { createDos8086, DOSBOX8086, DOSBOX8086_XT } from '../src/i8086-dos.js';

const PRESETS = { at: DOSBOX8086, xt: DOSBOX8086_XT };

/** Minimal dosbox.conf reader: the handful of keys that map onto this tier. */
export function importDosboxConf(confPath) {
    const text = readFileSync(confPath, 'utf8');
    const out = { program: null, preset: 'at', variant: '8086', cycles: null, machine: null };
    let section = null;
    const mounts = new Map();            // drive letter -> host dir
    const autoexec = [];
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.replace(/[#;].*$/, '').trim();
        if (!line) continue;
        const sec = line.match(/^\[(\w+)\]$/);
        if (sec) { section = sec[1].toLowerCase(); continue; }
        if (section === 'autoexec') { autoexec.push(line); continue; }
        const kv = line.match(/^(\w+)\s*=\s*(.+)$/);
        if (!kv) continue;
        const [, key, val] = [kv[0], kv[1].toLowerCase(), kv[2].trim()];
        if (section === 'dosbox' && key === 'machine') out.machine = val.toLowerCase();
        if (section === 'cpu' && key === 'cycles') out.cycles = val.toLowerCase();
    }
    // A CGA/Hercules machine is the XT-class board here; svga/vga/ega stay on
    // the AT-class default (both carry a text screen, which is what run-dos reads).
    if (out.machine && /^(cga|hercules|pcjr|tandy)/.test(out.machine)) out.preset = 'xt';
    // Resolve `mount c <dir>` and the first program the autoexec runs (foo.exe,
    // c:\foo.com, a bare name). Paths are taken relative to the conf's directory.
    const confDir = dirname(resolve(confPath));
    for (const cmd of autoexec) {
        const mount = cmd.match(/^mount\s+([a-z])\s+(.+)$/i);
        if (mount) { mounts.set(mount[1].toLowerCase(), resolve(confDir, mount[2].replace(/["']/g, ''))); continue; }
        const prog = cmd.match(/^(?:([a-z]):[\\/]?)?([\w.\\/-]+\.(?:com|exe))\b/i);
        if (prog && !out.program) {
            const drive = (prog[1] || 'c').toLowerCase();
            const rel = prog[2].replace(/\\/g, '/');
            out.program = mounts.has(drive) ? join(mounts.get(drive), rel) : resolve(confDir, rel);
        }
    }
    return out;
}

function parseArgs(argv) {
    const o = { program: null, variant: '8086', preset: 'at', max: 20_000_000, keys: '', screen: false, quiet: false, conf: null, files: [], out: null, chain: null, masm: null, link: null, exe2bin: false, run: false };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--variant') o.variant = argv[++i];
        else if (a === '--preset') o.preset = argv[++i];
        else if (a === '--max') o.max = Number(argv[++i]);
        else if (a === '--keys') o.keys = argv[++i];
        else if (a === '--screen') o.screen = true;
        else if (a === '--quiet') o.quiet = true;
        else if (a === '--dosbox-conf') o.conf = argv[++i];
        else if (a === '--file') o.files.push(argv[++i]);   // mount a host file into DOS (repeatable)
        else if (a === '--out') o.out = argv[++i];          // save files the program wrote into this dir
        else if (a === '--chain') o.chain = argv[++i];      // assemble+link SOURCE.ASM -> .EXE (MASM then LINK)
        else if (a === '--masm') o.masm = argv[++i];        // path to MASM.EXE (else $MSDOS_BIN_DIR)
        else if (a === '--link') o.link = argv[++i];        // path to LINK.EXE (else $MSDOS_BIN_DIR)
        else if (a === '--exe2bin') o.exe2bin = true;       // also run EXE2BIN (.EXE -> .BIN) as a chain stage
        else if (a === '--run') o.run = true;               // also RUN the built artifact in the same invocation
        else if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
        else o.program = a;
    }
    return o;
}

/**
 * Mount host files into the DOS virtual filesystem. A spec is `PATH` (mounted
 * under the uppercased basename, the name a tool constructs — MASM opens
 * `T.ASM`) or `DOSNAME=PATH` (mount under an explicit DOS name). Returns the
 * Map createDos8086 reads and writes as its disk, plus the set of input names
 * so the caller can tell which files the program CREATED.
 */
function mountFiles(specs, preloaded) {
    const files = new Map();
    const inputs = new Set();
    // In-memory inputs (e.g. one chain stage's artifact fed to the next).
    if (preloaded) for (const [name, bytes] of (preloaded instanceof Map ? preloaded : Object.entries(preloaded))) {
        files.set(name, bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes));
        inputs.add(name);
    }
    for (const spec of specs) {
        const eq = spec.indexOf('=');
        const [name, path] = eq >= 0 ? [spec.slice(0, eq), spec.slice(eq + 1)] : [basename(spec).toUpperCase(), spec];
        files.set(name, new Uint8Array(readFileSync(path)));
        inputs.add(name);
    }
    return { files, inputs };
}

/** Load a program image and dispatch to loadExe (MZ header) or loadCom. The
 *  args become the DOS command tail — EXE2BIN and other tools read them. */
function loadProgram(dos, path, args = '') {
    const bytes = new Uint8Array(readFileSync(path));
    const isExe = /\.exe$/i.test(path) || (bytes[0] === 0x4d && bytes[1] === 0x5a); // 'MZ'
    (isExe ? dos.loadExe : dos.loadCom).call(dos, bytes, { args });
    return isExe ? 'exe' : 'com';
}

export function runDos(opts, { write = (s) => process.stdout.write(s) } = {}) {
    let { program, variant, preset, max, keys } = opts;
    keys = keys || '';                    // a stage that drives via command tail passes no keystrokes
    let cyclesNote = null, machineNote = null;
    if (opts.conf) {
        const conf = importDosboxConf(opts.conf);
        program = program || conf.program;
        preset = conf.preset;                        // machine= -> board (at/xt)
        // variant stays from --variant: DOSBox has no 8086-vs-286 concept, so the
        // conf never overrides which core the user asked to run the program on.
        cyclesNote = conf.cycles; machineNote = conf.machine;
    }
    if (!program) throw new Error('no program: pass a .COM/.EXE path (or a --dosbox-conf whose autoexec runs one)');
    if (!PRESETS[preset]) throw new Error(`unknown preset '${preset}' (use at|xt)`);

    const machine = new I8086Machine({ ...PRESETS[preset], variant });
    let streamed = 0;
    const { files, inputs } = mountFiles(opts.files || [], opts.preloaded);
    const dos = createDos8086(machine, {
        onChar: (ch) => { streamed++; write(ch); },
        keys: [...keys].map((c) => c.charCodeAt(0) & 0xff),
        files,
    }).install();
    const kind = loadProgram(dos, program, opts.args || '');
    const result = dos.run(max);
    // Files present after the run that were not mounted inputs are what the
    // program CREATED (a .OBJ from MASM, a .EXE from LINK, ...).
    const created = [...files.keys()].filter((n) => !inputs.has(n));
    return { result, dos, machine, kind, program, preset, variant, cyclesNote, machineNote, streamed, files, inputs, created };
}

/**
 * Assemble + link a .ASM into a runnable .EXE in one go, chaining the artifacts
 * between the real DOS tools: MASM (SOURCE.ASM -> STEM.OBJ) then LINK (STEM.OBJ
 * -> an .EXE). Each stage runs through runDos; the .OBJ is fed to LINK in
 * memory (no temp files). LINK names its output with the default-drive prefix
 * (A:STEM.EXE), so the .EXE is found by extension, not by an exact name.
 *
 * With opts.exe2bin, a third stage runs EXE2BIN (STEM.EXE -> STEM.BIN) via the
 * command tail (EXE2BIN takes arguments, not prompts), producing a flat binary.
 *
 * @returns {{ ok, stem, exe, exeName, obj, bin, binName, stages: object[] }}
 */
const QUIET = { write() {} };   // chain tool stages run silently; only the RUN stage streams to the caller

export function runChain(opts, hooks = {}) {
    const dir = opts.bin || process.env.MSDOS_BIN_DIR;
    const masm = opts.masm || (dir && join(dir, 'MASM.EXE'));
    const link = opts.link || (dir && join(dir, 'LINK.EXE'));
    if (!masm || !link) throw new Error('run-dos --chain needs MASM.EXE and LINK.EXE (pass --masm/--link or set MSDOS_BIN_DIR)');
    const common = { variant: opts.variant || '8086', preset: opts.preset || 'at', max: opts.max || 40_000_000 };
    const stem = basename(opts.source).replace(/\.[^.]+$/, '').toUpperCase();
    const stages = [];
    const fail = (rest) => ({ ok: false, stem, exe: null, exeName: null, obj: null, bin: null, binName: null, stages, ...rest });

    // Stage 1 — MASM: prompts are Source / Object / Listing / Cross-ref; STEM
    // then defaults. Mount the source as STEM.ASM.
    const asm = runDos({ ...common, program: masm, keys: `${stem}\r\r\r\r`, files: [`${stem}.ASM=${opts.source}`] }, QUIET);
    stages.push({ tool: 'masm', ...summary(asm) });
    const objName = asm.created.find((n) => /\.OBJ$/i.test(n));
    if (!asm.result.terminated || !objName) return fail();
    const obj = asm.files.get(objName);

    // Stage 2 — LINK: prompts are Objects / Run file / List / Libraries. Feed
    // the .OBJ in memory as STEM.OBJ.
    const lnk = runDos({ ...common, program: link, keys: `${stem}\r\r\r\r`, preloaded: { [`${stem}.OBJ`]: obj } }, QUIET);
    stages.push({ tool: 'link', ...summary(lnk) });
    const exeName = lnk.created.find((n) => /\.EXE$/i.test(n));
    const exe = exeName ? lnk.files.get(exeName) : null;
    if (!exe) return fail({ obj });

    // Stage 3 (optional) — EXE2BIN: STEM.EXE -> STEM.BIN, via the command tail.
    let bin = null, binName = null;
    if (opts.exe2bin) {
        const e2b = typeof opts.exe2bin === 'string' ? opts.exe2bin : (dir && join(dir, 'EXE2BIN.EXE'));
        if (!e2b) return fail({ obj, exe, exeName });
        const conv = runDos({ ...common, program: e2b, args: `${stem}.EXE ${stem}.BIN`, preloaded: { [`${stem}.EXE`]: exe } }, QUIET);
        stages.push({ tool: 'exe2bin', ...summary(conv) });
        binName = conv.created.find((n) => /\.(BIN|COM)$/i.test(n));
        bin = binName ? conv.files.get(binName) : null;
    }

    // Stage 4 (optional) — RUN the freshly built artifact in the same
    // invocation: the flattened .COM if EXE2BIN produced one, else the .EXE.
    let ran = null;
    if (opts.run) {
        const r = bin ? runImage(bin, 'com', common, hooks) : runImage(exe, 'exe', common, hooks);
        stages.push({ tool: 'run', ...summary(r) });
        ran = r.result;
    }
    return { ok: true, stem, exe, exeName, obj, bin, binName, ran, stages };
}

const summary = (r) => ({ terminated: r.result.terminated, exitCode: r.result.exitCode, steps: r.result.steps, created: r.created ?? [] });

/** Run an in-memory program image (no host file) — used to run a chain's own
 *  freshly built artifact in the same invocation. */
export function runImage(bytes, kind, opts = {}, { write = (s) => process.stdout.write(s) } = {}) {
    const { variant = '8086', preset = 'at', max = 20_000_000, keys = '' } = opts;
    const machine = new I8086Machine({ ...PRESETS[preset], variant });
    let streamed = 0;
    // Accept keystrokes as a string (converted to bytes) or a byte array, so a
    // program that reads input (INT 21h/16h — e.g. a BASIC INPUT) can be driven.
    const keyBytes = typeof keys === 'string' ? [...keys].map((c) => c.charCodeAt(0) & 0xff) : [...keys];
    const dos = createDos8086(machine, { onChar: (ch) => { streamed++; write(ch); }, keys: keyBytes }).install();
    (kind === 'exe' ? dos.loadExe : dos.loadCom).call(dos, bytes);
    const result = dos.run(max);
    return { result, dos, machine, streamed };
}

// ── CLI entry ────────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
    let opts;
    try { opts = parseArgs(process.argv.slice(2)); }
    catch (e) { console.error(`run-dos: ${e.message}`); process.exit(64); }

    // --chain: assemble+link a .ASM into a .EXE (MASM -> LINK) and save it.
    if (opts.chain) {
        let c;
        try { c = runChain({ ...opts, source: opts.chain }); }
        catch (e) { console.error(`run-dos: ${e.message}`); process.exit(66); }
        if (c.ok && opts.out) {
            mkdirSync(opts.out, { recursive: true });
            writeFileSync(join(opts.out, `${c.stem}.EXE`), c.exe);
            if (c.bin) writeFileSync(join(opts.out, `${c.stem}.BIN`), c.bin);
        }
        if (!opts.quiet) {
            for (const s of c.stages) process.stderr.write(`[run-dos:chain] ${s.tool}: ${s.terminated ? `exit ${s.exitCode}` : 'DID NOT TERMINATE'} in ${s.steps} — wrote [${s.created.join(', ')}]\n`);
            const art = c.ok ? `${c.stem}.EXE (${c.exe.length} bytes)${c.bin ? ` + ${c.stem}.BIN (${c.bin.length} bytes)` : ''}${opts.out ? ` in ${opts.out}` : ''}` : 'FAILED';
            process.stderr.write(`[run-dos:chain] ${opts.chain} -> ${art}${c.ran ? ` — ran: exit ${c.ran.exitCode}` : ''}\n`);
        }
        process.exit(!c.ok ? 2 : (c.ran ? (c.ran.terminated ? c.ran.exitCode : 2) : 0));
    }

    if (!opts.program && !opts.conf) {
        console.error('usage: run-dos.mjs PROGRAM.COM|.EXE [--variant 8086|80286] [--preset at|xt] [--dosbox-conf FILE] [--keys TEXT] [--screen] [--max N]\n'
            + '       run-dos.mjs --chain SOURCE.ASM [--masm PATH --link PATH | MSDOS_BIN_DIR] [--out DIR] [--variant 80286]');
        process.exit(64);
    }
    let out;
    try { out = runDos(opts); }
    catch (e) { console.error(`run-dos: ${e.message}`); process.exit(66); }

    // Programs that draw straight to B800h produce no onChar stream; show the
    // screen for them, or whenever --screen is asked.
    if (opts.screen || out.streamed === 0) {
        const screen = out.dos.screenText().join('\n').replace(/\n+$/, '');
        if (screen.trim()) process.stdout.write((out.streamed ? '\n' : '') + screen + '\n');
    }
    // Save what the program wrote (a .OBJ, .EXE, .BIN, ...) so a run can feed
    // the next tool in the chain — MASM's .OBJ into LINK, LINK's .EXE into EXE2BIN.
    if (opts.out && out.created.length) {
        mkdirSync(opts.out, { recursive: true });
        for (const name of out.created) writeFileSync(join(opts.out, name), out.files.get(name));
    }
    if (!opts.quiet) {
        const conf = opts.conf ? ` conf=${basename(opts.conf)}${out.machineNote ? ` machine=${out.machineNote}` : ''}${out.cyclesNote ? ` cycles=${out.cyclesNote}` : ''}` : '';
        const wrote = out.created.length ? ` wrote=[${out.created.join(', ')}]${opts.out ? ` -> ${opts.out}` : ''}` : '';
        process.stderr.write(`\n[run-dos] ${basename(out.program)} (${out.kind}) on ${out.variant}/${out.preset}: `
            + `${out.result.terminated ? `exit ${out.result.exitCode}` : 'DID NOT TERMINATE'} in ${out.result.steps} instructions${conf}${wrote}\n`);
    }
    process.exit(out.result.terminated ? out.result.exitCode : 2);
}
