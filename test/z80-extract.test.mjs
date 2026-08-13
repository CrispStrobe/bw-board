// The Z80 extractor: a hand-wired Searle-shape decode (MREQ-gated memory,
// IORQ-gated ACIA) comes back as the machine config; contention across
// the two spaces refuses with the address named.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractZ80Machine } from '../src/z80-extract.js';

// ~MREQ inverted (g1), ROM = A15 low (g3: NAND(~mreq, ~a15)), RAM = A15
// high (g4: NAND(~mreq, a15)); ACIA: cs0 = ~IORQ (g2 on chip 2), cs1 =
// A7, cs2b = gnd; rs = A0. Memory: ROM $0000-$7FFF, RAM $8000-$FFFF;
// ports: $80-$FF mirror, base $80.
function searleCircuit() {
    const parts = [
        { id: 'cpu1', kind: 'z80' }, { id: 'rom1', kind: '28c256' },
        { id: 'ram1', kind: '62256' }, { id: 'acia1', kind: 'mc6850' },
        { id: 'glue1', kind: '74hc00' }, { id: 'glue2', kind: '74hc00' },
        { id: 'gnd1', kind: 'gnd' },
    ];
    const wires = [];
    const w = (f, ft, t, tt) => wires.push({ from: f, fromTerminal: ft, to: t, toTerminal: tt });
    for (let i = 0; i <= 14; i++) { w('cpu1', `a${i}`, 'rom1', `a${i}`); w('cpu1', `a${i}`, 'ram1', `a${i}`); }
    w('cpu1', 'mreqb', 'glue1', '1a'); w('cpu1', 'mreqb', 'glue1', '1b');   // g1: ~mreq
    w('cpu1', 'a15', 'glue1', '2a'); w('cpu1', 'a15', 'glue1', '2b');       // g2: ~a15
    w('glue1', '1y', 'glue1', '3a'); w('glue1', '2y', 'glue1', '3b');       // g3: rom csb
    w('glue1', '3y', 'rom1', 'csb');
    w('glue1', '1y', 'glue1', '4a'); w('cpu1', 'a15', 'glue1', '4b');       // g4: ram csb
    w('glue1', '4y', 'ram1', 'csb');
    w('cpu1', 'iorqb', 'glue2', '1a'); w('cpu1', 'iorqb', 'glue2', '1b');   // ~iorq
    w('glue2', '1y', 'acia1', 'cs0');
    w('cpu1', 'a7', 'acia1', 'cs1');
    w('gnd1', 'gnd', 'acia1', 'cs2b');
    w('cpu1', 'a0', 'acia1', 'rs');
    return { parts, wires };
}

test('the hand-wired Searle decode extracts to the Z80 machine config', () => {
    const r = extractZ80Machine(searleCircuit());
    assert.ok(r.ok, r.reasons.join('; '));
    assert.deepEqual(r.regions, [
        { kind: 'rom', start: 0x0000, end: 0x7fff },
        { kind: 'ram', start: 0x8000, end: 0xffff },
    ]);
    assert.deepEqual(r.ports, [{ kind: 'acia6850', name: 'acia1', at: 0x80 }]);
    assert.ok(r.notes.some((n) => /acia1 mirrors through ports/.test(n)));
    assert.deepEqual(r.lines, [
        'MAP ROM $0000-$7FFF',
        'MAP RAM $8000-$FFFF',
        'CHIP acia1 = MC6850 AT PORT $0080',
    ]);
});

test('memory-space contention refuses with the address; port space is separate', () => {
    const c = searleCircuit();
    // Wire RAM's select to ROM's: both answer the same memory addresses.
    c.wires = c.wires.filter((w) => !(w.to === 'ram1' && w.toTerminal === 'csb'));
    c.wires.push({ from: 'glue1', fromTerminal: '3y', to: 'ram1', toTerminal: 'csb' });
    const r = extractZ80Machine(c);
    assert.equal(r.ok, false);
    assert.match(r.reasons.join(';'), /memory-space contention at \$/);
});

test('an ACIA whose rs is not A0 refuses', () => {
    const c = searleCircuit();
    c.wires = c.wires.filter((w) => !(w.to === 'acia1' && w.toTerminal === 'rs'));
    c.wires.push({ from: 'cpu1', fromTerminal: 'a1', to: 'acia1', toTerminal: 'rs' });
    const r = extractZ80Machine(c);
    assert.equal(r.ok, false);
    assert.match(r.reasons.join(';'), /rs must ride A0/);
});
