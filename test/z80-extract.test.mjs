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
    w('glue1', '3y', 'rom1', 'ceb');
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

test('chip select through a 74HC244 buffer and 74LS32 OR gate is visible', () => {
    // ROM: OR(mreqb, a15) → active LOW when mreq active AND a15=0 → $0000-$7FFF.
    //      The select passes through a 74HC244 buffer (/1OE tied to GND).
    // RAM: standard NAND decode for $8000-$FFFF.
    const parts = [
        { id: 'cpu1', kind: 'z80' }, { id: 'rom1', kind: '28c256' },
        { id: 'ram1', kind: '62256' },
        { id: 'glue1', kind: '74hc00' }, { id: 'buf1', kind: '74hc244' },
        { id: 'or1', kind: '74ls32' }, { id: 'gnd1', kind: 'gnd' },
    ];
    const wires = [];
    const w = (f, ft, t, tt) => wires.push({ from: f, fromTerminal: ft, to: t, toTerminal: tt });
    for (let i = 0; i <= 14; i++) { w('cpu1', `a${i}`, 'rom1', `a${i}`); w('cpu1', `a${i}`, 'ram1', `a${i}`); }
    // ROM select: OR(mreqb, a15) — LOW when mreqb=0 AND a15=0
    w('cpu1', 'mreqb', 'or1', '1a'); w('cpu1', 'a15', 'or1', '1b');
    w('or1', '1y', 'buf1', '1a0');                                            // feed into buffer
    w('gnd1', 'gnd', 'buf1', '1oeb');                                         // enable buffer
    w('buf1', '1y0', 'rom1', 'ceb');                                          // buffered select → ROM
    // RAM: NAND(~mreq, a15) — standard Searle decode for upper half
    w('cpu1', 'mreqb', 'glue1', '1a'); w('cpu1', 'mreqb', 'glue1', '1b');   // ~mreq
    w('glue1', '1y', 'glue1', '3a'); w('cpu1', 'a15', 'glue1', '3b');       // NAND(~mreq, a15) → csb
    w('glue1', '3y', 'ram1', 'csb');
    const r = extractZ80Machine({ parts, wires });
    assert.ok(r.ok, r.reasons.join('; '));
    assert.deepEqual(r.regions, [
        { kind: 'rom', start: 0x0000, end: 0x7fff },
        { kind: 'ram', start: 0x8000, end: 0xffff },
    ]);
});

test('PainfulDiodes-style decode with UM245R, 74LS32 OR and 74LS04 inverter', () => {
    const parts = [
        { id: 'cpu1', kind: 'z80' }, { id: 'rom1', kind: '28c256' },
        { id: 'ram1', kind: '62256' }, { id: 'fifo1', kind: 'um245r' },
        { id: 'u1g', kind: '74ls32' }, { id: 'u5g', kind: '74ls32' },
        { id: 'u2', kind: '74ls04' }, { id: 'gnd1', kind: 'gnd' },
    ];
    const wires = [];
    const w = (f, ft, t, tt) => wires.push({ from: f, fromTerminal: ft, to: t, toTerminal: tt });
    for (let i = 0; i <= 14; i++) { w('cpu1', `a${i}`, 'rom1', `a${i}`); w('cpu1', `a${i}`, 'ram1', `a${i}`); }
    w('cpu1', 'a0', 'u2', '5a');
    w('cpu1', 'a15', 'u2', '6a');
    w('u2', '6y', 'u1g', '3a'); w('cpu1', 'mreqb', 'u1g', '3b');
    w('u1g', '3y', 'ram1', 'csb');
    w('cpu1', 'mreqb', 'u1g', '4a'); w('cpu1', 'a15', 'u1g', '4b');
    w('u1g', '4y', 'rom1', 'ceb');
    w('cpu1', 'rdb', 'u5g', '1a'); w('cpu1', 'iorqb', 'u5g', '1b');
    w('u2', '5y', 'u1g', '2a'); w('u5g', '1y', 'u1g', '2b');
    w('u1g', '2y', 'fifo1', 'rdb');
    const r = extractZ80Machine({ parts, wires });
    assert.ok(r.ok, r.reasons.join('; '));
    assert.deepEqual(r.regions, [
        { kind: 'rom', start: 0x0000, end: 0x7fff },
        { kind: 'ram', start: 0x8000, end: 0xffff },
    ]);
    const fifo = r.ports.find(p => p.kind === 'um245r');
    assert.ok(fifo, 'UM245R extracted as port device');
    assert.equal(fifo.at, 0x01, 'UM245R at port 1 (odd ports)');
    assert.ok(r.lines.some(l => /fifo1 = UM245R AT PORT \$0001/.test(l)), r.lines.join('; '));
});

test('an MC6845 wired in port space extracts as a crtc with its RAM framebuffer noted', () => {
    const c = searleCircuit();
    c.parts.push({ id: 'crtc1', kind: 'mc6845', params: { vramAt: 0xf000 } });
    const w = (f, ft, t, tt) => c.wires.push({ from: f, fromTerminal: ft, to: t, toTerminal: tt });
    // Select low over ports $00-$7F: csb = NAND(~iorq, ~a7); rsb rides A0.
    w('cpu1', 'a7', 'glue2', '2a'); w('cpu1', 'a7', 'glue2', '2b');     // ~a7
    w('glue2', '1y', 'glue2', '3a'); w('glue2', '2y', 'glue2', '3b');   // NAND(~iorq, ~a7)
    w('glue2', '3y', 'crtc1', 'csb');
    w('cpu1', 'a0', 'crtc1', 'rsb');
    const r = extractZ80Machine(c);
    assert.ok(r.ok, r.reasons.join('; '));
    const crtc = r.ports.find((p) => p.kind === 'crtc');
    assert.ok(crtc, 'crtc extracted');
    assert.equal(crtc.at, 0x00);
    assert.equal(crtc.vramAt, 0xf000);
    assert.ok(r.notes.some((n) => /framebuffer is system RAM at \$F000/.test(n)), r.notes.join('; '));
    assert.ok(r.lines.some((l) => /crtc1 = MC6845 AT PORT \$0000/.test(l)), r.lines.join('; '));
});
