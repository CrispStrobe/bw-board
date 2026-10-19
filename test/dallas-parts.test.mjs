// DS1302 and DS18B20, golden-tested the only honest way: bit-banged
// through board pins with datasheet timing, exactly as MCU firmware
// does it. The expectations come from the datasheets, not from any
// implementation — re-invent, assert, cross-check later if a golden
// ever disagrees with silicon.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerDallasParts } from '../src/devices/dallas-parts.js';
import { crc8Dallas } from '../src/devices/dallas-parts.js';

registerDallasParts();

// ─── DS1302 harness ──────────────────────────────────────────────────
function rtcBoard() {
    const board = new BoardImpl(5.0);
    board.setNetlist([
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'U1', kind: 'ds1302', params: {}, terminals: ['vcc', 'gnd', 'ce', 'sclk', 'io'] },
        { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0', 'P1.1', 'P1.2'] },
    ], [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'U1', terminal: 'vcc' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'U1', terminal: 'gnd' }] },
        { id: 'nce', terminals: [{ part: 'MCU', terminal: 'P1.0' }, { part: 'U1', terminal: 'ce' }] },
        { id: 'nck', terminals: [{ part: 'MCU', terminal: 'P1.1' }, { part: 'U1', terminal: 'sclk' }] },
        { id: 'nio', terminals: [{ part: 'MCU', terminal: 'P1.2' }, { part: 'U1', terminal: 'io' }] },
    ]);
    let t = 0n;
    const tick = (us) => { t += BigInt(us) * 1000n; board.advanceTo(t); };
    const pin = (p, high) => { board.setPin(p, 'pushpull', high); tick(2); };
    const release = (p) => { board.setPin(p, 'input', false); tick(2); };

    const writeByte = (b) => {
        for (let i = 0; i < 8; i++) {
            pin('P1.2', !!((b >> i) & 1));
            pin('P1.1', true);       // rising edge: device samples
            pin('P1.1', false);
        }
    };
    const readByte = (first = true) => {
        release('P1.2');
        let v = 0;
        for (let i = 0; i < 8; i++) {
            // The command's last falling edge already output bit 0 of the
            // FIRST byte; every later bit — and every bit of burst bytes
            // after the first — needs its own clock toggle.
            if (i > 0 || !first) { pin('P1.1', true); pin('P1.1', false); }
            if (board.readAnalog('P1.2') > 2.5) v |= 1 << i;
        }
        return v;
    };
    const cmd = (c) => { pin('P1.1', false); pin('P1.0', true); writeByte(c); };
    const end = () => { pin('P1.0', false); };
    const writeReg = (addr, val) => { cmd(0x80 | (addr << 1)); writeByte(val); end(); };
    const readReg = (addr) => { cmd(0x81 | (addr << 1)); const v = readByte(); end(); return v; };
    const writeRam = (idx, val) => { cmd(0xc0 | (idx << 1)); writeByte(val); end(); };
    const readRam = (idx) => { cmd(0xc1 | (idx << 1)); const v = readByte(); end(); return v; };
    return { board, tick, writeReg, readReg, writeRam, readRam, cmd, readByte, end, now: () => t };
}

describe('DS1302', () => {
    it('powers up halted (the classic CH trap), runs once CH clears', () => {
        const r = rtcBoard();
        assert.equal(r.readReg(0) & 0x80, 0x80, 'CH set at power-up');
        r.tick(3_000_000);
        assert.equal(r.readReg(0) & 0x7f, 0x00, 'halted clock does not count');

        r.writeReg(0, 0x00);                     // CH=0, sec=00 → running
        r.tick(2_000_000);                       // 2 s
        assert.equal(r.readReg(0), 0x02, 'two seconds, BCD, CH clear');
    });

    it('BCD calendar rolls: 23:59:59 on Dec 31 → Jan 1, next year', () => {
        const r = rtcBoard();
        r.writeReg(2, 0x23);                     // 23h (24h mode)
        r.writeReg(1, 0x59);
        r.writeReg(3, 0x31); r.writeReg(4, 0x12); r.writeReg(6, 0x25);
        r.writeReg(0, 0x59);                     // 59 s, CH clear — clock runs
        r.tick(1_500_000);
        assert.equal(r.readReg(0) & 0x7f, 0x00);
        assert.equal(r.readReg(1), 0x00);
        assert.equal(r.readReg(2), 0x00);
        assert.equal(r.readReg(3), 0x01, 'date rolled');
        assert.equal(r.readReg(4), 0x01, 'month rolled');
        assert.equal(r.readReg(6), 0x26, 'year rolled');
    });

    it('12h mode reads back with AM/PM; write-protect blocks writes', () => {
        const r = rtcBoard();
        r.writeReg(2, 0x80 | 0x20 | 0x03);       // 12h mode, PM, 3 → 15:00
        assert.equal(r.readReg(2), 0x80 | 0x20 | 0x03);
        r.writeReg(2, 0x15);                     // back to 24h: 15h
        assert.equal(r.readReg(2), 0x15);

        r.writeReg(7, 0x80);                     // WP on
        r.writeReg(1, 0x30);
        assert.equal(r.readReg(1), 0x00, 'write bounced off WP');
        r.writeReg(7, 0x00);                     // WP off again
        r.writeReg(1, 0x30);
        assert.equal(r.readReg(1), 0x30);
    });

    it('RAM bytes store; clock burst reads all eight registers', () => {
        const r = rtcBoard();
        r.writeRam(5, 0xa5);
        r.writeRam(30, 0x3c);                    // last RAM byte
        assert.equal(r.readRam(5), 0xa5);
        assert.equal(r.readRam(30), 0x3c);
        assert.equal(r.readRam(6), 0x00, 'untouched RAM reads back zero');

        // Clock burst read: command 0xBF → 8 bytes, last is WP.
        r.writeReg(1, 0x42);
        r.cmd(0xbf);
        const bytes = [];
        for (let i = 0; i < 8; i++) bytes.push(r.readByte(i === 0));
        r.end();
        assert.equal(bytes[1], 0x42, 'burst byte 1 is minutes');
        assert.equal(bytes[7] & 0x80, 0, 'burst byte 7 is WP, clear');
    });
});

