import test from 'node:test';
import assert from 'node:assert/strict';
import I80386,{I80386Fault,UnsupportedI80386} from '../src/experimental/i80386.js';

function fixture(bytes,options={cpuProfile:'strict386'}){
  const memory=new Map(bytes.map((byte,address)=>[address,byte]));
  const cpu=new I80386({read:address=>memory.get(address)??0,
    fetch:address=>memory.get(address)??0,
    write:(address,byte)=>memory.set(address,byte&255)},options);
  return {cpu,memory};
}
const ud=error=>error instanceof I80386Fault && error.vector===6;

test('strict profile is explicit and leaves the ordinary compatibility path available',()=>{
  assert.equal(new I80386().cpuProfile,'compatibility');
  assert.throws(()=>new I80386({}, {cpuProfile:'unknown'}),TypeError);
  const compatible=fixture([0x0f,0x22,0xe0],{cpuProfile:'compatibility'}).cpu;
  compatible.eax=0x10;
  compatible.step();
  assert.equal(compatible.cr4,0x10);
  assert.equal(Object.hasOwn(compatible,'_translate'),false);
  const strict=new I80386({}, {cpuProfile:'strict386'});
  assert.equal(Object.hasOwn(strict,'_translate'),true);
});

test('strict profile rejects CR4 instructions and externally supplied PSE state',()=>{
  for(const bytes of [[0x0f,0x20,0xe0],[0x0f,0x22,0xe0]]){
    const {cpu}=fixture(bytes);
    assert.throws(()=>cpu.step(),ud);
    assert.equal(cpu.eip,0);
    assert.equal(cpu.cr4,0);
  }
  const cpu=fixture([0x90]).cpu;
  cpu.cr4=0x10;
  assert.throws(()=>cpu._translate(0),UnsupportedI80386);
  cpu.reset();
  assert.equal(cpu.cr4,0);
  assert.equal(cpu._translate(0),0);
});

test('strict profile rejects later BSWAP before modifying a register',()=>{
  for(const bytes of [[0x0f,0xc8],[0x66,0x0f,0xc8]]){
    const cpu=fixture(bytes).cpu;
    cpu.eax=0x11223344;
    assert.throws(()=>cpu.step(),ud);
    assert.equal(cpu.eip,0);
    assert.equal(cpu.eax,0x11223344);
  }
  const compatible=fixture([0x66,0x0f,0xc8],{cpuProfile:'compatibility'}).cpu;
  compatible.eax=0x11223344;
  compatible.step();
  assert.equal(compatible.eax,0x44332211);
});

test('strict CR0 preserves writable ET and does not assign WP semantics',()=>{
  const {cpu,memory}=fixture([0x0f,0x22,0xc0,0x0f,0x20,0xc3]);
  cpu.hardwareReset({coprocessor:'80387'});
  assert.equal(cpu.cr0,0x10);
  cpu.cs=0;cpu.eip=0;cpu.segmentCaches[1].base=0;
  cpu.eax=0x00010011; // WP is a later-model bit; the 386 MOV mask discards it.
  cpu.step();cpu.step();
  assert.equal(cpu.cr0,0x11);
  assert.equal(cpu.ebx,0x11);
  cpu.eip=0;cpu.eax=1;cpu.step();
  assert.equal(cpu.cr0,1,'ET remains writable, even after an 80387 reset');

  // Even if a host supplies a Bochs-like reserved high bit, supervisor
  // writes still follow the 386 rule rather than 486 CR0.WP semantics.
  const paged=new I80386({
    read:address=>memory.get(address)??0,
    write:(address,value)=>memory.set(address,value&255),
  },{cpuProfile:'strict386'});
  const put32=(address,value)=>{
    for(let i=0;i<4;i++)memory.set(address+i,(value>>>(8*i))&255);
  };
  put32(0x1000,0x2001); // present, read-only PDE
  put32(0x2000,0x3001); // present, read-only PTE
  paged.cr0=0x80010001;
  paged.cr3=0x1000;
  assert.equal(paged._translate(0,{write:true,supervisor:true}),0x3000);
  paged.cs=3;
  assert.throws(()=>paged._translate(0,{write:true}),error=>
    error instanceof I80386Fault && error.vector===14);
});

test('strict debug scope refuses reserved registers and unmodeled GD traps',()=>{
  const reserved=fixture([0x0f,0x21,0xe0]).cpu;
  assert.throws(()=>reserved.step(),UnsupportedI80386);
  assert.equal(reserved.eip,0);
  const gd=fixture([0x0f,0x23,0xf8]).cpu;
  gd.eax=0x2000;
  assert.throws(()=>gd.step(),UnsupportedI80386);
  assert.equal(gd._debugRegisters[7],0);
  const breakpoint=fixture([0x0f,0x23,0xf8]).cpu;
  breakpoint.eax=1;
  assert.throws(()=>breakpoint.step(),UnsupportedI80386);
});
