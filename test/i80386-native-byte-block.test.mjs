import test from 'node:test';
import assert from 'node:assert/strict';
import {createI80386RamBridge} from '../src/experimental/i80386-ram-bridge.js';
import {ExperimentalI80386ATMachine,
  PCAT80386_EXPERIMENTAL_4M_HDD_XV6_SMP} from '../src/experimental/i80386-at-machine.js';
import {createI80386NativeByteRunner,isI80386NativeByteBlockValid} from
  '../src/experimental/i80386-native-byte-block.js';

const CODE=0x80120000, DATA=0x80130000;
const CODE_PHYS=0x120000, DATA_PHYS=0x130000;

async function fixture(shared) {
  const machine=new ExperimentalI80386ATMachine(PCAT80386_EXPERIMENTAL_4M_HDD_XV6_SMP);
  let bridge;
  if (shared) {bridge=await createI80386RamBridge();bridge.attach(machine);}
  const put32=(address,value)=>{
    for(let i=0;i<4;i++)machine._write386(address+i,(value>>>(8*i))&255);
  };
  put32(0x1800,0x4007);
  put32(0x4000+0x120*4,CODE_PHYS|7);
  put32(0x4000+0x130*4,DATA_PHYS|7);
  // MOV EAX,[EBX+ECX*4+10h]; CMP EAX,EDX; JNZ back to MOV.
  for(const [i,v] of [0x8b,0x44,0x8b,0x10,0x39,0xd0,0x75,0xf8].entries())
    machine._write386(CODE_PHYS+i,v);
  put32(DATA_PHYS+24,0x12345679);
  const cpu=machine.cpu;
  cpu.segmentCaches[1]={base:0,limit:0xffffffff,default32:true,
    present:true,code:true,readable:true,writable:false};
  cpu.segmentCaches[0]={base:0,limit:0xffffffff,default32:true,
    present:true,code:false,readable:true,writable:true};
  cpu.segmentCaches[3]={base:0,limit:0xffffffff,default32:true,
    present:true,code:false,readable:true,writable:true};
  cpu.cr0=0x80000001;cpu.cr3=0x1000;cpu.eip=CODE;
  cpu.ebx=DATA;cpu.ecx=2;cpu.edx=0x12345678;
  cpu._translate(CODE);cpu._translate(DATA+24);
  machine._chipDebt=0;machine._chipDeadline=100;
  return {machine,bridge,put32};
}

function state(machine) {
  const cpu=machine.cpu;
  return {eax:cpu.eax,ecx:cpu.ecx,edx:cpu.edx,ebx:cpu.ebx,
    eip:cpu.eip,eflags:cpu.eflags,cpuCycles:cpu.cycles,
    boardCycles:machine.cycles,chipDebt:machine._chipDebt};
}

test('real paged bytes execute a linked native loop with AT cycle accounting',async()=>{
  const fast=await fixture(true),slow=await fixture(false);
  const runner=await createI80386NativeByteRunner(fast.machine,fast.bridge);
  const block=runner.decode(8);
  assert.deepEqual(block?.instructions.map(ins=>ins.op),[8,2,5]);
  assert.equal(isI80386NativeByteBlockValid(block),true);
  assert.deepEqual(runner.run(block,6),{instructions:6,cycles:36,reason:'event'});
  for(let i=0;i<6;i++)slow.machine.step();
  assert.deepEqual(state(fast.machine),state(slow.machine));
  assert.equal(fast.machine.cpu.eip,CODE);

  fast.machine._write386(CODE_PHYS+5,0xc8); // Host edits the decoded CMP.
  assert.equal(isI80386NativeByteBlockValid(block),false);
  const before=state(fast.machine);
  assert.deepEqual(runner.run(block,6),{instructions:0,cycles:0,reason:'fallback'});
  assert.deepEqual(state(fast.machine),before);
});

test('native block exits at the same AT chip horizon as ordinary steps',async()=>{
  const fast=await fixture(true),slow=await fixture(false);
  fast.machine._chipDeadline=slow.machine._chipDeadline=7;
  const runner=await createI80386NativeByteRunner(fast.machine,fast.bridge);
  const block=runner.decode(8);
  assert.deepEqual(runner.run(block,8),{instructions:2,cycles:12,reason:'event'});
  slow.machine.step();slow.machine.step();
  assert.deepEqual(state(fast.machine),state(slow.machine));
  fast.machine.cpu.eflags|=0x100; // Single-step tracing uses the JS CPU.
  assert.deepEqual(runner.run(block,8),{instructions:0,cycles:0,reason:'fallback'});
});

