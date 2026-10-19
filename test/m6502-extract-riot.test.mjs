// E5.1: the M6532 RIOT through the drawn decode. Two selects (cs1 high,
// /cs2 low) put the whole chip — 128 bytes RAM, ports, timer — in one
// window; RS0B is not a select but the internal RAM/register partition,
// wired to A7 (the 6507SBC convention the core's addr-bit-7 contract
// encodes). Coarse decode here: A15=0,A14=1,A13=0 → $4000-$5FFF.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extract6502Machine } from '../src/m6502-extract.js';
import { M6502Machine } from '../src/m6502-machine.js';

function circuitWithRiot() {
    const parts = [
        { id: 'cpu1', kind: 'w65c02' },
        { id: 'ram1', kind: '62256' },
        { id: 'rom1', kind: '28c256' },
        { id: 'via1', kind: 'w65c22' },
        { id: 'riot1', kind: 'm6532' },
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
    // The RIOT's address pins ride A0-A6; RS0B rides A7.
    for (let i = 0; i <= 6; i++) w('cpu1', `a${i}`, 'riot1', `a${i}`);
    w('cpu1', 'a7', 'riot1', 'rs0b');
    // g1: ~A15; g2: ~A14; g3: RAM.CSB; ROM.CEB = ~A15
    w('cpu1', 'a15', 'glue1', '1a'); w('cpu1', 'a15', 'glue1', '1b');
    w('cpu1', 'a14', 'glue1', '2a'); w('cpu1', 'a14', 'glue1', '2b');
    w('glue1', '1y', 'glue1', '3a'); w('glue1', '2y', 'glue1', '3b');
    w('glue1', '3y', 'ram1', 'csb');
    w('glue1', '1y', 'rom1', 'ceb');
    // g4: NAND(~A15, A14) → VIA.CS2B and RIOT./CS2.
    w('glue1', '1y', 'glue1', '4a'); w('cpu1', 'a14', 'glue1', '4b');
    w('glue1', '4y', 'via1', 'cs2b');
    w('glue1', '4y', 'riot1', 'cs2b');
    w('cpu1', 'a13', 'via1', 'cs1');
    // RIOT.CS1 = ~A13 (glue2 g2): the RIOT takes the half the VIA leaves.
    w('cpu1', 'a13', 'glue2', '2a'); w('cpu1', 'a13', 'glue2', '2b');
    w('glue2', '2y', 'riot1', 'cs1');
    return { parts, wires };
}

test('the RIOT extracts with its RAM half and register half in one window', () => {
    const r = extract6502Machine(circuitWithRiot());
    assert.ok(r.ok, r.reasons.join('; '));
    assert.deepEqual(r.chips.find((c) => c.name === 'riot1'),
        { kind: 'riot', name: 'riot1', at: 0x4000, span: 0x2000 });
    assert.ok(r.lines.includes('CHIP riot1 = M6532 AT $4000'),
        `expected the M6532 CHIP line, got: ${JSON.stringify(r.lines)}`);

    const m = new M6502Machine(
        { clockHz: 1_000_000, regions: r.regions, chips: r.chips }, {});
    // The RAM half (RS0B low): write and read back through the bus.
    m._write(0x4010, 0xa5);
    assert.equal(m._read(0x4010), 0xa5, 'RIOT RAM at $4010');
    assert.equal(m._read(0x4110), 0xa5, 'the 256-byte frame mirrors through the window');
    // The register half (RS0B high): DDRA at +$81 reads back what was set.
    m._write(0x4081, 0x0f);
    assert.equal(m._read(0x4081), 0x0f, 'DDRA behind RS0B=A7 high');
});

test('RS0B wired to the wrong address line refuses with the line named', () => {
    const c = circuitWithRiot();
    c.wires = c.wires.filter((w) => !(w.to === 'riot1' && w.toTerminal === 'rs0b'));
    c.wires.push({ from: 'cpu1', fromTerminal: 'a8', to: 'riot1', toTerminal: 'rs0b' });
    const r = extract6502Machine(c);
    assert.equal(r.ok, false);
    assert.match(r.reasons.join(';'), /riot1\.rs0b must ride A7/);
});
