import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';

registerAllDevices();

/**
 * The orientation contract on both new accelerometers: params gx/gy/gz
 * in g via setPartParam, one stimulus channel for every accel model.
 */

const adxlBoard = (extraNets = []) => {
    const parts = [
        { id: 'v1', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'g1', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'a1', kind: 'adxl335', params: {}, terminals: ['vcc', 'gnd', 'xout', 'yout', 'zout', 'st'] },
    ];
    const nets = [
        { id: 'n_v', terminals: [{ part: 'v1', terminal: 'vcc' }, { part: 'a1', terminal: 'vcc' }] },
        { id: 'n_g', terminals: [{ part: 'g1', terminal: 'gnd' }, { part: 'a1', terminal: 'gnd' }] },
        { id: 'n_x', terminals: [{ part: 'a1', terminal: 'xout' }] },
        { id: 'n_y', terminals: [{ part: 'a1', terminal: 'yout' }] },
        { id: 'n_z', terminals: [{ part: 'a1', terminal: 'zout' }] },
        ...extraNets,
    ];
    const b = new BoardImpl(5.0);
    b.setNetlist(parts, nets);
    b.advanceTo(1_000_000n);
    return b;
};

describe('adxl335 — ratiometric analog 3-axis', () => {
    it('flat on the bench: x/y at Vs/2, z one g above', () => {
        const b = adxlBoard();
        assert.ok(Math.abs(b.nodeVoltages.get('n_x') - 2.5) < 0.05, `x ${b.nodeVoltages.get('n_x')}`);
        assert.ok(Math.abs(b.nodeVoltages.get('n_y') - 2.5) < 0.05, `y ${b.nodeVoltages.get('n_y')}`);
        assert.ok(Math.abs(b.nodeVoltages.get('n_z') - 3.0) < 0.05, `z ${b.nodeVoltages.get('n_z')}`);
    });

    it('tilting through setPartParam moves the axis output ratiometrically', () => {
        const b = adxlBoard();
        b.setPartParam('a1', 'gx', 1);      // on its side: X sees gravity
        b.setPartParam('a1', 'gz', 0);
        b.advanceTo(2_000_000n);
        assert.ok(Math.abs(b.nodeVoltages.get('n_x') - 3.0) < 0.05, `x ${b.nodeVoltages.get('n_x')}`);
        assert.ok(Math.abs(b.nodeVoltages.get('n_z') - 2.5) < 0.05, `z ${b.nodeVoltages.get('n_z')}`);
    });

    it('self-test: ST high adds the datasheet deflection', () => {
        const parts = [
            { id: 'v1', kind: 'vcc', params: {}, terminals: ['vcc'] },
            { id: 'g1', kind: 'gnd', params: {}, terminals: ['gnd'] },
            { id: 'a1', kind: 'adxl335', params: {}, terminals: ['vcc', 'gnd', 'xout', 'yout', 'zout', 'st'] },
        ];
        const nets = [
            { id: 'n_v', terminals: [{ part: 'v1', terminal: 'vcc' }, { part: 'a1', terminal: 'vcc' }, { part: 'a1', terminal: 'st' }] },
            { id: 'n_g', terminals: [{ part: 'g1', terminal: 'gnd' }, { part: 'a1', terminal: 'gnd' }] },
            { id: 'n_z', terminals: [{ part: 'a1', terminal: 'zout' }] },
        ];
        const b = new BoardImpl(5.0);
        b.setNetlist(parts, nets);
        b.advanceTo(1_000_000n);
        // z = (1 + 1.83) g → 2.5 + 2.83 * 0.5 = 3.915 V
        assert.ok(Math.abs(b.nodeVoltages.get('n_z') - 3.915) < 0.06, `z ${b.nodeVoltages.get('n_z')}`);
    });
});

describe('memsic2125 — PWM duty carries the g', () => {
    const duty = (b, net, fromNs, periodNs, stepNs) => {
        let high = 0, total = 0;
        for (let t = fromNs; t < fromNs + periodNs; t += stepNs) {
            b.advanceTo(BigInt(t));
            total++;
            if (b.nodeVoltages.get(net) > 2.5) high++;
        }
        return high / total;
    };

    it('0 g is 50% duty; +1 g is 62.5% (the sketch formula inverts this)', () => {
        const parts = [
            { id: 'v1', kind: 'vcc', params: {}, terminals: ['vcc'] },
            { id: 'g1', kind: 'gnd', params: {}, terminals: ['gnd'] },
            { id: 'm1', kind: 'memsic2125', params: {}, terminals: ['vcc', 'gnd', 'xout', 'yout'] },
        ];
        const nets = [
            { id: 'n_v', terminals: [{ part: 'v1', terminal: 'vcc' }, { part: 'm1', terminal: 'vcc' }] },
            { id: 'n_g', terminals: [{ part: 'g1', terminal: 'gnd' }, { part: 'm1', terminal: 'gnd' }] },
            { id: 'n_x', terminals: [{ part: 'm1', terminal: 'xout' }] },
        ];
        const b = new BoardImpl(5.0);
        b.setNetlist(parts, nets);
        const d0 = duty(b, 'n_x', 1_000_000, 10_000_000, 50_000);
        assert.ok(Math.abs(d0 - 0.5) < 0.05, `0 g duty ${d0}`);
        b.setPartParam('m1', 'gx', 1);
        const d1 = duty(b, 'n_x', 21_000_000, 10_000_000, 50_000);
        assert.ok(Math.abs(d1 - 0.625) < 0.05, `+1 g duty ${d1}`);
    });
});
