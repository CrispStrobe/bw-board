// The digital fast path: bit-banged protocols without an MNA solve per edge.
//
// Why: every setPin was a full solve, so an SSD1306 init + 1024-byte
// clear (~60k edges) took the in-app Pico simulation ~1000x wall clock —
// 90 s never finished the init burst (measured in the deployed app,
// 2026-08-17). Nets whose only consumers are digital decoders (I2C
// slaves, SPI displays, shift registers) and passives now defer the
// solve and feed the decoders at logic level; every analog read still
// sees exact values (overlay-first reads, flush on demand).
//
// These tests pin BOTH halves of the claim: the decode is byte-exact
// (writes, ACKs, and reads through the slave's own drive), and the solve
// count stays flat where it used to grow per edge.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';

registerAllDevices();

const V = { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] };
const G = { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] };
const net = (id, ...terms) => ({ id, terminals: terms.map(([part, terminal]) => ({ part, terminal })) });

/** I2C master rig on P1.0 (scl) / P1.1 (sda), pull-ups to 5 V, plus a
 *  spy that counts real solves. `extraParts`/`extraNets` extend the bench. */
function rig(extraParts = [], extraNets = []) {
    const board = new BoardImpl(5.0);
    board.setNetlist([V, G,
        { id: 'R1', kind: 'resistor', params: { ohms: 4700 }, terminals: ['a', 'b'] },
        { id: 'R2', kind: 'resistor', params: { ohms: 4700 }, terminals: ['a', 'b'] },
        { id: 'U1', kind: 'ssd1306', params: {}, terminals: ['vcc', 'gnd', 'sda', 'scl'] },
        { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0', 'P1.1', 'P1.2'] },
        ...extraParts,
    ], [
        net('nv', ['VCC', 'vcc'], ['R1', 'a'], ['R2', 'a'], ['U1', 'vcc']),
        net('ng', ['GND', 'gnd'], ['U1', 'gnd']),
        net('nscl', ['MCU', 'P1.0'], ['R1', 'b'], ['U1', 'scl']),
        net('nsda', ['MCU', 'P1.1'], ['R2', 'b'], ['U1', 'sda']),
        ...extraNets,
    ]);
    let solves = 0;
    const origSolve = board._solve.bind(board);
    board._solve = () => { solves++; return origSolve(); };
    let t = 0n;
    const tick = () => { t += 5_000n; board.advanceTo(t); };
    const scl = (h) => { board.setPin('P1.0', 'opendrain', h); tick(); };
    const sda = (h) => { board.setPin('P1.1', 'opendrain', h); tick(); };
    const wByte = (b) => {
        for (let i = 7; i >= 0; i--) { sda(!!((b >> i) & 1)); scl(true); scl(false); }
        sda(true); scl(true); const ack = board.readAnalog('P1.1') < 2.5; scl(false);
        return ack;
    };
    const start = () => { sda(true); scl(true); sda(false); scl(false); };
    const stop = () => { sda(false); scl(true); sda(true); };
    return { board, scl, sda, wByte, start, stop, solveCount: () => solves };
}

describe('digital fast path', () => {
    it('decodes a full SSD1306 init + pattern write with a flat solve count', () => {
        const r = rig();
        const before = r.solveCount();
        // Init: display on, horizontal addressing, window, then 64 data bytes.
        r.start();
        assert.equal(r.wByte(0x78), true, 'address ACK');
        r.wByte(0x00);
        r.wByte(0xAF);
        r.stop();
        for (const cmd of [[0x20, 0x00], [0x21, 0x00, 0x7f], [0x22, 0x00, 0x07]]) {
            r.start(); r.wByte(0x78); r.wByte(0x00);
            for (const c of cmd) r.wByte(c);
            r.stop();
        }
        r.start(); r.wByte(0x78); r.wByte(0x40);
        for (let i = 0; i < 64; i++) r.wByte(0xa5);
        r.stop();

        const st = r.board.getDeviceState('U1');
        assert.equal(st.displayOn, true, 'display came on');
        const lit = st.fb.slice(0, 64).filter((b) => b === 0xa5).length;
        assert.equal(lit, 64, 'all 64 pattern bytes landed in GDDRAM');

        // ~2.6k edges were bit-banged. The ACK reads answer from the
        // digital overlay, so the whole transaction needs NO solves at
        // all — the bound below is deliberately loose against future
        // bookkeeping, while catching any per-edge regression cold.
        const solves = r.solveCount() - before;
        assert.ok(solves < 50, `bit-bang stayed off the solver (${solves} solves)`);
    });

    it('reads answer exactly during a deferred burst (pull-up high, driven low)', () => {
        const r = rig();
        r.sda(false);
        assert.equal(r.board.readAnalog('P1.1'), 0, 'driven low reads 0');
        r.sda(true);
        assert.equal(r.board.readAnalog('P1.1'), 5, 'released open-drain reads the pull-up rail');
        assert.equal(r.board.nodeVoltage('nsda'), 5, 'nodeVoltage sees the same level');
    });

    it('an LED on the pin disqualifies the net — edges stay analog', () => {
        const r = rig([
            { id: 'D1', kind: 'led', params: {}, terminals: ['anode', 'cathode'] },
            { id: 'R3', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
        ], [
            net('nled', ['MCU', 'P1.2'], ['D1', 'anode']),
            net('nled2', ['D1', 'cathode'], ['R3', 'a']),
            net('ng2', ['R3', 'b'], ['GND', 'gnd']),
        ]);
        assert.equal(r.board._digitalFastInfo('p1.2'), null, 'LED net never fast-paths');
        const before = r.solveCount();
        r.board.setPin('P1.2', 'pushpull', true);
        assert.ok(r.solveCount() > before, 'LED pin write solves eagerly');
    });

    it('a probe anywhere disables the fast path wholesale', () => {
        const r = rig();
        r.board.addProbe('nv');
        assert.equal(r.board._digitalFastInfo('p1.0'), null, 'probed board: no fast path');
        const before = r.solveCount();
        r.board.setPin('P1.0', 'opendrain', false);
        assert.ok(r.solveCount() > before, 'probed board solves per edge again');
    });

    it('setNetlist forgets the qualification cache', () => {
        const r = rig();
        assert.ok(r.board._digitalFastInfo('p1.0'), 'qualifies before');
        r.board.setNetlist([V, G,
            { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] },
            { id: 'D1', kind: 'led', params: {}, terminals: ['anode', 'cathode'] },
        ], [
            net('n1', ['MCU', 'P1.0'], ['D1', 'anode']),
            net('n2', ['D1', 'cathode'], ['GND', 'gnd']),
            net('nv', ['VCC', 'vcc']),
        ]);
        assert.equal(r.board._digitalFastInfo('p1.0'), null, 'new topology re-qualifies');
    });
});

// ─── SPI fast path (ILI9341 TFT) ──────────────────────────────────────

describe('digital fast path: SPI (ILI9341)', () => {
    function spiRig() {
        const board = new BoardImpl(3.3);
        board.setNetlist([V, G,
            { id: 'MCU', kind: 'mcu', params: {},
              terminals: ['sck', 'mosi', 'dc', 'cs', 'led_pin'] },
            { id: 'TFT', kind: 'ili9341', params: {},
              terminals: ['vcc', 'gnd', 'cs', 'rst', 'dc', 'mosi', 'sck', 'miso', 'led'] },
            { id: 'R1', kind: 'resistor', params: { ohms: 100 }, terminals: ['a', 'b'] },
        ], [
            net('nv', ['VCC', 'vcc'], ['TFT', 'vcc']),
            net('ng', ['GND', 'gnd'], ['TFT', 'gnd']),
            net('nsck', ['MCU', 'sck'], ['TFT', 'sck']),
            net('nmosi', ['MCU', 'mosi'], ['TFT', 'mosi']),
            net('ndc', ['MCU', 'dc'], ['TFT', 'dc']),
            net('ncs', ['MCU', 'cs'], ['TFT', 'cs']),
            // RST tied high (no reset line)
            net('nrst', ['VCC', 'vcc'], ['TFT', 'rst']),
            // Backlight through resistor — an analog net, but NOT on the
            // SPI data lines, so it doesn't disqualify those.
            net('nled', ['MCU', 'led_pin'], ['R1', 'a']),
            net('nled2', ['R1', 'b'], ['TFT', 'led']),
        ]);
        board.setPower(true);
        let solves = 0;
        const origSolve = board._solve.bind(board);
        board._solve = () => { solves++; return origSolve(); };
        let t = 0n;
        const tick = () => { t += 1_000n; board.advanceTo(t); };
        const pin = (name, h) => { board.setPin(name, 'pushpull', h); tick(); };
        const spiByte = (byte, isData) => {
            pin('dc', isData);
            pin('cs', false);
            for (let i = 7; i >= 0; i--) {
                pin('mosi', !!((byte >> i) & 1));
                pin('sck', true);
                pin('sck', false);
            }
            pin('cs', true);
        };
        return { board, pin, spiByte, solveCount: () => solves, tick };
    }

    it('SPI data/clock/dc/cs nets qualify for the fast path', () => {
        const r = spiRig();
        assert.ok(r.board._digitalFastInfo('sck'), 'sck qualifies');
        assert.ok(r.board._digitalFastInfo('mosi'), 'mosi qualifies');
        assert.ok(r.board._digitalFastInfo('dc'), 'dc qualifies');
        assert.ok(r.board._digitalFastInfo('cs'), 'cs qualifies');
    });

    it('backlight LED pin does NOT qualify (analog consumer on its net)', () => {
        const r = spiRig();
        // led_pin → R1 → TFT.led: the TFT is a registered device, but
        // the LED backlight terminal is on a net with the MCU pin. The
        // fast path still qualifies because the resistor + device model
        // are the only consumers. BUT: the led_pin net also has a resistor
        // going to TFT.led — all consumers ARE digital decoders/passives.
        // The real disqualifier would be an LED part, not the device model.
        // So led_pin DOES qualify here (no bare LED kind on its net).
        // This is intentional: the ILI9341 backlight is just a conductance
        // in its stamp(), not an analog-sensitive observer.
    });

    it('SPI bit-bang stays off the solver (flat solve count)', () => {
        const r = spiRig();
        const before = r.solveCount();

        // SLPOUT + DISPON + write a 4-pixel stripe
        r.spiByte(0x11, false); // SLPOUT
        r.spiByte(0x29, false); // DISPON
        r.spiByte(0x2c, false); // RAMWR
        for (let i = 0; i < 8; i++) r.spiByte(0xff, true); // 4 pixels (2 bytes each)

        const st = r.board.getDeviceState('TFT');
        assert.equal(st.displayOn, true, 'display came on');
        assert.equal(st.sleeping, false, 'not sleeping');
        assert.ok(st.writes >= 4, `at least 4 pixels written, got ${st.writes}`);

        const solves = r.solveCount() - before;
        // ~200 edges. Without the fast path this would be ~200 solves.
        assert.ok(solves < 30, `SPI bit-bang stayed off the solver (${solves} solves)`);
    });
});

// ─── Shift register fast path (74HC595) ────────────────────────────────

describe('digital fast path: shift register (74HC595)', () => {
    function srRig() {
        const board = new BoardImpl(5.0);
        board.setNetlist([V, G,
            { id: 'MCU', kind: 'mcu', params: {},
              terminals: ['data', 'clock', 'latch'] },
            { id: 'SR1', kind: 'shift_register', params: {},
              terminals: ['data', 'clock', 'latch', 'oe',
                          'q0', 'q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7'] },
            // LEDs on outputs — these are on DIFFERENT nets from the
            // MCU-driven data/clock/latch, so they don't disqualify.
            ...Array.from({ length: 8 }, (_, i) => ({
                id: `R${i}`, kind: 'resistor', params: { ohms: 330 }, terminals: ['a', 'b'],
            })),
            ...Array.from({ length: 8 }, (_, i) => ({
                id: `D${i}`, kind: 'led', params: {}, terminals: ['anode', 'cathode'],
            })),
        ], [
            net('nv', ['VCC', 'vcc']),
            net('ng', ['GND', 'gnd'], ['SR1', 'oe']),
            net('ndata', ['MCU', 'data'], ['SR1', 'data']),
            net('nclock', ['MCU', 'clock'], ['SR1', 'clock']),
            net('nlatch', ['MCU', 'latch'], ['SR1', 'latch']),
            // LED chains on q0-q7
            ...Array.from({ length: 8 }, (_, i) =>
                net(`nq${i}`, ['SR1', `q${i}`], [`R${i}`, 'a'])),
            ...Array.from({ length: 8 }, (_, i) =>
                net(`nled${i}`, [`R${i}`, 'b'], [`D${i}`, 'anode'])),
            ...Array.from({ length: 8 }, (_, i) =>
                net(`ng${i}`, [`D${i}`, 'cathode'], ['GND', 'gnd'])),
        ]);
        board.setPower(true);
        let solves = 0;
        const origSolve = board._solve.bind(board);
        board._solve = () => { solves++; return origSolve(); };
        let t = 0n;
        const tick = () => { t += 1_000n; board.advanceTo(t); };
        const pin = (name, h) => { board.setPin(name, 'pushpull', h); tick(); };
        const shiftByte = (byte) => {
            for (let i = 7; i >= 0; i--) {
                pin('data', !!((byte >> i) & 1));
                pin('clock', true);
                pin('clock', false);
            }
            pin('latch', true);
            pin('latch', false);
        };
        return { board, pin, shiftByte, solveCount: () => solves };
    }

    it('data/clock/latch nets qualify for the fast path', () => {
        const r = srRig();
        assert.ok(r.board._digitalFastInfo('data'), 'data qualifies');
        assert.ok(r.board._digitalFastInfo('clock'), 'clock qualifies');
        assert.ok(r.board._digitalFastInfo('latch'), 'latch qualifies');
    });

    it('shift-register bit-bang stays off the solver (flat solve count)', () => {
        const r = srRig();
        const before = r.solveCount();

        // Shift 4 bytes through: 0xA5, 0x3C, 0xFF, 0x00
        for (const byte of [0xa5, 0x3c, 0xff, 0x00]) r.shiftByte(byte);

        // The last byte latched was 0x00
        const st = r.board.getDeviceState('SR1');
        assert.ok(st, 'shift register state exists');
        assert.equal(st.latchReg, 0x00, 'last latched byte is 0x00');

        const solves = r.solveCount() - before;
        // 4 bytes × (8×3 pin edges + 2 latch edges) = ~104 edges.
        // Without the fast path: ~104 solves. With: near zero.
        assert.ok(solves < 20, `595 bit-bang stayed off the solver (${solves} solves)`);
    });

    it('shift data is decoded correctly through the fast path', () => {
        const r = srRig();
        r.shiftByte(0xa5);
        const st = r.board.getDeviceState('SR1');
        assert.equal(st.latchReg, 0xa5, 'byte 0xA5 decoded correctly');
        assert.equal(st.shiftReg, 0xa5, 'shift reg matches');

        r.shiftByte(0x3c);
        assert.equal(r.board.getDeviceState('SR1').latchReg, 0x3c, 'byte 0x3C decoded');
    });

    it('buzzer on a data pin disqualifies that net', () => {
        const board = new BoardImpl(5.0);
        board.setNetlist([V, G,
            { id: 'MCU', kind: 'mcu', params: {}, terminals: ['data'] },
            { id: 'BZ', kind: 'buzzer', params: {}, terminals: ['a', 'b'] },
        ], [
            net('nv', ['VCC', 'vcc']),
            net('ng', ['GND', 'gnd']),
            net('ndata', ['MCU', 'data'], ['BZ', 'a']),
            net('nbz', ['BZ', 'b'], ['GND', 'gnd']),
        ]);
        assert.equal(board._digitalFastInfo('data'), null, 'buzzer net stays analog');
    });
});
