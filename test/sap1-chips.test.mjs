/**
 * SAP-1 TTL chips — hand-computed truth tables and behavioral oracles.
 *
 * 74LS173: 4-bit D register (3-state, rising-edge, /G enable, MR clear)
 * 74LS161: 4-bit synchronous counter (load, count, clear, RCO)
 * 74LS189: 16×4 RAM with INVERTED outputs (the classic trap)
 * 74LS157: quad 2:1 multiplexer (/G enable, S select)
 * 74LS107: dual JK flip-flop (FALLING-edge, active-low /CLR)
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { registerSAP1Chips } from '../src/devices/sap1-chips.js';
import { getDevice, unregisterDevice } from '../src/devices.js';

const KINDS = ['74ls173', '74ls161', '74ls189', '74ls157', '74ls107'];

function setup() { registerSAP1Chips(); }
function teardown() { for (const k of KINDS) try { unregisterDevice(k); } catch {} }

function makeChip(kind) {
    const model = getDevice(kind);
    const part = { id: kind, kind, params: {} };
    const state = model.init(part);
    const pins = {};
    for (const t of model.terminals) pins[t] = 0;
    pins.vcc = 5; pins.gnd = 0;
    const read = (t) => pins[t] ?? 0;
    let t = 0n;
    const tick = () => { model.update(part, state, read, t); t += 100n; };
    const pulse = (pin) => { pins[pin] = 5; tick(); pins[pin] = 0; tick(); };
    return { model, part, state, pins, read, tick, pulse };
}

// ─── 74LS173: 4-bit D register ───────────────────────────────────

describe('74LS173: 4-bit D register', () => {
    beforeEach(setup); afterEach(teardown);

    it('latches D0-D3 on CLK rising edge when /G1 /G2 both low', () => {
        const c = makeChip('74ls173');
        c.pins.g1b = 0; c.pins.g2b = 0; // data enable
        c.pins.oe1b = 0; c.pins.oe2b = 0; // output enable
        c.pins.d0 = 5; c.pins.d1 = 0; c.pins.d2 = 5; c.pins.d3 = 0; // 0b0101 = 5
        c.pulse('clk');
        assert.equal(c.state._reg, 5, 'latched 0101');
        assert.equal(c.state.drives.q0.vTh, 5, 'Q0 high');
        assert.equal(c.state.drives.q1.vTh, 0, 'Q1 low');
        assert.equal(c.state.drives.q2.vTh, 5, 'Q2 high');
    });

    it('ignores data when /G1 or /G2 is high', () => {
        const c = makeChip('74ls173');
        c.pins.g1b = 5; c.pins.g2b = 0; // /G1 high = disabled
        c.pins.oe1b = 0; c.pins.oe2b = 0;
        c.pins.d0 = 5; c.pins.d1 = 5; c.pins.d2 = 5; c.pins.d3 = 5;
        c.pulse('clk');
        assert.equal(c.state._reg, 0, 'data not latched with /G1 high');
    });

    it('outputs high-Z when /OE is high', () => {
        const c = makeChip('74ls173');
        c.pins.g1b = 0; c.pins.g2b = 0;
        c.pins.oe1b = 5; c.pins.oe2b = 0; // /OE1 high = high-Z
        c.pins.d0 = 5;
        c.pulse('clk');
        assert.equal(c.state.drives.q0.rTh, 1e9, 'Q0 high-Z');
    });

    it('MR clears the register asynchronously', () => {
        const c = makeChip('74ls173');
        c.pins.g1b = 0; c.pins.g2b = 0; c.pins.oe1b = 0; c.pins.oe2b = 0;
        c.pins.d0 = 5; c.pins.d1 = 5; c.pins.d2 = 5; c.pins.d3 = 5;
        c.pulse('clk');
        assert.equal(c.state._reg, 0x0f, 'all bits set');
        c.pins.mr = 5; c.tick();
        assert.equal(c.state._reg, 0, 'cleared by MR');
    });
});

// ─── 74LS161: 4-bit synchronous counter ──────────────────────────

describe('74LS161: 4-bit synchronous counter', () => {
    beforeEach(setup); afterEach(teardown);

    it('counts up on CLK rising when ENP and ENT are high', () => {
        const c = makeChip('74ls161');
        c.pins.clrb = 5; c.pins.loadb = 5; c.pins.enp = 5; c.pins.ent = 5;
        c.pulse('clk'); assert.equal(c.state._count, 1);
        c.pulse('clk'); assert.equal(c.state._count, 2);
        c.pulse('clk'); assert.equal(c.state._count, 3);
    });

    it('wraps from 15 to 0', () => {
        const c = makeChip('74ls161');
        c.pins.clrb = 5; c.pins.loadb = 5; c.pins.enp = 5; c.pins.ent = 5;
        c.state._count = 15;
        c.pulse('clk');
        assert.equal(c.state._count, 0, 'wraps to 0');
    });

    it('RCO goes high when count=15 and ENT=high', () => {
        const c = makeChip('74ls161');
        c.pins.clrb = 5; c.pins.loadb = 5; c.pins.enp = 5; c.pins.ent = 5;
        c.state._count = 15;
        c.tick(); // update outputs
        assert.equal(c.state.drives.rco.vTh, 5, 'RCO high at 15');
    });

    it('parallel load on CLK rising when /LOAD is low', () => {
        const c = makeChip('74ls161');
        c.pins.clrb = 5; c.pins.loadb = 0; c.pins.enp = 5; c.pins.ent = 5;
        c.pins.d0 = 5; c.pins.d1 = 0; c.pins.d2 = 5; c.pins.d3 = 5; // 0b1101 = 13
        c.pulse('clk');
        assert.equal(c.state._count, 13, 'loaded 13');
    });

    it('/CLR clears asynchronously', () => {
        const c = makeChip('74ls161');
        c.pins.clrb = 5; c.pins.loadb = 5; c.pins.enp = 5; c.pins.ent = 5;
        c.state._count = 10;
        c.pins.clrb = 0; c.tick();
        assert.equal(c.state._count, 0, 'cleared');
    });

    it('holds when ENP or ENT is low', () => {
        const c = makeChip('74ls161');
        c.pins.clrb = 5; c.pins.loadb = 5; c.pins.enp = 0; c.pins.ent = 5;
        c.state._count = 7;
        c.pulse('clk');
        assert.equal(c.state._count, 7, 'held when ENP low');
    });
});

// ─── 74LS189: 16×4 RAM with inverted outputs ─────────────────────

describe('74LS189: 16×4 RAM (inverted outputs)', () => {
    beforeEach(setup); afterEach(teardown);

    it('write then read: outputs are INVERTED', () => {
        const c = makeChip('74ls189');
        // Write 0b1010 to address 3
        c.pins.csb = 0; c.pins.web = 0;
        c.pins.a0 = 5; c.pins.a1 = 5; c.pins.a2 = 0; c.pins.a3 = 0; // addr 3
        c.pins.d0 = 0; c.pins.d1 = 5; c.pins.d2 = 0; c.pins.d3 = 5; // data 0b1010
        c.tick();

        // Read: /CS low, /WE high
        c.pins.web = 5;
        c.tick();
        // Stored 0b1010: O0=inv(0)=HIGH, O1=inv(1)=LOW, O2=inv(0)=HIGH, O3=inv(1)=LOW
        assert.equal(c.state.drives.o0.vTh, 5, 'O0 = inv(0) = HIGH');
        assert.equal(c.state.drives.o1.vTh, 0, 'O1 = inv(1) = LOW');
        assert.equal(c.state.drives.o2.vTh, 5, 'O2 = inv(0) = HIGH');
        assert.equal(c.state.drives.o3.vTh, 0, 'O3 = inv(1) = LOW');
    });

    it('different addresses hold different values', () => {
        const c = makeChip('74ls189');
        c.pins.csb = 0;
        // Write 0xF to addr 0
        c.pins.web = 0; c.pins.a0 = 0; c.pins.a1 = 0; c.pins.a2 = 0; c.pins.a3 = 0;
        c.pins.d0 = 5; c.pins.d1 = 5; c.pins.d2 = 5; c.pins.d3 = 5;
        c.tick();
        // Write 0x0 to addr 1
        c.pins.a0 = 5; c.pins.d0 = 0; c.pins.d1 = 0; c.pins.d2 = 0; c.pins.d3 = 0;
        c.tick();

        // Read addr 0: stored 0xF → inverted = all LOW
        c.pins.web = 5; c.pins.a0 = 0;
        c.tick();
        for (let i = 0; i < 4; i++) assert.equal(c.state.drives[`o${i}`].vTh, 0, `addr0 O${i} LOW`);

        // Read addr 1: stored 0x0 → inverted = all HIGH
        c.pins.a0 = 5;
        c.tick();
        for (let i = 0; i < 4; i++) assert.equal(c.state.drives[`o${i}`].vTh, 5, `addr1 O${i} HIGH`);
    });

    it('deselected (/CS high): outputs all HIGH', () => {
        const c = makeChip('74ls189');
        c.pins.csb = 5; c.pins.web = 5;
        c.tick();
        for (let i = 0; i < 4; i++) assert.equal(c.state.drives[`o${i}`].vTh, 5, `deselected O${i} HIGH`);
    });
});

// ─── 74LS157: quad 2:1 multiplexer ───────────────────────────────

describe('74LS157: quad 2:1 mux', () => {
    beforeEach(setup); afterEach(teardown);

    it('S=0 selects A inputs, S=1 selects B inputs', () => {
        const c = makeChip('74ls157');
        c.pins.gb = 0; // enabled
        c.pins['1a'] = 5; c.pins['1b'] = 0;
        c.pins['2a'] = 0; c.pins['2b'] = 5;
        c.pins.s = 0; c.tick();
        assert.equal(c.state.drives['1y'].vTh, 5, 'S=0: 1Y = 1A = HIGH');
        assert.equal(c.state.drives['2y'].vTh, 0, 'S=0: 2Y = 2A = LOW');

        c.pins.s = 5; c.tick();
        assert.equal(c.state.drives['1y'].vTh, 0, 'S=1: 1Y = 1B = LOW');
        assert.equal(c.state.drives['2y'].vTh, 5, 'S=1: 2Y = 2B = HIGH');
    });

    it('/G high forces all outputs LOW', () => {
        const c = makeChip('74ls157');
        c.pins.gb = 5; // disabled
        c.pins['1a'] = 5; c.pins['1b'] = 5;
        c.pins.s = 0; c.tick();
        assert.equal(c.state.drives['1y'].vTh, 0, 'disabled: 1Y LOW');
        assert.equal(c.state.drives['2y'].vTh, 0, 'disabled: 2Y LOW');
    });

    it('all four channels are independent', () => {
        const c = makeChip('74ls157');
        c.pins.gb = 0; c.pins.s = 0;
        c.pins['1a'] = 5; c.pins['2a'] = 0; c.pins['3a'] = 5; c.pins['4a'] = 0;
        c.tick();
        assert.equal(c.state.drives['1y'].vTh, 5);
        assert.equal(c.state.drives['2y'].vTh, 0);
        assert.equal(c.state.drives['3y'].vTh, 5);
        assert.equal(c.state.drives['4y'].vTh, 0);
    });
});

// ─── 74LS107: dual JK flip-flop (falling edge) ──────────────────

describe('74LS107: dual JK flip-flop', () => {
    beforeEach(setup); afterEach(teardown);

    it('triggers on FALLING edge of CLK', () => {
        const c = makeChip('74ls107');
        c.pins['1clrb'] = 5; c.pins['2clrb'] = 5; // not clearing
        c.pins['1j'] = 5; c.pins['1k'] = 0; // J=1 K=0 → set
        c.pins['1clk'] = 5; c.tick(); // rising: no change
        assert.equal(c.state._q[0], 0, 'no change on rising edge');
        c.pins['1clk'] = 0; c.tick(); // falling: triggers
        assert.equal(c.state._q[0], 1, 'set on falling edge');
        assert.equal(c.state.drives['1q'].vTh, 5);
        assert.equal(c.state.drives['1qb'].vTh, 0);
    });

    it('J=1 K=1 toggles', () => {
        const c = makeChip('74ls107');
        c.pins['1clrb'] = 5; c.pins['2clrb'] = 5;
        c.pins['1j'] = 5; c.pins['1k'] = 5;
        // Falling edge 1: toggle 0→1
        c.pins['1clk'] = 5; c.tick(); c.pins['1clk'] = 0; c.tick();
        assert.equal(c.state._q[0], 1);
        // Falling edge 2: toggle 1→0
        c.pins['1clk'] = 5; c.tick(); c.pins['1clk'] = 0; c.tick();
        assert.equal(c.state._q[0], 0);
    });

    it('/CLR clears asynchronously (active low)', () => {
        const c = makeChip('74ls107');
        c.pins['1clrb'] = 5; c.pins['2clrb'] = 5;
        c.pins['1j'] = 5; c.pins['1k'] = 0;
        c.pins['1clk'] = 5; c.tick(); c.pins['1clk'] = 0; c.tick();
        assert.equal(c.state._q[0], 1, 'set');
        c.pins['1clrb'] = 0; c.tick();
        assert.equal(c.state._q[0], 0, 'cleared by /CLR low');
    });

    it('two flip-flops are independent', () => {
        const c = makeChip('74ls107');
        c.pins['1clrb'] = 5; c.pins['2clrb'] = 5;
        c.pins['1j'] = 5; c.pins['1k'] = 0; // FF1: set
        c.pins['2j'] = 0; c.pins['2k'] = 5; // FF2: reset (already 0, stays 0)
        c.pins['1clk'] = 5; c.pins['2clk'] = 5; c.tick();
        c.pins['1clk'] = 0; c.pins['2clk'] = 0; c.tick();
        assert.equal(c.state._q[0], 1, 'FF1 set');
        assert.equal(c.state._q[1], 0, 'FF2 stays 0');
    });
});

function afterEach(fn) {} // placeholder — beforeEach handles registration
