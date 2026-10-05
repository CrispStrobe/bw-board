#!/usr/bin/env node
/**
 * PROOF: the GPL-Lab PicoBB `brickwright-media.json` is EXECUTABLE through
 * bw-board's canonical rp2040 media-bundle runner.
 *
 * Runs the manifest the lab ships (machine `rp2040js`, the
 * bbcbasic_console_pico.uf2 flash slot) through `runRp2040Bundle` and checks
 * that PicoBB — BBC BASIC for the Raspberry Pi Pico — boots over its UART0
 * console to the `>` prompt and runs a scripted REPL session.
 *
 * SKIPS LOUDLY when the firmware is absent — the UF2 is a built Zlib artifact
 * that lives in brickwright-media-lab (projects/picobb-rp2040/), never vendored
 * here, so run that project's fetch.sh (or point $PICOBB_UF2 at the .uf2) first.
 * A silent skip would read like a pass.
 *
 * The manifest below MIRRORS brickwright-media-lab projects/picobb-rp2040/
 * brickwright-media.json; the lab proof calls this same runner, so the Pico no
 * longer boots through a bespoke adapter path — it is a media bundle like the
 * 6502/Z80 projects.
 */
import { existsSync, readFileSync } from 'node:fs';
import { runRp2040Bundle } from '../src/machine-media-rp2040.js';

const UF2 = process.env.PICOBB_UF2
    || '/mnt/volume1/code/brickwright-media-lab/projects/picobb-rp2040/bbcbasic_console_pico.uf2';

const MANIFEST = {
    title: 'PicoBB — BBC BASIC for the Raspberry Pi Pico (RP2040 UART console)',
    machine: 'rp2040js',
    program: { kind: 'uf2', console: 'uart0', startKey: '\r', bootMs: 400 },
    slots: { flash: 'bbcbasic_console_pico.uf2' },
    expect: [
        'BBC BASIC for Pico Console v0.50',
        'UART Console',
        'Stack Check 4',
        '(C) Copyright R. T. Russell, 2025',
        '>',
    ],
    programs: [
        { title: 'arithmetic one-liner', input: 'PRINT 2+2\r', expect: ['PRINT 2+2', '         4'] },
        { title: 'FOR/NEXT squares loop', input: 'FOR I=1 TO 3:PRINT I*I:NEXT\r',
            expect: ['FOR I=1 TO 3', '         1', '         4', '         9'] },
    ],
};

if (!existsSync(UF2)) {
    console.log(`SKIP: no PicoBB firmware at ${UF2}.`);
    console.log('Run brickwright-media-lab projects/picobb-rp2040/fetch.sh (Zlib, fetched not vendored),');
    console.log('or set $PICOBB_UF2 to the bbcbasic_console_pico.uf2. Nothing to boot.');
    process.exit(0);
}

const files = { 'bbcbasic_console_pico.uf2': new Uint8Array(readFileSync(UF2)) };
const r = runRp2040Bundle(MANIFEST, files);

let ok = true;
for (const e of r.expect) { console.log(`  [${e.ok ? 'PASS' : 'FAIL'}] boot: ${e.text}`); ok = ok && e.ok; }
for (const p of r.programs) {
    for (const e of p.expect) { console.log(`  [${e.ok ? 'PASS' : 'FAIL'}] ${p.title}: ${e.text}`); ok = ok && e.ok; }
}
if (!ok) {
    console.log('\n--- transcript ---\n' + r.output.trim().slice(0, 600));
    console.error('\nPicoBB media bundle did NOT reach its acceptance state.');
    process.exit(1);
}
console.log(`\nPicoBB media bundle is executable: BBC BASIC alive on rp2040js (${r.machineMs} machine-ms).`);
