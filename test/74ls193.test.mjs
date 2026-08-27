// 74LS193 — the up/DOWN counter, which is the one a stack pointer needs.
//
// The tests that matter are the ones a 74LS161 would also pass if you got
// the chip wrong: counting UP proves almost nothing. What separates a 193
// is counting DOWN, an ASYNCHRONOUS load (the 161's waits for an edge),
// and cascade outputs that are gated by their own clock rather than being
// a bare "count == 15".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';

registerAllDevices();

const HI = 'net_vcc';
const LO = 'net_gnd';

/**
 * A 193 driven by two DIP-switch banks.
 *
 * The first cut of this rig rebuilt the netlist for every level change,
 * which re-runs init() and wipes _count and the edge history — so the chip
 * looked broken while it was the instrument resetting it. Switch params
 * move levels without touching the netlist.
 */
function rig() {
    const T = ['d0', 'd1', 'd2', 'd3', 'q0', 'q1', 'q2', 'q3',
        'up', 'down', 'loadb', 'clr', 'cob', 'bob', 'vcc', 'gnd'];
    const DATA = ['d0', 'd1', 'd2', 'd3'];
    const CTRL = ['up', 'down', 'loadb', 'clr'];

    const parts = [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'U', kind: '74ls193', params: {}, terminals: T },
        { id: 'SD', kind: 'dip_switch_spst', params: { switches: 0 },
          terminals: ['1a', '2a', '3a', '4a', '1b', '2b', '3b', '4b'] },
        { id: 'SC', kind: 'dip_switch_spst', params: { switches: 0 },
          terminals: ['1a', '2a', '3a', '4a', '1b', '2b', '3b', '4b'] },
    ];
    const hi = [{ part: 'VCC', terminal: 'vcc' }, { part: 'U', terminal: 'vcc' }];
    const lo = [{ part: 'GND', terminal: 'gnd' }, { part: 'U', terminal: 'gnd' }];
    const nets = [];
    [[DATA, 'SD'], [CTRL, 'SC']].forEach(([pins, sw]) => {
        pins.forEach((pin, i) => {
            hi.push({ part: sw, terminal: `${i + 1}a` });
            const r = `r_${pin}`;
            parts.push({ id: r, kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] });
            nets.push({ id: `n_${pin}`, terminals: [
                { part: sw, terminal: `${i + 1}b` },
                { part: r, terminal: 'a' },
                { part: 'U', terminal: pin },
            ] });
            lo.push({ part: r, terminal: 'b' });
        });
    });
    for (const t of ['q0', 'q1', 'q2', 'q3', 'cob', 'bob']) {
        nets.push({ id: `n_${t}`, terminals: [{ part: 'U', terminal: t }] });
    }
    nets.push({ id: HI, terminals: hi }, { id: LO, terminals: lo });

    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);

    const bits = { SD: 0, SC: 0 };
    let now = 0n;
    const settle = () => {
        now += 1_000_000n; board.advanceTo(now);
        now += 1_000_000n; board.advanceTo(now);
    };
    const bankOf = (pin) => (DATA.includes(pin) ? ['SD', DATA.indexOf(pin)] : ['SC', CTRL.indexOf(pin)]);

    const api = {
        set(pin, v) {
            const [sw, i] = bankOf(pin);
            bits[sw] = v ? (bits[sw] | (1 << i)) : (bits[sw] & ~(1 << i));
            board.setPartParam(sw, 'switches', bits[sw]);
            settle();
            return api;
        },
        setAll(obj) {
            for (const [pin, v] of Object.entries(obj)) {
                const [sw, i] = bankOf(pin);
                bits[sw] = v ? (bits[sw] | (1 << i)) : (bits[sw] & ~(1 << i));
            }
            board.setPartParam('SD', 'switches', bits.SD);
            board.setPartParam('SC', 'switches', bits.SC);
            settle();
            return api;
        },
        count() {
            return [0, 1, 2, 3].reduce((a, i) =>
                a + (board.nodeVoltage(`n_q${i}`) > 2.5 ? 1 << i : 0), 0);
        },
        low(pin) { return board.nodeVoltage(`n_${pin}`) < 2.5; },
        countUp() { api.setAll({ down: true, up: false }); api.set('up', true); return api; },
        countDown() { api.setAll({ up: true, down: false }); api.set('down', true); return api; },
    };
    // Bringing the idle clocks HIGH is itself a rising edge, so a rig that
    // merely sets the levels starts at 1. That is the chip being right, not
    // wrong — so clear afterwards, which is what you would do at a bench.
    api.setAll({ loadb: true, clr: true, up: true, down: true });
    api.set('clr', false);
    return api;
}

