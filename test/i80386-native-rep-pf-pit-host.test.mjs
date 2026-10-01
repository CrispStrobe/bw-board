import assert from 'node:assert/strict';
import test from 'node:test';
import {NativeRepPfPitHost,parseRepRpcLine,encodeRepReply,assembleRepPageReply} from '../scripts/bochs-cpu3-native-rep-pf-pit/host.mjs';
const host=()=>new NativeRepPfPitHost(new Uint8Array(65536).fill(0xa7));
const req=(h,operation,arg0=0,arg1=0,arg2=0,payload='-')=>h.handleRequest({seq:h.nextRequest,operation,arg0,arg1,arg2,payload,nativeTicks:h.nativeTicks,successfulQuanta:h.successfulQuanta});
test('successful REP and ordinary work charge board; native fault tick does not',()=>{
 const h=host();h.beginRun();req(h,'QUANTUM',1);req(h,'NATIVE_TICK',1);req(h,'NATIVE_TICK',1);
 assert.deepEqual([h.machine.cycles,h.machine._chipDebt,h.nativeTicks,h.successfulQuanta,h.machine.cpu.cycles],[10,6,2,1,0]);
 assert.throws(()=>h.machine.cpu.step(),/execution forbidden/);h.endRun();const final=h.finish();assert.equal(final.after.board.debt,0);assert.equal(final.after.board.cycles,10);assert.equal(Object.keys(final.after.board.chipStates).length,11);
});
test('actual PIC/PIT deadline and eligible acknowledge use board devices',()=>{
 const h=host();h.beginRun();
 for(const [port,value] of [[0x20,0x11],[0xa0,0x11],[0x21,0x20],[0xa1,0x28],[0x21,4],[0xa1,2],[0x21,1],[0xa1,1],[0xa1,255],[0x21,254],[0x43,0x30],[0x40,6],[0x40,0]])req(h,'PIO_OUT',port,1,value);
 assert.throws(()=>req(h,'ACK'),/staged PIC line/);
 let due=false;for(let i=0;i<8&&!due;i++)due=!!req(h,'QUANTUM',1).value;
 assert(due);h.endRun();const line=h.stageLine();assert(line.asserted);assert.equal(h.machine.chips.pic1.intActive,true);
 h.beginRun();req(h,'QUANTUM');const owed=[h.machine.cycles,h.machine._chipDebt,h.machine.chips.pit1._frac];assert.equal(req(h,'ACK').value,32);assert.deepEqual([h.machine.cycles,h.machine._chipDebt,h.machine.chips.pit1._frac],owed,'ACK does not invent chip debt settlement');assert.equal(h.machine.chips.pic1.getState().isr,1);
 req(h,'PIO_OUT',0x20,1,0x20);assert.equal(h.machine.chips.pic1.getState().isr,0);assert.equal(h.machine.cpu.cycles,0);h.endRun();h.finish();
});
test('unsupported physical spans and executable RAM fail before board effects',()=>{
 const h=host();h.beginRun();let writes=0;const write=h.machine._write386.bind(h.machine);h.machine._write386=(...a)=>{writes++;return write(...a);};
 for(const [raw,width] of [[0xffffffff,2],[0x4fff,2],[0xa0000,1],[0x7000,17]])assert.throws(()=>req(h,'WRITE',raw,width,0,'00'.repeat(width)),/board host/);
 assert.throws(()=>req(h,'PAGE',0x7000,4096),/homogeneous ROM/);
 assert.throws(()=>req(h,'PIO_OUT',0x64,1,0xd1),/unowned/);assert.equal(writes,0);assert.equal(h.mappingEpoch,0);h.endRun();
});
test('typed backing writes retain bytes and generation across delivery-only ticks',()=>{
 const h=host();h.beginRun();const a=req(h,'WRITE',0x8ff0,4,0,'02000000');req(h,'NATIVE_TICK',1);const b=req(h,'WRITE',0x8ff4,4,0,'2c020000');
 assert.equal(a.generation,1);assert.equal(b.generation,2);assert.equal(req(h,'READ',0x8ff0,8).hex,'020000002c020000');assert.equal(h.machine.cycles,4);assert.equal(h.successfulQuanta,0);h.endRun();
});
test('page chunks and strict wire retain high reset decode and reject corruption',()=>{
 const h=host();h.beginRun();const p=req(h,'PAGE',0xfffff000,4096),lines=encodeRepReply(p);assert.equal(p.decoded,0xfff000);assert.equal(assembleRepPageReply(lines).bytes.length,4096);
 const broken=[...lines];[broken[1],broken[2]]=[broken[2],broken[1]];assert.throws(()=>assembleRepPageReply(broken),/sequence/);
 assert.throws(()=>parseRepRpcLine('BWR11\tREQ\t01\tACK\t0\t0\t0\t-\t0\t0'),/canonical/);h.endRun();
});
