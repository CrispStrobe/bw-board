import test from 'node:test';
import assert from 'node:assert/strict';
import ProtectedI80286,{SEG_DS}from'../src/experimental/i80286-protected.js';

function fixture(program=[]){
  const mem=new Map(),fetches=[];
  const cpu=new ProtectedI80286({
    read:a=>mem.get(a)??0,
    fetch:a=>{fetches.push(a);return mem.get(a)??0;},
    write:(a,v)=>mem.set(a,v&255),
  },{deliverProtectedFaults:true});
  const put=(a,bytes)=>bytes.forEach((v,i)=>mem.set(a+i,v));
  const word=a=>(mem.get(a)??0)|((mem.get(a+1)??0)<<8);
  const desc=(a,base,limit,access)=>put(a,[limit&255,limit>>8,base&255,base>>8&255,base>>16&255,access,0,0]);
  const gate=(vector,offset,{selector=8,present=true,type=6}={})=>
    put(0x400+vector*8,[offset&255,offset>>8,selector&255,selector>>8,0,(present?0x80:0)|type,0,0]);
  put(0,[0x0f,1,0x16,0,1,0x0f,1,0x1e,6,1,0xb8,1,0,0x0f,1,0xf0,0xea,0,0,8,0]);
  put(0x100,[0x17,0,0,2,0,0,0xff,0x07,0,4,0,0]);
  desc(0x208,0x100000,0xffff,0x9a);desc(0x210,0x120000,0xffff,0x92);
  put(0x100000,[0xb8,0x10,0,0x8e,0xd0,0xbc,0,1,...program]);
  cpu.cs=0;cpu.ip=0;
  for(let i=0;i<8;i++)cpu.step();
  return{cpu,mem,fetches,put,word,desc,gate};
}

test('TF traps completed instructions with SS and explicit control-transfer suppression',()=>{
  const plain=fixture([0x90,0xf4]);plain.gate(1,0x100);plain.cpu.flags|=0x100;
  plain.cpu.step();assert.deepEqual([plain.cpu.ip,plain.cpu.sp],[0x100,0xfa]);
  assert.equal(plain.word(0x1200fa),9,'single-step saves the completed instruction next IP');

  const movss=fixture([0x8e,0xd0,0x90]);movss.gate(1,0x100);movss.cpu.flags|=0x100;
  movss.cpu.step();assert.equal(movss.cpu.ip,10,'MOV SS retires without a debug trap');
  movss.cpu.step();assert.equal(movss.cpu.ip,0x100,'the following instruction is traced');

  const sti=fixture([0xfb,0x90]);sti.gate(1,0x100);sti.cpu.flags|=0x100;
  sti.cpu.step();assert.equal(sti.cpu.ip,0x100,'STI shadow does not suppress single-step');

  const popf=fixture([0x9d]);popf.gate(1,0x100);popf.cpu.flags|=0x100;
  popf.put(0x120100,[2,0]);popf.cpu.step();assert.equal(popf.cpu.ip,0x100,'TF sampled before POPF clearing it');

  const software=fixture([0xcd,0x20]);software.gate(0x20,0x180);software.gate(1,0x100);software.cpu.flags|=0x100;
  software.cpu.step();assert.equal(software.cpu.ip,0x180,'software INT entry suppresses the old task trace');

  const halt=fixture([0xf4]);halt.gate(1,0x100);halt.cpu.flags|=0x100;
  halt.cpu.step();assert.equal(halt.cpu.ip,0x100);assert.equal(halt.cpu.halted,false);
});

test('TF on LMSW delivers a malformed #DB gate replacement from the completed boundary',()=>{
  const mem=new Map();
  const cpu=new ProtectedI80286({
    read:a=>mem.get(a)??0,fetch:a=>mem.get(a)??0,write:(a,v)=>mem.set(a,v&255),
  },{deliverProtectedFaults:true});
  const put=(a,bytes)=>bytes.forEach((v,i)=>mem.set(a+i,v));
  put(0,[0x0f,0x01,0xf0]);
  put(0x208,[0xff,0xff,0,0x10,0,0x9a,0,0]);
  put(0x408,[0,0,0,0,0,0x86,0,0]);
  put(0x468,[0,1,8,0,0,0x86,0,0]);
  cpu.gdtr={base:0x200,limit:0x0f};cpu.idtr={base:0x400,limit:0x6f};
  cpu.cs=0;cpu.ip=0;cpu.ax=1;cpu.flags=0x0102;
  cpu.step();
  assert.deepEqual([cpu.msw&1,cpu.ip,cpu.sp],[1,0x100,0xfff8]);
  assert.equal((mem.get(0xfff8)??0)|((mem.get(0xfff9)??0)<<8),1,
    '#GP for malformed external #DB entry retains EXT');
  assert.equal((mem.get(0xfffa)??0)|((mem.get(0xfffb)??0)<<8),3,
    'replacement handler saves the completed LMSW IP');
});

