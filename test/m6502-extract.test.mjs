// The bus extractor: the canonical breadboard decode, wired by hand as a
// netlist, must come back as the machine config — and the two failures a
// real breadboard punishes (bus contention, open vectors) must refuse
// with addresses named, not half-work.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extract6502Machine } from '../src/m6502-extract.js';

// The classic decode, two 74HC00s:
//   g1: ~A15            g2: ~A14           g3: RAM.CSB = NAND(~A15,~A14)
//   g4: VIA.CS2B = NAND(~A15, A14)         ROM.CSB = ~A15 (g1 reused)
//   g5: ~g4 (= ~A15 & A14)  g6: ~A13       g7: ACIA.CS1B = NAND(g5, ~A13)
//   VIA.CS1 = A13 (direct)   ACIA.CS0 = A12 (direct)
// RAM $0000-$3FFF, ACIA $5000 (mirrored to $5FFF), VIA $6000 (to $7FFF),
// ROM $8000-$FFFF.
function eaterCircuit() {
    const parts = [
        { id: 'cpu1', kind: 'w65c02' },
        { id: 'ram1', kind: '62256' },
        { id: 'rom1', kind: '28c256' },
        { id: 'via1', kind: 'w65c22' },
        { id: 'acia1', kind: 'w65c51' },
        { id: 'glue1', kind: '74hc00' },
        { id: 'glue2', kind: '74hc00' },
    ];
    const wires = [];
    const w = (from, ft, to, tt) => wires.push({ from, fromTerminal: ft, to, toTerminal: tt });
    // Address bus, straight, to RAM/ROM (a0-a14).
    for (let i = 0; i <= 14; i++) {
        w('cpu1', `a${i}`, 'ram1', `a${i}`);
        w('cpu1', `a${i}`, 'rom1', `a${i}`);
    }
    // Register selects ride the low address lines.
    for (let i = 0; i <= 3; i++) w('cpu1', `a${i}`, 'via1', `rs${i}`);
    for (let i = 0; i <= 1; i++) w('cpu1', `a${i}`, 'acia1', `rs${i}`);
    // g1: ~A15
    w('cpu1', 'a15', 'glue1', '1a'); w('cpu1', 'a15', 'glue1', '1b');
    // g2: ~A14
    w('cpu1', 'a14', 'glue1', '2a'); w('cpu1', 'a14', 'glue1', '2b');
    // g3: RAM.CSB = NAND(~A15, ~A14)
    w('glue1', '1y', 'glue1', '3a'); w('glue1', '2y', 'glue1', '3b');
    w('glue1', '3y', 'ram1', 'csb');
    // ROM.CSB = ~A15
    w('glue1', '1y', 'rom1', 'ceb');
    // g4: VIA.CS2B = NAND(~A15, A14); VIA.CS1 = A13
    w('glue1', '1y', 'glue1', '4a'); w('cpu1', 'a14', 'glue1', '4b');
    w('glue1', '4y', 'via1', 'cs2b');
    w('cpu1', 'a13', 'via1', 'cs1');
    // g5: ~g4; g6: ~A13; g7: ACIA.CS1B = NAND(g5, g6); ACIA.CS0 = A12
    w('glue1', '4y', 'glue2', '1a'); w('glue1', '4y', 'glue2', '1b');
    w('cpu1', 'a13', 'glue2', '2a'); w('cpu1', 'a13', 'glue2', '2b');
    w('glue2', '1y', 'glue2', '3a'); w('glue2', '2y', 'glue2', '3b');
    w('glue2', '3y', 'acia1', 'cs1b');
    w('cpu1', 'a12', 'acia1', 'cs0');
    return { parts, wires };
}

test('the hand-wired canonical decode extracts to the machine config', () => {
    const r = extract6502Machine(eaterCircuit());
    assert.ok(r.ok, r.reasons.join('; '));
    assert.deepEqual(r.regions, [
        { kind: 'ram', start: 0x0000, end: 0x3fff },
        { kind: 'rom', start: 0x8000, end: 0xffff },
    ]);
    assert.deepEqual(r.chips, [
        { kind: 'via', name: 'via1', at: 0x6000 },
        { kind: 'acia', name: 'acia1', at: 0x5000 },
    ]);
    assert.deepEqual(r.lines, [
        'MAP RAM $0000-$3FFF',
        'MAP ROM $8000-$FFFF',
        'CHIP via1 = W65C22 AT $6000',
        'CHIP acia1 = W65C51 AT $5000',
    ]);
    assert.ok(r.notes.some((n) => /via1 mirrors through \$6000-\$7FFF/.test(n)),
        `expected the mirror note, got: ${JSON.stringify(r.notes)}`);
    assert.ok(r.notes.some((n) => /\$4000/.test(n) || /open bus/.test(n)),
        'the $4000-$4FFF hole is noted as open bus');
});

test('a mis-wired select is bus contention with the address named', () => {
    const c = eaterCircuit();
    // Wire VIA.CS2B to ground: the VIA now answers wherever A13 is high —
    // including inside the ROM. On the bench this is two chips fighting.
    c.parts.push({ id: 'gnd1', kind: 'gnd' });
    c.wires = c.wires.filter((w) => !(w.to === 'via1' && w.toTerminal === 'cs2b'));
    c.wires.push({ from: 'gnd1', fromTerminal: 'gnd', to: 'via1', toTerminal: 'cs2b' });
    const r = extract6502Machine(c);
    assert.equal(r.ok, false);
    assert.match(r.reasons.join(';'), /bus contention at \$[0-9a-f]{4}/);
    assert.match(r.reasons.join(';'), /via1/);
});

test('a machine whose ROM misses the vectors refuses to pretend it boots', () => {
    const c = eaterCircuit();
    c.parts = c.parts.filter((p) => p.id !== 'rom1');
    c.wires = c.wires.filter((w) => w.from !== 'rom1' && w.to !== 'rom1');
    const r = extract6502Machine(c);
    assert.equal(r.ok, false);
    assert.match(r.reasons.join(';'), /\$FFFA/);
});

test('a floating chip select refuses instead of guessing', () => {
    const c = eaterCircuit();
    c.wires = c.wires.filter((w) => !(w.to === 'acia1' && w.toTerminal === 'cs0'));
    const r = extract6502Machine(c);
    assert.equal(r.ok, false);
    assert.match(r.reasons.join(';'), /acia1\.cs0 is undriven/);
});

test('a permuted address bus refuses rather than scrambling bytes', () => {
    const c = eaterCircuit();
    // Swap A0/A1 into the ROM.
    c.wires = c.wires.filter((w) => !(w.to === 'rom1' && (w.toTerminal === 'a0' || w.toTerminal === 'a1')));
    c.wires.push({ from: 'cpu1', fromTerminal: 'a0', to: 'rom1', toTerminal: 'a1' });
    c.wires.push({ from: 'cpu1', fromTerminal: 'a1', to: 'rom1', toTerminal: 'a0' });
    const r = extract6502Machine(c);
    assert.equal(r.ok, false);
    assert.match(r.reasons.join(';'), /rom1\.a0.*straight/);
});
