// The VDU decoder: synthetic streams in any chunking, and — when the local
// BeebEater clone exists — the LIVE proof: BBC BASIC's own DRAW commands on
// the machine produce a decoded square.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { VduDecoder } from '../src/vdu-decoder.js';

test('VDU 25 sequences decode to move/draw with signed coordinates', () => {
    const d = new VduDecoder();
    const ev = d.pushAll([25, 4, 100, 0, 100, 0, 25, 5, 0x2c, 0x01, 100, 0]);
    assert.deepEqual(ev, [
        { type: 'move', mode: 4, x: 100, y: 100 },
        { type: 'draw', mode: 5, x: 300, y: 100 },
    ]);
    // Negative coordinates are signed 16-bit.
    const neg = d.pushAll([25, 5, 0x9c, 0xff, 0, 0]);
    assert.equal(neg[0].x, -100);
});

test('state carries across arbitrary chunk boundaries', () => {
    const d = new VduDecoder();
    let ev = [];
    for (const b of [25, 4, 100]) ev.push(...d.push(b));
    assert.deepEqual(ev, [], 'mid-sequence: nothing yet');
    for (const b of [0, 100, 0]) ev.push(...d.push(b));
    assert.deepEqual(ev, [{ type: 'move', mode: 4, x: 100, y: 100 }]);
});

test('text, controls and unknown codes all surface — nothing drops', () => {
    const d = new VduDecoder();
    const ev = d.pushAll([72, 73, 13, 10, 7, 22, 4, 12, 23, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    assert.deepEqual(ev.map((e) => e.type),
        ['char', 'char', 'cr', 'newline', 'bell', 'mode', 'cls', 'vdu']);
    assert.equal(ev[0].char, 'H');
    assert.equal(ev[5].n, 4);
    assert.deepEqual(ev[7], { type: 'vdu', code: 23, params: [1, 2, 3, 4, 5, 6, 7, 8, 9] });
});

test('live: BBC BASIC DRAW commands on the machine decode to the square', async (t) => {
    const romPath = join(homedir(), 'code', 'BeebEater', 'BeebEater.rom');
    if (!existsSync(romPath)) { t.skip('BeebEater clone not present'); return; }
    const { M6502Machine, EATER6502 } = await import('../src/m6502-machine.js');
    const d = new VduDecoder();
    const events = [];
    const m = new M6502Machine(EATER6502, {
        onSerial: (byte) => events.push(...d.push(byte)),
    });
    m.loadRom(readFileSync(romPath), 0x8000);
    m.reset();
    for (let b = 0; b < 8; b++) { m.chips.via1.setInput('b', b, 0); m.chips.via1.setInput('a', b, 0); }
    m.advanceToMs(4000);
    const type = (s) => { for (const ch of s) {
        m.chips.acia1.rxPush(ch.charCodeAt(0));
        m.advanceToMs(m.tMs + (ch === '\r' ? 300 : 30));
    } };
    type('10 MOVE 100,100\r');
    type('20 DRAW 300,100\r');
    type('30 DRAW 300,300\r');
    type('40 DRAW 100,300\r');
    type('50 DRAW 100,100\r');
    type('RUN\r');
    m.advanceToMs(m.tMs + 3000);
    const path = events.filter((e) => e.type === 'move' || e.type === 'draw')
        .map((e) => `${e.type} ${e.x},${e.y}`).join(' | ');
    assert.equal(path,
        'move 100,100 | draw 300,100 | draw 300,300 | draw 100,300 | draw 100,100',
        'a closed square, decoded from the wire');
});
