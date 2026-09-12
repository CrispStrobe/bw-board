// The tracked demo ROMs are the CURRENT output of their generators.
//
// WHY THIS EXISTS. `rom/blink-demo.bin` and its nine siblings are tracked
// binaries, and their tests DO execute them — test/i8086-blink-demo.test.mjs
// reads the file and boots it. So they are not dead artefacts, and the usual
// tell for a dead one ("nothing executes it", findable by grep) is absent.
// What was missing is narrower and has no surface at all: NOTHING CHECKED THEY
// STILL MATCH THEIR GENERATORS. Edit scripts/build-blink-demo.mjs, forget to
// regenerate, and every existing test goes on passing against the OLD bytes —
// it looks exactly like coverage, and on the day it does fail it presents as
// the change not working rather than as the check being wrong, which sends the
// reader to the wrong file.
//
// It is the substitution species with a build artefact as the proxy: the tests'
// set is {the tracked bytes}, the goal's set is {what the generator produces
// today}, and those coincide by accident rather than by construction. LANES 13
// with `.bin` where `busTrace` was. Recorded as ROADMAP R2, and as the
// twenty-fourth species in brickwright-lite's docs/GATES-THAT-CANNOT-FAIL.md.
//
// THE TRAP THIS FILE HAD TO AVOID, and it is the reason `--out` exists. The
// shortest thing that appears to work is to run each generator and then diff
// `git status`. That regenerates INTO rom/ — it overwrites the evidence with
// the thing it was supposed to compare against, so the first run is the only
// real one and every run after it is self-confirming. Each generator is
// therefore built into a temp directory that is thrown away.
//
// WHAT IT DOES NOT PROVE, stated here rather than discovered later: that the
// generator is CORRECT. A wrong generator faithfully reproduced still passes.
// This gate is about correspondence and nothing else.
//
// THE CONSEQUENCE, which is sharper than it first reads: this file can never be
// the oracle for a claim that the shipped ROM bytes are unchanged by some piece
// of work. It rebuilds THROUGH the same generators, so a generator that drifted
// in lockstep with its output passes green. An oracle that shares an
// implementation with the thing it checks is measuring self-consistency, not
// correctness -- the same shape as a reproducibility twin proving an artefact
// matches a fresh run of the same faulty query. Its green means "these bytes
// are not STALE"; it has never meant "these bytes are RIGHT".
//
// So a "no ROM byte moved" claim needs an anchor OUTSIDE this implementation.
// One exists as of 2026-09-10: an isolated single-branch clone identified BIOS
// source 7b8d1404 with zero bios.asm commits between it and the then-current
// pin, and all seven demo ROMs compared byte for byte from there --
// 4f9d09331bdf37c6, 39fe4f6e277180f5, 51b8940c9c5234b6, 9b35f9e4a4492cbd,
// dd6399cbcce5afa3, 88d66b132eff501e, 803cd82a0be9e661. A second, independent
// route (a recorder-selection repair) predicted the same 7b8d1404 without
// relying on the first. That pass ran COMPARE-ONLY BEFORE ANY WRITE, which is
// an ordering requirement rather than a preference: a compare performed after
// writing cannot distinguish "unchanged" from "overwritten with the same
// bytes". Re-run that shape when the claim is needed again; do not substitute
// this file's green for it.
//
// NOT DELETABLE AS REDUNDANT: bw-board's own BIOS is immune to this by
// construction — rom/bios.bin is gitignored and untracked, so consumers build
// from rom/bios.asm and run what they built. The demo ROMs cannot take that
// cure, because brickwright-lite references them as product assets
// (CircuitDesigner.jsx, its vendored i8086-machine.js). Not shipping the
// artefact is the fix; this gate is what you need when you must ship it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROM = join(ROOT, 'rom');

/** Every generator that writes a TRACKED binary into rom/, and what it writes. */
const GENERATORS = [
    ['build-blink-demo.mjs', 'blink-demo.bin'],
    ['build-cga-demo.mjs', 'cga-demo.bin'],
    ['build-cga-gfx-demo.mjs', 'cga-gfx-demo.bin'],
    ['build-desk-demo.mjs', 'desk-demo.bin'],
    ['build-ega-demo.mjs', 'ega-demo.bin'],
    ['build-hercules-demo.mjs', 'hercules-demo.bin'],
    ['build-keyboard-demo.mjs', 'keyboard-demo.bin'],
    ['build-serial-monitor.mjs', 'serial-monitor.bin'],
    ['build-timer-demo.mjs', 'timer-demo.bin'],
    ['build-vga-demo.mjs', 'vga-demo.bin'],
];

test('the list of generators has not drifted from the tracked binaries', () => {
    // A generator added without a line here would be unguarded, and the guard
    // would go on reporting green about the nine it does know. The census's
    // own lesson: a check reports on what it FOUND.
    const tracked = readdirSync(ROM).filter((f) => f.endsWith('.bin') && f !== 'bios.bin');
    const covered = GENERATORS.map(([, bin]) => bin);
    assert.deepEqual(tracked.slice().sort(), covered.slice().sort(),
        'rom/*.bin and the GENERATORS list above disagree — a demo ROM was added, '
        + 'removed or renamed without updating this file, so it is unguarded');
});

for (const [script, bin] of GENERATORS) {
    test(`${bin} is the current output of ${script}`, () => {
        const tracked = readFileSync(join(ROM, bin));
        // Build into a THROWAWAY directory. Never into rom/ -- see the header.
        const tmp = mkdtempSync(join(tmpdir(), 'romfresh-'));
        try {
            execFileSync(process.execPath, [join(ROOT, 'scripts', script), '--out', tmp],
                { stdio: 'pipe' });
            const built = join(tmp, bin);
            assert.ok(existsSync(built),
                `${script} --out did not write ${bin} into the temp directory; the `
                + '--out option is what keeps this gate from overwriting its own evidence');
            const fresh = readFileSync(built);
            assert.equal(fresh.length, tracked.length,
                `${bin} is ${tracked.length} bytes and ${script} now produces `
                + `${fresh.length}: the tracked file is stale, run "node scripts/${script}"`);
            let at = -1;
            for (let i = 0; i < fresh.length; i++) if (fresh[i] !== tracked[i]) { at = i; break; }
            assert.equal(at, -1,
                `${bin} differs from what ${script} produces, first at byte ${at} `
                + `(tracked ${tracked[at]?.toString(16)}, generator ${fresh[at]?.toString(16)}). `
                + `The generator changed and the artefact was not regenerated: run `
                + `"node scripts/${script}". Nothing else in the suite would have caught this, `
                + 'because every test that uses this ROM loads the tracked bytes.');
        } finally {
            rmSync(tmp, { recursive: true, force: true });
        }
    });
}
