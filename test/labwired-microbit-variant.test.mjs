import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildLabwiredSystem, labwiredAdapterOptionsFor} from '../src/labwired-bridge.js';
import {MICROBIT_V2} from '../src/labwired-chips.js';

const bench = {parts: [{id: 'mb', kind: 'microbit'}], nets: []};
const build = options => buildLabwiredSystem({netlist: bench, chipKind: 'microbit_v2', ...options});

test('default micro:bit remains matrix-only, including explicit null variant', () => {
    const base = build({});
    assert.equal(base.ok, true);
    assert.equal(base.boardVariant, null);
    assert.equal(base.systemYaml, build({boardVariant: null}).systemYaml);
    assert.match(base.systemYaml, /type: "led-matrix-mux"/);
    assert.doesNotMatch(base.systemYaml, /lsm303agr|accelerometer|magnetometer/);
});

test('selected LSM303AGR attaches both scoped devices on internal TWIM0 once', () => {
    const selected = build({boardVariant: 'lsm303agr'});
    assert.equal(selected.ok, true);
    assert.equal(selected.boardVariant, 'lsm303agr');
    assert.match(selected.systemYaml, /id: "accelerometer"\n {4}type: "lsm303agr_accel"\n {4}connection: "i2c0"/);
    assert.match(selected.systemYaml, /id: "magnetometer"\n {4}type: "lsm303agr_mag"\n {4}connection: "i2c0"/);
    assert.equal(selected.systemYaml.match(/id: "led_matrix"/g).length, 1);
    assert.equal(selected.systemYaml.match(/^external_devices:/gm).length, 1);
    assert.doesNotMatch(selected.systemYaml, /irq_pin|interrupt_pin|P0\.25|FXOS/);
    assert.equal(selected.chipYaml, MICROBIT_V2.chipYaml);
    assert.deepEqual(selected.pins, MICROBIT_V2.pins);
    assert.deepEqual(selected.bindings, build({}).bindings, 'circuit pad bindings do not change');
});

test('selected devices retain the matrix publisher and both chip aliases', () => {
    for (const chipKind of ['microbit', 'microbit_v2']) {
        const opts = labwiredAdapterOptionsFor({netlist: bench, chipKind, boardVariant: 'lsm303agr'});
        assert.equal(opts.boardVariant, 'lsm303agr');
        assert.equal(opts.onBoardMatrix, 'led_matrix');
        assert.deepEqual(opts.onBoardDisplays, [{id: 'led_matrix', type: 'led-matrix-mux'}]);
        assert.equal(opts.mcuId, 'mb');
    }
});

test('unknown, inherited and malformed variants never silently use the default', () => {
    for (const boardVariant of ['fxos8700', '', '__proto__', 'constructor', 1, false, ['lsm303agr'], {}]) {
        const result = build({boardVariant});
        assert.equal(result.ok, false);
        assert.equal(result.systemYaml, null);
        assert.equal(result.refusals[0].code, 'board-variant-unmapped');
        assert.throws(() => labwiredAdapterOptionsFor({netlist: bench, chipKind: 'microbit_v2', boardVariant}),
            /board-variant-unmapped/);
    }
});

test('the selected micro:bit sensor variant is not attached to unrelated chips', () => {
    const result = build({chipKind: 'stm32f030', boardVariant: 'lsm303agr'});
    assert.equal(result.ok, false);
    assert.equal(result.refusals[0].code, 'board-variant-unmapped');
});
