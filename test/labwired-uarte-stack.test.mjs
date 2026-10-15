import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync, existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {LABWIRED_CATALOG, LABWIRED_BOARDS} from '../src/labwired-catalog.js';

const fixture = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/labwired/uarte-stack');
const provenance = JSON.parse(readFileSync(join(fixture, 'provenance.json'), 'utf8'));
const wasmDir = process.env.LABWIRED_WASM;
const skip = !wasmDir ? 'set LABWIRED_WASM to the wasm-bindgen NODEJS out-dir' :
    !existsSync(join(wasmDir, 'labwired_wasm.js')) ? 'the supplied engine has no labwired_wasm.js' : false;

test('the original MIT stack-reuse guest binds its source, linker and compiled ELF', () => {
    assert.equal(provenance.repository, 'CrispStrobe/labwired-core');
    assert.match(provenance.sourceRef, /^[a-f0-9]{40}$/);
    assert.equal(provenance.license, 'MIT');
    assert.deepEqual(Object.keys(provenance.sha256).sort(), ['board-io.ld', 'firmware.elf', 'uarte-stack-buffer.S']);
    for (const [name, hash] of Object.entries(provenance.sha256)) {
        assert.equal(createHash('sha256').update(readFileSync(join(fixture, name))).digest('hex'), hash, name);
    }
    assert.equal(readFileSync(join(fixture, 'firmware.elf')).subarray(0, 4).toString(), '\x7fELF');
});

test('the actual release engine retains ordered serial after every stack-slot reuse', {skip}, async () => {
    const {createDebugTarget} = await import('../src/debug-target-factory.js');
    const wasm = createRequire(import.meta.url)(join(wasmDir, 'labwired_wasm.js'));
    const {adapter, target} = await createDebugTarget('labwired', {
        wasm, chip: LABWIRED_CATALOG.nrf52833, labwiredBoard: LABWIRED_BOARDS['microbit-v2'],
        firmware: new Uint8Array(readFileSync(join(fixture, 'firmware.elf'))), name: 'uarte-stack-lifetime'
    });
    const bytes = [];
    adapter.onSerial(byte => bytes.push(byte));
    for (let i = 0; i < 5; i++) adapter.advanceNs(1_000_000n);
    const state = target.readMem('sram', 0x20000100, 12);
    assert.ok(state instanceof Uint8Array, JSON.stringify(state));
    const words = new DataView(state.buffer, state.byteOffset, state.byteLength);
    assert.equal(words.getUint32(0, true), 1, 'guest reached success rather than timeout');
    assert.equal(words.getUint32(4, true), Buffer.byteLength(provenance.expectedSerial));
    assert.equal(words.getUint32(8, true), Buffer.byteLength(provenance.expectedSerial), 'every transmitted slot was overwritten');
    assert.deepEqual(Buffer.from(bytes), Buffer.from(provenance.expectedSerial), 'exact ordered serial from the compiled guest');
});
