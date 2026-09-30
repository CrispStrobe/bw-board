import assert from 'node:assert/strict';
import test from 'node:test';
import {NativeDeviceHost,boardHz,clocksPerQuantum,pitHz} from
  '../scripts/bochs-cpu3-native-device-events-host.mjs';

function programmedHost(){
  const host=new NativeDeviceHost();
  const out=(port,value)=>assert.equal(host.handleRequest('PIO_OUT',port,1,value,
    host.nativeTicks),0);
  for(const [port,value] of [[0x20,0x13],[0x21,0x20],[0x21,0x01],
    [0x21,0xfe],[0x43,0x30],[0x40,0x00],[0x40,0x10]])out(port,value);
  return {host,out};
}

test('actual I8254 crystal and I8259 PIC deliver one owned timer wake',()=>{
  assert.equal(boardHz,6_000_000);
  assert.equal(clocksPerQuantum,6);
  assert.equal(pitHz,1_193_182);
  const {host,out}=programmedHost();
  assert.equal(host.pic.vectorBase,0x20);
  assert.equal(host.pic.imr,0xfe);
  assert.equal(host.pit.counters[0].reload,4096);
  assert.equal(host.pit.counters[0].mode,0);
  assert.equal(host.nextNativeDeadline()>0,true);
  for(let i=0;i<30;i++)assert.equal(host.handleRequest('TICK',1,0,0,i),0);
  assert.equal(host.nativeTicks,30);
  assert.equal(host.successfulQuanta,30);
  assert.equal(host.boardCycles,180);
  assert.equal(host.stageLine(),false);
  const fractionBefore=host.pit._frac;
  assert(fractionBefore>0&&fractionBefore<1);
  const nativeBefore=host.nativeTicks;
  const idle=host.advanceHaltedToFirstEdge();
  assert(idle>0);
  assert.equal(host.nativeTicks,nativeBefore);
  assert.equal(host.successfulQuanta,nativeBefore);
  assert.equal(host.boardCycles,180+idle);
  assert.equal(host.idleBoardCycles,idle);
  assert.equal(host.pit.counters[0].out,1);
  assert.equal(host.pic.irr,1);
  assert.equal(host.pic.intActive,true);
  assert.equal(host.stageLine(),true);
  assert.equal(host.handleRequest('ACK',0,0,0,nativeBefore),0x20);
  assert.equal(host.pic.irr,0);
  assert.equal(host.pic.isr,1);
  assert.equal(host.stageLine(),false);
  out(0x20,0x20);
  assert.equal(host.pic.isr,0);
  assert.equal(host.pic.intActive,false);
  assert.equal(host.journal.filter(e=>e.kind==='pic-ack').length,1);
  assert.equal(host.journal.filter(e=>e.kind==='pit-output'&&
    e.channel===0&&e.level===1).length,1);
  assert.equal(host.state().pitFraction,host.pit._frac);
});

test('device host refuses scripted vector, wrong clocks, and foreign ports',()=>{
  const {host}=programmedHost();
  assert.throws(()=>host.handleRequest('ACK',0,0,0,0),/without serviceable/);
  assert.throws(()=>host.handleRequest('TICK',2,0,0,0),/TICK shape/);
  assert.throws(()=>host.handleRequest('TICK',1,0,0,1),/request tick/);
  assert.throws(()=>host.handleRequest('PIO_OUT',0x92,1,2,0),/unowned PIO/);
  assert.throws(()=>host.handleRequest('PIO_OUT',0x41,1,2,0),/unowned PIO/);
  assert.throws(()=>host.handleRequest('PIO_IN',0x21,2,0,0),/byte PIO/);
  assert.throws(()=>host.handleRequest('PIO_IN',0x21,1,1,0),/reserved argument/);
  assert.throws(()=>host.handleRequest('LINE',1,0,0,0),/unknown callback/);
});
