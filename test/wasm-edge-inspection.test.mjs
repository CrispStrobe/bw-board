import {test} from 'node:test';
import assert from 'node:assert/strict';
import {selectEdgeWat} from '../scripts/lib/wasm-edge-inspection.mjs';
const fixture = `(module
  (type $t (func (param i32)))
  (type $unused (func))
  (func $input_channels (type $t)
    i32.const 8)
  (func $service_edge_driven_gpio_devices_cold (type $t)
    call_indirect (type $t))
  (func $unrelated (type $unused)
    nop)
  (elem (;0;) (i32.const 1) func $input_channels)
  (data (;0;) (i32.const 0) "secret")
)`;
test('select complete named bodies, relevant types and original table entries only', () => {
    const result = selectEdgeWat(fixture);
    assert.equal(result.functions.length, 2);
    assert(result.functions[1].wat.endsWith('call_indirect (type $t))'));
    assert.deepEqual(result.types, ['  (type $t (func (param i32)))']);
    assert.equal(result.elements.length, 1);
    assert(!JSON.stringify(result).includes('secret'));
    assert(!JSON.stringify(result).includes('$unrelated'));
});
test('missing named functions or function table fail closed', () => {
    assert.throws(() => selectEdgeWat(fixture.replaceAll('input_channels', 'other')), /Required/);
    assert.throws(() => selectEdgeWat(fixture.replace(/^  \(elem .*\n/m, '')), /No function table/);
});
test('unnamed numeric WABT type annotations are retained', () => {
    const result = selectEdgeWat(fixture.replace('(type $t (func', '(type (;2;) (func').replaceAll('(type $t)', '(type 2)'));
    assert.deepEqual(result.types, ['  (type (;2;) (func (param i32)))']);
});
test('static slot 48 candidates retain words and resolved neighbor symbols', () => {
    const bytes = Buffer.alloc(56);
    for (const [slot, value] of [[3, 2], [4, 3], [12, 1], [13, 4]]) bytes.writeUInt32LE(value, slot * 4);
    const encoded = [...bytes].map(byte => '\\' + byte.toString(16).padStart(2, '0')).join('');
    const wat = fixture.replaceAll('$input_channels', '$DeclarativeLogicDevice.input_channels')
        .replace('func $DeclarativeLogicDevice.input_channels)', 'func $DeclarativeLogicDevice.input_channels $id $as_any $service)')
        .replace('"secret"', '"' + encoded + '"');
    const result = selectEdgeWat(wat, {inspectVtables: true});
    assert.equal(result.vtableCandidates.length, 1);
    assert.equal(result.vtableCandidates[0].slots[12].symbol, '$DeclarativeLogicDevice.input_channels');
    assert.equal(result.vtableCandidates[0].slots[13].symbol, '$service');
    assert.deepEqual(selectEdgeWat(wat.replace(')\n)', '))'), {inspectVtables: true}).vtableCandidates, result.vtableCandidates);
    assert.throws(() => selectEdgeWat(wat.replace(encoded, '\\00'), {inspectVtables: true}), /No static/);
});
