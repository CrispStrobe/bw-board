#!/usr/bin/env node
/**
 * Abersoft fig-Forth (1983) boots and interprets — the Spectrum arc's
 * system-software milestone, and the launch pad for tron-0xf.
 *
 * The tape is programandala.net's tron_0xf "compilable" TAP, whose
 * first blocks ARE Abersoft Forth itself (the repo ships the Forth
 * tape; GPL — everything here stays LOCAL-ONLY, never vendored).
 * Rebuild: cd ~/code/tron-0xf && PATH="$PWD/.toolbin:...gnubin:$PATH"
 *          make VERSION=0.3.0-dev   (see .toolbin/ shims: fsb via its
 *          Vim converter, bin2code reimplemented, pbm2scr via gforth).
 *
 * The whole path is the real one: original 48K ROM (byte-perfect
 * zxs-rom build), typed LOAD "" on the emulated keyboard, the $0556
 * LD-BYTES trap serving the TAP, the BASIC loader auto-running the
 * Forth binary — then typed Forth through the ROM's interrupt-driven
 * keyboard scan, asserted by reading the SCREEN back as text against
 * the ROM font (zxScreenText). No transcript taps, no shortcuts.
 *
 * Acceptance: the fig-FORTH banner, then 2 3 + . prints 5.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { Z80Machine } from '../src/z80-machine.js';
import { zxScreenText } from '../src/zx-ula.js';

const romPath = process.env.ZX_ROM || join(homedir(), 'code', 'zxs-rom', '48.ROM');
const tapPath = process.env.ABERSOFT_TAP
    || join(homedir(), 'code', 'tron-0xf', 'target', 'tron_0xf_v0.3.0-dev_compilable.tap')
;
for (const [p, hint] of [[romPath, 'build zxs-rom'], [tapPath, 'see header for the make recipe']]) {
    if (!existsSync(p)) { console.error(`SKIP (loudly): ${p} missing — ${hint}`); process.exit(2); }
}

const m = new Z80Machine({
    clockHz: 3_500_000,
    regions: [{ kind: 'rom', start: 0x0000, end: 0x3fff }],
    ula: true,
});
m.load(readFileSync(romPath), 0);
m.cpu.pc = 0;
m.insertTape(readFileSync(tapPath));

/** Press key combos one after another: ~120ms hold, ~120ms release. */
let t = 0;
const press = (...combos) => {
    for (const names of combos) {
        m.ula.setKeys(names); m.advanceToMs(t += 120);
        m.ula.setKeys([]); m.advanceToMs(t += 120);
    }
};
/** Type plain text into the running system (letters/digits/space/enter/.). */
const type = (s) => {
    for (const ch of s) {
        if (ch === ' ') press(['space']);
        else if (ch === '\n') press(['enter']);
        else if (ch === '.') press(['sym', 'm']);
        else if (ch === '+') press(['sym', 'k']);
        else press([ch.toLowerCase()]);
    }
};

const checks = [];
const expect = (what, ok) => { checks.push(ok); console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); };
const screen = () => zxScreenText(m.mem);

// Boot BASIC, type LOAD "" (j = LOAD keyword, sym+p = quote), run the tape.
m.advanceToMs(t = 4200);
press(['j'], ['sym', 'p'], ['sym', 'p'], ['enter']);
m.advanceToMs(t += 8000); // loader BASIC + CODE blocks + auto-RUN into Forth

const banner = screen().find((l) => /fig-FORTH/.test(l)) ?? '';
expect(`fig-Forth banner on screen (${JSON.stringify(banner)})`, /fig-FORTH 1\.1A/.test(banner));
expect(`tape blocks consumed for boot (${m.tape.pos})`, m.tape.pos >= 4);

type('2 3 + .\n');
m.advanceToMs(t += 1500);
const line = screen().find((l) => /^2 3 \+/.test(l)) ?? screen().filter(Boolean).at(-1) ?? '';
expect(`typed Forth interpreted: 2 3 + . echoes 5 OK (${JSON.stringify(line)})`, /5\s+OK/i.test(line));

console.log('\n--- screen ---');
console.log(screen().filter(Boolean).join('\n'));
process.exit(checks.every(Boolean) ? 0 : 1);
