#!/usr/bin/env node
/**
 * The retro tier's deepest whole-system smoke: BBC BASIC, interactive, on
 * our machine. BeebEater (MIT, github.com/chelsea6502/BeebEater) targets
 * byte-for-byte the EATER6502 preset — RAM $0000-$3FFF, ACIA $5000, VIA
 * $6000, ROM $8000-$FFFF, 1 MHz — and bundles the BBC BASIC 4 ROM
 * (Acorn heritage via mdfs.net: run locally, never vendored, never
 * redistributed — the ehBASIC rule). This script boots it, reads the
 * banner off the ACIA, types arithmetic and a three-line program at the
 * prompt, and asserts the answers.
 *
 * Setup: git clone --depth 1 https://github.com/chelsea6502/BeebEater \
 *          ~/code/BeebEater
 *
 * Two machine facts the run depends on, learned the honest way:
 *  - BeebEater's init polls the HD44780 busy flag on PB7; with no LCD
 *    the VIA's inputs float high and boot hangs in lcd_wait EXACTLY as
 *    the real bench would. Port B is driven low here (LCD-never-busy)
 *    until the HD44780 board part exists — then this script should wire
 *    the real model instead.
 *  - Keystrokes are paced (30 ms/char, 300 ms after CR): BeebEater's
 *    line handling has a window after Enter where a hammered UART loses
 *    characters, on our machine as on a gasping terminal.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { M6502Machine, EATER6502 } from '../src/m6502-machine.js';

const romPath = process.env.BEEBEATER_ROM || join(homedir(), 'code', 'BeebEater', 'BeebEater.rom');
if (!existsSync(romPath)) {
    console.error('SKIP (loudly): BeebEater.rom not found — see header for the clone recipe');
    process.exit(2);
}

let out = '';
const m = new M6502Machine(EATER6502, {
    onSerial: (byte) => { out += String.fromCharCode(byte); },
});
m.loadRom(readFileSync(romPath), 0x8000);
m.reset();
for (let b = 0; b < 8; b++) { m.chips.via1.setInput('b', b, 0); m.chips.via1.setInput('a', b, 0); }
m.advanceToMs(4000);

const checks = [];
const expect = (what, re) => checks.push({ what, ok: re.test(out), re });
expect('banner', /BeebEater Computer 16K/);
expect('BASIC announces itself', /BASIC/);
expect('prompt', />/);

const type = (s) => {
    for (const ch of s) {
        m.chips.acia1.rxPush(ch.charCodeAt(0));
        m.advanceToMs(m.tMs + (ch === '\r' ? 300 : 30));
    }
};
type('PRINT 2+2\r');
m.advanceToMs(m.tMs + 500);
expect('arithmetic (BBC right-aligned field)', / {9}4\n/);

type('10 FOR I=1 TO 3\r');
type('20 PRINT "HI";I\r');
type('30 NEXT I\r');
type('RUN\r');
m.advanceToMs(m.tMs + 2000);
expect('a stored program runs', /HI1\n\rHI2\n\rHI3\n/);

let bad = 0;
for (const c of checks) {
    console.log(`${c.ok ? 'ok ' : 'FAIL'}  ${c.what}`);
    if (!c.ok) bad++;
}
if (bad) console.log('--- transcript ---\n' + JSON.stringify(out));
else console.log(`\nBBC BASIC is alive on the machine (${(m.tMs / 1000).toFixed(1)} machine-seconds).`);
process.exit(bad ? 1 : 0);
