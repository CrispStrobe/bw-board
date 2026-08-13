// The composable Z80 machine on the SEARLE preset: a hand-assembled ROM
// prints over the MC6850 and echoes input — the canonical breadboard
// shape (ROM low, RAM high, ACIA at ports $80/$81) exercised end to end
// on the vector-complete core.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Z80Machine, SEARLE } from '../src/z80-machine.js';

// org 0: ACIA master reset + config, print "Z80!", then echo forever.
const ROM = [
    0x3e, 0x03, 0xd3, 0x80,       // LD A,3 / OUT ($80),A   master reset
    0x3e, 0x02, 0xd3, 0x80,       // LD A,2 / OUT ($80),A   ÷64
    0x21, 0x1f, 0x00,             // LD HL,msg
    0x7e, 0xb7, 0x28, 0x05,       // loop: LD A,(HL) / OR A / JR Z,echo
    0xd3, 0x81, 0x23, 0x18, 0xf7, // OUT ($81),A / INC HL / JR loop
    0xdb, 0x80, 0x0f, 0x30, 0xfb, // echo: IN A,($80) / RRCA / JR NC,echo
    0xdb, 0x81, 0xd3, 0x81,       // IN A,($81) / OUT ($81),A
    0x18, 0xf5,                    // JR echo
    0x5a, 0x38, 0x30, 0x21, 0x00, // "Z80!",0
];

test('SEARLE machine: ROM prints over the 6850 and echoes input', () => {
    let out = '';
    const m = new Z80Machine(SEARLE, {
        onSerial: (b) => { out += String.fromCharCode(b); },
    });
    m.load(Uint8Array.from(ROM), 0);
    m.advanceToMs(5);
    assert.equal(out, 'Z80!');
    m.chips.acia1.rxPush(0x41);
    m.advanceToMs(m.tMs + 2);
    assert.equal(out, 'Z80!A', 'the poll loop echoes typed input');
    // ROM region rejects bus writes; RAM accepts them.
    m.cpu.write(0x0000, 0x99);
    assert.equal(m.mem[0x0000], 0x3e, 'ROM is write-protected on the bus');
    m.cpu.write(0x2000, 0x99);
    assert.equal(m.mem[0x2000], 0x99);
});

test('IM 1 delivery: an ACIA RX interrupt reaches RST $38', () => {
    // EI + HALT; the $38 handler reads the data register (clearing IRQ),
    // echoes it, and returns to the HALT loop.
    const rom = new Uint8Array(0x100);
    rom.set([0x3e, 0x03, 0xd3, 0x80,       // reset ACIA
        0x3e, 0x82, 0xd3, 0x80,             // control: RX IRQ enable (bit7) + ÷64
        0xfb, 0x76, 0x18, 0xfd], 0);        // EI / HALT / JR halt
    rom.set([0xdb, 0x81, 0xd3, 0x81, 0xfb, 0xed, 0x4d], 0x38); // IN,($81)/OUT/EI/RETI
    let out = '';
    const m = new Z80Machine(SEARLE, { onSerial: (b) => { out += String.fromCharCode(b); } });
    m.load(rom, 0);
    m.advanceToMs(2);
    m.chips.acia1.rxPush(0x51);   // 'Q'
    m.advanceToMs(m.tMs + 2);
    assert.equal(out, 'Q', 'interrupt woke HALT, handler echoed');
});
