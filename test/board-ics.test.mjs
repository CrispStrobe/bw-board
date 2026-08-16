// AT24C02 and XPT2046 goldens: protocols bit-banged through board pins,
// electrical world included (I2C pullups are real resistors, the ADC
// measures a real divider). Expectations from the datasheets.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerBoardICs } from '../src/devices/board-ics.js';

registerBoardICs();

// ─── I2C master harness (open-drain + pullups, as wired) ─────────────
function eepromBoard(params = {}) {
    const board = new BoardImpl(5.0);
    board.setNetlist([
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 4700 }, terminals: ['a', 'b'] },
        { id: 'R2', kind: 'resistor', params: { ohms: 4700 }, terminals: ['a', 'b'] },
        { id: 'U1', kind: 'at24c02', params, terminals: ['vcc', 'gnd', 'sda', 'scl'] },
        { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0', 'P1.1'] },
    ], [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }, { part: 'R2', terminal: 'a' }, { part: 'U1', terminal: 'vcc' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'U1', terminal: 'gnd' }] },
        { id: 'nscl', terminals: [{ part: 'MCU', terminal: 'P1.0' }, { part: 'R1', terminal: 'b' }, { part: 'U1', terminal: 'scl' }] },
        { id: 'nsda', terminals: [{ part: 'MCU', terminal: 'P1.1' }, { part: 'R2', terminal: 'b' }, { part: 'U1', terminal: 'sda' }] },
    ]);
    let t = 0n;
    const tick = () => { t += 5_000n; board.advanceTo(t); };
    // Open-drain master: driveHigh=true releases, false pulls low.
    const scl = (h) => { board.setPin('P1.0', 'opendrain', h); tick(); };
    const sda = (h) => { board.setPin('P1.1', 'opendrain', h); tick(); };
    const sdaRead = () => board.readAnalog('P1.1') > 2.5;

    const start = () => { sda(true); scl(true); sda(false); scl(false); };
    const stop = () => { sda(false); scl(true); sda(true); };
    const writeByte = (b) => {
        for (let i = 7; i >= 0; i--) { sda(!!((b >> i) & 1)); scl(true); scl(false); }
        sda(true);                       // release for ACK
        scl(true);
        const acked = !sdaRead();        // slave pulls low = ACK
        scl(false);
        return acked;
    };
    const readByte = (ack) => {
        sda(true);
        let v = 0;
        for (let i = 7; i >= 0; i--) { scl(true); if (sdaRead()) v |= 1 << i; scl(false); }
        sda(!ack); scl(true); scl(false); sda(true);
        return v;
    };
    return { board, start, stop, writeByte, readByte };
}

describe('AT24C02', () => {
    it('byte write commits on STOP; random read returns it; wrong address NACKs', () => {
        const e = eepromBoard();
        e.start();
        assert.equal(e.writeByte(0xa0), true, 'device ACKs its address');
        assert.equal(e.writeByte(0x10), true, 'word address ACKed');
        assert.equal(e.writeByte(0x42), true, 'data ACKed');
        e.stop();

        e.start();
        e.writeByte(0xa0); e.writeByte(0x10);       // dummy write sets address
        e.start();                                   // repeated START
        assert.equal(e.writeByte(0xa1), true, 'read address ACKed');
        assert.equal(e.readByte(false), 0x42, 'random read hits the byte');
        e.stop();

        e.start();
        assert.equal(e.writeByte(0xa2 | 0), false, 'address 0x51: nobody home');
        e.stop();
    });

    it('page write wraps within the 8-byte page; sequential read crosses pages', () => {
        const e = eepromBoard();
        e.start();
        e.writeByte(0xa0); e.writeByte(0x0e);        // page 0x08-0x0F, offset 6
        e.writeByte(0x11); e.writeByte(0x22); e.writeByte(0x33);   // 0x0E,0x0F, wrap → 0x08
        e.stop();

        e.start(); e.writeByte(0xa0); e.writeByte(0x0e);
        e.start(); e.writeByte(0xa1);
        const a = e.readByte(true);                  // 0x0E
        const b = e.readByte(true);                  // 0x0F
        const c = e.readByte(false);                 // 0x10 — NEXT page, untouched
        e.stop();
        assert.equal(a, 0x11);
        assert.equal(b, 0x22);
        assert.equal(c, 0xff, 'sequential read crossed into erased space');

        e.start(); e.writeByte(0xa0); e.writeByte(0x08);
        e.start(); e.writeByte(0xa1);
        assert.equal(e.readByte(false), 0x33, 'third byte wrapped to the page start');
        e.stop();
    });

    it('erased parts read 0xFF everywhere', () => {
        const e = eepromBoard();
        e.start(); e.writeByte(0xa0); e.writeByte(0x00);
        e.start(); e.writeByte(0xa1);
        assert.equal(e.readByte(false), 0xff);
        e.stop();
    });
});

