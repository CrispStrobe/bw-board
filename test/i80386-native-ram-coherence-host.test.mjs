import assert from 'node:assert/strict';
import test from 'node:test';
import {NativeRamCoherenceHost,parseRamRpcLine,encodeRamReply,assembleRamPageReply,ramSha} from '../scripts/bochs-cpu3-native-ram-coherence-host.mjs';
// Host-only tests use a free constant ROM and never execute either CPU.
const model=()=>new NativeRamCoherenceHost(new Uint8Array(65536).fill(0xa7));
const request=(h,operation,arg0=0,arg1=0,arg2=0,payload='-')=>h.handleRequest({kind:'REQ',seq:h.nextRequest,operation,arg0,arg1,arg2,payload,nativeTicks:h.nativeTicks,successfulQuanta:h.successfulQuanta});
test('owned successful clock charges six while native tick never runs the JS CPU',()=>{
 const h=model();assert.equal(h.machine.cycles,4);assert.equal(h.machine.cpu.cycles,0);
 assert.throws(()=>h.machine.cpu.step(),/CPU execution forbidden/);h.beginRun();request(h,'QUANTUM');request(h,'NATIVE_TICK',1);
 assert.deepEqual([h.machine.cycles,h.machine._chipDebt,h.nativeTicks,h.successfulQuanta],[10,6,1,1]);
 request(h,'PIO_OUT',0xe9,1,0x52);assert.equal(h.machine._chipDebt,0);h.endRun();assert.equal(h.finish().after.board.cycles,10);
});
test('actual A20 callbacks alter mapping independently of raw executable addresses',()=>{
 const h=model();h.beginRun();request(h,'WRITE',0x7000,4,0,'bb1111cb');request(h,'WRITE',0x107000,4,0,'bb3333cb');
 const low=request(h,'PAGE',0x7000,4096),high=request(h,'PAGE',0x107000,4096);
 assert.equal(low.generation,1);assert.equal(high.generation,1);assert.notEqual(low.sha256,high.sha256);
 request(h,'PIO_OUT',0x64,1,0xd1);const off=request(h,'PIO_OUT',0x60,1,1);assert.deepEqual([off.a20,off.mappingEpoch],[0,1]);
 const alias=request(h,'PAGE',0x107000,4096);assert.equal(alias.decoded,0x7000);assert.equal(alias.sha256,low.sha256);
 const patch=request(h,'WRITE',0x107001,2,0,'5555');assert.equal(patch.decoded,0x7001);assert.equal(patch.generation,2);
 assert.equal(request(h,'READ',0x7000,4).hex,'bb5555cb');assert.equal(request(h,'PAGE',0x7000,4096).generation,2);
 request(h,'PIO_OUT',0x64,1,0xd1);const on=request(h,'PIO_OUT',0x60,1,3);assert.deepEqual([on.a20,on.mappingEpoch],[1,2]);
 assert.equal(request(h,'READ',0x107000,4).hex,'bb3333cb');assert.equal(request(h,'PAGE',0x107000,4096).generation,1);
 h.endRun();const final=h.finish();assert.deepEqual(final.lowCode,[0xbb,0x55,0x55,0xcb]);assert.deepEqual(final.highCode,[0xbb,0x33,0x33,0xcb]);
 assert.equal(Object.keys(final.after.board.chipStates).length,11);assert.equal(h.machine.cpu.cycles,0);
});
test('whole span, port and generation rejection precede any board effect',()=>{
 const h=model();h.beginRun();let reads=0,writes=0;const read=h.machine._read386.bind(h.machine),write=h.machine._write386.bind(h.machine);
 h.machine._read386=(...a)=>{reads++;return read(...a);};h.machine._write386=(...a)=>{writes++;return write(...a);};
 for(const [raw,width] of [[0xa0000,1],[0xb8000,1],[0xffffffff,2],[0xfff,2],[0x7000,17]]){
  assert.throws(()=>request(h,'READ',raw,width),/ram board host/);assert.throws(()=>request(h,'WRITE',raw,width,0,'00'.repeat(width)),/ram board host/);
 }
 h.generations.set(0x7000,0xffffffff);assert.throws(()=>request(h,'WRITE',0x7000,1,0,'a5'),/overflow before effect/);
 for(const [port,value] of [[0x92,2],[0x64,0xff],[0x60,1]])assert.throws(()=>request(h,'PIO_OUT',port,1,value),/ram board host/);
 assert.deepEqual([reads,writes,h.bus.length,h.mappingEpoch],[0,0,0,0]);h.endRun();
});
test('bounded page protocol authenticates SHA and complete chunk chronology',()=>{
 const h=model();h.beginRun();const page=request(h,'PAGE',0xfffff000,4096),lines=encodeRamReply(page);
 assert.equal(lines.length,66);assert.equal(ramSha(assembleRamPageReply(lines).bytes),page.sha256);
 for(const mutate of [ls=>ls.splice(2,1),ls=>{[ls[1],ls[2]]=[ls[2],ls[1]];},ls=>{ls[1]=ls[1].slice(0,-1)+'0';},ls=>{ls[65]='BWR10\tEND\t999';}]){
  const changed=[...lines];mutate(changed);assert.throws(()=>assembleRamPageReply(changed),/ram board host/);
 }
 for(const address of [0xa0000,0xc0000])assert.throws(()=>request(h,'PAGE',address,4096),/ram board host/);h.endRun();
});
test('wire roundtrips current generations, epochs and authoritative PIO state',()=>{
 const h=model();h.beginRun();for(const reply of [request(h,'WRITE',0x7000,1,0,'bb'),request(h,'READ',0x7000,1),request(h,'PIO_OUT',0x64,1,0xd1)]){
  const wire=encodeRamReply(reply);assert.deepEqual(parseRamRpcLine(wire[0]),reply);
 }
 for(const line of ['BWR9\tREP\t1\tOK\t0','BWR10\tREQ\t01\tREAD\t0\t1\t0\t-\t0\t0','BWR10\tREP\t1\tOK\t0\t2\t0','BWR10\tMEM\t1\tOK\t00007000\t1\t2\tbb\t4294967296\t0'])assert.throws(()=>parseRamRpcLine(line),/ram board host/);
 h.endRun();
});
