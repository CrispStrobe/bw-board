import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {selectEdgeWat} from '../scripts/lib/wasm-edge-inspection.mjs';
// Text-parser fixtures only: not compiled ABI or timing evidence.
function fixture (words = 19) {
    const bytes = Buffer.alloc(words * 4);
    for (const [slot, value] of [[3, 2], [4, 3], [9, 5], [12, 1], [13, 4], [18, 6]]) {
        if (slot < words) bytes.writeUInt32LE(value, slot * 4);
    }
    const encoded = [...bytes].map(b => '\\' + b.toString(16).padStart(2, '0')).join('');
    return `(module
  (type $slice (func (param i32 i32)))
  (type $boolean (func (param i32) (result i32)))
  (type $unused (func))
  (func $DeclarativeLogicDevice.input_channels (type $slice)
    nop)
  (func $service_edge_driven_gpio_devices_cold (type $slice)
    call_indirect (type $boolean))
  (func $id (type $slice)
    nop)
  (func $as_any (type $boolean)
    i32.const 8)
  (func $service (type $slice)
    nop)
  (func $Button.as_sim_input (type $boolean)
    i32.const 8)
  (func $other_trait_merged_zero (type $boolean)
    i32.const 0)
  (func $not_referenced (type $unused)
    nop)
  (elem (;0;) (i32.const 1) func $DeclarativeLogicDevice.input_channels $id $as_any $service $Button.as_sim_input $other_trait_merged_zero)
  (data (;0;) (i32.const 4096) "${encoded}"))`;
}
test('default narrow selection is unchanged; opt-in retains full bounded Button target bodies', () => {
    const wat = fixture(), narrow = selectEdgeWat(wat, {inspectVtables: true});
    assert.equal(narrow.functions.length, 2);
    assert.equal(narrow.vtableCandidates[0].words.length, 14);
    assert(!narrow.functions.some(f => f.header.includes('other_trait')));
    const wide = selectEdgeWat(wat, {inspectVtables: true, vtableWords: 19, includeButtonTargets: true});
    assert.equal(wide.vtableCandidates[0].address, 4096);
    assert.equal(wide.vtableCandidates[0].words.length, 19);
    assert.equal(wide.vtableCandidates[0].slots[18].offset, 72);
    assert.equal(wide.vtableCandidates[0].slots[18].symbol, '$other_trait_merged_zero');
    assert(wide.functions.some(f => f.header.includes('other_trait_merged_zero') && f.wat.endsWith('i32.const 0)')));
    assert(!wide.functions.some(f => f.header.includes('not_referenced')));
    assert(wide.types.includes('  (type $boolean (func (param i32) (result i32)))'));
    assert(!wide.types.some(t => t.includes('$unused')));
});
test('extended bounds reject short data, invalid words, missing identity and missing target bodies', () => {
    for (const vtableWords of [0, 13, 33, 19.1, NaN, '19']) assert.throws(() => selectEdgeWat(fixture(), {vtableWords}), /word bound/);
    assert.throws(() => selectEdgeWat(fixture(), {includeButtonTargets: true}), /require/);
    assert.throws(() => selectEdgeWat(fixture(14), {inspectVtables: true, vtableWords: 19}), /No static/);
    assert.throws(() => selectEdgeWat(fixture().replaceAll('$Button.as_sim_input', '$other'), {inspectVtables: true, vtableWords: 19, includeButtonTargets: true}), /No Button/);
    const missing = fixture().replace(/^  \(func \$other_trait_merged_zero[^\n]*\n[^\n]*\n/m, '');
    assert.throws(() => selectEdgeWat(missing, {inspectVtables: true, vtableWords: 19, includeButtonTargets: true}), /Missing original/);
});
test('extended target types absent from narrow callees are retained and bodies deduplicated', () => {
    const wat = fixture().replace('call_indirect (type $boolean)', 'call_indirect (type $slice)');
    const narrow = selectEdgeWat(wat, {inspectVtables: true});
    assert(!narrow.types.some(t => t.includes('$boolean')));
    const wide = selectEdgeWat(wat, {inspectVtables: true, vtableWords: 19, includeButtonTargets: true});
    assert(wide.types.some(t => t.includes('$boolean')));
    assert.equal(new Set(wide.functions.map(f => f.header)).size, wide.functions.length);
    assert.deepEqual(selectEdgeWat(wat, {inspectVtables: true}), narrow);
});
test('hosted layout workflow verifies exact original bytes and never executes or uploads engines', () => {
    const workflow = readFileSync(new URL('../.github/workflows/labwired-edge-layout.yml', import.meta.url), 'utf8');
    for (const key of ['build_run', 'core_ref', 'wasm_sha', 'glue_sha', 'vtable_words']) assert(workflow.includes(key + ':'));
    assert(workflow.indexOf('Validate pinned inputs') < workflow.indexOf('actions/download-artifact'));
    assert(workflow.indexOf('Verify original bytes') < workflow.indexOf('wasm2wat engine/'));
    assert(workflow.includes('assert.equal(info.ref, e.CORE_REF)'));
    assert(workflow.includes('assert.equal(info.targets.nodejs[file].bytes, bytes.length)'));
    assert(workflow.indexOf("'evidence/selected-prefix.json'") < workflow.indexOf('includeButtonTargets: true'));
    assert(workflow.includes('if: always()')); assert(workflow.includes('path: evidence/'));
    assert(!workflow.includes('WebAssembly.')); assert(!workflow.includes('import(\'engine'));
    assert(!workflow.includes('path: engine/')); assert(!workflow.includes('wasm-opt'));
    assert(!workflow.includes('contents: write')); assert(!workflow.includes('NODE_OPTIONS'));
});