// ─── DS18B20 harness ─────────────────────────────────────────────────
function owBoard(params = {}) {
    const board = new BoardImpl(5.0);
    board.setNetlist([
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'RP', kind: 'resistor', params: { ohms: 4700 }, terminals: ['a', 'b'] },
        { id: 'U1', kind: 'ds18b20', params, terminals: ['vcc', 'gnd', 'dq'] },
        { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P2.0'] },
    ], [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'RP', terminal: 'a' }, { part: 'U1', terminal: 'vcc' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'U1', terminal: 'gnd' }] },
        { id: 'ndq', terminals: [{ part: 'MCU', terminal: 'P2.0' }, { part: 'RP', terminal: 'b' }, { part: 'U1', terminal: 'dq' }] },
    ]);
    let t = 0n;
    const tick = (us) => { t += BigInt(us) * 1000n; board.advanceTo(t); };
    const low = () => board.setPin('P2.0', 'pushpull', false);
    const release = () => board.setPin('P2.0', 'input', false);
    const sample = () => board.readAnalog('P2.0') > 2.5;

    const reset = () => {
        low(); tick(500);
        release(); tick(70);
        const presence = !sample();              // device pulls low in its window
        tick(430);
        return presence;
    };
    const writeBit = (b) => {
        low(); tick(b ? 8 : 65);
        release(); tick(b ? 57 : 5);
    };
    const writeByte = (v) => { for (let i = 0; i < 8; i++) writeBit((v >> i) & 1); };
    const readBit = () => {
        low(); tick(3);
        release(); tick(9);
        const b = sample() ? 1 : 0;
        tick(50);
        return b;
    };
    const readByte = () => { let v = 0; for (let i = 0; i < 8; i++) v |= readBit() << i; return v; };
    return { board, tick, reset, writeByte, readByte, readBit };
}

describe('DS18B20', () => {
    it('reset gets a presence pulse; READ ROM returns family 0x28 + valid CRC', () => {
        const w = owBoard();
        assert.equal(w.reset(), true, 'presence detected');
        w.writeByte(0x33);                       // READ ROM
        const rom = [];
        for (let i = 0; i < 8; i++) rom.push(w.readByte());
        assert.equal(rom[0], 0x28, 'DS18B20 family code');
        assert.equal(crc8Dallas(rom.slice(0, 8)), 0, 'CRC over all 8 bytes is zero');
    });

    it('SKIP ROM + CONVERT T + READ SCRATCHPAD returns the set temperature', () => {
        const w = owBoard({ temperature: 25.5, tconvMs: 2 });
        assert.equal(w.reset(), true);
        w.writeByte(0xcc);                       // SKIP ROM
        w.writeByte(0x44);                       // CONVERT T
        assert.equal(w.readBit(), 0, 'busy while converting');
        w.tick(2500);                            // > tconv
        assert.equal(w.readBit(), 1, 'done');

        assert.equal(w.reset(), true);
        w.writeByte(0xcc);
        w.writeByte(0xbe);                       // READ SCRATCHPAD
        const sp = [];
        for (let i = 0; i < 9; i++) sp.push(w.readByte());
        const raw = sp[0] | (sp[1] << 8);
        assert.equal(raw / 16, 25.5, 'temperature encodes 12-bit');
        assert.equal(crc8Dallas(sp.slice(0, 8)), sp[8], 'scratchpad CRC checks');
    });

    it('negative temperatures come back in two-s complement', () => {
        const w = owBoard({ temperature: -10.125, tconvMs: 1 });
        w.reset();
        w.writeByte(0xcc); w.writeByte(0x44); w.tick(1500);
        w.reset();
        w.writeByte(0xcc); w.writeByte(0xbe);
        const lsb = w.readByte(); const msb = w.readByte();
        let raw = lsb | (msb << 8);
        if (raw & 0x8000) raw -= 0x10000;
        assert.equal(raw / 16, -10.125);
    });

    it('MATCH ROM with the wrong serial goes inert; the right one answers', () => {
        const w = owBoard({ temperature: 20, tconvMs: 1, serial: [9, 9, 9, 9, 9, 9] });
        w.reset();
        w.writeByte(0x55);                       // MATCH ROM
        for (let i = 0; i < 8; i++) w.writeByte(0x00);   // wrong ROM
        w.writeByte(0xbe);
        assert.equal(w.readByte(), 0xff, 'inert device leaves the bus pulled up');

        w.reset();
        w.writeByte(0x55);
        const head = [0x28, 9, 9, 9, 9, 9, 9];
        const rom = [...head, crc8Dallas(head)];
        for (const b of rom) w.writeByte(b);
        w.writeByte(0xbe);
        const sp = [];
        for (let i = 0; i < 9; i++) sp.push(w.readByte());
        assert.equal((sp[0] | (sp[1] << 8)) / 16, 20, 'matched device answers');
    });
});
