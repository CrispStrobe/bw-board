import test from 'node:test';
import assert from 'node:assert/strict';
import {createEmu8051DebugTarget} from '../src/emu8051-debug.js';

const makeTarget = () => {
    const armed = [];
    const wasm = Object.fromEntries([
        '_emu_dbg_state', '_emu_dbg_run', '_emu_dbg_halt', '_emu_dbg_step',
        '_emu_dbg_reset', '_emu_dbg_run_until_ns', '_emu_dbg_read_mem',
        '_emu_dbg_write_mem', '_emu_dbg_pc'
    ].map(name => [name, () => 0]));
    wasm._emu_dbg_set_bp_code = address => {
        armed.push(address);
        return armed.length;
    };
    return {target: createEmu8051DebugTarget(wasm), armed};
};

const REFUSAL = {
    unsupported: 'code breakpoint addr must be in 0x0000..0xffff'
};

test('emu8051 run-to publishes the exact synchronous code-address boundary', () => {
    const {target, armed} = makeTarget();
    const [route] = target.capabilities().runTo;
    const {addressMax, ...shape} = route;
    assert.deepEqual(shape, {
        kind: 'address', space: 'code', addressMin: 0,
        stopSides: ['before'], installation: 'sync'
    });
    assert.equal(addressMax, 0xffff, 'the published range spans the architectural 16-bit PC');

    assert.equal(typeof target.setBreakpoint({kind: 'code', addr: addressMax}), 'number',
        'the highest address a caller is told about must be settable');
    assert.deepEqual(armed, [addressMax]);

    assert.deepEqual(target.setBreakpoint({kind: 'code', addr: addressMax + 1}), REFUSAL,
        'the first address beyond the published range must be refused');
});

test('emu8051 rejects a high address before it can alias byte zero in WASM', () => {
    const {target, armed} = makeTarget();
    const result = target.setBreakpoint({kind: 'code', addr: 0x10000});
    assert.deepEqual(armed, [],
        'a high address must not silently arm a different byte');
    assert.deepEqual(result, REFUSAL);
});

for (const [name, addr] of [
    ['negative', -1],
    ['fractional', 1.5],
    ['non-finite', Number.NaN]
]) {
    test(`emu8051 code breakpoint refuses a ${name} address before calling WASM`, () => {
        const {target, armed} = makeTarget();
        assert.deepEqual(target.setBreakpoint({kind: 'code', addr}), REFUSAL);
        assert.deepEqual(armed, [], 'an invalid address must not arm any native breakpoint');
    });
}
