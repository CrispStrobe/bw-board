/**
 * The debugger chain, end to end, with nothing stubbed:
 *
 *   Scratch blocks
 *     -> generateC(project, {debug: true})        (sb3-creator)   @bw yield map
 *     -> sdcc --debug                             (SDCC)          .ihx + .cdb
 *     -> stc_symtab.py                            (stc-compiler)  yields[].block
 *     -> createEmu8051DebugTarget + a yield breakpoint            halts
 *     -> the Scratch block a front end would glow
 *
 * This lives in bench/ rather than test/ on purpose. It needs FOUR things this
 * repo does not own — two sibling checkouts, a real SDCC, and a built WASM — so
 * as a test it would skip on most machines and CI, and a suite that reports
 * "0 fail" while silently running nothing is worse than no suite. Run it by
 * hand when any link in the chain changes:
 *
 *     node bench/e2e-debugger.mjs
 *
 * Exit code 0 means every link holds. It says exactly which piece is missing
 * rather than skipping quietly.
 */

import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdtempSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createEmu8051DebugTarget } from '../src/emu8051-debug.js';
import { createDebugSession } from '../src/debug-session.js';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const code = path.resolve(here, '../..');

const SB3 = process.env.SB3_CREATOR || path.join(code, 'sb3-creator');
const STCC = process.env.STC_COMPILER || path.join(code, 'stc-compiler');
const WASM = process.env.EMU8051_JS
    || [path.join(code, 'emu8051-stc/build/emu8051.js'),
        path.join(code, 'lego/brickwright-lite/overlay/scratch-gui/src/lib/emu8051/emu8051.js'),
        '/mnt/volume1/code/emu8051-stc/build/emu8051.js'].find(existsSync);

function need(what, where) {
    if (!where || !existsSync(where)) {
        console.error(`e2e-debugger: cannot find ${what}` + (where ? ` at ${where}` : ''));
        console.error('  set SB3_CREATOR / STC_COMPILER / EMU8051_JS, or check the sibling out.');
        process.exit(2);
    }
    return where;
}
need('sb3-creator', SB3);
need('stc-compiler', STCC);
need('an emu8051 build', WASM);
try {
    execFileSync('sdcc', ['--version'], { stdio: 'pipe' });
} catch {
    console.error('e2e-debugger: no runnable sdcc on PATH (brew install sdcc)');
    process.exit(2);
}

const work = mkdtempSync(path.join(tmpdir(), 'bw-e2e-'));

/** Two scripts, so the emitter produces the scheduler and there is a task 1. */
const PROGRAM = `DEVICE STC12C5A60S2
CLOCK 11059200
PIN led1 = P1.0 OUTPUT ACTIVE LOW
PIN led2 = P1.1 OUTPUT

WHEN flag clicked:
  FOREVER:
    toggle led1
    wait 0.15 seconds

WHEN flag clicked:
  REPEAT 4:
    toggle led2
    wait 0.3 seconds
`;

// ---- 1. blocks -> debug C -------------------------------------------------
const { default: SB3Creator } = await import(path.join(SB3, 'src/utils/sb3Creator.js'));
const { readYieldMap } = await import(path.join(SB3, 'src/utils/cToPseudocode.js'));

const creator = new SB3Creator();
creator.parse(PROGRAM);
const c = creator.generateC(undefined, { debug: true });
writeFileSync(path.join(work, 'e2e.c'), c);

const projectBlocks = new Map();
for (const t of creator.project.targets) {
    for (const [id, b] of Object.entries(t.blocks || {})) projectBlocks.set(id, b);
}
const emitted = readYieldMap(c);
console.log(`1. generateC({debug:true}) — ${emitted.length} yields over ${new Set(emitted.map((y) => y.task)).size} tasks`);

// ---- 2. sdcc --debug ------------------------------------------------------
execFileSync('sdcc', ['--debug', '-mmcs51', '--iram-size', '256', '--xram-size', '1024',
    '--code-size', '61440', '-o', `${work}/`, path.join(work, 'e2e.c')], { stdio: 'pipe' });