test('stale PIC interrupt does not block native execution after xv6 APIC handoff',async()=>{
  const fast=await fixture(true),slow=await fixture(false);
  for(const {machine} of [fast,slow]) {
    machine._mpReady=true;
    machine._pic._intActive=true;
    machine.cpu.eflags|=0x200;
  }
  const runner=await createI80386NativeByteRunner(fast.machine,fast.bridge);
  const block=runner.decode(8);
  assert.deepEqual(runner.run(block,3),{instructions:3,cycles:18,reason:'event'});
  for(let i=0;i<3;i++)slow.machine.step();
  assert.deepEqual(state(fast.machine),state(slow.machine));
});

test('a masked PIC interrupt does not block native execution with IF clear',async()=>{
  const fast=await fixture(true),slow=await fixture(false);
  for(const {machine} of [fast,slow]) {
    machine._pic._intActive=true;
    machine.cpu.eflags&=~0x200;
  }
  const runner=await createI80386NativeByteRunner(fast.machine,fast.bridge);
  const block=runner.decode(8);
  assert.deepEqual(runner.run(block,3),{instructions:3,cycles:18,reason:'event'});
  for(let i=0;i<3;i++)slow.machine.step();
  assert.deepEqual(state(fast.machine),state(slow.machine));
});

test('a masked IOAPIC edge does not block native execution',async()=>{
  const fast=await fixture(true),slow=await fixture(false);
  for(const {machine} of [fast,slow]) {
    machine._mpReady=true;
    machine._apicIrqMask=1 << 14;
    machine._ioapic[0x10 + 14 * 2]=0x10000;
    machine.cpu.eflags|=0x200;
  }
  const runner=await createI80386NativeByteRunner(fast.machine,fast.bridge);
  const block=runner.decode(8);
  assert.deepEqual(runner.run(block,3),{instructions:3,cycles:18,reason:'event'});
  for(let i=0;i<3;i++)slow.machine.step();
  assert.deepEqual(state(fast.machine),state(slow.machine));
});

test('a deliverable IOAPIC edge exits before native execution',async()=>{
  const {machine,bridge}=await fixture(true);
  machine._mpReady=true;
  machine._apicIrqMask=1 << 14;
  machine._ioapic[0x10 + 14 * 2]=0x32;
  machine.cpu.eflags|=0x200;
  const runner=await createI80386NativeByteRunner(machine,bridge);
  const block=runner.decode(8),before=state(machine);
  assert.deepEqual(runner.run(block,3),
    {instructions:0,cycles:0,reason:'fallback'});
  assert.deepEqual(state(machine),before);
});

test('page-table remap invalidates a previously decoded native load',async()=>{
  const {machine,bridge,put32}=await fixture(true);
  const runner=await createI80386NativeByteRunner(machine,bridge);
  const block=runner.decode(8);
  assert.equal(isI80386NativeByteBlockValid(block),true);
  put32(0x4000+0x130*4,0x140007);
  assert.equal(isI80386NativeByteBlockValid(block),false);
  assert.deepEqual(runner.run(block,8),{instructions:0,cycles:0,reason:'fallback'});
});

test('register-immediate MOV and sign-extended CMP loop matches ordinary 386 flags',async()=>{
  const fast=await fixture(true),slow=await fixture(false);
  // MOV EAX,12345679h; CMP EAX,78h; JNZ back to MOV.
  const code=[0xb8,0x79,0x56,0x34,0x12,0x83,0xf8,0x78,0x75,0xf6];
  for(const machine of [fast.machine,slow.machine])
    code.forEach((byte,i)=>machine._write386(CODE_PHYS+i,byte));
  const runner=await createI80386NativeByteRunner(fast.machine,fast.bridge);
  const block=runner.decode(8);
  assert.deepEqual(block?.instructions.map(ins=>ins.op),[11,10,5]);
  assert.deepEqual(runner.run(block,6),{instructions:6,cycles:36,reason:'event'});
  for(let i=0;i<6;i++)slow.machine.step();
  assert.deepEqual(state(fast.machine),state(slow.machine));
});