// ─── XPT2046 harness ─────────────────────────────────────────────────
function adcBoard(params = {}) {
    const board = new BoardImpl(5.0);
    board.setNetlist([
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        // 1.25 V divider on xp: 15k over 5k.
        { id: 'RA', kind: 'resistor', params: { ohms: 15000 }, terminals: ['a', 'b'] },
        { id: 'RB', kind: 'resistor', params: { ohms: 5000 }, terminals: ['a', 'b'] },
        // 2.0 V divider on aux: 15k over 10k.
        { id: 'RC', kind: 'resistor', params: { ohms: 15000 }, terminals: ['a', 'b'] },
        { id: 'RD', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
        { id: 'U1', kind: 'xpt2046', params, terminals: ['vcc', 'gnd', 'csb', 'dclk', 'din', 'dout', 'xp', 'yp', 'vbat', 'aux'] },
        { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0', 'P1.1', 'P1.2', 'P1.3'] },
    ], [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'RA', terminal: 'a' }, { part: 'RC', terminal: 'a' }, { part: 'U1', terminal: 'vcc' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'RB', terminal: 'b' }, { part: 'RD', terminal: 'b' }, { part: 'U1', terminal: 'gnd' }] },
        { id: 'nx', terminals: [{ part: 'RA', terminal: 'b' }, { part: 'RB', terminal: 'a' }, { part: 'U1', terminal: 'xp' }] },
        { id: 'na', terminals: [{ part: 'RC', terminal: 'b' }, { part: 'RD', terminal: 'a' }, { part: 'U1', terminal: 'aux' }] },
        { id: 'ncs', terminals: [{ part: 'MCU', terminal: 'P1.0' }, { part: 'U1', terminal: 'csb' }] },
        { id: 'nck', terminals: [{ part: 'MCU', terminal: 'P1.1' }, { part: 'U1', terminal: 'dclk' }] },
        { id: 'ndi', terminals: [{ part: 'MCU', terminal: 'P1.2' }, { part: 'U1', terminal: 'din' }] },
        { id: 'ndo', terminals: [{ part: 'MCU', terminal: 'P1.3' }, { part: 'U1', terminal: 'dout' }] },
    ]);
    let t = 0n;
    const tick = () => { t += 2_000n; board.advanceTo(t); };
    const pin = (p, h) => { board.setPin(p, 'pushpull', h); tick(); };

    const transfer = (cmd, nbits) => {
        pin('P1.0', false);                          // /CS
        board.setPin('P1.3', 'input', false);
        for (let i = 7; i >= 0; i--) { pin('P1.2', !!((cmd >> i) & 1)); pin('P1.1', true); pin('P1.1', false); }
        // The command byte's own falling edge drove the null bit (that is
        // what makes the canonical (word>>3) arithmetic work on silicon);
        // sampling after each further fall reads b11..b0 directly.
        let v = 0;
        for (let i = 0; i < nbits; i++) {
            pin('P1.1', true); pin('P1.1', false);
            if (board.readAnalog('P1.3') > 2.5) v = (v << 1) | 1; else v <<= 1;
        }
        pin('P1.0', true);
        return v;
    };
    return { transfer };
}

describe('XPT2046', () => {
    it('12-bit single-ended: X channel measures the 1.25 V divider', () => {
        const a = adcBoard();
        const v = a.transfer(0xd4, 12);              // S, A=101(x), 12-bit, SER
        assert.ok(Math.abs(v - 1024) <= 8, `1.25/5.0 → ~1024, got ${v}`);
    });

    it('AUX channel and 8-bit mode both convert', () => {
        const a = adcBoard();
        const aux = a.transfer(0xe4, 12);            // A=110 → aux at 2.0 V
        assert.ok(Math.abs(aux - 1638) <= 10, `2.0/5.0 → ~1638, got ${aux}`);
        const v8 = a.transfer(0xdc, 8);              // x, MODE=1 → 8-bit
        assert.ok(Math.abs(v8 - 64) <= 2, `8-bit x → ~64, got ${v8}`);
    });

    it('VBAT reads through the internal 1/4 divider; temp diode tracks params', () => {
        const a = adcBoard({ temperature: 45 });
        // vbat terminal is unwired → reads ~0; the interesting check is temp.
        const t = a.transfer(0x84, 12);              // A=000 → temp diode
        const expectV = 0.6 - 20 * 0.0021;           // 45 °C
        const expect = Math.round((expectV / 5.0) * 4095);
        assert.ok(Math.abs(t - expect) <= 8, `temp ~${expect}, got ${t}`);
    });
});

