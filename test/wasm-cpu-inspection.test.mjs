import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {selectCpuWat} from '../scripts/lib/wasm-cpu-inspection.mjs';
const wat=`(module
  (type (;0;) (func (param i32)))
  (func $CortexM_step_batch (type 0)
    (local i32)
    local.get 0
    i32.load offset=4
    call $CortexM_run_t16_cached_run)
  (func $CortexM_run_t16_cached_run (type 0)
    local.get 0
    i32.load16_u offset=8
    call $helper
    call $helper
    memory.copy)
  (func $Unrelated_step_batch (type 0)
    unreachable)
  (export "cpu" (func $CortexM_step_batch)))`;
test('CPU selection preserves exact original bodies and referenced types, not unrelated names',()=>{
    const r=selectCpuWat(wat);
    assert.equal(r.functions.length,2);assert.equal(r.types.length,1);
    for(const f of r.functions)assert(wat.includes(f.wat));
    assert.deepEqual(r.functions[0].directCalls,[{target:'$CortexM_run_t16_cached_run',occurrences:1}]);
    assert.deepEqual(r.functions[1].directCalls,[{target:'$helper',occurrences:2}]);
    assert.deepEqual(r.functions[1].memoryOps,{'i32.load16_u':1,'memory.copy':1});
    assert(r.absentLabels.includes('execute_t16_fast_op'));assert.equal(r.limitations.length,5);
});
test('missing roots, missing types, duplicate identities and excessive receipts fail closed',()=>{
    assert.throws(()=>selectCpuWat(wat.replaceAll('CortexM_run_t16_cached_run','Other_cached_run')),/Required CPU body/);
    assert.throws(()=>selectCpuWat(wat.replace('  (type (;0;) (func (param i32)))\n','')),/Missing original CPU type/);
    assert.throws(()=>selectCpuWat(wat.replace('$CortexM_run_t16_cached_run (type','$CortexM_step_batch (type')),/Duplicate/);
    assert.throws(()=>selectCpuWat(wat.replace('    memory.copy)','    memory.copy\n'+('    nop\n'.repeat(300000))+')')),/receipt bound/);
});
test('hosted CPU inspection pins original artifacts and retains only text evidence',()=>{
    const workflow=readFileSync(new URL('../.github/workflows/labwired-cpu-inspection.yml',import.meta.url),'utf8');
    for(const text of ['36915940413','43b2d62f5a0fa24ae0b38a645069f5aaa78af685',
        '7bd66fe4e926fbf14322621499f3fbddefefae763f61742c4c8c7312113b7a3d',
        'b93d7f484286d64ae8f19d86bf67eb8d4309cf49720cbb06f59557c401b7ad73',
        'assert.equal(info.ref, e.CORE_REF)','bytes.length','selectCpuWat','engineExecution: false','if: always()','path: evidence/'])assert(workflow.includes(text),text);
    assert(!/selectEdgeWat|VTABLE_WORDS|LABWIRED_WASM:|instantiate|--jitless|wasm-opt/.test(workflow));
    assert(workflow.indexOf('Validate pinned inputs')<workflow.indexOf('actions/download-artifact'));
});
