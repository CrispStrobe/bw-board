#!/usr/bin/env node
/**
 * Which oracles are present, and therefore which claims are STANDING rather
 * than merely recorded.
 *
 * WHY THIS EXISTS, and it is the same defect as the one that produced the
 * 8086 CI gate, one level up. `npm test` reports "3369 pass, 42 skipped", and
 * in that number the three skips that mean "a CPU core's 646,000-vector
 * evidence did not run" are indistinguishable from the ones that mean "no
 * Playwright" or "no lcapy". A reader sees green. The fix for the 8086 was to
 * make its grind run; the fix for the rest is to make their ABSENCE legible,
 * because a suite nobody can obtain is a defensible gap and a suite nobody
 * NOTICED is not.
 *
 * So this prints, in one table, every external input that gates a check in
 * this repo: whether it is present, how it is detected, what it proves, and
 * how to get it. Nothing here runs a test. It answers only "what would have
 * been checked if you ran everything right now, and what would not".
 *
 *   node scripts/oracle-census.mjs                 # the table, exit 0
 *   node scripts/oracle-census.mjs --require 8086-vectors,z80-vectors
 *   node scripts/oracle-census.mjs --json
 *
 * `--require` is what makes this usable as a CI gate: a job that checks out a
 * suite asserts it actually got it, rather than discovering later that a
 * sparse pattern matched nothing and every dependent test skipped politely.
 *
 * TWO KINDS, kept apart because their absence means different things:
 *   ORACLE   an INDEPENDENT source of truth — hardware-generated vectors,
 *            a second implementation, a reference solver. Its absence means
 *            a claim rests on our own opinion.
 *   FIXTURE  data a check needs in order to run at all — a ROM, a firmware
 *            image, a tape. Its absence means the check did not happen; the
 *            claims it would have made are simply unmade.
 *
 * THE LIST MUST NOT DRIFT FROM THE TESTS, which is the failure mode a census
 * has: it would go on cheerfully reporting PRESENT for an env var nothing
 * reads any more. `test/oracle-census.test.mjs` requires every `gates` entry
 * to actually mention the detection key, so a renamed variable or a moved path
 * turns this file red instead of turning it into fiction.
 *
 * @module
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const HOME = homedir();

/**
 * Every external input that gates a check. `detect` is the key a reader can
 * grep for; `paths` are tried in order, after `env` if it is set.
 */
export const INPUTS = [
    {
        id: '8086-vectors', kind: 'oracle',
        what: 'SingleStepTests 8086 — 646,000 vectors from an Intel P80C86A-2. '
            + 'Grounds src/i8086.js and src/i8086-disasm.js on TEXT as well as state.',
        env: 'I8086_VECTORS',
        paths: [join(HOME, 'code', '8086-vectors', 'v1_binary'), join(HOME, 'code', '8086-vectors', 'v1')],
        gates: ['test/i8086.test.mjs', 'test/i8086-disasm.test.mjs', 'test/moo.test.mjs',
            'scripts/grind-i8086.mjs', 'scripts/grind-i8086-disasm.mjs'],
        obtain: 'git clone --depth 1 https://github.com/SingleStepTests/8086 ~/code/8086-vectors',
        ci: 'yes — the `vectors` job checks out v1_binary and grinds all 646,000 per push',
    },
    {
        id: 'z80-vectors', kind: 'oracle',
        what: 'SingleStepTests z80 — 1,604 opcode files with full undocumented state '
            + '(X/Y flags, Q latch, R per-M1, WZ). Grounds src/z80.js.',
        env: 'Z80_VECTORS',
        paths: [join(HOME, 'code', 'z80-vectors', 'v1')],
        gates: ['test/z80-disasm.test.mjs', 'scripts/grind-z80.mjs'],
        obtain: 'git clone --depth 1 --filter=blob:none https://github.com/SingleStepTests/z80 ~/code/z80-vectors',
        ci: 'yes — the `vectors-full` job, on a schedule rather than per push (1.6 GB unpacked)',
    },
    {
        id: '65c02-vectors', kind: 'oracle',
        what: 'SingleStepTests 65x02, WDC variant — ~10k vectors per opcode including '
            + 'cycle counts. Grounds src/w65c02.js.',
        env: 'VECTORS_DIR',
        paths: [join(HOME, 'code', '65x02-vectors', 'wdc65c02', 'v1')],
        gates: ['test/w65c02.test.mjs', 'test/w65c02-disasm.test.mjs', 'scripts/grind-w65c02.mjs'],
        obtain: 'git clone --depth 1 --filter=blob:none --sparse '
            + 'https://github.com/SingleStepTests/65x02 ~/code/65x02-vectors '
            + '&& cd ~/code/65x02-vectors && git sparse-checkout set wdc65c02/v1',
        ci: 'yes — the `vectors-full` job, on a schedule rather than per push',
    },
    {
        id: 'lcapy', kind: 'oracle',
        what: 'An independent SYMBOLIC circuit solver. The only non-numerical check on mna.js.',
        env: 'LCAPY_PYTHON',
        paths: [join(HOME, '.local/pipx/venvs/lcapy/bin/python')],
        gates: ['test/lcapy-oracle.test.mjs'],
        obtain: 'pipx install lcapy',
        ci: 'no',
    },
    {
        id: 'emu8051', kind: 'oracle',
        what: 'A second 8051 implementation (MIT sibling repo), built to WASM. '
            + 'Cross-checks the emu8051 adapter against a different upstream.',
        env: 'EMU8051_JS',
        // Two detection routes because the tests genuinely use two: the
        // brightness and debug gates read $EMU8051_JS, while the
        // idle-fastforward gate looks for a built emu8051.js beside the repo
        // or checked out inside it (the CI layout). Listing only one of them
        // made this row claim a variable none of its gates read — caught by
        // test/oracle-census.test.mjs, which is what that test is for.
        paths: [join(HOME, 'code', 'emu8051-stc'), '/mnt/volume1/code/emu8051-stc'],
        gates: ['test/emu8051-idle-fastforward.test.mjs', 'test/brightness-emu8051.test.js',
            'test/emu8051-debug.test.js'],
        obtain: 'git clone https://github.com/CrispStrobe/emu8051-stc and build its WASM',
        ci: 'yes — checked out at a pinned ref by the `test` job',
    },
    {
        id: 'labwired-wasm', kind: 'oracle',
        what: 'The labwired engine as WASM — the differential oracle for the labwired bridge.',
        env: 'LABWIRED_WASM',
        paths: [],
        gates: ['test/labwired-adapter.test.mjs', 'test/labwired-roundtrip.test.mjs',
            'test/pad-drive-parity.test.mjs'],
        obtain: 'point LABWIRED_WASM at a wasm-bindgen NODEJS out-dir (the web target will not load under node)',
        ci: 'no',
    },
    {
        id: 'labwired-cli', kind: 'oracle',
        what: 'The labwired binary — the STM32F030 differential oracle.',
        env: 'LABWIRED_CLI',
        paths: [],
        gates: ['test/labwired-oracle.test.mjs'],
        obtain: 'build labwired and point LABWIRED_CLI at it',
        ci: 'no',
    },
    {
        id: 'v86', kind: 'oracle',
        what: 'v86 (BSD-2) run headless — a whole-program second opinion on the support chips. '
            + 'Established that our i8254 read-back is more complete than its.',
        env: 'V86_ORACLE_DIR',
        paths: [],
        gates: ['scripts/oracle-v86.mjs'],
        obtain: 'download libv86.mjs + v86.wasm from a v86 release and point V86_ORACLE_DIR at them',
        ci: 'no',
    },
    {
        id: 'zx-roms', kind: 'fixture',
        what: 'Spectrum 48K/128K ROMs. Without them the ZX tier boots nothing and '
            + 'its snapshot, tape and banking gates do not run.',
        env: 'ZX_ROM',
        paths: [],
        gates: ['test/zx-tape.test.mjs', 'test/zx-sna.test.mjs', 'test/zx-z80file.test.mjs',
            'test/zx128.test.mjs'],
        obtain: 'supply 48.ROM / 128.ROM locally; never vendored — see the STECCY provenance note',
        ci: 'no — deliberately, the ROMs are not ours to ship',
    },
    {
        id: 'blinkenrocket-fw', kind: 'fixture',
        what: 'The reference Blinkenrocket firmware hex. Without it the sound-becomes-data '
            + 'modem loop is unproven end to end.',
        env: 'BLINKENROCKET_HEX',
        paths: [join(HOME, 'code', 'blinkenrocket-firmware', 'build', 'main.hex')],
        gates: ['test/blinkenrocket-modem-e2e.test.mjs'],
        obtain: 'build blinkenrocket-firmware at ref 140e2931',
        ci: 'no',
    },
];

