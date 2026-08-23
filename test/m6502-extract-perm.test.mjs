// E5.2 — address-permutation support. Real breadboards permute A-lines
// for routing convenience; inside one chip that only relabels cells.
// The extractor detects the permutation per chip, the machine applies
// it in the byte path — and the two faces of the truth are both
// asserted here: RAM permutes TRANSPARENTLY (the CPU reads back what it
// wrote), while a ROM's linear image scrambles under the CPU's eyes,
// because the image was programmed for straight wiring.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extract6502Machine } from '../src/m6502-extract.js';
import { M6502Machine } from '../src/m6502-machine.js';

// The canonical decode with A3/A5 swapped INTO THE RAM only.
function circuitWithSwappedRam() {
    const parts = [
        { id: 'cpu1', kind: 'w65c02' },
        { id: 'ram1', kind: '62256' },
        { id: 'rom1', kind: '28c256' },
        { id: 'via1', kind: 'w65c22' },
        { id: 'glue1', kind: '74hc00' },
    ];
    const wires = [];
    const w = (from, ft, to, tt) => wires.push({ from, fromTerminal: ft, to, toTerminal: tt });
    for (let i = 0; i <= 14; i++) {
        if (i === 3) w('cpu1', 'a5', 'ram1', 'a3');
        else if (i === 5) w('cpu1', 'a3', 'ram1', 'a5');
        else w('cpu1', `a${i}`, 'ram1', `a${i}`);
        w('cpu1', `a${i}`, 'rom1', `a${i}`);
    }
    for (let i = 0; i <= 3; i++) w('cpu1', `a${i}`, 'via1', `rs${i}`);
    w('cpu1', 'a15', 'glue1', '1a'); w('cpu1', 'a15', 'glue1', '1b');
    w('cpu1', 'a14', 'glue1', '2a'); w('cpu1', 'a14', 'glue1', '2b');
    w('glue1', '1y', 'glue1', '3a'); w('glue1', '2y', 'glue1', '3b');
    w('glue1', '3y', 'ram1', 'csb');
    w('glue1', '1y', 'rom1', 'ceb');
    w('glue1', '1y', 'glue1', '4a'); w('cpu1', 'a14', 'glue1', '4b');
    w('glue1', '4y', 'via1', 'cs2b');
    w('cpu1', 'a13', 'via1', 'cs1');
    return { parts, wires };
}

test('swapped RAM lines extract as a permutation and read back what they wrote', () => {
    const r = extract6502Machine(circuitWithSwappedRam());
    assert.ok(r.ok, r.reasons.join('; '));
    const ram = r.regions.find((x) => x.kind === 'ram');
    assert.equal(ram.perm[3], 5, 'chip a3 rides A5');
    assert.equal(ram.perm[5], 3, 'chip a5 rides A3');
    assert.ok(ram.perm.every((b, i) => (i === 3 || i === 5 ? true : b === i)));
    assert.ok(r.notes.some((n) => /ram1 address lines are permuted \(a3→A5, a5→A3\)/.test(n)));

    // The machine "boots" the config and the CPU's view is self-consistent:
    // every write reads back, across addresses that exercise both swapped bits.
    const m = new M6502Machine(
        { clockHz: 1_000_000, regions: r.regions, chips: r.chips }, {});
    for (const a of [0x0000, 0x0008, 0x0020, 0x0028, 0x1234, 0x3fff]) {
        m._write(a, a & 0xff);
    }
    for (const a of [0x0000, 0x0008, 0x0020, 0x0028, 0x1234, 0x3fff]) {
        assert.equal(m._read(a), a & 0xff, `readback at $${a.toString(16)}`);
    }
    // ...and the permutation is REAL, not a no-op: the byte the CPU put
    // at $0008 (bit 3 set) physically landed in cell $0020 (bit 5 set),
    // which is where a straight-wired probe of the chip would find it.
    assert.equal(m.mem[0x0020], 0x08, 'the wiring decided where the byte lives');
    assert.equal(m.mem[0x0008], 0x20, 'and vice versa');
});

test('a permuted ROM scrambles its linear image exactly as the silicon would', () => {
    // Swap A0/A1 into the ROM: a straight-programmed image is read back
    // with cells 1 and 2 exchanged in every group of four.
    const c = circuitWithSwappedRam();
    c.wires = c.wires.filter((w) => !(w.to === 'ram1' && (w.toTerminal === 'a3' || w.toTerminal === 'a5')));
    c.wires.push({ from: 'cpu1', fromTerminal: 'a3', to: 'ram1', toTerminal: 'a3' });
    c.wires.push({ from: 'cpu1', fromTerminal: 'a5', to: 'ram1', toTerminal: 'a5' });
    c.wires = c.wires.filter((w) => !(w.to === 'rom1' && (w.toTerminal === 'a0' || w.toTerminal === 'a1')));
    c.wires.push({ from: 'cpu1', fromTerminal: 'a0', to: 'rom1', toTerminal: 'a1' });
    c.wires.push({ from: 'cpu1', fromTerminal: 'a1', to: 'rom1', toTerminal: 'a0' });
    const r = extract6502Machine(c);
    assert.ok(r.ok, r.reasons.join('; '));
    const rom = r.regions.find((x) => x.kind === 'rom');
    assert.deepEqual(rom.perm.slice(0, 2), [1, 0]);

    const m = new M6502Machine(
        { clockHz: 1_000_000, regions: r.regions, chips: r.chips }, {});
    // Program the chip linearly (what an EEPROM programmer does), then
    // read through the wiring: 0,1,2,3 → 0,2,1,3.
    const img = new Uint8Array(0x8000);
    for (let i = 0; i < 8; i++) img[i] = 0x10 + i;
    m.loadRom(img, 0x8000);
    assert.equal(m._read(0x8000), 0x10);
    assert.equal(m._read(0x8001), 0x12, 'CPU address 1 fetches cell 2');
    assert.equal(m._read(0x8002), 0x11, 'CPU address 2 fetches cell 1');
    assert.equal(m._read(0x8003), 0x13);
});
