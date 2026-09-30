import assert from 'node:assert/strict';
import test from 'node:test';
import {assertMemoryMapByte,assertNativeMemoryMapSelfParity} from
  '../scripts/bochs-cpu3-native-memory-map-compare.mjs';
import {parseArm,failureProbe} from
  '../scripts/run-bochs-cpu3-native-memory-map-compare.mjs';

const byte=(overrides={})=>({rw:'R',raw:0x100500,effective:0x500,
  class:'ram',value:0x31,effect:'ram-read',why:'ordinary',...overrides});

test('accepts an A20-gated host RAM byte and typed device effects',()=>{
  assert.equal(assertMemoryMapByte(byte(),false).effective,0x500);
  assertMemoryMapByte(byte({rw:'W',raw:0xffff0,effective:0xffff0,
    class:'rom',value:0x12,effect:'rom-ignored'}),true);
  assertMemoryMapByte(byte({rw:'W',raw:0xa0000,effective:0xa0000,
    class:'mmio',value:0x5a,effect:'mmio-write'}),true);
  assertMemoryMapByte(byte({raw:0xd0000,effective:0xd0000,
    class:'unmapped',value:0xff,effect:'open-bus'}),true);
});

test('rejects a page walk that bypasses A20 or borrows a data access',()=>{
  assert.throws(()=>assertMemoryMapByte(byte({raw:0x111014,effective:0x111014,
    why:'pte-read'}),false),/A20 raw\/effective/);
  assert.throws(()=>assertMemoryMapByte(byte({raw:0x111014,effective:0x11014,
    why:'pte-ad-write'}),false),/page-walk cause\/direction/);
  assertMemoryMapByte(byte({raw:0x111014,effective:0x11014,
    why:'pte-read'}),false);
});

test('rejects ROM/RAM/MMIO/open-bus class or effect substitutions',()=>{
  assert.throws(()=>assertMemoryMapByte(byte({class:'rom'}),false),/map class or effect/);
  assert.throws(()=>assertMemoryMapByte(byte({effect:'ram-commit'}),false),/map class or effect/);
  assert.throws(()=>assertMemoryMapByte(byte({raw:0xa0000,effective:0xa0000,
    class:'ram',effect:'ram-read'}),true),/map class or effect/);
  assert.throws(()=>assertMemoryMapByte(byte({raw:0xd0000,effective:0xd0000,
    class:'unmapped',effect:'open-bus',value:0}),true),/open bus/);
});

test('full report cannot be inferred from a single mapped access',()=>{
  assert.throws(()=>assertNativeMemoryMapSelfParity({}),/missing schema/);
});

test('BWS6 parser refuses a fabricated completion or undecoded seed page',()=>{
  assert.throws(()=>parseArm('BWS6\tDEACTIVATE\tproof-complete\n',
    'continuous',null),/deactivation lacks final proof/);
  assert.throws(()=>parseArm('BWS6\tSEEDPAGE\t160\t00\n',
    'continuous',null),/misplaced page/);
  assert.throws(()=>parseArm('BWS5\tDEACTIVATE\tproof-complete\n',
    'continuous',null),/no BWS6 records/);
});

test('guard proof requires exact SIGABRT and named unsafe-execute failure',()=>{
  const raw='BWS6\tFAIL\tunsafe-execute-page\n';
  assert.deepEqual(failureProbe({code:null,signal:'SIGABRT',stderr:raw},
    'unsafeExecuteRom'),{rejected:true,kind:'unsafe-execute-rom',
    observedFailure:'unsafe-execute-page'});
  assert.throws(()=>failureProbe({code:null,signal:'SIGTERM',stderr:raw},
    'unsafeExecuteRom'),/did not abort/);
  assert.throws(()=>failureProbe({code:null,signal:'SIGABRT',stderr:
    'BWS6\tFAIL\tBochs-timer-fallback\n'},'unsafeExecuteRom'),/exact active guard/);
});
