import test from 'node:test';
import assert from 'node:assert/strict';
import I80386, {I80386Fault} from '../src/experimental/i80386.js';
import {ExperimentalI80386ATMachine,PCAT80386_EXPERIMENTAL_4M} from
  '../src/experimental/i80386-at-machine.js';

const code=[
  0x8e,0x06,0x80,0x00, // MOV ES,[0080]
  0x26,0xa0,0x00,0x00, // MOV AL,ES:[0000]
  0xe8,0x02,0x00,      // CALL 000d
  0xe4,0x21,           // IN AL,21h: event boundary after RET
  0xc3,                // RET to 000b
];
function put(memory,address,bytes){
  bytes.forEach((value,index)=>memory.set(address+index,value&255));
}
function descriptor(base,access=0x92){
  return [0xff,0xff,base,base>>>8,base>>>16,access,0,base>>>24]
    .map(value=>value&255);
}
function fixture(mode){
  const memory=new Map(code.map((value,address)=>[address,value]));
  const effects=[];
  let ioReads=0;
  const cpu=new I80386({
    fetch:address=>{effects.push(['fetch',address]);return memory.get(address)??0;},
    read:address=>{effects.push(['read',address]);return memory.get(address)??0;},
    write:(address,value)=>{effects.push(['write',address,value&255]);memory.set(address,value&255);},
    inPort:(port,width)=>{effects.push(['io',port,width]);ioReads++;return 0x5a;},
  });
  cpu.cr0=1;
  cpu.cs=mode==='vm86'?0:8;
  cpu.ds=0;
  cpu.ss=mode==='vm86'?0x100:0x10;
  cpu.esp=0x100;
  cpu.segmentCaches[1]={base:0,limit:0xffff,default32:false,present:true,
    code:true,readable:true,writable:false};
  cpu.segmentCaches[2]={base:0x1000,limit:0xffff,default32:false,present:true,
    code:false,readable:true,writable:true};
  memory.set(0x3000,0xa5);
  if(mode==='protected16'){
    cpu.gdtr={base:0x200,limit:0x1f};
    put(memory,0x218,descriptor(0x3000));
    put(memory,0x80,[0x18,0]);
  }else{
    cpu.eflags=0x23002; // VM=1, IOPL=3; TSS bitmap still controls I/O.
    cpu.segmentCaches[3]=cpu._virtualSegmentCache(3,0);
    cpu.tr={selector:0x28,base:0x600,limit:0x80,present:true,type:11};
    put(memory,0x666,[0x68,0]);
    put(memory,0x80,[0x00,0x03]);
  }
  const step=()=>{
    const start=effects.length;
    cpu.step();
    return effects.slice(start);
  };
  return {cpu,memory,effects,step,get ioReads(){return ioReads;}};
}

for(const mode of ['protected16','vm86'])
  test(`${mode} ES load, dependent read, CALL/RET, and I/O boundary preserve ordered state`,()=>{
    const f=fixture(mode),{cpu,memory}=f;
    const loaded=f.step();
    const selector=mode==='vm86'?0x300:0x18;
    assert.equal(cpu.es,selector);
    assert.equal(cpu.segmentCaches[0].base,0x3000);
    assert.equal(cpu.eip,4);
    assert.deepEqual(loaded.slice(0,6),[
      ['fetch',0],['fetch',1],['fetch',2],['fetch',3],
      ['read',0x80],['read',0x81],
    ]);
    if(mode==='protected16'){
      assert.deepEqual(loaded.slice(6),[
        ...Array.from({length:8},(_,i)=>['read',0x218+i]),
        ['write',0x21d,0x93],
      ]);
      assert.equal(memory.get(0x21d),0x93);
    }else assert.equal(loaded.length,6);
    assert.deepEqual(f.step(),[
      ['fetch',4],['fetch',5],['fetch',6],['fetch',7],['read',0x3000],
    ]);
    assert.equal(cpu.al,0xa5);
    assert.deepEqual(f.step(),[
      ['fetch',8],['fetch',9],['fetch',10],
      ['write',0x10fe,0x0b],['write',0x10ff,0],
    ]);
    assert.deepEqual([cpu.eip,cpu.sp],[13,0xfe]);
    assert.deepEqual(f.step(),[
      ['fetch',13],['read',0x10fe],['read',0x10ff],
    ]);
    assert.deepEqual([cpu.eip,cpu.sp,cpu.al],[11,0x100,0xa5]);
    assert.equal(f.ioReads,0);
    const io=f.step();
    assert.deepEqual(io.slice(0,2),[['fetch',11],['fetch',12]]);
    assert.deepEqual(io.at(-1),['io',0x21,8]);
    assert.equal(f.ioReads,1);
    assert.deepEqual([cpu.eip,cpu.sp,cpu.al,cpu.es],[13,0x100,0x5a,selector]);
  });

test('protected16 later CALL target fault retains completed ES load, read, and Accessed write',()=>{
  const f=fixture('protected16'),{cpu,memory}=f;
  f.step();f.step();
  cpu.segmentCaches[1].limit=12; // E8 bytes fit; target 000d does not.
  const before=cpu._snapshotInstruction(),start=f.effects.length;
  assert.throws(()=>cpu.step(),error=>error instanceof I80386Fault&&
    error.vector===13&&error.errorCode===0);
  assert.deepEqual(cpu._snapshotInstruction(),before);
  assert.deepEqual(f.effects.slice(start),[['fetch',8],['fetch',9],['fetch',10]]);
  assert.deepEqual([cpu.es,cpu.al,cpu.eip,cpu.sp,memory.get(0x21d)],
    [0x18,0xa5,8,0x100,0x93]);
  assert.equal(memory.has(0x10fe),false);
});

