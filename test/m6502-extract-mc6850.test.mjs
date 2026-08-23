// E5.1, first SELECT-vocabulary addition: the MC6850 on the 6502 bus.
// The fixture drops the 6850 into the canonical decode's $4000-$4FFF
// hole (the address range the base fixture notes as open bus):
//
//   cs2b = NAND(~A15, A14)   — low exactly when A15=0 & A14=1 (g4, shared
//                              with the VIA, which also wants that window)
//   cs1  = ~A13              — high when A13=0 (glue2 g2, shared)
//   cs0  = ~A12              — high when A12=0 (glue2 g4, new)
//   rs   = A0                — the one register select rides A0
//
// So the 6850 answers at A15=0,A14=1,A13=0,A12=0 = $4000-$4FFF, beside
// the W65C51 at $5000 — two ACIA generations decoded on one board.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extract6502Machine } from '../src/m6502-extract.js';
import { M6502Machine } from '../src/m6502-machine.js';

function circuitWith6850() {
    const parts = [
        { id: 'cpu1', kind: 'w65c02' },
        { id: 'ram1', kind: '62256' },
        { id: 'rom1', kind: '28c256' },
        { id: 'via1', kind: 'w65c22' },
        { id: 'acia1', kind: 'w65c51' },
        { id: 'uart1', kind: 'mc6850' },
        { id: 'glue1', kind: '74hc00' },
        { id: 'glue2', kind: '74hc00' },
    ];
    const wires = [];
    const w = (from, ft, to, tt) => wires.push({ from, fromTerminal: ft, to, toTerminal: tt });
    for (let i = 0; i <= 14; i++) {
        w('cpu1', `a${i}`, 'ram1', `a${i}`);
        w('cpu1', `a${i}`, 'rom1', `a${i}`);
    }
    for (let i = 0; i <= 3; i++) w('cpu1', `a${i}`, 'via1', `rs${i}`);
    for (let i = 0; i <= 1; i++) w('cpu1', `a${i}`, 'acia1', `rs${i}`);
    w('cpu1', 'a0', 'uart1', 'rs');
    // g1: ~A15; g2: ~A14; g3: RAM.CSB = NAND(~A15,~A14); ROM.CEB = ~A15
    w('cpu1', 'a15', 'glue1', '1a'); w('cpu1', 'a15', 'glue1', '1b');
    w('cpu1', 'a14', 'glue1', '2a'); w('cpu1', 'a14', 'glue1', '2b');
    w('glue1', '1y', 'glue1', '3a'); w('glue1', '2y', 'glue1', '3b');
    w('glue1', '3y', 'ram1', 'csb');
    w('glue1', '1y', 'rom1', 'ceb');
    // g4: NAND(~A15, A14) → VIA.CS2B and the 6850's /CS2 alike.
    w('glue1', '1y', 'glue1', '4a'); w('cpu1', 'a14', 'glue1', '4b');
    w('glue1', '4y', 'via1', 'cs2b');
    w('glue1', '4y', 'uart1', 'cs2b');
    w('cpu1', 'a13', 'via1', 'cs1');
    // glue2 g1: ~g4; g2: ~A13; g3: ACIA.CS1B = NAND(~g4, ~A13); ACIA.CS0 = A12
    w('glue1', '4y', 'glue2', '1a'); w('glue1', '4y', 'glue2', '1b');
    w('cpu1', 'a13', 'glue2', '2a'); w('cpu1', 'a13', 'glue2', '2b');
    w('glue2', '1y', 'glue2', '3a'); w('glue2', '2y', 'glue2', '3b');
    w('glue2', '3y', 'acia1', 'cs1b');
    w('cpu1', 'a12', 'acia1', 'cs0');
    // The 6850's two high selects: cs1 = ~A13 (shared g2), cs0 = ~A12 (g4, new).
    w('glue2', '2y', 'uart1', 'cs1');
    w('cpu1', 'a12', 'glue2', '4a'); w('cpu1', 'a12', 'glue2', '4b');
    w('glue2', '4y', 'uart1', 'cs0');
    return { parts, wires };
}

test('the 6850 extracts into the decode hole beside the W65C51', () => {
    const r = extract6502Machine(circuitWith6850());
    assert.ok(r.ok, r.reasons.join('; '));
    const uart = r.chips.find((c) => c.name === 'uart1');
    assert.deepEqual(uart, { kind: 'acia6850', name: 'uart1', at: 0x4000, span: 0x1000 });
    // The neighbours keep their windows — adding vocabulary must not
    // move anyone else.
    assert.deepEqual(r.chips.find((c) => c.name === 'acia1'),
        { kind: 'acia', name: 'acia1', at: 0x5000, span: 0x1000 });
    assert.deepEqual(r.chips.find((c) => c.name === 'via1'),
        { kind: 'via', name: 'via1', at: 0x6000, span: 0x2000 });
    assert.ok(r.lines.includes('CHIP uart1 = MC6850 AT $4000'),
        `expected the MC6850 CHIP line, got: ${JSON.stringify(r.lines)}`);
    assert.ok(r.notes.some((n) => /uart1 mirrors through \$4000-\$4FFF/.test(n)),
        'the coarse decode is noted as a mirror, not silently absorbed');
});

test('a floating 6850 select refuses instead of guessing', () => {
    const c = circuitWith6850();
    c.wires = c.wires.filter((w) => !(w.to === 'uart1' && w.toTerminal === 'cs1'));
    const r = extract6502Machine(c);
    assert.equal(r.ok, false);
    assert.match(r.reasons.join(';'), /uart1\.cs1 is undriven/);
});

test('a 6850 wired over the W65C51 is contention with the address named', () => {
    const c = circuitWith6850();
    // Give the 6850 the ACIA's window: cs0 = A12 instead of ~A12.
    c.wires = c.wires.filter((w) => !(w.to === 'uart1' && w.toTerminal === 'cs0'));
    c.wires.push({ from: 'cpu1', fromTerminal: 'a12', to: 'uart1', toTerminal: 'cs0' });
    const r = extract6502Machine(c);
    assert.equal(r.ok, false);
    assert.match(r.reasons.join(';'), /bus contention at \$5000/);
    assert.match(r.reasons.join(';'), /uart1/);
});

test('the machine runs the extracted 6850: memory-mapped tx and rx', () => {
    const r = extract6502Machine(circuitWith6850());
    assert.ok(r.ok, r.reasons.join('; '));
    const sent = [];
    const m = new M6502Machine(
        { clockHz: 1_000_000, regions: r.regions, chips: r.chips },
        { onSerial: (b) => sent.push(b) });
    // TX: a store to the data register ($4001) leaves through onSerial.
    m._write(0x4001, 0x42);
    assert.deepEqual(sent, [0x42]);
    // RX: a pushed byte raises RDRF in status ($4000) and reads back once.
    m.chips.uart1.rxPush(0x55);
    assert.equal(m._read(0x4000) & 0x01, 0x01, 'RDRF set');
    assert.equal(m._read(0x4001), 0x55, 'the byte comes off the data register');
    assert.equal(m._read(0x4000) & 0x01, 0x00, 'RDRF clears after the read');
    // The coarse decode mirrors through the window, like the silicon.
    m.chips.uart1.rxPush(0x66);
    assert.equal(m._read(0x4ffd), 0x66, 'mirror at $4FFD reads the data register');
});
