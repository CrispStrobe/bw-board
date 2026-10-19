// A stepper is UNIPOLAR or BIPOLAR, and they are different motors.
//
// Unipolar is five wires: four coils sharing a centre tap, each pulled low in
// turn — a 28BYJ-48 behind a ULN2003. Bipolar is four: two coils driven BOTH
// WAYS by an H-bridge — a NEMA-17 behind an L298. The model had only the
// first, so bw-parts' four-wire sidecar described a motor that could not be
// wired, which the terminal cross-check counted as four unreachable pins.
//
// params.wiring picks. Default stays unipolar so no existing bench moves.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';

registerAllDevices();

const TERMS = ['coil_a1', 'coil_a2', 'coil_b1', 'coil_b2'];

/**
 * A bipolar stepper whose four wires are each driven to a rail, the way an
 * H-bridge drives them. `drive` is [a1, a2, b1, b2]: 1 high, 0 low, null open.
 */
function motor(stepsPerRev = 200) {
    const board = new BoardImpl(12.0);
    // Two DIP banks stand in for the H-bridge legs: SH pulls a wire up, SL
    // pulls it down, and closing neither leaves it floating. (A first cut used
    // `switch` parts and every coil end sat at 4 V with no difference across
    // it — nothing drove, so no phase was ever detected.)
    const parts = [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'M', kind: 'stepper', params: { wiring: 'bipolar', stepsPerRev }, terminals: TERMS },
        { id: 'SH', kind: 'dip_switch_spst', params: { switches: 0 },
          terminals: ['1a', '2a', '3a', '4a', '1b', '2b', '3b', '4b'] },
        { id: 'SL', kind: 'dip_switch_spst', params: { switches: 0 },
          terminals: ['1a', '2a', '3a', '4a', '1b', '2b', '3b', '4b'] },
    ];
    const hi = [{ part: 'VCC', terminal: 'vcc' }];
    const lo = [{ part: 'GND', terminal: 'gnd' }];
    const nets = [];
    TERMS.forEach((t, i) => {
        hi.push({ part: 'SH', terminal: `${i + 1}a` });
        lo.push({ part: 'SL', terminal: `${i + 1}b` });
        nets.push({ id: `n_${t}`, terminals: [
            { part: 'M', terminal: t },
            { part: 'SH', terminal: `${i + 1}b` },
            { part: 'SL', terminal: `${i + 1}a` },
        ] });
    });
    nets.push({ id: 'nv', terminals: hi }, { id: 'ng', terminals: lo });
    board.setNetlist(parts, nets);

    let now = 0n;
    const api = {
        /** Drive the four wires: 1 high, 0 low, null floating. */
        drive(want) {
            let up = 0;
            let down = 0;
            want.forEach((v, i) => {
                if (v === 1) up |= 1 << i;
                if (v === 0) down |= 1 << i;
            });
            board.setPartParam('SH', 'switches', up);
            board.setPartParam('SL', 'switches', down);
            now += 2_000_000n; board.advanceTo(now);
            now += 2_000_000n; board.advanceTo(now);
            return api;
        },
        volts: (t) => board.nodeVoltage(`n_${t}`),
        state: () => board.getDeviceState('M'),
    };
    return api;
}

// Full step, one coil at a time: A+, B+, A-, B-.
const FORWARD = [[1, 0, null, null], [null, null, 1, 0], [0, 1, null, null], [null, null, 0, 1]];

describe('bipolar stepper', () => {
    it('four full steps advance it by four', () => {
        const m = motor(200);
        for (const s of FORWARD) m.drive(s);
        assert.equal(m.state().stepCount, 3,
            'three transitions from the first energised phase');
        assert.ok(Math.abs(m.state().angle - 3 * 1.8) < 0.01, `angle ${m.state().angle}`);
    });

    it('reversing the sequence unwinds it', () => {
        // The property that separates a stepper from a thing that spins: the
        // phase ORDER carries direction, so playing it backwards returns.
        const m = motor(200);
        for (const s of FORWARD) m.drive(s);
        const forward = m.state().stepCount;
        for (const s of [...FORWARD].reverse().slice(1)) m.drive(s);
        assert.ok(m.state().stepCount < forward,
            `stepping back must decrease the count: ${forward} -> ${m.state().stepCount}`);
    });

    it('the current through a coil actually reverses, which is what phase means here', () => {
        // The physical fact the model rests on, and the whole difference from
        // unipolar: A+ and A- energise the SAME coil in opposite directions.
        // A sign-blind reading would call both "coil A is on" and see one
        // phase where there are two — and then the forward sequence above
        // would count DOWN, because B+ -> A+ looks like a step backwards.
        const m = motor(200);
        m.drive([1, 0, null, null]);                       // A+
        const plus = m.volts('coil_a1') - m.volts('coil_a2');
        m.drive([0, 1, null, null]);                       // A-
        const minus = m.volts('coil_a1') - m.volts('coil_a2');
        assert.ok(plus > 1, `A+ should put a positive volt across coil A, got ${plus.toFixed(2)}`);
        assert.ok(minus < -1, `A- should reverse it, got ${minus.toFixed(2)}`);

        // And a two-phase jump is NOT one step: the counter only follows
        // adjacent transitions, so A+ straight to A- moves nothing. That is
        // the model being right, not shy.
        const before = m.state().stepCount;
        m.drive([1, 0, null, null]);
        m.drive([0, 1, null, null]);
        assert.equal(m.state().stepCount, before, 'a jump of two phases is not a step');
    });

    it('the default wiring is still unipolar, with its five terminals', () => {
        // Backwards compatibility, asserted rather than hoped: every bench
        // that placed a stepper before this existed keeps coil1..4 and com.
        const board = new BoardImpl(12.0);
        board.setNetlist([
            { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
            { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
            { id: 'M', kind: 'stepper', params: {},
              terminals: ['coil1', 'coil2', 'coil3', 'coil4', 'com'] },
        ], [
            { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'M', terminal: 'com' }] },
            { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'M', terminal: 'coil1' }] },
        ]);
        assert.ok(board.getDeviceState('M'), 'a unipolar stepper still loads');
    });
});