test('protected16 later RET target fault keeps the committed call frame and ES cache',()=>{
  const f=fixture('protected16'),{cpu,memory}=f;
  for(let i=0;i<3;i++)f.step();
  put(memory,0x10fe,[0x00,0x40]); // Corrupt return address after committed CALL.
  cpu.segmentCaches[1].limit=0x3fff;
  const before=cpu._snapshotInstruction(),start=f.effects.length;
  assert.throws(()=>cpu.step(),error=>error instanceof I80386Fault&&
    error.vector===13&&error.errorCode===0);
  assert.deepEqual(cpu._snapshotInstruction(),before);
  assert.deepEqual(f.effects.slice(start),[
    ['fetch',13],['read',0x10fe],['read',0x10ff],
  ]);
  assert.deepEqual([cpu.es,cpu.al,cpu.eip,cpu.sp,memory.get(0x21d)],
    [0x18,0xa5,13,0xfe,0x93]);
  assert.deepEqual([memory.get(0x10fe),memory.get(0x10ff)],[0,0x40]);
});

test('VM86 denied I/O faults after committed ES read and CALL/RET without consuming device input',()=>{
  const f=fixture('vm86'),{cpu,memory}=f;
  for(let i=0;i<4;i++)f.step();
  memory.set(0x66c,2); // Port 21h is bit 1 of the byte at TSS bitmap + 4.
  const before=cpu._snapshotInstruction(),start=f.effects.length;
  assert.throws(()=>cpu.step(),error=>error instanceof I80386Fault&&
    error.vector===13&&error.errorCode===0);
  assert.deepEqual(cpu._snapshotInstruction(),before);
  assert.equal(f.ioReads,0);
  assert.deepEqual([cpu.es,cpu.al,cpu.eip,cpu.sp],[0x300,0xa5,11,0x100]);
  assert.deepEqual(f.effects.slice(start),[
    ['fetch',11],['fetch',12],['read',0x666],['read',0x667],['read',0x66c],
  ]);
});

test('AT board chip deadline stops at the combined I/O boundary; MOV SS shadow defers IRQ',()=>{
  const accesses=[];
  const machine=new ExperimentalI80386ATMachine(PCAT80386_EXPERIMENTAL_4M,
    {onPortAccess:event=>accesses.push(event)});
  const {cpu}=machine;
  cpu.cr0=1;cpu.cs=8;cpu.ds=0;cpu.ss=0x10;cpu.esp=0x100;
  cpu.segmentCaches[1]={base:0,limit:0xffff,default32:false,present:true,
    code:true,readable:true,writable:false};
  cpu.segmentCaches[2]={base:0x1000,limit:0xffff,default32:false,present:true,
    code:false,readable:true,writable:true};
  cpu.gdtr={base:0x200,limit:0x1f};
  machine.mem.set(code,0);
  machine.mem.set([0x18,0],0x80);
  machine.mem.set(descriptor(0x3000),0x218);
  machine.mem[0x3000]=0xa5;
  machine._chipDebt=0;machine._chipDeadline=10000;
  assert.deepEqual(machine.runBlock(4).instructions,4);
  assert.deepEqual([cpu.eip,cpu.sp,cpu.es,cpu.al],[11,0x100,0x18,0xa5]);
  assert.equal(accesses.filter(event=>event.dir==='in').length,0);
  machine._chipDeadline=machine._chipDebt;
  assert.deepEqual(machine.runBlock(1),{instructions:0,cycles:0,reason:'chip-event'});
  assert.equal(cpu.eip,11);
  assert.equal(accesses.filter(event=>event.dir==='in').length,0);
  machine._chipDeadline=machine._chipDebt+10000;
  assert.equal(machine.runBlock(1).instructions,1);
  assert.deepEqual(accesses.filter(event=>event.dir==='in').map(event=>event.port),[0x21]);

  const interrupts=[];
  const shadow=new ExperimentalI80386ATMachine(PCAT80386_EXPERIMENTAL_4M,
    {onInterrupt:event=>interrupts.push(event)});
  const master=shadow.chips.pic1,slave=shadow.chips.pic2;
  master.write(0,0x11);master.write(1,0x20);master.write(1,4);master.write(1,1);
  slave.write(0,0x11);slave.write(1,0x28);slave.write(1,2);slave.write(1,1);
  shadow.cpu.reset();shadow.cpu.ss=0;shadow.cpu.sp=0x800;
  shadow.mem.set([0x8e,0xd0,0x90],0); // MOV SS,AX; NOP.
  shadow.mem.set([0x00,0x03,0x00,0x00],0x80); // IRQ0 vector 20h -> 0000:0300.
  shadow.mem[0x300]=0x90; // Owned one-instruction handler.
  shadow.cpu.ax=0x100;
  shadow.cpu.eflags=0x202;
  shadow.step();
  assert.equal(shadow.cpu._interruptShadow,1);
  master.setIRQ(0,1);
  assert.equal(master.intActive,true);
  shadow.step();
  assert.equal(shadow.cpu.eip,3,'the instruction following MOV SS retires first');
  assert.equal(shadow.cpu._interruptShadow,0);
  assert.equal(master.intActive,true,'IRQ remains pending through the shadow');
  assert.deepEqual(interrupts,[]);
  shadow.step();
  assert.deepEqual(interrupts,[{vector:0x20,source:'irq'}]);
  assert.equal(shadow.cpu.eip,0x301);
});
