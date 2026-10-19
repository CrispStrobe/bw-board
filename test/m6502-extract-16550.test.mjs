// E5.1: the NS16C550 through the DRAWN decode. The machine has run
// 'uart16550' from MAP/CHIP declarations since the config grammar grew
// the kind — what was missing was the extractor entry, so a hand-wired
// 16550 decode reached nothing. Same fixture geometry as the 6850
// slice: the UART takes the canonical decode's $4000-$4FFF hole.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extract6502Machine } from '../src/m6502-extract.js';
import { M6502Machine } from '../src/m6502-machine.js';

function circuitWith16550() {
    const parts = [
        { id: 'cpu1', kind: 'w65c02' },
        { id: 'ram1', kind: '62256' },
        { id: 'rom1', kind: '28c256' },
        { id: 'via1', kind: 'w65c22' },
        { id: 'uart1', kind: 'ns16c550' },
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
    // The 16550's register selects ride the low address lines.
    for (let i = 0; i <= 2; i++) w('cpu1', `a${i}`, 'uart1', `a${i}`);
    // g1: ~A15; g2: ~A14; g3: RAM.CSB; ROM.CEB = ~A15
    w('cpu1', 'a15', 'glue1', '1a'); w('cpu1', 'a15', 'glue1', '1b');
    w('cpu1', 'a14', 'glue1', '2a'); w('cpu1', 'a14', 'glue1', '2b');
    w('glue1', '1y', 'glue1', '3a'); w('glue1', '2y', 'glue1', '3b');
    w('glue1', '3y', 'ram1', 'csb');
    w('glue1', '1y', 'rom1', 'ceb');
    // g4: NAND(~A15, A14) → VIA.CS2B and UART./CS2.
    w('glue1', '1y', 'glue1', '4a'); w('cpu1', 'a14', 'glue1', '4b');
    w('glue1', '4y', 'via1', 'cs2b');
    w('glue1', '4y', 'uart1', 'cs2b');
    w('cpu1', 'a13', 'via1', 'cs1');
    // glue2: g2 = ~A13 → UART.CS1; g4 = ~A12 → UART.CS0.
    w('cpu1', 'a13', 'glue2', '2a'); w('cpu1', 'a13', 'glue2', '2b');
    w('glue2', '2y', 'uart1', 'cs1');
    w('cpu1', 'a12', 'glue2', '4a'); w('cpu1', 'a12', 'glue2', '4b');
    w('glue2', '4y', 'uart1', 'cs0');
    return { parts, wires };
}

test('the drawn 16550 decode reaches the machine kind that already ran', () => {
    const r = extract6502Machine(circuitWith16550());
    assert.ok(r.ok, r.reasons.join('; '));
    assert.deepEqual(r.chips.find((c) => c.name === 'uart1'),
        { kind: 'uart16550', name: 'uart1', at: 0x4000, span: 0x1000 });
    assert.ok(r.lines.includes('CHIP uart1 = NS16C550 AT $4000'),
        `expected the NS16C550 CHIP line, got: ${JSON.stringify(r.lines)}`);
    // The machine instantiates it and the THR write leaves via onSerial.
    const sent = [];
    const m = new M6502Machine(
        { clockHz: 1_000_000, regions: r.regions, chips: r.chips },
        { onSerial: (b) => sent.push(b) });
    m._write(0x4000, 0x48); // THR with DLAB=0
    assert.deepEqual(sent, [0x48]);
});

test('a register select off its address line refuses with the line named', () => {
    const c = circuitWith16550();
    // a1 onto A3: the register file would scramble.
    c.wires = c.wires.filter((w) => !(w.to === 'uart1' && w.toTerminal === 'a1'));
    c.wires.push({ from: 'cpu1', fromTerminal: 'a3', to: 'uart1', toTerminal: 'a1' });
    const r = extract6502Machine(c);
    assert.equal(r.ok, false);
    assert.match(r.reasons.join(';'), /uart1\.a1 must ride A1/);
});