test('a contributory delivery fault escalates to #DF with a zero error word',()=>{
  const f=fixture([0x8b,0x06,0x10,0]);
  f.cpu.segmentCaches[SEG_DS].limit=0x10;
  f.gate(13,0x100,{selector:0});f.gate(8,0x180);
  f.cpu.step();
  assert.deepEqual([f.cpu.ip,f.cpu.sp,f.word(0x1200f8)],[0x180,0xf8,0]);
  assert.equal(f.word(0x1200fa),8,'double-fault frame identifies the original instruction');
  assert.equal(f.cpu.shutdown,false);
});

test('#DF task gate saves the broken task and starts a clean double-fault task',()=>{
  const f=fixture([0x8b,0x06,0x10,0]);f.cpu.gdtr.limit=0x27;
  f.desc(0x218,0x170000,0x2b,0x83);f.desc(0x220,0x171000,0x2b,0x81);
  f.cpu.tr={selector:0x18,valid:true,base:0x170000,limit:0x2b};
  const words=new Map([[0x0e,0x180],[0x10,2],[0x1a,0x300],[0x22,0x10],[0x24,8],[0x26,0x10],[0x28,0x10],[0x2a,0]]);
  for(const [offset,value]of words)f.put(0x171000+offset,[value&255,value>>8]);
  f.cpu.segmentCaches[SEG_DS].limit=0x10;f.cpu.segmentCaches[2].usable=false;
  f.gate(13,0x100,{selector:0});f.gate(8,0,{selector:0x20,type:5});
  f.cpu.step();
  assert.deepEqual([f.cpu.tr.selector,f.cpu.ip,f.cpu.sp],[0x20,0x180,0x2fe]);
  assert.equal(f.word(0x171000),0x18,'new task backlink identifies the faulting task');
  assert.equal(f.word(0x17000e),8,'outgoing TSS saves the original restart IP');
  assert.equal(f.word(0x1202fe),0,'#DF error word is zero on the new task stack');

  const broken=fixture([0x8b,0x06,0x10,0]);broken.cpu.gdtr.limit=0x27;
  broken.desc(0x218,0x170000,0x2b,0x83);broken.desc(0x220,0x171000,0x2b,0x81);
  broken.cpu.tr={selector:0x18,valid:true,base:0x170000,limit:0x2b};
  for(const [offset,value]of words)broken.put(0x171000+offset,[value&255,value>>8]);
  broken.put(0x171028,[0x28,0]);broken.cpu.segmentCaches[SEG_DS].limit=0x10;
  broken.gate(13,0x100,{selector:0});broken.gate(8,0,{selector:0x20,type:5});
  broken.cpu.step();
  assert.equal(broken.cpu.shutdown,true);assert.equal(broken.cpu.tr.selector,0x20,
    'post-commit #DF task failure retains the incoming task context');

  const committed=fixture([0x8b,0x06,0x10,0]);committed.cpu.gdtr.limit=0x27;
  committed.desc(0x218,0x170000,0x2b,0x83);committed.desc(0x220,0x171000,0x2b,0x81);
  committed.cpu.tr={selector:0x18,valid:true,base:0x170000,limit:0x2b};
  for(const [offset,value]of words)committed.put(0x171000+offset,[value&255,value>>8]);
  committed.put(0x171028,[0x28,0]);committed.cpu.segmentCaches[SEG_DS].limit=0x10;
  committed.gate(13,0,{selector:0x20,type:5});committed.gate(8,0x1c0);
  committed.cpu.step();
  assert.deepEqual([committed.cpu.tr.selector,committed.cpu.ip,committed.cpu.sp],[0x20,0x1c0,0x2f8]);
  assert.equal(committed.word(0x1202fa),0x180,
    '#DF after a post-commit task fault saves the incoming task IP');
  assert.equal(committed.word(0x1202f8),0);

  const traced=fixture([0x90]);traced.cpu.gdtr.limit=0x27;
  traced.desc(0x218,0x170000,0x2b,0x83);traced.desc(0x220,0x171000,0x2b,0x81);
  traced.cpu.tr={selector:0x18,valid:true,base:0x170000,limit:0x2b};
  for(const [offset,value]of words)traced.put(0x171000+offset,[value&255,value>>8]);
  traced.put(0x171028,[0x28,0]);traced.gate(1,0,{selector:0x20,type:5});traced.gate(10,0x1d0);
  traced.cpu.flags|=0x100;traced.cpu.step();
  assert.deepEqual([traced.cpu.tr.selector,traced.cpu.ip,traced.cpu.sp],[0x20,0x1d0,0x2f8]);
  assert.equal(traced.word(0x1202fa),0x180,
    'a post-commit #DB task fault delivers its replacement from the incoming task IP');
  assert.equal(traced.word(0x1202f8),0x29,'#DB replacement retains the external-event bit');
});