test('full-width CMP immediate preserves ordinary 386 flags',async()=>{
  const fast=await fixture(true),slow=await fixture(false);
  // MOV EAX,FFFFFFFFh; CMP EAX,80000000h; JNZ back to MOV.
  const code=[0xb8,0xff,0xff,0xff,0xff,0x81,0xf8,
    0x00,0x00,0x00,0x80,0x75,0xf3];
  for(const machine of [fast.machine,slow.machine])
    code.forEach((byte,i)=>machine._write386(CODE_PHYS+i,byte));
  const runner=await createI80386NativeByteRunner(fast.machine,fast.bridge);
  const block=runner.decode(8);
  assert.deepEqual(block?.instructions.map(ins=>ins.op),[11,10,5]);
  assert.deepEqual(runner.run(block,6),{instructions:6,cycles:36,reason:'event'});
  for(let i=0;i<6;i++)slow.machine.step();
  assert.deepEqual(state(fast.machine),state(slow.machine));
});

test('native register immediate ALU and shift bytes match interpreter flags',async()=>{
  const cases=[
    {name:'ADD overflow',code:[0x83,0xc0,0x01],eax:0x7fffffff,flags:0x202,op:12},
    {name:'ADD sign-extended negative',code:[0x83,0xc0,0xff],eax:0,flags:0x202,op:12},
    {name:'ADD full immediate',code:[0x81,0xc0,0x01,0,0,0x80],eax:0x80000000,flags:0x202,op:12},
    {name:'OR sign-extended immediate',code:[0x83,0xc8,0x80],eax:0,flags:0x213,op:13},
    {name:'AND sign-extended immediate',code:[0x83,0xe0,0x7f],eax:0xffffffff,flags:0x213,op:14},
    {name:'AND EAX immediate',code:[0x25,0,0,0,0x80],eax:0xffffffff,flags:0x213,op:14},
    {name:'SHL count one',code:[0xc1,0xe0,0x01],eax:0x80000001,flags:0x212,op:15},
    {name:'SHR count one',code:[0xc1,0xe8,0x01],eax:0x80000001,flags:0x212,op:16},
    {name:'SHR count thirteen',code:[0xc1,0xe8,0x0d],eax:0xa4680001,flags:0xa12,op:16},
    {name:'SHL masked zero',code:[0xc1,0xe0,0x20],eax:0x80000001,flags:0xad7,op:15},
    {name:'SHR masked zero',code:[0xc1,0xe8,0x00],eax:0x80000001,flags:0xad7,op:16},
  ];
  for(const entry of cases) {
    const fast=await fixture(true),slow=await fixture(false);
    for(const machine of [fast.machine,slow.machine]) {
      entry.code.forEach((byte,i)=>machine._write386(CODE_PHYS+i,byte));
      machine.cpu.eax=entry.eax;machine.cpu.eflags=entry.flags;
    }
    const runner=await createI80386NativeByteRunner(fast.machine,fast.bridge);
    const block=runner.decode(1);
    assert.equal(block?.instructions[0]?.op,entry.op,entry.name);
    assert.deepEqual(runner.run(block,1),
      {instructions:1,cycles:6,reason:'done'},entry.name);
    slow.machine.step();
    assert.deepEqual(state(fast.machine),state(slow.machine),entry.name);
  }
});

test('native immediate decoder rejects memory operands',async()=>{
  const {machine,bridge}=await fixture(true);
  const runner=await createI80386NativeByteRunner(machine,bridge);
  for(const code of [[0x83,0x00,0x01],[0xc1,0x28,0x05]]) {
    code.forEach((byte,i)=>machine._write386(CODE_PHYS+i,byte));
    assert.equal(runner.decode(1),null);
  }
});

test('TEST AL,imm8 matches interpreter flags without changing EAX',async()=>{
  for(const [eax,immediate,flags] of [
    [0x12345680,0x80,0xad7], [0x87654380,0x7f,0xad7],
    [0xffffffff,0x55,0x202], [0xabcdef01,0x01,0x202],
  ]) {
    const fast=await fixture(true),slow=await fixture(false);
    for(const machine of [fast.machine,slow.machine]) {
      machine._write386(CODE_PHYS,0xa8);
      machine._write386(CODE_PHYS+1,immediate);
      machine.cpu.eax=eax;machine.cpu.eflags=flags;
    }
    const runner=await createI80386NativeByteRunner(fast.machine,fast.bridge);
    const block=runner.decode(1);
    assert.equal(block?.instructions[0]?.op,18);
    assert.deepEqual(runner.run(block,1),
      {instructions:1,cycles:6,reason:'done'});
    slow.machine.step();
    assert.deepEqual(state(fast.machine),state(slow.machine));
  }
});