/** Resolve one input to {present, via}. `via` names WHAT was found, so a
 *  PRESENT line can be checked rather than trusted. */
export function resolve(input) {
    const fromEnv = input.env ? process.env[input.env] : null;
    if (fromEnv) {
        return existsSync(fromEnv)
            ? { present: true, via: `$${input.env}=${fromEnv}` }
            : { present: false, via: `$${input.env}=${fromEnv} (set, but does not exist)` };
    }
    for (const p of input.paths) if (existsSync(p)) return { present: true, via: p };
    const tried = [input.env ? `$${input.env}` : null, ...input.paths].filter(Boolean);
    return { present: false, via: `tried ${tried.join(', ') || '(no default path)'}` };
}

const argv = process.argv.slice(2);
const required = (argv.find((a) => a.startsWith('--require'))?.split('=')[1]
    ?? (argv.includes('--require') ? argv[argv.indexOf('--require') + 1] : ''))
    .split(',').map((s) => s.trim()).filter(Boolean);

const rows = INPUTS.map((i) => ({ ...i, ...resolve(i) }));

if (argv.includes('--json')) {
    console.log(JSON.stringify(rows.map(({ id, kind, present, via, gates }) =>
        ({ id, kind, present, via, gates })), null, 2));
} else {
    const pad = (s, n) => String(s).padEnd(n);
    console.log(`${pad('INPUT', 18)}${pad('KIND', 9)}${pad('STATE', 9)}GATES  DETECTED VIA`);
    for (const r of rows) {
        console.log(`${pad(r.id, 18)}${pad(r.kind, 9)}${pad(r.present ? 'present' : 'ABSENT', 9)}`
            + `${pad(r.gates.length, 7)}${r.via}`);
    }
    const absent = rows.filter((r) => !r.present);
    const gatesLost = absent.reduce((n, r) => n + r.gates.length, 0);
    console.log(`\n${rows.length - absent.length}/${rows.length} present. `
        + `${absent.length} absent, gating ${gatesLost} file(s) that therefore did not run.`);
    for (const r of absent) console.log(`  ${r.id}: ${r.obtain}`);
}

// The point of the whole file: a required input that is missing is an ERROR,
// not a skip. Without this a job can check a suite out, match nothing, and
// have every dependent test skip politely while the job goes green.
const missing = required.filter((id) => {
    const r = rows.find((x) => x.id === id);
    if (!r) { console.error(`--require names "${id}", which is not in the census`); process.exit(2); }
    return !r.present;
});
if (missing.length) {
    console.error(`\nFAILED: required input(s) absent: ${missing.join(', ')}`);
    process.exit(1);
}
