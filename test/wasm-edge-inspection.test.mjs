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
