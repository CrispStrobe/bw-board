import test from 'node:test';
import assert from 'node:assert/strict';
import I80386, {I80386Fault} from '../src/experimental/i80386.js';
import {ExperimentalI80386ATMachine, PCAT80386_EXPERIMENTAL_4M_HDD_FREEDOS_VGA} from
  '../src/experimental/i80386-at-machine.js';

const put32 = (write, address, value) => {
  for (let i = 0; i < 4; i++) write(address + i, value >>> (8 * i));
};

function codeSegment(cpu) {
  cpu.segmentCaches[1] = {base: 0, limit: 0xffffffff, default32: true,
    present: true, code: true, readable: true, writable: false};
}

function pagedCpu() {
  const mem = new Uint8Array(0x10000);
  const cpu = new I80386({
    read: address => mem[address] ?? 0,
    fetch: address => mem[address] ?? 0,
    write: (address, value) => {mem[address] = value & 255;},
  }, {translationCache: true});
  codeSegment(cpu);
  put32((a,v)=>{mem[a]=v;},0x1000,0x2007);
  put32((a,v)=>{mem[a]=v;},0x2000,0x6007);
  cpu.cr0 = 0x80000001;
  cpu.cr3 = 0x1000;
  return {cpu,mem};
}

test('repeated register MOV sees live registers and guest code writes',()=>{
  const {cpu,mem}=pagedCpu();
  mem.set([0x89,0xc3],0x6000); // MOV EBX,EAX
  cpu.eax=0x12;cpu.step();
  assert.equal(cpu.ebx,0x12);
  cpu.eax=0x34;cpu.eip=0;cpu.step();
  assert.equal(cpu.ebx,0x34);
  cpu.ecx=0x56;cpu._writeLinear(1,1,0xcb); // MOV EBX,ECX
  cpu.eip=0;cpu.step();
  assert.equal(cpu.ebx,0x56);
});

test('repeated 16-bit MOV checks changed CS limit and prefix semantics',()=>{
  const {cpu,mem}=pagedCpu();
  mem.set([0x89,0xc3],0x6000);
  cpu.segmentCaches[1].default32=false;
  cpu.eax=0x12345678;cpu.ebx=0xabcd0000;
  cpu.step();cpu.eip=0;cpu.step();
  assert.equal(cpu.ebx,0xabcd5678);
  cpu.segmentCaches[1].limit=0;
  cpu.eip=0;
  assert.throws(()=>cpu.step(),e=>e instanceof I80386Fault&&e.vector===13);
  assert.equal(cpu.eip,0);
  cpu.segmentCaches[1].limit=0xffffffff;
  cpu._writeLinear(0,3,0xc38966); // 66 MOV EBX,EAX uses 32-bit width.
  cpu.eip=0;cpu.step();
  assert.equal(cpu.ebx,cpu.eax);
});

test('a later instruction fault cannot run or roll back an earlier instruction',()=>{
  const {cpu,mem}=pagedCpu();
  mem[0x6ffe]=0x40; // INC EAX commits at the end of the mapped code page.
  mem[0x6fff]=0xb8; // MOV EAX,imm32 then faults while fetching the immediate.
  cpu.eip=0xffe;
  assert.equal(cpu.step(),1);
  assert.deepEqual([cpu.eax,cpu.eip],[1,0xfff]);
  assert.throws(()=>cpu.step(),e=>e instanceof I80386Fault&&e.vector===14);
  assert.deepEqual([cpu.eax,cpu.eip,cpu.cr2],[1,0xfff,0x1000]);
});

test('guest writes to executed code are observed on the next instruction',()=>{
  const {cpu,mem}=pagedCpu();
  mem.set([0xb8,1,0,0,0],0x6000); // MOV EAX,1
  cpu.step();
  assert.equal(cpu.eax,1);
  cpu._writeLinear(1,4,2); // Guest self-modifies the immediate.
  cpu.eip=0;
  cpu.step();
  assert.equal(cpu.eax,2);
});

test('AT host/DMA code writes and page-table remaps change the next fetch',()=>{
  const machine=new ExperimentalI80386ATMachine(PCAT80386_EXPERIMENTAL_4M_HDD_FREEDOS_VGA);
  const cpu=machine.cpu;
  codeSegment(cpu);
  const put=(address,value)=>put32((a,v)=>machine._write(a,v),address,value);
  put(0x1000,0x2007);put(0x2000,0x6007);
  for(const [address,bytes] of [[0x6000,[0x89,0xc3]],[0x7000,[0x89,0xd3]]])
    bytes.forEach((v,i)=>machine._write(address+i,v));
  cpu.cr0=0x80000001;cpu.cr3=0x1000;
  cpu.eax=1;cpu.ecx=2;cpu.edx=3;
  cpu.step();
  assert.equal(cpu.ebx,1);
  machine._write(0x6001,0xcb); // Same RAM ingress used by AT DMA and host writes.
  cpu.eip=0;cpu.step();
  assert.equal(cpu.ebx,2);
  put(0x2000,0x7007); // Remap the same linear code page.
  cpu.eip=0;cpu.step();
  assert.equal(cpu.ebx,3);
});

test('guest MOV CR3 changes an executed linear code address',()=>{
  const {cpu,mem}=pagedCpu();
  put32((a,v)=>{mem[a]=v;},0x4000,0x5007);
  put32((a,v)=>{mem[a]=v;},0x5000,0x7007);
  mem.set([0x89,0xc3,0x0f,0x22,0xd8],0x6000); // MOV EBX,EAX; MOV CR3,EAX
  mem.set([0x89,0xcb],0x7000); // MOV EBX,ECX at the same linear address.
  cpu.eax=0x4000;cpu.ecx=0x77;
  cpu.step();cpu.step();
  assert.deepEqual([cpu.cr3,cpu.eip],[0x4000,5]);
  cpu.eip=0;
  cpu.step();
  assert.equal(cpu.ebx,0x77);
});
