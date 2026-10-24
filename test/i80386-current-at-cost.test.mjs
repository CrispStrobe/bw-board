import test from 'node:test';
import assert from 'node:assert/strict';
import {measured,CODE} from '../scripts/i80386-current-at-cost/fixture.mjs';

test('authored five operation loop has independent arithmetic and charge goldens',()=>{
  assert.deepEqual(Array.from(CODE),[0x40,0x89,0x06,0,0x20,0x8b,0x1e,0,0x20,0x01,0xd8,0xe9,0xf2,0xff]);
  for(const kind of ['core','at']){
    const value=measured(kind,'timing',5);
    assert.deepEqual(value.state,{ax:2,bx:1,ip:0,word:1});
    assert.equal(value.cpuCycles,5);
    assert.equal(value.charges,kind==='core'?5:30);
    assert.equal(value.ifEnabled,false);
    assert.equal(value.interrupts,0);
    assert.equal(value.warmupDoesNotContributeToMeasuredState,true);
    assert.equal(value.physical386TimingCalibrated,false);
  }
});

test('profile mode shares the authored state and invalid modes refuse',()=>{
  assert.deepEqual(measured('core','profile',5).state,measured('core','timing',5).state);
  assert.throws(()=>measured('native','timing',5));
  assert.throws(()=>measured('at','foreign',5));
  assert.throws(()=>measured('at','timing',1000001));
});