test('clear is asynchronous and active HIGH', () => {
    const u = rig();
    u.countUp().countUp().countUp();
    assert.equal(u.count(), 3);
    u.set('clr', true);
    assert.equal(u.count(), 0, 'CLEAR needs no clock edge');
    u.set('clr', false);
});

test('load is ASYNCHRONOUS — the 161 next door waits for an edge', () => {
    const u = rig();
    u.setAll({ d0: true, d1: false, d2: true, d3: true });   // 1101 = 13
    u.set('loadb', false);
    assert.equal(u.count(), 13, 'no clock was given, and it loaded anyway');
    u.set('loadb', true);
    assert.equal(u.count(), 13, 'and it stays after /LOAD is released');
});

test('clear beats load', () => {
    const u = rig();
    u.setAll({ d0: true, d1: true, d2: true, d3: true });
    u.setAll({ loadb: false, clr: true });
    assert.equal(u.count(), 0, 'CLEAR wins when both are asserted');
});

test('counts up, wraps 15 to 0', () => {
    const u = rig();
    const seen = [];
    for (let i = 0; i < 17; i++) { seen.push(u.count()); u.countUp(); }
    assert.deepEqual(seen, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 0]);
});

test('counts DOWN, wraps 0 to 15 — the half a 74LS161 cannot do', () => {
    const u = rig();
    const seen = [];
    for (let i = 0; i < 5; i++) { seen.push(u.count()); u.countDown(); }
    assert.deepEqual(seen, [0, 15, 14, 13, 12]);
});

test('up then down returns to where it started', () => {
    // A stack pointer is only useful if push and pop are inverses.
    const u = rig();
    u.setAll({ d0: false, d1: true, d2: false, d3: true });  // 1010 = 10
    u.set('loadb', false); u.set('loadb', true);
    assert.equal(u.count(), 10);
    u.countUp().countUp().countUp();
    assert.equal(u.count(), 13);
    u.countDown().countDown().countDown();
    assert.equal(u.count(), 10, 'three pushes and three pops leave it where it was');
});

test('the idle clock must be held high, or nothing counts', () => {
    const u = rig();
    u.setAll({ up: false, down: false });
    u.set('up', true);
    assert.equal(u.count(), 0, 'DOWN low holds the counter still');
});

test('/CO and /BO are gated by their own clock, not bare count comparisons', () => {
    // This is what makes them cascade: what leaves the pin is a PULSE that
    // can clock the next stage. A naive "low when count == 15" would sit
    // low forever and the next chip would never see an edge.
    const u = rig();
    u.setAll({ d0: true, d1: true, d2: true, d3: true });    // 15
    u.set('loadb', false); u.set('loadb', true);
    assert.equal(u.count(), 15);

    u.setAll({ down: true, up: true });
    assert.equal(u.low('cob'), false, 'at 15 with UP high, /CO is not asserted');
    u.set('up', false);
    assert.equal(u.low('cob'), true, 'at 15 with UP low, /CO goes low');

    // Hold CLEAR across the clock changes. Raising UP back to high after the
    // /CO check is a rising edge like any other, and letting it land would
    // count to 1 and quietly make the /BO assertion below test nothing —
    // the same trap the rig's own setup falls into two screens up.
    u.set('clr', true);
    u.setAll({ up: true, down: true });
    u.set('clr', false);
    assert.equal(u.count(), 0);
    assert.equal(u.low('bob'), false, 'at 0 with DOWN high, /BO is not asserted');
    u.set('down', false);
    assert.equal(u.low('bob'), true, 'at 0 with DOWN low, /BO goes low');
});
