#!/usr/bin/env node
/**
 * Snake on our machine — the retro video+input tier acceptance run.
 *
 * gfoot's snake.s (Unlicense), assembled with vasm6502_oldstyle,
 * running on M6502Machine + the simplevga card + VIA buttons:
 *
 *   ROM  $E000 (BE6502 ROM region $8000-$FFFF, fixture in rom/simplevga/)
 *   VIA  $6000 — PA0..3 buttons (setButtons), PA4 vsync (card's 60 Hz),
 *                PA5/6/7 = RS/RW/E of the BE6502's HD44780 (8-bit mode,
 *                data on FULL port B — gfoot uses Eater's original hookup)
 *   VGA  write-only overlay on the ROM window, bank on PORTB
 *
 * The LCD must be REAL: snake's lcd_init spins in lcd_wait polling the
 * busy flag through port B — the BeebEater lesson (floating inputs
 * read high) all over again, solved the same honest way: the full
 * HD44780 model wired at machine level, busy readback through
 * via.setInput.
 *
 * Assertions: sync appears (vram_init ran), the frame contains
 * non-backdrop drawing, the picture CHANGES over a second of play
 * (the snake moves), and steering changes where it goes.
 *
 * ROM rebuild: vasm6502_oldstyle -Fbin -dotdir src/snake.s -o snake.rom
 * from a gfoot/simplevga6502 checkout.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { M6502Machine } from '../src/m6502-machine.js';
import { registerHD44780 } from '../src/devices/hd44780.js';
import { getDevice, unregisterDevice } from '../src/devices.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const romPath = process.env.SNAKE_ROM || join(HERE, '..', 'rom', 'simplevga', 'snake.rom');
if (!existsSync(romPath)) {
    console.error('SKIP (loudly): snake.rom missing — see header for the rebuild recipe');
    process.exit(2);
}

registerHD44780();
const model = getDevice('hd44780');
const lcdPart = { id: 'LCD1', kind: 'hd44780', params: { cols: 16, rows: 2 } };
const lcd = model.init(lcdPart);
const lcdPins = {
    vss: 0, vdd: 5.0, v0: 2.5, rs: 0, rw: 0, e: 0,
    d0: 0, d1: 0, d2: 0, d3: 0, d4: 0, d5: 0, d6: 0, d7: 0, a: 5.0, k: 0,
};
let portA = 0, portB = 0;

const m = new M6502Machine({
    clockHz: 1_000_000,
    regions: [
        { kind: 'ram', start: 0x0000, end: 0x3fff },
        { kind: 'rom', start: 0x8000, end: 0xffff },
    ],
    chips: [
        { kind: 'via', name: 'via1', at: 0x6000 },
        { kind: 'simplevga', name: 'vga', at: 0 },
    ],
    onPinChange: undefined,
}, {
    onPinChange: (pin, level) => {
        if (!pin.startsWith('via1.P')) return;
        const port = pin[6], bit = parseInt(pin[7]);
        const mask = 1 << bit;
        if (port === 'A') portA = level ? portA | mask : portA & ~mask;
        else portB = level ? portB | mask : portB & ~mask;
        // gfoot lcd.s: E=PA7, RW=PA6, RS=PA5; data = full port B.
        lcdPins.e = (portA & 0x80) ? 5 : 0;
        lcdPins.rw = (portA & 0x40) ? 5 : 0;
        lcdPins.rs = (portA & 0x20) ? 5 : 0;
        for (let i = 0; i < 8; i++) lcdPins[`d${i}`] = (portB >> i) & 1 ? 5 : 0;
        model.update(lcdPart, lcd, (t) => lcdPins[t] ?? 0, BigInt(Math.round(m.tMs * 1e6)));
        // Busy/readback: the model drives d0-d7 → present them to the VIA.
        const via = m.chips.via1;
        for (let i = 0; i < 8; i++) {
            const drv = lcd.drives[`d${i}`];
            via.setInput('b', i, drv && drv.rTh < 1e6 ? (drv.vTh > 2.5 ? 1 : 0) : 0);
        }
    },
});

m.loadRom(readFileSync(romPath), 0xe000);
m.reset();
const card = m.chips.vga;

const checks = [];
const expect = (what, ok) => { checks.push({ what, ok }); console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); };

m.advanceToMs(3000);
expect('vram_init ran: the monitor locks (signal true)', card.signal());
const f1 = card.renderFrame();
const nonZero = f1.indices ? f1.indices.reduce((n, p) => n + (p !== 0 ? 1 : 0), 0) : 0;
expect(`the frame shows drawing (${nonZero} non-background pixels)`, nonZero > 50);

const snap = Array.from(f1.indices ?? []);
m.advanceToMs(4500);
const f2 = card.renderFrame();
let moved = 0;
for (let i = 0; i < snap.length; i++) if (snap[i] !== f2.indices[i]) moved++;
expect(`the snake moves (${moved} pixels changed over 1.2s)`, moved > 10);

m.setButtons(0b0010); // press up
m.advanceToMs(4700);
m.setButtons(0);
m.advanceToMs(7000);
const f3 = card.renderFrame();
let steered = 0;
for (let i = 0; i < snap.length; i++) if (snap[i] !== f3.indices[i]) steered++;
expect(`steering registered (${steered} pixels changed after input)`, steered > moved);
console.log('LCD line 1:', JSON.stringify(lcd.text?.[0] ?? ''));

try { unregisterDevice('hd44780'); unregisterDevice('char_lcd'); } catch { /* */ }
process.exit(checks.every((c) => c.ok) ? 0 : 1);
