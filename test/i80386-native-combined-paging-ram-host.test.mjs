import assert from 'node:assert/strict';
import test from 'node:test';
import {NativeCombinedPagingRamHost,parseCombinedRpcLine,encodeCombinedReply,assembleCombinedPageReply,combinedSha} from '../scripts/bochs-cpu3-native-combined-paging-ram/host.mjs';
// Manual callbacks test the actual board host contract; these are not native CPU guest receipts.
const host=()=>new NativeCombinedPagingRamHost(new Uint8Array(65536).fill(0xa7));
const req=(h,operation,arg0=0,arg1=0,arg2=0,payload='-')=>h.handleRequest({seq:h.nextRequest,operation,arg0,arg1,arg2,payload,nativeTicks:h.nativeTicks,successfulQuanta:h.successfulQuanta});
const out=(h,port,value)=>req(h,'PIO_OUT',port,1,value);
const gate=(h,value)=>{out(h,0x64,0xd1);return out(h,0x60,value);};

test('actual 8042 gate epochs share low aliases and preserve independent high RAM',()=>{
 const h=host();h.beginRun();req(h,'WRITE',0x7000,4,0,'bb1111cb');req(h,'WRITE',0x107000,4,0,'bb3333cb');
 const off=gate(h,1);assert.deepEqual([off.boardA20,off.mappingEpoch],[0,1]);
 assert.equal(req(h,'READ',0x107000,4).hex,'bb1111cb');
 const alias=req(h,'WRITE',0x107001,2,0,'5555');assert.deepEqual([alias.decoded,alias.generation,alias.mappingEpoch],[0x7001,2,1]);
 assert.equal(req(h,'READ',0x7000,4).hex,'bb5555cb');assert.equal(req(h,'PAGE',0x107000,4096).generation,2);
 assert.deepEqual([gate(h,1).boardA20,h.mappingEpoch],[0,1],'unchanged controller output does not invent an epoch');
 const on=gate(h,3);assert.deepEqual([on.boardA20,on.mappingEpoch],[1,2]);assert.equal(req(h,'READ',0x107000,4).hex,'bb3333cb');
 req(h,'WRITE',0x107001,2,0,'4444');assert.equal(req(h,'READ',0x107000,4).hex,'bb4444cb');assert.equal(req(h,'READ',0x7000,4).hex,'bb5555cb');
 assert.equal(h.machine._fastA20Latch,0);assert.equal(h.machine.cpu.cycles,0);h.endRun();
});

test('RAM pages authenticate typed whole-callback generations and exact chunk bytes',()=>{
 const h=host();h.beginRun();const w=req(h,'WRITE',0x7000,4,0,'bb2222cb');assert.equal(w.generation,1);
 const p=req(h,'PAGE',0x7000,4096),lines=encodeCombinedReply(p),assembled=assembleCombinedPageReply(lines);
 assert.equal(assembled.decoded,0x7000);assert.equal(assembled.generation,1);assert.equal(assembled.bytes.subarray(0,4).toString('hex'),'bb2222cb');assert.equal(combinedSha(assembled.bytes),p.sha256);
 const swapped=[...lines];[swapped[1],swapped[2]]=[swapped[2],swapped[1]];assert.throws(()=>assembleCombinedPageReply(swapped),/chunk sequence\/index/);
 const damaged=[...lines];damaged[1]=damaged[1].replace('bb2222cb','bb2222ca');assert.throws(()=>assembleCombinedPageReply(damaged),/complete page digest/);
 const end=[...lines];end[65]='BWR12\tEND\t999';assert.throws(()=>assembleCombinedPageReply(end),/END sequence/);h.endRun();
});

test('unsupported spans, executable pages and ports reject before physical or PIO effects',()=>{
 const h=host();h.beginRun();let writes=0,ports=0;const write=h.machine._write386.bind(h.machine),pio=h.machine._out386.bind(h.machine);
 h.machine._write386=(...args)=>{writes++;return write(...args);};h.machine._out386=(...args)=>{ports++;return pio(...args);};
 const before=h.state();
 for(const [raw,width] of [[0xffffffff,2],[0x4fff,2],[0xa0000,1],[0xbffff,1],[0x7000,17],[0x7000,0]])assert.throws(()=>req(h,'WRITE',raw,width,0,'00'.repeat(width)),/span|MMIO|range/);
 for(const raw of [0,0x6000,0x7001,0xa0000,0xc0000])assert.throws(()=>req(h,'PAGE',raw,4096),/admission|span|MMIO/);
 assert.throws(()=>req(h,'PIO_OUT',0x92,1,2),/unowned PIO/);assert.throws(()=>req(h,'PIO_OUT',0xe9,2,65),/unowned PIO/);assert.throws(()=>req(h,'PIO_IN',0x60,1),/unsupported callback/);
 assert.equal(writes,0);assert.equal(ports,0);assert.deepEqual(h.state(),before);h.endRun();
});

