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
