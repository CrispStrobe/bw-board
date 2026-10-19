// PS/2, held to goldens: the frame logic is exercised end-to-end (the
// capture reconstructs bytes from the LSB-first stream and checks odd
// parity — no shortcut), and the KiT-shape machine golden types on a
// live KIT1 with an IRQ-driven ISR collecting make/break sequences.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PS2Keyboard, PS2Capture, ps2OnVia, SCAN_CODES } from '../src/ps2.js';
import { M6502Machine, KIT1 } from '../src/m6502-machine.js';

test('frame logic: bytes survive the shift chain, parity checked, pacing paces', () => {
    const kbd = new PS2Keyboard();
    const got = [];
    const cap = new PS2Capture(kbd, {
        gapCycles: 100,
        onByte: (b, ok) => got.push([b, ok]),
    });

    kbd.keyDown('a'); kbd.keyUp('a');            // 1C, F0, 1C
    cap.advance(99);
    assert.equal(got.length, 0, 'nothing before the inter-frame gap');
    cap.advance(1);
    assert.deepEqual(got, [[0x1c, true]]);
    cap.advance(100); cap.advance(100);
    assert.deepEqual(got, [[0x1c, true], [0xf0, true], [0x1c, true]]);

    // Extended key: E0 prefix then the code.
    kbd.keyDown('up');
    cap.advance(100); cap.advance(100);
    assert.deepEqual(got.slice(3).map(([b]) => b), [0xe0, 0x75]);

    // Every scan code round-trips the serializer/deserializer pair.
    for (const code of Object.values(SCAN_CODES)) {
        const { value, parityOk } = cap._shiftFrame(code);
        assert.equal(value, code);
        assert.equal(parityOk, true);
    }

    // DA re-strobes per frame — an edge-triggered CA1 sees every byte.
    const edges = [];
    const kbd2 = new PS2Keyboard();
    const cap2 = new PS2Capture(kbd2, { gapCycles: 10, onDa: (l) => edges.push(l) });
    kbd2.type('ab');
    for (let i = 0; i < 6; i++) cap2.advance(10);
    assert.equal(edges.filter((l) => l === 1).length, 6, 'six frames, six rising edges');
});

// org $8000 on KIT1: VIA at $7800, PA inputs, CA1 rising edge; the ISR
// stores each captured byte into a buffer at $0200 and bumps $00.
// The classic PS/2 monitor loop, clean-roomed to its register accesses.
const PS2_ROM = [
    0xa9, 0x00, 0x8d, 0x03, 0x78,             // LDA #0   / STA DDRA
    0xa9, 0x01, 0x8d, 0x0c, 0x78,             // LDA #1   / STA PCR    CA1 rising
    0xad, 0x01, 0x78,                         // LDA PORTA             clear stale flag
    0xa9, 0x82, 0x8d, 0x0e, 0x78,             // LDA #$82 / STA IER
    0xa2, 0x00, 0x86, 0x00,                   // LDX #0   / STX $00
    0x58,                                     // CLI
    0x4c, 0x16, 0x80,                         // loop: JMP loop
    0x48, 0x8a, 0x48,                         // isr: PHA / TXA / PHA
    0xa6, 0x00,                               // LDX $00
    0xad, 0x01, 0x78,                         // LDA PORTA             the byte; clears CA1
    0x9d, 0x00, 0x02,                         // STA $0200,X
    0xe6, 0x00,                               // INC $00
    0x68, 0xaa, 0x68,                         // PLA / TAX / PLA
    0x40,                                     // RTI
];

test('KIT1 + PS/2 chain: typed keys arrive as make/break sequences by IRQ', () => {
    const m = new M6502Machine(KIT1, {});
    m.loadRom(PS2_ROM);
    m.mem[0xfffc] = 0x00; m.mem[0xfffd] = 0x80;
    m.mem[0xfffe] = 0x1a; m.mem[0xffff] = 0x80;
    const kbd = new PS2Keyboard();
    m.attachDevice('ps2', ps2OnVia(kbd, m.chips.via1, { gapCycles: 800 }));
    m.reset();
    for (let i = 0; i < 200; i++) m.step();
    assert.equal(m.mem[0x00], 0, 'quiet keyboard, quiet ISR');

    kbd.keyDown('k'); kbd.keyUp('k');
    kbd.keyDown('enter'); kbd.keyUp('enter');
    // ~6 frames × 800 cycles of pacing, ~2-6 cycles per instruction.
    for (let i = 0; i < 4000 && m.mem[0x00] < 6; i++) m.step();

    const n = m.mem[0x00];
    const buf = Array.from(m.mem.slice(0x0200, 0x0200 + n));
    assert.deepEqual(buf, [0x42, 0xf0, 0x42, 0x5a, 0xf0, 0x5a],
        'make k, break k, make enter, break enter — Code Set 2');

    // The pacing left the ISR comfortable: no byte was lost.
    assert.equal(n, 6);
});
