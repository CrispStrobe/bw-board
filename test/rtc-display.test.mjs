// DS3231 + MAX7219 goldens. The RTC harness is the same open-drain I2C
// master as the AT24C02 test; the matrix harness is LedControl's exact
// packet discipline (16 bits, latch on LOAD rising).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerRtcDisplay } from '../src/devices/rtc-display.js';

registerRtcDisplay();

const V = { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] };
const G = { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] };
const net = (id, ...ts) => ({ id, terminals: ts.map(([part, terminal]) => ({ part, terminal })) });

describe('DS3231', () => {
    function rig(params = {}) {
        const board = new BoardImpl(5.0);
        board.setNetlist([V, G,
            { id: 'R1', kind: 'resistor', params: { ohms: 4700 }, terminals: ['a', 'b'] },
            { id: 'R2', kind: 'resistor', params: { ohms: 4700 }, terminals: ['a', 'b'] },
            { id: 'U1', kind: 'ds3231', params, terminals: ['vcc', 'gnd', 'sda', 'scl'] },
            { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0', 'P1.1'] },
        ], [
            net('nv', ['VCC', 'vcc'], ['R1', 'a'], ['R2', 'a'], ['U1', 'vcc']),
            net('ng', ['GND', 'gnd'], ['U1', 'gnd']),
            net('nscl', ['MCU', 'P1.0'], ['R1', 'b'], ['U1', 'scl']),
            net('nsda', ['MCU', 'P1.1'], ['R2', 'b'], ['U1', 'sda']),
        ]);
        let t = 0n;
        const tick = () => { t += 5_000n; board.advanceTo(t); };
        const scl = (h) => { board.setPin('P1.0', 'opendrain', h); tick(); };
        const sda = (h) => { board.setPin('P1.1', 'opendrain', h); tick(); };
        const sdaRead = () => board.readAnalog('P1.1') > 2.5;
        const start = () => { sda(true); scl(true); sda(false); scl(false); };
        const stop = () => { sda(false); scl(true); sda(true); };
        const wByte = (b) => {
            for (let i = 7; i >= 0; i--) { sda(!!((b >> i) & 1)); scl(true); scl(false); }
            sda(true); scl(true); const ack = !sdaRead(); scl(false);
            return ack;
        };
        const rByte = (ack) => {
            sda(true);
            let v = 0;
            for (let i = 7; i >= 0; i--) { scl(true); if (sdaRead()) v |= 1 << i; scl(false); }
            sda(!ack); scl(true); scl(false); sda(true);
            return v;
        };
        const readRegs = (reg, n) => {
            start(); wByte(0xd0); wByte(reg);
            start(); wByte(0xd1);
            const out = [];
            for (let i = 0; i < n; i++) out.push(rByte(i < n - 1));
            stop();
            return out;
        };
        const writeRegs = (reg, bytes) => {
            start(); wByte(0xd0); wByte(reg);
            for (const b of bytes) wByte(b);
            stop();
        };
        const advance = (ms) => { t += BigInt(ms) * 1_000_000n; board.advanceTo(t); };
        return { readRegs, writeRegs, advance };
    }

    it('keeps BCD time from power-on; register pointer wraps', () => {
        const r = rig();
        r.writeRegs(0x00, [0x30, 0x59, 0x23]);   // 23:59:30, 24h mode
        r.advance(31_000);
        const [sec, min, hour, , date] = r.readRegs(0x00, 5);
        assert.equal(sec, 0x01);
        assert.equal(min, 0x00);
        assert.equal(hour, 0x00, 'midnight rolled');
        assert.equal(date, 0x02, 'date advanced');
    });

    it('OSF powers up set and clears only when written zero — the lostPower dance', () => {
        const r = rig();
        assert.equal(r.readRegs(0x0f, 1)[0] & 0x80, 0x80, 'OSF set at power-on');
        r.writeRegs(0x0f, [0x00]);
        assert.equal(r.readRegs(0x0f, 1)[0] & 0x80, 0x00, 'cleared by writing zero');
    });

    it('temperature registers encode quarter degrees', () => {
        const r = rig({ temperature: 26.75 });
        const [msb, lsb] = r.readRegs(0x11, 2);
        assert.equal(msb, 26);
        assert.equal(lsb >> 6, 3, '0.75 °C = three quarters');
    });
});

describe('MAX7219', () => {
    function rig() {
        const board = new BoardImpl(5.0);
        board.setNetlist([V, G,
            { id: 'U1', kind: 'max7219', params: {}, terminals: ['vcc', 'gnd', 'din', 'clk', 'cs', 'dout'] },
            { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0', 'P1.1', 'P1.2'] },
        ], [
            net('nv', ['VCC', 'vcc'], ['U1', 'vcc']),
            net('ng', ['GND', 'gnd'], ['U1', 'gnd']),
            net('nd', ['MCU', 'P1.0'], ['U1', 'din']),
            net('nk', ['MCU', 'P1.1'], ['U1', 'clk']),
            net('nc', ['MCU', 'P1.2'], ['U1', 'cs']),
        ]);
        let t = 0n;
        const tick = () => { t += 2_000n; board.advanceTo(t); };
        const pin = (p, h) => { board.setPin(p, 'pushpull', h); tick(); };
        // LedControl's discipline: CS low, 16 bits MSB-first, CS high.
        const packet = (addr, data) => {
            pin('P1.2', false);
            const word = (addr << 8) | data;
            for (let i = 15; i >= 0; i--) {
                pin('P1.1', false);
                pin('P1.0', !!((word >> i) & 1));
                pin('P1.1', true);
            }
            pin('P1.1', false);
            pin('P1.2', true);
        };
        return { board, packet, st: () => board.getDeviceState('U1') };
    }

    it('digit packets land in the framebuffer; shutdown gates the display', () => {
        const m = rig();
        assert.equal(m.st().shutdown, true, 'datasheet power-on state');
        m.packet(0x0c, 0x01);                     // leave shutdown
        m.packet(0x0b, 0x07);                     // scan all
        m.packet(0x01, 0xaa);                     // row 0
        m.packet(0x08, 0x55);                     // row 7
        const s = m.st();
        assert.equal(s.shutdown, false);
        assert.equal(s.digits[0], 0xaa);
        assert.equal(s.digits[7], 0x55);
        m.packet(0x00, 0xff);                     // the no-op filler
        assert.equal(m.st().digits[0], 0xaa, 'no-op writes nothing');
    });
});