// ─── AT24C64 (the blinkenrocket badge's animation store) ─────────────
function eeprom64Board(params = {}, strap = {}) {
    const board = new BoardImpl(5.0);
    const parts = [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 4700 }, terminals: ['a', 'b'] },
        { id: 'R2', kind: 'resistor', params: { ohms: 4700 }, terminals: ['a', 'b'] },
        { id: 'U1', kind: 'at24c64', params,
          terminals: ['a0', 'a1', 'a2', 'gnd', 'sda', 'scl', 'wp', 'vcc'] },
        { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0', 'P1.1'] },
    ];
    const nets = [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }, { part: 'R2', terminal: 'a' }, { part: 'U1', terminal: 'vcc' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'U1', terminal: 'gnd' }] },
        { id: 'nscl', terminals: [{ part: 'MCU', terminal: 'P1.0' }, { part: 'R1', terminal: 'b' }, { part: 'U1', terminal: 'scl' }] },
        { id: 'nsda', terminals: [{ part: 'MCU', terminal: 'P1.1' }, { part: 'R2', terminal: 'b' }, { part: 'U1', terminal: 'sda' }] },
    ];
    // Optional straps: tie a0/a1/a2/wp to VCC through the supply net
    for (const pin of ['a0', 'a1', 'a2', 'wp']) {
        if (strap[pin]) nets[0].terminals.push({ part: 'U1', terminal: pin });
    }
    board.setNetlist(parts, nets);
    let t = 0n;
    const tick = () => { t += 5_000n; board.advanceTo(t); };
    const scl = (h) => { board.setPin('P1.0', 'opendrain', h); tick(); };
    const sda = (h) => { board.setPin('P1.1', 'opendrain', h); tick(); };
    const sdaRead = () => board.readAnalog('P1.1') > 2.5;
    const start = () => { sda(true); scl(true); sda(false); scl(false); };
    const stop = () => { sda(false); scl(true); sda(true); };
    const writeByte = (b) => {
        for (let i = 7; i >= 0; i--) { sda(!!((b >> i) & 1)); scl(true); scl(false); }
        sda(true); scl(true);
        const acked = !sdaRead();
        scl(false);
        return acked;
    };
    const readByte = (ack) => {
        sda(true);
        let v = 0;
        for (let i = 7; i >= 0; i--) { scl(true); if (sdaRead()) v |= 1 << i; scl(false); }
        sda(!ack); scl(true); scl(false); sda(true);
        return v;
    };
    return { board, start, stop, writeByte, readByte };
}

describe('AT24C64', () => {
    it('two-byte addressing: write at 0x1234 reads back at 0x1234, not 0x34', () => {
        const e = eeprom64Board();
        e.start();
        assert.equal(e.writeByte(0xa0), true, 'ACKs 0x50 with straps low');
        e.writeByte(0x12); e.writeByte(0x34);        // word address, high first
        e.writeByte(0x99);
        e.stop();

        e.start(); e.writeByte(0xa0); e.writeByte(0x12); e.writeByte(0x34);
        e.start(); e.writeByte(0xa1);
        assert.equal(e.readByte(false), 0x99, 'random read at 0x1234');
        e.stop();

        e.start(); e.writeByte(0xa0); e.writeByte(0x00); e.writeByte(0x34);
        e.start(); e.writeByte(0xa1);
        assert.equal(e.readByte(false), 0xff, '0x0034 untouched — no one-byte aliasing');
        e.stop();
    });

    it('32-byte pages: offset 30 write wraps to the page start, not the next page', () => {
        const e = eeprom64Board();
        e.start();
        e.writeByte(0xa0); e.writeByte(0x00); e.writeByte(0x3e);  // page 0x20-0x3F, offset 30
        e.writeByte(0x11); e.writeByte(0x22); e.writeByte(0x33);  // 0x3E, 0x3F, wrap → 0x20
        e.stop();

        e.start(); e.writeByte(0xa0); e.writeByte(0x00); e.writeByte(0x20);
        e.start(); e.writeByte(0xa1);
        assert.equal(e.readByte(false), 0x33, 'third byte wrapped to 0x20');
        e.stop();

        e.start(); e.writeByte(0xa0); e.writeByte(0x00); e.writeByte(0x40);
        e.start(); e.writeByte(0xa1);
        assert.equal(e.readByte(false), 0xff, '0x40 (next page) untouched');
        e.stop();
    });

    it('A0 strap high moves the bus address to 0x51', () => {
        const e = eeprom64Board({}, { a0: true });
        e.start();
        assert.equal(e.writeByte(0xa0), false, '0x50: nobody home');
        e.stop();
        e.start();
        assert.equal(e.writeByte(0xa2), true, '0x51 ACKs');
        e.stop();
    });

    it('WP high: writes ACK but are DISCARDED at STOP', () => {
        const e = eeprom64Board({}, { wp: true });
        e.start();
        e.writeByte(0xa0); e.writeByte(0x00); e.writeByte(0x10);
        assert.equal(e.writeByte(0x55), true, 'data still ACKs (datasheet)');
        e.stop();
        e.start(); e.writeByte(0xa0); e.writeByte(0x00); e.writeByte(0x10);
        e.start(); e.writeByte(0xa1);
        assert.equal(e.readByte(false), 0xff, 'nothing was written');
        e.stop();
    });

    it('params.contents preloads the array (animation images ship this way)', () => {
        const e = eeprom64Board({ contents: [0xde, 0xad, 0xbe, 0xef] });
        e.start(); e.writeByte(0xa0); e.writeByte(0x00); e.writeByte(0x00);
        e.start(); e.writeByte(0xa1);
        assert.equal(e.readByte(true), 0xde);
        assert.equal(e.readByte(true), 0xad);
        assert.equal(e.readByte(true), 0xbe);
        assert.equal(e.readByte(false), 0xef);
        e.stop();
    });
});
