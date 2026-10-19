// vsync → NMI (config {kind:'simplevga', nmi:true}) — the Bad Apple
// pacing hookup: the VGA frame pulse on the 6502's NMI pin. Oracle
// arithmetic: the frame pulse is a 60 Hz square (machine-time derived),
// one FALLING edge per frame → the NMI counter advances 60/second.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { M6502Machine } from '../src/m6502-machine.js';

test('the frame pulse fires NMI once per frame', () => {
    const rom = new Uint8Array(0x8000).fill(0xea);
    rom.set([0x4c, 0x00, 0x80], 0x0000);        // main: jmp main
    rom.set([0xe6, 0x10, 0x40], 0x0005);        // nmi: inc $10, rti
    rom.set([0x05, 0x80, 0x00, 0x80, 0x05, 0x80], 0x7ffa); // NMI/RESET/IRQ
    const m = new M6502Machine({
        clockHz: 1_000_000,
        regions: [
            { kind: 'ram', start: 0x0000, end: 0x3fff },
            { kind: 'rom', start: 0x8000, end: 0xffff },
        ],
        chips: [
            { kind: 'via', name: 'via1', at: 0x6000 },
            { kind: 'simplevga', name: 'vga1', nmi: true },
        ],
    }, {});
    m.loadRom(rom, 0x8000);
    m.cpu.pc = 0x8000;
    m.advanceToMs(500);
    const frames = m.mem[0x10];
    assert.ok(frames >= 28 && frames <= 32,
        `expected ~30 NMIs in 500 ms at 60 Hz, got ${frames}`);
});

test('without nmi:true the pulse stays a PA4 signal only', () => {
    const rom = new Uint8Array(0x8000).fill(0xea);
    rom.set([0x4c, 0x00, 0x80], 0x0000);
    rom.set([0xe6, 0x10, 0x40], 0x0005);
    rom.set([0x05, 0x80, 0x00, 0x80, 0x05, 0x80], 0x7ffa);
    const m = new M6502Machine({
        clockHz: 1_000_000,
        regions: [
            { kind: 'ram', start: 0x0000, end: 0x3fff },
            { kind: 'rom', start: 0x8000, end: 0xffff },
        ],
        chips: [
            { kind: 'via', name: 'via1', at: 0x6000 },
            { kind: 'simplevga', name: 'vga1' },
        ],
    }, {});
    m.loadRom(rom, 0x8000);
    m.cpu.pc = 0x8000;
    m.advanceToMs(200);
    assert.equal(m.mem[0x10], 0);
});
