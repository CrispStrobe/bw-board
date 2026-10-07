import assert from 'node:assert/strict';
import {encode,readyForScan} from './keyboard.mjs';

assert.deepEqual(encode('n\r').map(e=>e.scan),[0x31,0xb1,0x1c,0x9c]);
assert.deepEqual(encode('c:\\').map(e=>e.scan),
  [0x2e,0xae,0x2a,0x27,0xa7,0xaa,0x2b,0xab]);
assert.throws(()=>encode('/'),/unsupported guest key/);
assert.equal(readyForScan({step:5_000,lastAcceptedStep:0,ringEmpty:true,controllerStatus:0}),true);
for(const condition of [
  {step:4_999,lastAcceptedStep:0,ringEmpty:true,controllerStatus:0},
  {step:5_000,lastAcceptedStep:0,ringEmpty:false,controllerStatus:0},
  {step:5_000,lastAcceptedStep:0,ringEmpty:true,controllerStatus:1}])
  assert.equal(readyForScan(condition),false);
console.log('keyboard controls PASS');
