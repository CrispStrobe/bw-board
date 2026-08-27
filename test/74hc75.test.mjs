// 74HC75 — a quad latch, and the half of it that was missing.
//
// The DIP16 brings out Q and /Q for all four bits; that is what fills a
// sixteen-pin package for four bits of latch. The model had Q only, so four
// of the chip's pins could be wired on a board and reached by nothing.
//
// The interesting test is the FIRST one: /Q starts high, and a model that
// writes its outputs only when the latch changes leaves all four inverted
// outputs stuck low until some bit happens to move. Nothing else notices.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';

registerAllDevices();

const DRIVEN = ['1d', '2d', '3d', '4d', '1e', '2e'];
const OUT = ['1q', '2q', '3q', '4q', '1q_bar', '2q_bar', '3q_bar', '4q_bar'];

function rig() {
    const parts = [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'U', kind: '74hc75', params: {}, terminals: [...DRIVEN, ...OUT, 'vcc', 'gnd'] },
        { id: 'SW', kind: 'dip_switch_spst', params: { switches: 0 },
          terminals: ['1a', '2a', '3a', '4a', '1b', '2b', '3b', '4b'] },
        { id: 'SE', kind: 'dip_switch_spst', params: { switches: 0 },
          terminals: ['1a', '2a', '3a', '4a', '1b', '2b', '3b', '4b'] },
    ];
    const hi = [{ part: 'VCC', terminal: 'vcc' }, { part: 'U', terminal: 'vcc' }];
    const lo = [{ part: 'GND', terminal: 'gnd' }, { part: 'U', terminal: 'gnd' }];
    const nets = [];
    const wire = (pin, sw, pos) => {
        hi.push({ part: sw, terminal: `${pos}a` });
        const r = `r_${pin}`;
        parts.push({ id: r, kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] });
        nets.push({ id: `n_${pin}`, terminals: [
            { part: sw, terminal: `${pos}b` },
            { part: r, terminal: 'a' },
            { part: 'U', terminal: pin },
        ] });
        lo.push({ part: r, terminal: 'b' });
    };
    ['1d', '2d', '3d', '4d'].forEach((p, i) => wire(p, 'SW', i + 1));
    ['1e', '2e'].forEach((p, i) => wire(p, 'SE', i + 1));
    for (const o of OUT) nets.push({ id: `n_${o}`, terminals: [{ part: 'U', terminal: o }] });
    nets.push({ id: 'net_vcc', terminals: hi }, { id: 'net_gnd', terminals: lo });

    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);
    const bits = { SW: 0, SE: 0 };
    let now = 0n;
    const settle = () => {
        now += 1_000_000n; board.advanceTo(now);
        now += 1_000_000n; board.advanceTo(now);
    };
    const bank = (p) => (p.endsWith('d') ? ['SW', Number(p[0]) - 1] : ['SE', Number(p[0]) - 1]);
    const api = {
        set(obj) {
            for (const [pin, v] of Object.entries(obj)) {
                const [sw, i] = bank(pin);
                bits[sw] = v ? (bits[sw] | (1 << i)) : (bits[sw] & ~(1 << i));
            }
            board.setPartParam('SW', 'switches', bits.SW);
            board.setPartParam('SE', 'switches', bits.SE);
            settle();
            return api;
        },
        high: (pin) => board.nodeVoltage(`n_${pin}`) > 2.5,
    };
    settle();
    return api;
}

test('/Q is HIGH from the first solve, with no latch movement at all', () => {
    // The bug this catches: outputs written only inside `if (changed)`.
    // Nothing has changed yet, so a conditional write leaves /Q at init's
    // zero — four pins reading the opposite of the truth, silently.
    const u = rig();
    for (const i of [1, 2, 3, 4]) {
        assert.equal(u.high(`${i}q`), false, `${i}q starts low`);
        assert.equal(u.high(`${i}q_bar`), true, `${i}q_bar must start HIGH`);
    }
});

test('Q and /Q are complementary for every bit, transparent and latched', () => {
    const u = rig();
    u.set({ '1e': true, '2e': true });          // transparent
    u.set({ '1d': true, '2d': false, '3d': true, '4d': false });
    const want = [true, false, true, false];
    want.forEach((v, i) => {
        assert.equal(u.high(`${i + 1}q`), v, `${i + 1}q follows D while enabled`);
        assert.equal(u.high(`${i + 1}q_bar`), !v, `${i + 1}q_bar is its complement`);
    });

    u.set({ '1e': false, '2e': false });        // latch
    u.set({ '1d': false, '2d': true, '3d': false, '4d': true });
    want.forEach((v, i) => {
        assert.equal(u.high(`${i + 1}q`), v, `${i + 1}q held after the enable fell`);
        assert.equal(u.high(`${i + 1}q_bar`), !v, `${i + 1}q_bar held too`);
    });
});

test('the two enables are independent — 1E holds bits 1,2 and 2E bits 3,4', () => {
    // A latch whose enables are crossed passes every test that moves both
    // together, which is why this one moves exactly one.
    const u = rig();
    u.set({ '1e': true, '2e': true });
    u.set({ '1d': true, '2d': true, '3d': true, '4d': true });
    u.set({ '1e': false });                     // freeze bits 1 and 2 only
    u.set({ '1d': false, '2d': false, '3d': false, '4d': false });

    assert.equal(u.high('1q'), true, 'bit 1 was frozen high');
    assert.equal(u.high('2q'), true, 'bit 2 was frozen high');
    assert.equal(u.high('3q'), false, 'bit 3 stayed transparent and followed D down');
    assert.equal(u.high('4q'), false, 'bit 4 too');
    assert.equal(u.high('1q_bar'), false);
    assert.equal(u.high('3q_bar'), true);
});