test('a failed #DF enters shutdown; failed NMI leaves RESET as the only recovery',()=>{
  const failed=fixture([0x8b,0x06,0x10,0]);failed.cpu.segmentCaches[SEG_DS].limit=0x10;
  failed.gate(13,0x100,{selector:0});failed.gate(8,0x180,{selector:0});
  failed.cpu.step();assert.equal(failed.cpu.shutdown,true);assert.equal(failed.cpu.step(),0);
  const stoppedIp=failed.cpu.ip;failed.cpu.interrupt(0x20);assert.equal(failed.cpu.ip,stoppedIp);
  failed.gate(2,0x1a0,{selector:0});
  assert.throws(()=>failed.cpu.interrupt(2),e=>e.vector===13);assert.equal(failed.cpu.shutdown,true);
  failed.gate(2,0x1a0);failed.cpu.interrupt(2);
  assert.equal(failed.cpu.shutdown,true,'a second NMI cannot recover after failed NMI entry');
  failed.cpu.reset();assert.equal(failed.cpu.shutdown,false);

  const recovered=fixture();recovered.cpu.shutdown=true;recovered.gate(2,0x1a0);
  recovered.cpu.interrupt(2);
  assert.deepEqual([recovered.cpu.shutdown,recovered.cpu.ip],[false,0x1a0]);

  const ud=fixture([0x8e,0xc8]);ud.cpu.gdtr.limit=0x27;ud.desc(0x220,0x100000,0xffff,0x1a);
  ud.gate(6,0x100,{selector:0x20});ud.gate(11,0x1c0);
  ud.cpu.step();
  assert.equal(ud.cpu.ip,0x1c0,'#UD entry #NP is delivered as the replacement exception');
  assert.equal(ud.word(0x1200f8),0x20);assert.equal(ud.word(0x1200fa),8);
});

test('host failures during #DF delivery stay visible and do not become shutdown',()=>{
  const f=fixture([0x8b,0x06,0x10,0]);f.cpu.segmentCaches[SEG_DS].limit=0x10;
  f.gate(13,0x100,{selector:0});f.gate(8,0x180);
  const hostFailure=new Error('host bus write failure');
  f.cpu.write=()=>{throw hostFailure;};
  assert.throws(()=>f.cpu.step(),error=>error===hostFailure);
  assert.equal(f.cpu.shutdown,false);
});

test('host failures during shutdown NMI do not invent an architectural NMI lockout',()=>{
  const f=fixture();f.cpu.shutdown=true;f.gate(2,0x1a0);
  const hostFailure=new Error('host NMI bus failure');let calls=0;
  f.cpu.write=()=>{calls++;throw hostFailure;};
  assert.throws(()=>f.cpu.interrupt(2),error=>error===hostFailure);
  assert.equal(f.cpu._shutdownNmiFailed,false);
  assert.throws(()=>f.cpu.interrupt(2),error=>error===hostFailure);
  assert.ok(calls>=2,'the second NMI is attempted because no architectural entry fault occurred');
});

test('WAIT and ESC expose the bounded 286 #NM controls',()=>{
  const wait=fixture([0x9b]);wait.gate(7,0x120);wait.cpu.msw|=0x0a;wait.cpu.step();
  assert.equal(wait.cpu.ip,0x120);assert.equal(wait.word(0x1200fa),8);

  const esc=fixture([0xd8,0xc0]);esc.gate(7,0x120);esc.cpu.msw|=4;esc.cpu.step();
  assert.equal(esc.cpu.ip,0x120);assert.equal(esc.word(0x1200fa),8);

  const emWait=fixture([0x9b,0xf4]);emWait.cpu.msw|=4;emWait.cpu.step();assert.equal(emWait.cpu.ip,9);
});
