#!/usr/bin/env node
/**
 * The retro tier's deepest whole-system smoke: BBC BASIC, interactive, on
 * our machine. BeebEater (MIT, github.com/chelsea6502/BeebEater) targets
 * byte-for-byte the EATER6502 preset — RAM $0000-$3FFF, ACIA $5000, VIA
 * $6000, ROM $8000-$FFFF, 1 MHz — and bundles the BBC BASIC 4 ROM
 * (Acorn heritage via mdfs.net: run locally, never vendored, never
 * redistributed — the ehBASIC rule). This script boots it, reads the
 * banner off the ACIA, types arithmetic and a three-line program at the
 * prompt, and asserts the answers — AND verifies the LCD text state.
 *
 * The HD44780 LCD is wired to VIA port B (BeebEater.asm, verified):
 *   PB0 → LCD D4       PB4 → RS  (register select)
 *   PB1 → LCD D5       PB5 → RW  (read/write)
 *   PB2 → LCD D6       PB6 → E   (enable strobe)
 *   PB3 → LCD D7/BF    PB7 → (unused by LCD, output only)
 *
 * The lcd_read routine (BeebEater.asm line 545) sets DDRB=0xF0 to make
 * PB0-PB3 inputs, reads PORTB, then does ASL×4 to shift the lower nibble
 * (LCD D4-D7) to bits 4-7 of the accumulator. The busy flag comes from
 * PB3 (LCD D7), shifted to bit 7 by the four ASLs.
 *
 * Setup: git clone --depth 1 https://github.com/chelsea6502/BeebEater \
 *          ~/code/BeebEater
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { M6502Machine, EATER6502 } from '../src/m6502-machine.js';
import { registerHD44780 } from '../src/devices/hd44780.js';
import { getDevice, unregisterDevice } from '../src/devices.js';

const romPath = process.env.BEEBEATER_ROM || join(homedir(), 'code', 'BeebEater', 'BeebEater.rom');
if (!existsSync(romPath)) {
    console.error('SKIP (loudly): BeebEater.rom not found — see header for the clone recipe');
    process.exit(2);
}

// ── HD44780 LCD model via the device registry ───────────────────────────
// Use the full device model's update() function so that BOTH read and write
// E pulses advance the internal nibble counter — exactly as the real chip
// does. This avoids the nibble-phase misalignment that occurs when the
// firmware's LCD_WRITE sends two nibbles during the 8-bit → 4-bit switch.
registerHD44780();
const model = getDevice('hd44780');
const lcdPart = { id: 'LCD1', kind: 'hd44780', params: { cols: 16, rows: 2 } };
const lcd = model.init(lcdPart);

// Pin voltages presented to the LCD model's update() function.
// These mirror the physical wiring from VIA port B.
const lcdPins = {
    vss: 0, vdd: 5.0, v0: 2.5,
    rs: 0, rw: 0, e: 0,
    d0: 0, d1: 0, d2: 0, d3: 0,  // D0-D3 unconnected (float low)
    d4: 0, d5: 0, d6: 0, d7: 0,  // D4-D7 wired to PB0-PB3
    a: 5.0, k: 0,
};

// Track the raw port B output level and the last E state for edge detect.
let lastPortB = 0;

let out = '';
const m = new M6502Machine(EATER6502, {
    onSerial: (byte) => { out += String.fromCharCode(byte); },
    onPinChange: (pin, level, tMs) => {
        // Only care about via1 port B pins
        if (!pin.startsWith('via1.PB')) return;
        const bit = parseInt(pin[7]);
        const mask = 1 << bit;
        if (level) lastPortB |= mask;
        else lastPortB &= ~mask;

        // Map VIA port B outputs to LCD pin voltages
        lcdPins.rs = (lastPortB & 0x10) ? 5.0 : 0;  // PB4 → RS
        lcdPins.rw = (lastPortB & 0x20) ? 5.0 : 0;  // PB5 → RW
        lcdPins.e  = (lastPortB & 0x40) ? 5.0 : 0;   // PB6 → E
        lcdPins.d4 = (lastPortB & 0x01) ? 5.0 : 0;  // PB0 → D4
        lcdPins.d5 = (lastPortB & 0x02) ? 5.0 : 0;  // PB1 → D5
        lcdPins.d6 = (lastPortB & 0x04) ? 5.0 : 0;  // PB2 → D6
        lcdPins.d7 = (lastPortB & 0x08) ? 5.0 : 0;  // PB3 → D7

        const tNs = BigInt(Math.round(tMs * 1_000_000));
        const read = (terminal) => lcdPins[terminal] ?? 0;

        // Run the LCD model's update() on every pin change.
        // This handles E edges, nibble counting, reads, and writes
        // identically to how the board simulation would.
        model.update(lcdPart, lcd, read, tNs);

        // When the LCD drives data pins (read mode), feed them back to
        // the VIA as inputs. The LCD model sets state.drives for d4-d7
        // during read operations (when RW=1 and E=1).
        if (lcd.drives.d4 || lcd.drives.d5 || lcd.drives.d6 || lcd.drives.d7) {
            for (let i = 0; i < 4; i++) {
                const drive = lcd.drives[`d${i + 4}`];
                if (drive) {
                    const lvl = drive.vTh > 2.5 ? 1 : 0;
                    m.chips.via1.setInput('b', i, lvl);
                }
            }
        }
    },
});

m.loadRom(readFileSync(romPath), 0x8000);
m.reset();

// Drive port A low (no devices attached to PA).
for (let b = 0; b < 8; b++) m.chips.via1.setInput('a', b, 0);

// Boot: 4s machine time covers LCD init + BASIC cold start.
m.advanceToMs(4000);

const checks = [];
const expect = (what, ok, detail) => checks.push({ what, ok, detail });

// ── Serial (ACIA) checks ──────────────────────────────────────────────
expect('banner', /BeebEater Computer 16K/.test(out), out.slice(0, 80));
expect('BASIC announces itself', /BASIC/.test(out));
expect('prompt', />/.test(out));

const type = (s) => {
    for (const ch of s) {
        m.chips.acia1.rxPush(ch.charCodeAt(0));
        m.advanceToMs(m.tMs + (ch === '\r' ? 300 : 30));
    }
};
type('PRINT 2+2\r');
m.advanceToMs(m.tMs + 500);
expect('arithmetic (BBC right-aligned field)', / {9}4\n/.test(out));

type('10 FOR I=1 TO 3\r');
type('20 PRINT "HI";I\r');
type('30 NEXT I\r');
type('RUN\r');
m.advanceToMs(m.tMs + 2000);
expect('a stored program runs', /HI1\n\rHI2\n\rHI3\n/.test(out));

// ── LCD text state checks ──────────────────────────────────────────────
expect('LCD in 4-bit mode', lcd.is4Bit);
expect('LCD display on', lcd.displayOn);
// Note: lcd.twoLine may be false — the BeebEater's 4-bit init sends the
// function set (0x28) while the LCD is still in 8-bit mode, where D3 (the
// N bit for 2-line) is physically unconnected and reads as 0. On real
// hardware, most 16×2 modules operate in 2-line mode regardless. The
// DDRAM addressing (0x00-0x27 / 0x40-0x67) works correctly either way,
// so text content on both lines is the meaningful assertion.

const hasContent = lcd.text[0].trim().length > 0 || lcd.text[1].trim().length > 0;
expect('LCD has content after boot', hasContent,
    `line1="${lcd.text[0]}" line2="${lcd.text[1]}"`);

// The boot message writes to the LCD — verify visible text
const allText = lcd.text.join('');
expect('LCD shows boot text', /[A-Za-z]/.test(allText),
    `text="${allText}"`);

// Cleanup
try { unregisterDevice('hd44780'); } catch {}

// Report
let bad = 0;
for (const c of checks) {
    const suffix = c.detail ? ` (${c.detail})` : '';
    console.log(`${c.ok ? 'ok ' : 'FAIL'}  ${c.what}${c.ok ? '' : suffix}`);
    if (!c.ok) bad++;
}
if (!bad) {
    console.log(`\nBBC BASIC is alive on the machine (${(m.tMs / 1000).toFixed(1)} machine-seconds).`);
    console.log(`LCD line 1: "${lcd.text[0]}"`);
    console.log(`LCD line 2: "${lcd.text[1]}"`);
}
process.exit(bad ? 1 : 0);
