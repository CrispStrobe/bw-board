// ST7920 serial-mode goldens: the harness bit-bangs the EXACT sequence
// the Apache reference firmware uses (sync 0xF8/0xFA, CS raised per
// transfer, MSB-first on SCLK rising edges), through board pins.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerST7920, st7920Pixel } from '../src/devices/st7920.js';

registerST7920();

function rig() {
    const board = new BoardImpl(5.0);
    board.setNetlist([
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'U1', kind: 'st7920', params: {}, terminals: ['vcc', 'gnd', 'cs', 'sclk', 'sid', 'rstb'] },
        { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P2.7', 'P2.6', 'P2.5', 'P3.4'] },
    ], [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'U1', terminal: 'vcc' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'U1', terminal: 'gnd' }] },
        { id: 'nck', terminals: [{ part: 'MCU', terminal: 'P2.7' }, { part: 'U1', terminal: 'sclk' }] },
        { id: 'ncs', terminals: [{ part: 'MCU', terminal: 'P2.6' }, { part: 'U1', terminal: 'cs' }] },
        { id: 'nsi', terminals: [{ part: 'MCU', terminal: 'P2.5' }, { part: 'U1', terminal: 'sid' }] },
        { id: 'nrs', terminals: [{ part: 'MCU', terminal: 'P3.4' }, { part: 'U1', terminal: 'rstb' }] },
    ]);
    let t = 0n;
    const tick = () => { t += 2_000n; board.advanceTo(t); };
    const pin = (p, h) => { board.setPin(p, 'pushpull', h); tick(); };
    const byte = (d) => {
        for (let i = 0; i < 8; i++) {
            pin('P2.7', false);
            pin('P2.5', !!(d & 0x80)); d = (d << 1) & 0xff;
            pin('P2.7', true);
        }
        pin('P2.7', false);
    };
    // The reference firmware's shapes, verbatim protocol.
    const cmd = (c) => { pin('P2.6', true); byte(0xf8); byte(c & 0xf0); byte((c << 4) & 0xf0); pin('P2.6', false); };
    const data = (d) => { pin('P2.6', true); byte(0xfa); byte(d & 0xf0); byte((d << 4) & 0xf0); pin('P2.6', false); };
    const reset = () => { pin('P3.4', false); tick(); pin('P3.4', true); tick(); };
    const st = () => board.getDeviceState('U1');
    return { board, cmd, data, reset, st, pin };
}

describe('ST7920 serial', () => {
    it('text mode: HELLO on line 1, WORLD on line 3 (the interleave)', () => {
        const r = rig();
        r.reset();
        r.cmd(0x30);                          // basic function set
        r.cmd(0x0c);                          // display on
        r.cmd(0x01);                          // clear
        r.cmd(0x80);                          // DDRAM addr 0 → row 0
        for (const ch of 'HELLO') r.data(ch.charCodeAt(0));
        r.cmd(0x88);                          // addr 0x08 → row 2 on screen
        for (const ch of 'WORLD') r.data(ch.charCodeAt(0));

        const s = r.st();
        assert.equal(s.displayOn, true);
        assert.equal(String.fromCharCode(...s.text[0].slice(0, 5)), 'HELLO');
        assert.equal(String.fromCharCode(...s.text[2].slice(0, 5)), 'WORLD');
        assert.equal(s.text[1][0], 0x20, 'line 2 untouched');
    });

    it('graphics: GDRAM dance stores cells, pixels map across halves', () => {
        const r = rig();
        r.reset();
        r.cmd(0x30);
        r.cmd(0x34);                          // extended
        r.cmd(0x36);                          // graphics on
        r.cmd(0x80 | 5);                      // vertical y=5
        r.cmd(0x80 | 2);                      // horizontal x=2
        r.data(0xaa); r.data(0x55);           // cell (5,2) = 0xAA55
        r.data(0xff); r.data(0x00);           // auto-inc → cell (5,3) = 0xFF00

        const s = r.st();
        assert.equal(s.graphicsOn, true);
        assert.equal(s.gdram[5 * 16 + 2], 0xaa55);
        assert.equal(s.gdram[5 * 16 + 3], 0xff00);
        // Pixel mapping: cell (5,2) covers screen y=5, x=32..47.
        assert.equal(st7920Pixel(s, 32, 5), 1, 'MSB of 0xAA55');
        assert.equal(st7920Pixel(s, 33, 5), 0);
        assert.equal(st7920Pixel(s, 47, 5), 1, 'LSB of 0xAA55');
        // Lower half: y>=32 lives at x-cell offset 8.
        r.cmd(0x80 | 0); r.cmd(0x80 | 8);
        r.data(0x80); r.data(0x00);
        assert.equal(st7920Pixel(r.st(), 0, 32), 1, 'lower-half origin pixel');
    });

    it('clear wipes text; CS low ignores clocks; reset pin wipes everything', () => {
        const r = rig();
        r.reset();
        r.cmd(0x30); r.cmd(0x0c);
        r.cmd(0x80); r.data(0x41);
        r.cmd(0x01);                          // clear
        assert.equal(r.st().text[0][0], 0x20);

        // Clocking bytes with CS LOW must do nothing (active-high CS).
        r.cmd(0x80);
        r.pin('P2.6', false);
        // raw clocks without CS:
        for (let i = 0; i < 24; i++) { r.pin('P2.7', true); r.pin('P2.7', false); }
        r.data(0x42);
        assert.equal(r.st().text[0][0], 0x42, 'stream after CS-low noise still decodes');

        r.reset();
        const s = r.st();
        assert.equal(s.text[0][0], 0x20, 'reset wiped text');
        assert.equal(s.displayOn, false);
    });
});
