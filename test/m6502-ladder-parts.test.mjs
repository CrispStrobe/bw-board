// The ladder's two new input/output parts, golden-tested: the 74C922
// keypad encoder (the KIM-1 rung — DA on CA1, code on PA0-PA3) and the
// 74HC374 latch port (the pre-VIA output rung, partial-decoded window).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { M74C922, keypadOnVia } from '../src/m74c922.js';
import { M6502Machine, EATER6502 } from '../src/m6502-machine.js';

test('74C922: code/DA behavior incl. two-key rollover and /OE', () => {
    const events = [];
    const k = new M74C922({ onChange: (code, da) => events.push([code, da]) });
    assert.equal(k.da, 0);

    k.press(0x0b);
    assert.deepEqual(events.at(-1), [0x0b, 1], 'key registered, DA up');

    k.press(0x05);
    assert.equal(k.code, 0x0b, 'second key ignored while first held');
    assert.equal(events.length, 1, 'no event for the ignored press');

    k.release(0x0b);
    // DA must fall and rise again so an edge-triggered CA1 sees key #2.
    assert.deepEqual(events.slice(-2), [[0, 0], [0x05, 1]]);

    k.release(0x05);
    assert.equal(k.da, 0);

    k.setOeb(1);
    assert.equal(k.code, 0xf, 'three-stated outputs read pulled-up');
    k.setOeb(0);
});

// org $8000 on EATER6502: PA as inputs, CA1 rising edge, stale flag
// cleared by reading PORTA (the power-on hazard is real hardware's too),
// then IRQ-driven capture: ISR reads PORTA, stores code at $00, counts
// interrupts at $01. Clean-room; the builds' own ROMs do the same dance.
const KEYPAD_ROM = [
    0xa9, 0x00, 0x8d, 0x03, 0x60,             // LDA #0   / STA DDRA
    0xa9, 0x01, 0x8d, 0x0c, 0x60,             // LDA #1   / STA PCR    CA1 rising
    0xad, 0x01, 0x60,                         // LDA PORTA             clear stale CA1
    0xa9, 0x82, 0x8d, 0x0e, 0x60,             // LDA #$82 / STA IER    enable CA1
    0x58,                                     // CLI
    0x4c, 0x13, 0x80,                         // loop: JMP loop
    0x48,                                     // isr: PHA
    0xad, 0x01, 0x60,                         // LDA PORTA             clears the flag
    0x29, 0x0f,                               // AND #$0F
    0x85, 0x00,                               // STA $00
    0xe6, 0x01,                               // INC $01
    0x68,                                     // PLA
    0x40,                                     // RTI
];

test('keypad on EATER6502: DA on CA1 interrupts, rollover reaches the ISR', () => {
    const m = new M6502Machine(EATER6502, {});
    m.loadRom(KEYPAD_ROM);
    m.mem[0xfffc] = 0x00; m.mem[0xfffd] = 0x80;
    m.mem[0xfffe] = 0x16; m.mem[0xffff] = 0x80;
    const enc = keypadOnVia(m.chips.via1);
    m.reset();
    for (let i = 0; i < 60; i++) m.step();          // init + settle in the loop
    assert.equal(m.mem[0x01], 0, 'no phantom interrupt from wiring-time edges');

    enc.press(0x0b);
    for (let i = 0; i < 40; i++) m.step();
    assert.equal(m.mem[0x00], 0x0b, 'ISR captured the key code off PA0-PA3');
    assert.equal(m.mem[0x01], 1);

    enc.press(0x05);                                 // rollover: held-key shadow
    for (let i = 0; i < 40; i++) m.step();
    assert.equal(m.mem[0x01], 1, 'ignored while the first key is held');

    enc.release(0x0b);                               // DA re-strobes for key #2
    for (let i = 0; i < 40; i++) m.step();
    assert.equal(m.mem[0x00], 0x05);
    assert.equal(m.mem[0x01], 2);

    enc.release(0x05);
    for (let i = 0; i < 40; i++) m.step();
    assert.equal(m.mem[0x01], 2, 'release alone is no keypress');
});

// The cool-web-shape output rung: a '374 owning a $1000 window through
// partial decode. org $8000: pattern to $7000, then to a mirror address.
const LATCH_ROM = [
    0xa9, 0xaa, 0x8d, 0x00, 0x70,             // LDA #$AA / STA $7000
    0xa9, 0x55, 0x8d, 0xbc, 0x7a,             // LDA #$55 / STA $7ABC  (mirror)
    0xdb,                                     // STP
];

test('latch port: write-only LED byte, mirrored through its window', () => {
    const pins = [];
    const m = new M6502Machine({
        clockHz: 1_000_000,
        regions: [
            { kind: 'ram', start: 0x0000, end: 0x3fff },
            { kind: 'rom', start: 0x8000, end: 0xffff },
        ],
        chips: [{ kind: 'latch', name: 'leds', at: 0x7000, span: 0x1000 }],
    }, { onPinChange: (pin, level) => pins.push([pin, level]) });
    m.loadRom(LATCH_ROM);
    m.mem[0xfffc] = 0x00; m.mem[0xfffd] = 0x80;
    m.reset();
    for (let i = 0; i < 20 && !m.cpu.stopped; i++) m.step();

    assert.equal(m.chips.leds.value, 0x55, 'the mirror write landed');
    const q1 = pins.filter(([p]) => p === 'leds.Q1').map(([, l]) => l);
    assert.deepEqual(q1, [1, 0], 'Q1: up on $AA, down on $55');
    const q0 = pins.filter(([p]) => p === 'leds.Q0').map(([, l]) => l);
    assert.deepEqual(q0, [1], 'Q0: only the $55 write raised it');

    assert.equal(m.cpu.read(0x7000), 0xff, 'reading the latch is open bus');
});
