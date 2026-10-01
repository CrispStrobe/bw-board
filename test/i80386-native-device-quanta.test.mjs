import assert from 'node:assert/strict';
import test from 'node:test';
import {NativeDeviceQuantumHost,boardHz,clocksPerQuantum,pitHz} from
  '../scripts/bochs-cpu3-native-device-quanta-host.mjs';

function programmed(){
  const host=new NativeDeviceQuantumHost();
  const request=(kind,a=0,b=0,c=0)=>host.handleRequest(kind,a,b,c,
    host.nativeTicks,host.successfulQuanta);
  for(const [port,value] of [[0x20,0x13],[0x21,0x20],[0x21,1],[0x21,0xfe],
    [0x43,0x30],[0x40,0x80],[0x40,0]])
    assert.equal(request('PIO_OUT',port,1,value),0);
  return {host,request};
}

test('real PIT/PIC edge follows successful work, not native fault ticks',()=>{
  assert.equal(boardHz,6_000_000);
  assert.equal(clocksPerQuantum,6);
  assert.equal(pitHz,1_193_182);
  const {host,request}=programmed();
  for(let i=0;i<107;i++){
    assert.equal(request('QUANTUM',1),0);
    assert.equal(request('NATIVE_TICK',1),0);
  }
  assert.equal(host.pic.intActive,false);
  const before=host.state();
  assert.equal(request('NATIVE_TICK',1),0); // failed attempt's native tick
  assert.equal(host.nativeTicks,before.nativeTicks+1);
  assert.equal(host.successfulQuanta,before.successfulQuanta);
  assert.equal(host.boardCycles,before.boardCycles);
  assert.equal(host.pit._frac,before.pitFraction);
  assert.equal(host.pic.intActive,false);
  assert.equal(request('QUANTUM',1),1); // real model reaches its one-shot edge
  assert.equal(host.successfulQuanta,108);
  assert.equal(host.boardCycles,648);
  assert.equal(host.pic.irr,1);
  assert.equal(host.stageLine(),true);
  assert.equal(request('ACK'),0x20);
  assert.equal(host.pic.isr,1);
  assert.equal(host.stageLine(),false);
  assert.equal(request('PIO_OUT',0x20,1,0x20),0);
  assert.equal(host.pic.isr,0);
  assert.equal(host.journal.filter(e=>e.kind==='pit-output'&&e.level===1).length,1);
  assert.equal(host.journal.filter(e=>e.kind==='pic-ack').length,1);
});

test('quantum host rejects clock tuple, foreign ports and invented IRQ vectors',()=>{
  const {host,request}=programmed();
  assert.throws(()=>host.handleRequest('QUANTUM',1,0,0,0,1),/clock tuple/);
  assert.throws(()=>request('NATIVE_TICK',2),/NATIVE_TICK shape/);
  assert.throws(()=>request('QUANTUM',2),/QUANTUM kind/);
  assert.throws(()=>request('PIO_OUT',0x92,1,2),/unowned PIO/);
  assert.throws(()=>request('PIO_IN',0x21,2),/byte PIO/);
  assert.throws(()=>request('ACK'),/without serviceable/);
});

import {parseRpcLine,parseNativeLog} from
  '../scripts/run-bochs-cpu3-native-device-quanta-compare.mjs';
import {assertNativeDeviceQuantaProof} from
  '../scripts/bochs-cpu3-native-device-quanta-compare.mjs';

test('BWR8 parser rejects malformed and ambiguous wire values',()=>{
  for(const line of ['', 'BWR7\tREADY\t0000\t00007e00\t0\t0',
    'BWR8\tREQ\t01\tQUANTUM\t1\t0\t0\t0\t0',
    'BWR8\tREQ\t1\tQUANTUM\t-1\t0\t0\t0\t0',
    'BWR8\tREQ\t1\tUNKNOWN\t1\t0\t0\t0\t0',
    'BWR8\tDONE\t1\tRUN\t1', 'BWR8\tREADY\t0000\t00007e00\t0\t0\r'])
    assert.throws(()=>parseRpcLine(line));
  assert.deepEqual(parseRpcLine('BWR8\tREQ\t1\tQUANTUM\t1\t0\t0\t0\t0'),
    {kind:'REQ',seq:1,operation:'QUANTUM',arg0:1,arg1:0,arg2:0,
      nativeTicks:0,successfulQuanta:0});
});

test('proof and native parser reject absent execution evidence',()=>{
  assert.throws(()=>assertNativeDeviceQuantaProof({}),/missing schema/);
  assert.throws(()=>parseNativeLog(''),/evidence absent/);
});


import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {assertNativeDeviceQuantaArmProof} from
  '../scripts/bochs-cpu3-native-device-quanta-compare.mjs';
const pilotPath=process.env.BW_DEVICE_QUANTA_ACTUAL_PILOT;
test('actual ef157 continuous pilot satisfies the one-arm core proof',
  {skip:!pilotPath},()=>{
    const bytes=readFileSync(pilotPath);
    assert.equal(createHash('sha256').update(bytes).digest('hex'),
      '6a5071f8feb9859f64da09386f0f2245ea7de1f9346466881eed7a561571e6f5');
    const pilot=JSON.parse(bytes);
    assert.equal(pilot.schema,'bw.bochs-cpu3-native-device-quanta-single-diagnostic.v1');
    const checked=assertNativeDeviceQuantaArmProof(pilot.arm);
    assert.equal(checked.finalHost.successfulQuanta,4041);
    assert.equal(checked.finalHost.nativeTicks,4043);
  });
