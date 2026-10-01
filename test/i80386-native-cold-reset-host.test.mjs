import assert from 'node:assert/strict';
import test from 'node:test';
import {NativeColdResetHost,parseColdRpcLine,encodeColdReply,assembleColdPageReply,coldSha} from '../scripts/bochs-cpu3-native-cold-reset-host.mjs';
// Deliberately small host model checks, not native execution receipts. The real
// free ROM and four native arms are qualified by the source-bound runner.
const model=()=>new NativeColdResetHost(new Uint8Array(65536).fill(0xa7));
const request=(h,operation,arg0=0,arg1=0,arg2=0,payload='-')=>h.handleRequest({kind:'REQ',
  seq:h.nextRequest,operation,arg0,arg1,arg2,payload,nativeTicks:h.nativeTicks,successfulQuanta:h.successfulQuanta});

test('actual board reset epoch and native clock notifications keep CPU execution separate',()=>{
  const h=model();assert.equal(h.machine.cycles,4);assert.equal(h.machine.cpu.cycles,0);
  assert.throws(()=>h.machine.cpu.step(),/JavaScript CPU execution forbidden/);
  h.beginRun();request(h,'QUANTUM');
  assert.deepEqual([h.machine.cycles,h.machine._chipDebt,h.nativeTicks,h.successfulQuanta],[10,6,0,1]);
  const fraction=h.machine.chips.pit1._frac;request(h,'NATIVE_TICK',1);
  assert.equal(h.machine.chips.pit1._frac,fraction);assert.equal(h.machine.cycles,10);
  request(h,'PIO_OUT',0xe9,1,0x43);
  assert.equal(h.machine._chipDebt,0);assert.equal(h.journal.find(e=>e.kind==='board-pio').value,0x43);
  h.endRun();const final=h.finish();
  assert.equal(final.after.board.cycles,10);assert.equal(h.machine.cpu.cycles,0);
  assert.throws(()=>h.finish(),/unique terminal boundary/);
});

test('RAM effects and ignored ROM/openbus writes use actual decoded board bytes',()=>{
  const h=model();h.beginRun();
  assert.deepEqual(request(h,'WRITE',0x500,2,0,'a55a'),{kind:'MEM',seq:1,decoded:0x500,class:1,effect:2,hex:'a55a'});
  assert.equal(request(h,'READ',0x500,2).hex,'a55a');
  const ignored=request(h,'WRITE',0xf0200,1,0,'00');assert.equal(ignored.hex,'a7');assert.equal(ignored.effect,4);
  assert.equal(h.bus.at(-1).value,0);assert.equal(h.bus.at(-1).before,0xa7);assert.equal(h.bus.at(-1).after,0xa7);
  const open=request(h,'WRITE',0xc0000,1,0,'12');assert.equal(open.hex,'ff');assert.equal(open.effect,8);
  const reset=request(h,'READ',0xfffffff0,1);assert.equal(reset.decoded,0xfffff0);
  const wire=encodeColdReply(reset)[0];assert(wire.includes('\t00fffff0\t'));
  assert.deepEqual(parseColdRpcLine(wire),reset);h.endRun();
});

test('whole span rejection observes no bytes or peripheral effects',()=>{
  const h=model();h.beginRun();let reads=0,writes=0;
  h.machine._read386=()=>{reads++;return 0;};h.machine._write386=()=>{writes++;};
  for(const [address,width] of [[0xa0000,1],[0xb0000,1],[0xb8000,1],[0xbffff,1],[0xffffffff,2],[0x5ff,17],[0xfff,2]]){
    assert.throws(()=>request(h,'READ',address,width),/cold board host/);
    assert.throws(()=>request(h,'WRITE',address,width,0,'00'.repeat(width)),/cold board host/);
  }
  assert.deepEqual([reads,writes,h.bus.length],[0,0,0]);
  assert.throws(()=>h.mutate(),/mutation.*forbidden/);h.endRun();
});

test('immutable ROM pages require exact 64 chunk order and SHA before admission',()=>{
  const h=model();h.beginRun();const page=request(h,'PAGE',0xfffff000,4096);
  const lines=encodeColdReply(page);assert.equal(lines.length,66);
  const decoded=assembleColdPageReply(lines);assert.equal(decoded.decoded,0xfff000);
  assert.equal(coldSha(decoded.bytes),page.sha256);
  const mutations=[
    ls=>{ls.splice(2,1);},
    ls=>{[ls[1],ls[2]]=[ls[2],ls[1]];},
    ls=>{ls[1]=ls[1].replace(/\t0\t/,'\t1\t');},
    ls=>{ls[1]=ls[1].slice(0,-1)+'0';},
    ls=>{ls[0]=ls[0].replace(/\t0\t2\t/,'\t1\t2\t');},
    ls=>{ls[65]='BWR9\tEND\t999';},
  ];
  for(const mutate of mutations){const ls=[...lines];mutate(ls);assert.throws(()=>assembleColdPageReply(ls),/cold board host/);}
  for(const address of [0,0xa0000,0xc0000])assert.throws(()=>request(h,'PAGE',address,4096),/cold board host/);
  h.endRun();
});

test('wire rejects noncanonical numbers, widths and overlong page chunks',()=>{
  for(const line of [
    'BWR9\tREQ\t01\tREAD\t0\t1\t0\t-\t0\t0',
    'BWR9\tREQ\t1\tWRITE\t0\t2\t0\tff\t0\t0',
    'BWR9\tMEM\t1\tOK\t00FFFFF0\t2\t3\ta7',
    'BWR9\tDATA\t1\t64\t'+'00'.repeat(64),
    'BWR9\tDATA\t1\t0\t'+'00'.repeat(128),
    'BWR8\tREP\t1\tOK\t0',
    'BWR9\tDONE\t1\tRUN\t4\t0\t0\tf000\t0000018a\t49\t49\t49\t49\t0\t0\t1\t1\t0',
  ])assert.throws(()=>parseColdRpcLine(line),/cold board host/);
  assert.equal(parseColdRpcLine('BWR9\tDONE\t1\tRUN\t4\t0\t0\tf000\t0000018a\t49\t49\t49\t49\t0\t0\t512\t1\t0').ifFlag,true);
});
