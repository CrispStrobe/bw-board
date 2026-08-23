// The AY-3-8912 through the drawn decode — the two-phase select shape
// (spec-updates/ay-two-phase-select.md). BDIR/BC1 name an OPERATION,
// so the fixture's glue gates them from the decode, RWB and A0:
//
//   sel  = A15=0 ∧ A14=1 ∧ A13=0      (the $4000-$5FFF window)
//   BDIR = sel · ~RWB                  (write cycles only)
//   BC1  = sel · ~A0                   (latch at the even address)
//
// → latch at even offsets, data-write at odd, reads at even (BC1 is
// rwb-independent), all discovered by classification, none declared.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extract6502Machine } from '../src/m6502-extract.js';
import { M6502Machine } from '../src/m6502-machine.js';

function circuitWithAy({ gateBdirWithRwb = true } = {}) {
    const parts = [
        { id: 'cpu1', kind: 'w65c02' },
        { id: 'ram1', kind: '62256' },
        { id: 'rom1', kind: '28c256' },
        { id: 'psg1', kind: 'ay8912' },
        { id: 'glue1', kind: '74hc00' },
        { id: 'glue2', kind: '74hc00' },
        { id: 'glue3', kind: '74hc00' },
    ];
    const wires = [];
    const w = (from, ft, to, tt) => wires.push({ from, fromTerminal: ft, to, toTerminal: tt });
    for (let i = 0; i <= 14; i++) {
        w('cpu1', `a${i}`, 'ram1', `a${i}`);
        w('cpu1', `a${i}`, 'rom1', `a${i}`);
    }
    // g1: ~A15; g2: ~A14; g3: RAM.CSB = NAND(~A15,~A14); ROM.CEB = ~A15
    w('cpu1', 'a15', 'glue1', '1a'); w('cpu1', 'a15', 'glue1', '1b');
    w('cpu1', 'a14', 'glue1', '2a'); w('cpu1', 'a14', 'glue1', '2b');
    w('glue1', '1y', 'glue1', '3a'); w('glue1', '2y', 'glue1', '3b');
    w('glue1', '3y', 'ram1', 'csb');
    w('glue1', '1y', 'rom1', 'ceb');
    // g4 = NAND(~A15, A14): low across $4000-$7FFF.
    w('glue1', '1y', 'glue1', '4a'); w('cpu1', 'a14', 'glue1', '4b');
    // glue2: g1 = ~g4 (window high); g2 = ~A13; g3 = selb = NAND(win, ~A13);
    //        g4 = sel = ~selb (high across $4000-$5FFF).
    w('glue1', '4y', 'glue2', '1a'); w('glue1', '4y', 'glue2', '1b');
    w('cpu1', 'a13', 'glue2', '2a'); w('cpu1', 'a13', 'glue2', '2b');
    w('glue2', '1y', 'glue2', '3a'); w('glue2', '2y', 'glue2', '3b');
    w('glue2', '3y', 'glue2', '4a'); w('glue2', '3y', 'glue2', '4b');
    // glue3: g1 = ~RWB; g2 = bdirb = NAND(sel, ~RWB); BDIR = ~g2 (g3).
    if (gateBdirWithRwb) {
        w('cpu1', 'rwb', 'glue3', '1a'); w('cpu1', 'rwb', 'glue3', '1b');
        w('glue2', '4y', 'glue3', '2a'); w('glue3', '1y', 'glue3', '2b');
    } else {
        // The mis-wiring: BDIR from the select alone, no RWB gating.
        w('glue2', '4y', 'glue3', '2a'); w('glue2', '4y', 'glue3', '2b');
    }
    w('glue3', '2y', 'glue3', '3a'); w('glue3', '2y', 'glue3', '3b');
    w('glue3', '3y', 'psg1', 'bdir');
    // glue3 g4 + glue1 spare: ~A0, then BC1 = ~NAND(sel, ~A0). glue3 has
    // one gate left (g4 = ~A0); the second NAND + inverter ride glue2? All
    // glue2 gates are used — add the pair on glue3 g4 and reuse: BC1 needs
    // NAND(sel, ~A0) then an inverter. Use glue3.4 for ~A0 and wire the
    // NAND+inverter as a fourth chip? No — a 74hc00 has exactly 4 gates;
    // glue1 g1..g4 used, glue2 g1..g4 used, glue3 g1..g3 used. g4 = ~A0:
    w('cpu1', 'a0', 'glue3', '4a'); w('cpu1', 'a0', 'glue3', '4b');
    parts.push({ id: 'glue4', kind: '74hc00' });
    // glue4: g1 = bc1b = NAND(sel, ~A0); g2 = BC1 = ~g1.
    w('glue2', '4y', 'glue4', '1a'); w('glue3', '4y', 'glue4', '1b');
    w('glue4', '1y', 'glue4', '2a'); w('glue4', '1y', 'glue4', '2b');
    w('glue4', '2y', 'psg1', 'bc1');
    return { parts, wires };
}

test('the two-address AY decode classifies: latch even, data odd, reads even', () => {
    const r = extract6502Machine(circuitWithAy());
    assert.ok(r.ok, r.reasons.join('; '));
    const psg = r.chips.find((c) => c.name === 'psg1');
    assert.deepEqual(psg, { kind: 'psg8912', name: 'psg1', at: 0x4000, span: 0x2000, readMask: 1 });
    assert.ok(r.lines.includes('CHIP psg1 = AY38912 AT $4000'),
        `expected the AY CHIP line, got: ${JSON.stringify(r.lines)}`);
    assert.ok(r.notes.some((n) => /psg1\.a8 is unwired — treated as tied high/.test(n)));

    // The machine plays the protocol: latch register 0 (tone A fine),
    // write a period byte, and the core's register file shows it.
    const m = new M6502Machine(
        { clockHz: 1_000_000, regions: r.regions, chips: r.chips }, {});
    m._write(0x4000, 0x00);  // latch: select register 0
    m._write(0x4001, 0x7b);  // data: tone A fine period
    assert.equal(m.chips.psg1.ay.regs[0], 0x7b, 'the write reached the selected register');
    // Reads decode at the EVEN parity here (BC1 = sel·~A0):
    assert.equal(m._read(0x4000), 0x7b, 'read-back at the latch address');
    assert.equal(m._read(0x4001), 0xff, 'the odd parity has no read decode: open bus');
});

test('BDIR without RWB gating refuses with the address and the fix named', () => {
    const r = extract6502Machine(circuitWithAy({ gateBdirWithRwb: false }));
    assert.equal(r.ok, false);
    assert.match(r.reasons.join(';'),
        /psg1: BDIR is active during a CPU read cycle at \$4000 — gate BDIR with RWB/);
});

test('the rwb axis costs the single-phase corpus nothing (guard)', () => {
    // The canonical decode from the base fixture file, re-run through the
    // extended evaluator: byte-identical regions and chips. (The base
    // file's own assertions are the fuller version of this guard; this
    // one pins the claim next to the machinery that could break it.)
    const c = circuitWithAy();
    c.parts = c.parts.filter((p) => !['psg1', 'glue3', 'glue4'].includes(p.id));
    c.wires = c.wires.filter((w) => !['psg1', 'glue3', 'glue4'].includes(w.from)
        && !['psg1', 'glue3', 'glue4'].includes(w.to));
    const r = extract6502Machine(c);
    assert.ok(r.ok, r.reasons.join('; '));
    assert.deepEqual(r.regions, [
        { kind: 'ram', start: 0x0000, end: 0x3fff },
        { kind: 'rom', start: 0x8000, end: 0xffff },
    ]);
    assert.deepEqual(r.chips, []);
});