const hex = readFileSync(path.join(work, 'e2e.ihx'), 'utf8');
console.log(`2. sdcc --debug — ${hex.trim().split('\n').length} hex records`);

// ---- 3. the symbol table --------------------------------------------------
execFileSync('python3', [path.join(STCC, 'stc_symtab.py'),
    '--cdb', path.join(work, 'e2e.cdb'), '--source', path.join(work, 'e2e.c'),
    '--fosc', '11059200', '--device', 'stc12c5a60s2',
    '-o', path.join(work, 'symbols.json')], { stdio: 'pipe' });
const symbols = JSON.parse(readFileSync(path.join(work, 'symbols.json'), 'utf8'));
const all = symbols.scheduler.tasks.flatMap((t) => t.yields);
console.log(`3. stc_symtab — ${all.length} yields, ${all.filter((y) => y.block).length} carrying a block id`);

// ---- 4. into the emulator -------------------------------------------------
const createEmu8051 = require(WASM);
const wasm = await createEmu8051();
wasm._emu_init(1);
wasm._emu_set_fosc(11059200);
wasm._emu_set_vcc(5.0);
wasm.ccall('emu_load_hex', 'number', ['string', 'number'], [hex, hex.length]);
const target = createEmu8051DebugTarget(wasm, { symbols });
console.log(`4. emulator — image loaded, steps ${JSON.stringify(target.capabilities().steps)}`);

// ---- 5. break at a yield, and land on a block -----------------------------
const task = symbols.scheduler.tasks[1];
const y = task.yields.find((v) => v.label === 'repeat_top') || task.yields[1];
const handle = target.setBreakpoint({ kind: 'yield', task: task.name, state: y.state });
if (typeof handle !== 'number') {
    console.error(`e2e-debugger: the breakpoint was refused — ${handle.unsupported}`);
    process.exit(1);
}

const session = createDebugSession(target);
session.start();
let frames = 0;
let outcome;
do { outcome = session.pump(); frames++; } while (outcome !== 'halted' && frames < 600);

const st = session.state();
const block = projectBlocks.get(y.block);
console.log(`5. halted in frame ${frames} at pc 0x${st.why ? st.why.pc.toString(16) : '?'}` +
    `, cause ${st.why && st.why.cause}`);
if (st.tasks) {
    const at = st.tasks.find((t) => t.task === task.name);
    console.log(`   position ${at.task} state ${at.state}, asked for state ${y.state}`);
}
console.log(`   block ${y.block} -> ${block ? block.opcode : 'NOT IN THE PROJECT'}`);
console.log(`   program time ${st.why ? (Number(st.why.tNs) / 1e6).toFixed(3) : '?'} ms, ` +
    `skew ${st.why && st.why.skewNs} ns`);

// ---- what has to hold -----------------------------------------------------
const fail = [];
if (!st.halted) fail.push(`never reached the breakpoint in ${frames} frames`);
if (st.tasks) {
    const at = st.tasks.find((t) => t.task === task.name);
    if (!at || at.state !== y.state) fail.push(`halted at state ${at && at.state}, wanted ${y.state}`);
}
if (!block) fail.push('the symbol table names a block that is not in the project');
if (st.why && st.why.cause !== 'breakpoint') fail.push(`cause was ${st.why.cause}`);
if (st.why && st.why.skewNs !== 0n) fail.push('an emulator must report zero skew');
if (all.some((v) => !v.block)) fail.push('some yields lost their block id in the .cdb pass');
// The emitter's map and the compiled one must agree, or the glow lands elsewhere.
for (const e of emitted) {
    const t = symbols.scheduler.tasks.find((s) => s.name === e.task);
    const found = t && t.yields.find((v) => v.state === e.state);
    if (!found) fail.push(`${e.task}/${e.state} vanished between the emitter and the .cdb`);
    else if (found.block !== e.block) fail.push(`${e.task}/${e.state} changed block id in transit`);
}

console.log(fail.length ? `\nFAILED\n  ${fail.join('\n  ')}` : '\nOK — every link holds.');
process.exit(fail.length ? 1 : 0);