test('terminal forward JZ and JNZ exit to their target or fallthrough',async()=>{
  for(const opcode of [0x74,0x75]) for(const taken of [false,true]) {
    const fast=await fixture(true),slow=await fixture(false);
    for(const machine of [fast.machine,slow.machine]) {
      // MOV EAX,1; Jcc +2; NOP; NOP; NOP.
      [0xb8,1,0,0,0,opcode,2,0x90,0x90,0x90].forEach((byte,i)=>
        machine._write386(CODE_PHYS+i,byte));
      machine.cpu.eflags=(taken === (opcode === 0x74)) ? 0x42 : 2;
    }
    const runner=await createI80386NativeByteRunner(fast.machine,fast.bridge);
    const block=runner.decode(8);
    assert.deepEqual(block?.instructions.map(ins=>ins.op),
      [11,opcode === 0x74 ? 4 : 5]);
    assert.equal(block.instructions[1].dst,2);
    assert.deepEqual(runner.run(block,2),
      {instructions:2,cycles:12,reason:'done'});
    slow.machine.step();slow.machine.step();
    assert.deepEqual(state(fast.machine),state(slow.machine));
    assert.equal(fast.machine.cpu.eip,CODE+(taken ? 9 : 7));
  }
});

test('OR register from validated SS RAM matches interpreter flags and cycles',async()=>{
  for(const [source,initial] of [[0x12345678,0x80000000],[0,0],[0xffffffff,0x12]]) {
    const fast=await fixture(true),slow=await fixture(false);
    for(const {machine,put32} of [fast,slow]) {
      // OR ESI,1; OR ESI,[EBP+0]; NOP.
      [0x83,0xce,1,0x0b,0x75,0,0x90].forEach((byte,i)=>
        machine._write386(CODE_PHYS+i,byte));
      machine.cpu.segmentCaches[2]={base:0,limit:0xffffffff,default32:true,
        present:true,code:false,readable:true,writable:true};
      machine.cpu.ebp=DATA+24;machine.cpu.esi=initial;
      machine.cpu.eflags=0xad7;
      put32(DATA_PHYS+24,source);
      machine.cpu._translate(DATA+24);
    }
    const runner=await createI80386NativeByteRunner(fast.machine,fast.bridge);
    const block=runner.decode(8);
    assert.deepEqual(block?.instructions.map(ins=>ins.op),[13,19,0]);
    assert.deepEqual(runner.run(block,2),
      {instructions:2,cycles:12,reason:'event'});
    slow.machine.step();slow.machine.step();
    assert.deepEqual({...state(fast.machine),esi:fast.machine.cpu.esi},
      {...state(slow.machine),esi:slow.machine.cpu.esi});
  }
});

test('OR RAM window exits before a dynamic address leaves its page',async()=>{
  const {machine,bridge}=await fixture(true);
  [0x83,0xce,1,0x0b,0x75,0,0x90].forEach((byte,i)=>
    machine._write386(CODE_PHYS+i,byte));
  machine.cpu.segmentCaches[2]={base:0,limit:0xffffffff,default32:true,
    present:true,code:false,readable:true,writable:true};
  machine.cpu.ebp=DATA+24;machine.cpu.esi=0x10;
  machine.cpu._translate(DATA+24);
  const runner=await createI80386NativeByteRunner(machine,bridge);
  const block=runner.decode(8);
  assert.equal(block?.instructions[1]?.op,19);
  machine.cpu.ebp=DATA+0x1000;
  assert.deepEqual(runner.run(block,3),
    {instructions:1,cycles:6,reason:'unsupported'});
  assert.equal(machine.cpu.esi,0x11);
  assert.equal(machine.cpu.eip,CODE+3);
});

