import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDebugTarget} from '../src/debug-target-factory.js';
import {binToElf} from '../src/bin-to-elf.js';

const board = {parts: [{id: 'mb', kind: 'microbit'}], nets: []};
const raw = new Uint8Array(64);
new DataView(raw.buffer).setUint32(0, 0x20020000, true);
new DataView(raw.buffer).setUint32(4, 9, true);
const firmware = binToElf(raw, {loadAddress: 0});

// These constructor doubles qualify option forwarding, NOT sensor fidelity.
test('factory forwards the selected variant into the constructor instead of dropping it', async () => {
    let system, chip;
    const wasm = {WasmSimulator: {new_from_config: (manifest, descriptor) => {
        system = manifest;
        chip = descriptor;
        throw Error('constructor boundary reached');
    }}};
    await assert.rejects(createDebugTarget('labwired', {
        wasm, board, firmware, chipKind: 'microbit_v2', boardVariant: 'lsm303agr'
    }), /constructor boundary reached/);
    assert.match(system, /lsm303agr_accel/);
    assert.match(system, /lsm303agr_mag/);
    assert.match(system, /led-matrix-mux/);
    assert.match(chip, /base_address: 0x50000800/);
    assert.match(chip, /reg_offset: 0x500/);
});

test('manual overrides cannot silently discard the selected variant', async () => {
    let constructors = 0;
    const wasm = {WasmSimulator: {new_from_config: () => { constructors++; }}};
    for (const overrides of [{board: null}, {chipYaml: 'arch: arm'}, {pins: {}},
        {systemYaml: ''}, {systemYaml: 'name: manual'}]) {
        await assert.rejects(createDebugTarget('labwired', {
            wasm, board, firmware, chipKind: 'microbit_v2', boardVariant: 'lsm303agr', ...overrides
        }), /board-derived manifest/);
    }
    assert.equal(constructors, 0);
});
