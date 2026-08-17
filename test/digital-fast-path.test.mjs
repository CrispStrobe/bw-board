// The digital fast path: bit-banged I2C without an MNA solve per edge.
//
// Why: every setPin was a full solve, so an SSD1306 init + 1024-byte
// clear (~60k edges) took the in-app Pico simulation ~1000x wall clock —
// 90 s never finished the init burst (measured in the deployed app,
// 2026-08-17). Nets whose only consumers are I2C decoders and passives
// now defer the solve and feed the decoders at logic level; every analog
// read still sees exact values (overlay-first reads, flush on demand).
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
