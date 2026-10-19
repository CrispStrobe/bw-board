#!/usr/bin/env node
/**
 * Standing opcode-coverage gate for the 8086 core. It emits ONE number and
 * exits nonzero when that number is not zero: how many opcodes the core
 * implements are exercised by NEITHER the always-on test corpus NOR the
 * SingleStepTests grind.
 *
 * Why a number, not a report. The real verification is the 646,000-vector grind
 * (scripts/grind-i8086.mjs) — every opcode BYTE is ground there EXCEPT the two
 * the suite omits wholesale: 0x0F (POP CS, README "currently omitted") and 0x9B
 * (WAIT, README "not included"). So an opcode is covered-by-nothing exactly when
 * it is one of those two AND no always-on test executes it. This gate is the
 * complement of the grind: it names the opcodes the grind cannot reach and
 * demands the hand-written tests reach them instead. Today the number is 0 —
 * POP CS runs in the core tests, WAIT is pinned by its own test in
 * test/i8086.test.mjs. Implement a new opcode the grind also skips without a
 * test and this goes to 1 and fails, which is the whole point of standing it up.
 *
 * A counter read against thin input has not been read (VERIFICATION.md, and the
 * cycle-coverage counter that read 100% off a five-instruction loop where a DOS
 * boot gives 54%). The corpus below is the executing core suite — programs that
 * assemble and run, not device demos. If an opcode's coverage is ever in doubt,
 * WIDEN this list; never narrow it to make the number go green.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync, rmSync, mkdtempSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');

// The corpus: always-on i8086 tests that ASSEMBLE AND RUN programs. Demos and
// renderers are left out because they exercise devices, not the opcode set —
// the executing core is the realistic opcode workload.
const CORPUS = [
    'i8086.test.mjs', 'i8086-asm.test.mjs', 'i8086-emu8086.test.mjs',
    'i8086-186.test.mjs', 'i8086-machine.test.mjs', 'i8086-dos.test.mjs',
    'i8086-interrupts.test.mjs', 'i8086-integration.test.mjs',
    'i8086-isr-pwm.test.mjs', 'i8086-timer-tick.test.mjs',
].map((f) => join('test', f));

// The two BYTES the SingleStepTests 8086 suite omits wholesale (README: 0F
// "currently omitted", 9B "not included"). Every other byte is ground, so it
// needs no hand-written test to be covered. Keep this list tied to the suite's
// documented exclusions, not to what happens to be untested this week.
const GRIND_OMITS = new Set([0x0f, 0x9b]);

const dir = mkdtempSync(join(tmpdir(), 'cov-8086-'));
const out = join(dir, 'fired.txt');
const hook = join(here, 'cov-i8086-hook.mjs');

const r = spawnSync(process.execPath, ['--test', '--import', hook, ...CORPUS],
    { cwd: repo, env: { ...process.env, COV_OUT: out }, encoding: 'utf8' });

if (r.status !== 0) {
    process.stderr.write('cov: the corpus is not green — coverage is meaningless until it is.\n');
    process.stderr.write((r.stdout || '').split('\n').filter((l) => /^not ok|^# fail/.test(l)).join('\n') + '\n');
    rmSync(dir, { recursive: true, force: true });
    process.exit(2);
}

const fired = new Set(
    existsSync(out)
        ? readFileSync(out, 'utf8').trim().split(/\s+/).filter(Boolean).map((h) => parseInt(h, 16))
        : [],
);
rmSync(dir, { recursive: true, force: true });

const uncovered = [...GRIND_OMITS].filter((op) => !fired.has(op)).sort((a, b) => a - b);
const hx = (n) => '0x' + n.toString(16).padStart(2, '0');

process.stdout.write(`i8086 opcodes exercised by the corpus: ${fired.size}\n`);
process.stdout.write(`covered by nothing (grind-omitted AND untested): ${uncovered.length}`);
process.stdout.write(uncovered.length ? ` -> ${uncovered.map(hx).join(' ')}\n` : '\n');
if (fired.size < 190) {
    // The corpus fired ~202 distinct opcodes when this was written. A sharp drop
    // means the corpus itself shrank or failed to load, not that coverage
    // improved — the number below would be a lie of omission. Refuse it.
    process.stderr.write(`cov: only ${fired.size} opcodes fired; the corpus looks truncated, not the coverage improved.\n`);
    process.exit(2);
}
process.exit(uncovered.length === 0 ? 0 : 1);