test('ROM ignored writes and reset-alias reads preserve actual observed bytes',()=>{
 const h=host();h.beginRun();const w=req(h,'WRITE',0xfffffff0,1,0,'00');assert.deepEqual([w.decoded,w.class,w.effect,w.hex,w.generation],[0xfffff0,2,2,'a7',0]);
 assert.equal(req(h,'READ',0x1000520,1).decoded,0x1000520,'non-reset raw addresses are not broadly truncated to 24 bits');
 assert.equal(req(h,'READ',0x1000520,1).hex,'ff');
 const page=assembleCombinedPageReply(encodeCombinedReply(req(h,'PAGE',0xfffff000,4096)));assert.equal(page.decoded,0xfff000);assert(page.bytes.every(b=>b===0xa7));h.endRun();
});

test('success charges actual board clocks while fault ticks and callbacks leave JS CPU idle',()=>{
 const h=host();h.beginRun();req(h,'QUANTUM',1);req(h,'NATIVE_TICK',1);req(h,'NATIVE_TICK',1);req(h,'QUANTUM',0);
 assert.deepEqual([h.machine.cycles,h.machine._chipDebt,h.nativeTicks,h.successfulQuanta,h.machine.cpu.cycles],[16,12,2,2,0]);assert.throws(()=>h.machine.cpu.step(),/execution forbidden/);
 h.endRun();const final=h.finish();assert.equal(final.after.board.debt,0);assert.equal(final.after.board.cycles,16);assert.equal(Object.keys(final.after.board.chipStates).length,11);assert.throws(()=>h.finish(),/unique terminal/);
});

test('actual PIT deadline requires a paused PIC line and ACK does not invent chip advance',()=>{
 const h=host();h.beginRun();for(const [p,v] of [[0x20,0x11],[0xa0,0x11],[0x21,0x20],[0xa1,0x28],[0x21,4],[0xa1,2],[0x21,1],[0xa1,1],[0xa1,255],[0x21,254],[0x43,0x30],[0x40,6],[0x40,0]])out(h,p,v);
 assert.throws(()=>req(h,'ACK'),/staged PIC line/);assert.throws(()=>h.stageLine(),/paused boundary/);
 let due=false;for(let i=0;i<8&&!due;i++)due=!!req(h,'QUANTUM',1).value;assert(due);h.endRun();assert(h.stageLine().asserted);
 h.beginRun();req(h,'QUANTUM');const clock=[h.machine.cycles,h.machine._chipDebt,h.machine.chips.pit1._frac];assert.equal(req(h,'ACK').value,0x20);assert.deepEqual([h.machine.cycles,h.machine._chipDebt,h.machine.chips.pit1._frac],clock);assert.equal(h.machine.chips.pic1.getState().isr,1);
 out(h,0x20,0x20);h.endRun();assert.equal(h.stageLine().asserted,false);assert.equal(h.machine.chips.pic1.getState().isr,0);h.finish();
});

test('request ownership, canonical wire fields and callback reentry fail closed',()=>{
 const h=host();assert.throws(()=>req(h,'READ',0x7000,1),/outside RUN/);h.beginRun();assert.throws(()=>h.beginRun(),/reentry/);
 const base={seq:1,operation:'READ',arg0:0x7000,arg1:1,arg2:0,payload:'-',nativeTicks:0,successfulQuanta:0};assert.throws(()=>h.handleRequest({...base,seq:2}),/sequence gap/);assert.throws(()=>h.handleRequest({...base,nativeTicks:1}),/clock tuple/);
 const write=h.machine._write386.bind(h.machine);h.machine._write386=(...args)=>{assert.throws(()=>req(h,'READ',0x7000,1),/callback reentry/);return write(...args);};req(h,'WRITE',0x7000,1,0,'22');assert.equal(h.nextRequest,2);assert.equal(h._requestActive,false);h.endRun();
 for(const line of ['BWR12\tREQ\t01\tACK\t0\t0\t0\t-\t0\t0','BWR12\tMEM\t1\tOK\t0000700A\t1\t0\t00\t0\t0\t1','BWR12\tPIO\t1\tOK\t0\t2\t0','BWR12\tREP\t1\tOK\t0\t1\t0','BWR12\tREADY\tf000\t0000fff0\t0\t0\r'])assert.throws(()=>parseCombinedRpcLine(line),/canonical|shape|range|ASCII/);
});

test('generation and mapping bounds deny effects before actual board callbacks',()=>{
 const h=host();h.beginRun();h.generations.set(0x7000,0xffffffff);let writes=0,pios=0;h.machine._write386=()=>{writes++;};h.machine._out386=()=>{pios++;};
 assert.throws(()=>req(h,'WRITE',0x7000,1,0,'00'),/generation overflow before effect/);h.mappingEpoch=0xffffffff;assert.throws(()=>out(h,0x64,0xd1),/epoch bound before PIO effect/);assert.equal(writes,0);assert.equal(pios,0);assert.equal(h.nextRequest,1);h.endRun();
});