async function stosFixture({count=9,offset=0,direction=false,extraPage=false}={}) {
  const fast=await fixture(true),slow=await fixture(false);
  for(const {machine,put32} of [fast,slow]) {
    if (extraPage) put32(0x4000+0x131*4,(DATA_PHYS+0x1000)|7);
    machine._write386(CODE_PHYS,0xf3);
    machine._write386(CODE_PHYS+1,0xab);
    const cpu=machine.cpu;
    cpu.eax=0x89abcdef;cpu.ecx=count;cpu.edi=(DATA+offset)>>>0;
    cpu.eflags=0x202 | (direction ? 0x400 : 0);
    machine.step(); // The interpreter sets REP restart state and the dirty TLB bit.
  }
  return {fast,slow,runner:await createI80386NativeByteRunner(fast.machine,fast.bridge)};
}

function stosState(machine) {
  return {...state(machine),edi:machine.cpu.edi,
    repeatContext:machine.cpu._repeatContext,
    data:Array.from(machine.mem.slice(DATA_PHYS-8,DATA_PHYS+0x1010))};
}

test('native REP STOSD completes after the first interpreted iteration in both directions',async()=>{
  for(const direction of [false,true]) {
    const {fast,slow,runner}=await stosFixture({count:9,
      offset:direction ? 32 : 0,direction});
    const block=runner.decode(8);
    assert.deepEqual(block?.instructions.map(ins=>ins.op),[17]);
    assert.deepEqual(runner.run(block,8),
      {instructions:8,cycles:48,reason:'done'});
    for(let i=0;i<8;i++)slow.machine.step();
    assert.deepEqual(stosState(fast.machine),stosState(slow.machine));
    assert.equal(fast.machine.cpu._repeatContext,null);
    assert.equal(fast.machine.cpu.eip,CODE+2);
  }
});

test('native REP STOSD respects instruction and chip budgets and retains restart state',async()=>{
  const {fast,slow,runner}=await stosFixture({count:12});
  const block=runner.decode(8);
  assert.deepEqual(runner.run(block,3),
    {instructions:3,cycles:18,reason:'event'});
  for(let i=0;i<3;i++)slow.machine.step();
  assert.deepEqual(stosState(fast.machine),stosState(slow.machine));
  fast.machine._chipDeadline=slow.machine._chipDeadline=fast.machine._chipDebt+7;
  assert.deepEqual(runner.run(block,8),
    {instructions:2,cycles:12,reason:'event'});
  for(let i=0;i<2;i++)slow.machine.step();
  assert.deepEqual(stosState(fast.machine),stosState(slow.machine));
});

test('native REP STOSD exits before a page crossing and resumes after JS primes next page',async()=>{
  const {fast,slow,runner}=await stosFixture({count:5,offset:0xff8,extraPage:true});
  const block=runner.decode(8);
  assert.equal(block?.instructions[0]?.op,17);
  assert.deepEqual(runner.run(block,8),
    {instructions:1,cycles:6,reason:'fault-boundary'});
  slow.machine.step();
  assert.deepEqual(stosState(fast.machine),stosState(slow.machine));
  assert.deepEqual(runner.run(block,8),
    {instructions:0,cycles:0,reason:'fault-boundary'});
  fast.machine.step();slow.machine.step(); // New page first write runs through JS.
  assert.deepEqual(stosState(fast.machine),stosState(slow.machine));
  const next=runner.decode(8);
  assert.equal(next?.instructions[0]?.op,17);
  assert.deepEqual(runner.run(next,8),
    {instructions:2,cycles:12,reason:'done'});
  slow.machine.step();slow.machine.step();
  assert.deepEqual(stosState(fast.machine),stosState(slow.machine));
});

test('native REP STOSD invalidates for code mutation and page remap',async()=>{
  const {fast,runner}=await stosFixture({count:5});
  const block=runner.decode(8);
  assert.equal(isI80386NativeByteBlockValid(block),true);
  fast.machine._write386(CODE_PHYS+1,0xaa);
  assert.equal(isI80386NativeByteBlockValid(block),false);
  fast.machine._write386(CODE_PHYS+1,0xab);
  fast.put32(0x4000+0x130*4,0x140007);
  assert.equal(isI80386NativeByteBlockValid(block),false);
  assert.deepEqual(runner.run(block,8),
    {instructions:0,cycles:0,reason:'fallback'});
});

test('native REP STOSD requires exact bytes and matching interpreter restart state',async()=>{
  const {fast,runner}=await stosFixture({count:5});
  const cpu=fast.machine.cpu;
  assert.equal(runner.decode(1)?.instructions[0]?.op,17);
  const context=cpu._repeatContext;
  cpu._repeatContext=null;
  assert.equal(runner.decode(1),null);
  cpu._repeatContext={...context,eip:CODE+2};
  assert.equal(runner.decode(1),null);
  cpu._repeatContext=context;
  fast.machine._write386(CODE_PHYS,0x66);
  assert.equal(runner.decode(1),null);
});

