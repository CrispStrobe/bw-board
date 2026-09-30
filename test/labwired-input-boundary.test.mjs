/**
 * Two deliberately separate proofs: JS call-contract doubles check admission
 * and forwarding; the opt-in suite below uses actual published/generated WASM
 * and real analog kits to prove backend scoping and transaction atomicity.
 * Neither suite qualifies LSM303AGR, browser rendering or performance.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { createLabwiredAdapter, plain } from '../src/labwired-adapter.js';
import { createLabwiredDebugTarget } from '../src/labwired-debug.js';
import { binToElf } from '../src/bin-to-elf.js';

const contractAdapter = sim => createLabwiredAdapter({
    wasm: { WasmSimulator: { new_from_config: () => sim } },
    chipYaml: 'arch: arm', firmwareOnly: true,
});

describe('engineering input JS call contract (backend doubles, not model proof)', () => {
    it('missing APIs refuse explicitly, never use sequential set_input fallback', () => {
        let singles = 0;
        const adapter = contractAdapter({ set_input: () => { singles++; } });
        assert.throws(() => adapter.discoverInputs(), /no input discovery/);
        assert.throws(() => adapter.setInputs([{ channel: 'x', value: 1 }]), /no atomic inputs/);
        assert.equal(singles, 0);
    });

    it('discovery normalizes actual serde Map shapes and rejects malformed top level', () => {
        const row = new Map([['peripheral', 'accel'], ['key', 'x'], ['unit', 'g']]);
        assert.deepEqual(contractAdapter({ list_inputs: () => [row] }).discoverInputs(),
            [{ peripheral: 'accel', key: 'x', unit: 'g' }]);
        assert.throws(() => contractAdapter({ list_inputs: () => null }).discoverInputs(), /invalid channel list/);
        assert.throws(() => contractAdapter({ list_inputs: () => { throw Error('backend unavailable'); } })
            .discoverInputs(), /backend unavailable/);
    });

    it('validates every row before one copied atomic call, without trimming identities', () => {
        const calls = [];
        const adapter = contractAdapter({ set_inputs: rows => { calls.push(rows); } });
        const input = [{ component: 'accelerometer', channel: 'x', value: 1 },
            { component: 'magnetometer', channel: 'x', value: 30 }];
        const receipt = adapter.setInputs(input);
        assert.deepEqual(calls, [input]);
        assert.notEqual(receipt, input);
        assert.notEqual(receipt[0], input[0]);
        input[0].value = 99;
        assert.equal(calls[0][0].value, 1);
        adapter.setInputs([{ channel: 'position', value: 50 }]);
        assert.deepEqual(calls[1], [{ channel: 'position', value: 50 }]);
    });

    it('bad later rows, nonfinite values and unknown fields never reach the backend', () => {
        let calls = 0;
        const adapter = contractAdapter({ set_inputs: () => { calls++; } });
        for (const bad of [null, [], {}, { channel: '', value: 1 },
            { channel: 'x', value: '1' }, { channel: 'x', value: NaN },
            { channel: 'x', value: Infinity }, { channel: 'x', value: 1, component: null },
            { channel: 'x', value: 1, component: '' }, { channel: 'x', value: 1, raw: true }]) {
            assert.throws(() => adapter.setInputs([{ channel: 'x', value: 1 }, bad]), /each input/);
        }
        assert.throws(() => adapter.setInputs({ channel: 'x', value: 1 }), /must be an array/);
        assert.throws(() => adapter.setInputs(new Array(2)), /each input/);
        assert.equal(calls, 0);
    });

    it('backend transaction errors propagate without a success receipt', () => {
        const adapter = contractAdapter({ set_inputs: () => { throw Error('unknown component'); } });
        assert.throws(() => adapter.setInputs([{ component: 'missing', channel: 'x', value: 1 }]),
            /unknown component/);
    });

    it('reset uses the new backend for both discovery and writes', () => {
        let generation = 0;
        const calls = [];
        const adapter = createLabwiredAdapter({ chipYaml: 'arch: arm', firmwareOnly: true,
            wasm: { WasmSimulator: { new_from_config: () => {
                const id = ++generation;
                return { list_inputs: () => [{ peripheral: String(id) }],
                    set_inputs: () => calls.push(id) };
            } } } });
        adapter.setInputs([]);
        adapter.resetToProgram();
        assert.deepEqual(adapter.discoverInputs(), [{ peripheral: '2' }]);
        adapter.setInputs([]);
        assert.deepEqual(calls, [1, 2]);
    });

    it('debug boundary refuses missing input methods and detached targets', () => {
        const target = createLabwiredDebugTarget({ adapter: {
            sim: {}, firmwareOnly: true, clockHz: 48_000_000,
        } });
        assert.match(target.discoverInputs().unsupported, /no input discovery/);
        assert.equal(target.setInputs([]).code, 'inputs-unavailable');
        target.detach();
        assert.equal(target.setInputs([]).code, 'detached');
        assert.match(target.discoverInputs().unsupported, /detached/);
    });
});

// Existing CI can use its NODEJS build. A caller can also exercise published
// WEB bytes under Node by providing both paths: this is engine proof, not a
// browser/worker execution claim. No downloads/builds happen inside the test.
const nodeDir = process.env.LABWIRED_WASM;
const webGlue = process.env.LABWIRED_INPUT_WEB_GLUE;
const webBytes = process.env.LABWIRED_INPUT_WEB_WASM;
const skip = !nodeDir && !(webGlue && webBytes)
    ? 'real WASM input proof needs LABWIRED_WASM or both LABWIRED_INPUT_WEB_GLUE/WASM paths' : false;
let wasm;
if (!skip) {
    if (nodeDir) wasm = createRequire(import.meta.url)(join(nodeDir, 'labwired_wasm.js'));
    else {
        wasm = await import('data:text/javascript;base64,' + readFileSync(webGlue).toString('base64'));
        await wasm.default({ module_or_path: readFileSync(webBytes) });
    }
    assert.equal(typeof wasm.WasmSimulator.prototype.list_inputs, 'function', 'real backend needs list_inputs');
    assert.equal(typeof wasm.WasmSimulator.prototype.set_inputs, 'function', 'real backend needs atomic set_inputs');
}

const makeReal = () => {
    const raw = new Uint8Array(64);
    const view = new DataView(raw.buffer);
    view.setUint32(0, 0x20001000, true);
    view.setUint32(4, 0x08000009, true);
    raw.set([0xfe, 0xe7], 8); // b .; no program retirement needed for input routing.
    return createLabwiredAdapter({ wasm, firmwareOnly: true, firmware: binToElf(raw),
        chipYaml: readFileSync(new URL('./fixtures/labwired/stm32f0-chip.yaml', import.meta.url), 'utf8'),
        systemYaml: `name: "scoped-input-contract"
chip: "chip.yaml"
external_devices:
  - id: "left"
    type: "potentiometer"
    connection: "adc"
    config:
      channel: 0
  - id: "right"
    type: "potentiometer"
    connection: "adc"
    config:
      channel: 1
board_io: []
` });
};
const counts = adapter => plain(adapter.sim.get_peripheral_snapshot('adc')).channel_inputs.slice(0, 2);

describe('actual WASM engineering-input transaction proof', { skip }, () => {
    it('discovers both scoped ids and drives real analog-kit ADC inputs in one transaction', () => {
        const adapter = makeReal();
        try {
            assert.deepEqual(adapter.discoverInputs().map(row => [row.peripheral, row.key, row.unit]),
                [['left', 'position', '%'], ['right', 'position', '%']]);
            adapter.setInputs([{ component: 'left', channel: 'position', value: 25 },
                { component: 'right', channel: 'position', value: 75 }]);
            assert.deepEqual(counts(adapter), [1023, 3071]);
        } finally { adapter.sim.free(); }
    });

    it('backend rejects ambiguous or unknown identities and bad later ranges atomically', () => {
        const adapter = makeReal();
        try {
            adapter.setInputs([{ component: 'left', channel: 'position', value: 25 },
                { component: 'right', channel: 'position', value: 75 }]);
            for (const sets of [[{ channel: 'position', value: 50 }],
                [{ component: 'missing', channel: 'position', value: 50 }],
                [{ component: 'left', channel: 'position', value: 50 },
                    { component: 'right', channel: 'position', value: 101 }]]) {
                assert.throws(() => adapter.setInputs(sets));
                assert.deepEqual(counts(adapter), [1023, 3071], 'failed transaction changes no earlier component');
            }
        } finally { adapter.sim.free(); }
    });

    it('debug success emits one isolated input fact; replay routes atomically without re-emitting', () => {
        const adapter = makeReal();
        const target = createLabwiredDebugTarget({ adapter });
        const facts = [];
        target.onDebugInput(fact => { fact.payload.sets[0].value = 99; fact.time.ticks = 999; });
        target.onDebugInput(fact => facts.push(fact));
        try {
            const before = target.debugTime();
            assert.deepEqual(target.setInputs([{ component: 'left', channel: 'position', value: 25 },
                { component: 'right', channel: 'position', value: 75 }]), { accepted: true });
            assert.equal(facts.length, 1);
            assert.equal(facts[0].producer, 'labwired.inputs');
            assert.equal(facts[0].payload.sets[0].value, 25);
            assert.deepEqual(facts[0].time, before, 'listeners cannot rewrite later receipts');
            assert.deepEqual(target.debugTime(), before, 'input does not retire a guest instruction');
            assert.deepEqual(counts(adapter), [1023, 3071]);
            adapter.setInputs([{ component: 'left', channel: 'position', value: 0 }]);
            assert.deepEqual(target.applyReplayInput(facts[0]), { accepted: true });
            assert.deepEqual(counts(adapter), [1023, 3071]);
            assert.equal(facts.length, 1);
            assert.equal(target.setInputs([{ component: 'right', channel: 'position', value: 101 }]).accepted, false);
            assert.equal(facts.length, 1, 'rejected input produces no accepted fact');
            target.detach();
            assert.equal(target.applyReplayInput(facts[0]).code, 'detached');
        } finally { adapter.sim.free(); }
    });

    it('a circuit-bound target refuses input replay rather than half-rewinding its board', () => {
        const adapter = makeReal();
        try {
            const target = createLabwiredDebugTarget({ adapter: { ...adapter, firmwareOnly: false } });
            assert.equal(target.applyReplayInput({ producer: 'labwired.inputs',
                payload: { sets: [{ component: 'left', channel: 'position', value: 0 }] } }).code,
            'board-inputs-unlogged');
        } finally { adapter.sim.free(); }
    });
});