const DEST=0x80140000,DEST_PHYS=0x140000;

async function movsFixture({count=7,sourceOffset=0,destinationOffset=0,
  direction=false,overlap=false}={}) {
  const fast=await fixture(true),slow=await fixture(false);
  for(const {machine,put32} of [fast,slow]) {
    put32(0x4000+0x140*4,DEST_PHYS|7);
    for(let i=0;i<16;i++) put32(DATA_PHYS+i*4,0x12340000+i);
    machine._write386(CODE_PHYS,0xf3);
    machine._write386(CODE_PHYS+1,0xa5);
    const cpu=machine.cpu;
    cpu.esi=(DATA+sourceOffset)>>>0;
    cpu.edi=((overlap?DATA:DEST)+destinationOffset)>>>0;
    cpu.ecx=count;
    cpu.eflags=0x202 | (direction?0x400:0);
    machine.step(); // Prime source read, destination dirty bit and REP restart.
  }
  return {fast,slow,runner:await createI80386NativeByteRunner(fast.machine,fast.bridge)};
}

function movsState(machine) {
  return {...state(machine),esi:machine.cpu.esi,edi:machine.cpu.edi,
    repeatContext:machine.cpu._repeatContext,
    source:Array.from(machine.mem.slice(DATA_PHYS,DATA_PHYS+0x1000)),
    destination:Array.from(machine.mem.slice(DEST_PHYS,DEST_PHYS+0x1000))};
}

test('native REP MOVSD matches interpreter for forward and reverse overlap',async()=>{
  for(const {direction,sourceOffset,destinationOffset} of [
    {direction:false,sourceOffset:0,destinationOffset:4},
    {direction:true,sourceOffset:20,destinationOffset:16},
  ]) {
    const {fast,slow,runner}=await movsFixture({count:5,direction,
      sourceOffset,destinationOffset,overlap:true});
    const block=runner.decode(8);
    assert.deepEqual(block?.instructions.map(ins=>ins.op),[20]);
    assert.deepEqual(runner.run(block,8),
      {instructions:4,cycles:24,reason:'done'});
    for(let i=0;i<4;i++)slow.machine.step();
    assert.deepEqual(movsState(fast.machine),movsState(slow.machine));
    assert.equal(fast.machine.cpu._repeatContext,null);
  }
});

test('native REP MOVSD exits before source or destination page crossing',async()=>{
  for(const boundary of ['source','destination']) {
    const {fast,slow,runner}=await movsFixture({count:5,
      sourceOffset:boundary==='source'?0xff8:0,
      destinationOffset:boundary==='destination'?0xff8:0});
    const block=runner.decode(8);
    assert.equal(block?.instructions[0]?.op,20);
    assert.deepEqual(runner.run(block,8),
      {instructions:1,cycles:6,reason:'fault-boundary'});
    slow.machine.step();
    assert.deepEqual(movsState(fast.machine),movsState(slow.machine));
  }
});

test('native REP MOVSD honors chip budgets and source mapping invalidation',async()=>{
  const {fast,slow,runner}=await movsFixture({count:12});
  const block=runner.decode(8);
  fast.machine._chipDeadline=slow.machine._chipDeadline=fast.machine._chipDebt+7;
  assert.deepEqual(runner.run(block,8),
    {instructions:2,cycles:12,reason:'event'});
  slow.machine.step();slow.machine.step();
  assert.deepEqual(movsState(fast.machine),movsState(slow.machine));
  fast.put32(0x4000+0x130*4,0x150007);
  assert.equal(isI80386NativeByteBlockValid(block),false);
  assert.deepEqual(runner.run(block,8),
    {instructions:0,cycles:0,reason:'fallback'});
});

test('native REP MOVSD exits before a pending NMI without copying',async()=>{
  const {fast,runner}=await movsFixture({count:5});
  const block=runner.decode(8);
  const before=movsState(fast.machine);
  fast.machine._nmiPending=true;
  assert.deepEqual(runner.run(block,8),
    {instructions:0,cycles:0,reason:'fallback'});
  assert.deepEqual(movsState(fast.machine),before);
});
