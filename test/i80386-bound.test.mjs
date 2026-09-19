import test from "node:test";
import assert from "node:assert/strict";
import I80386, { I80386Fault } from "../src/experimental/i80386.js";

function fixture(bytes, options = {}) {
  const memory = new Map(bytes.map((value, index) => [index, value]));
  const reads = [];
  const cpu = new I80386({
    read(address) {
      reads.push(address >>> 0);
      return memory.get(address >>> 0) ?? 0;
    },
    fetch: (address) => memory.get(address >>> 0) ?? 0,
    write: (address, value) => memory.set(address >>> 0, value & 0xff),
  }, options);
  const put = (address, values) =>
    values.forEach((value, index) => memory.set(address + index, value & 0xff));
  return { cpu, memory, reads, put };
}

test("BOUND admits signed inclusive 16-bit and 32-bit endpoints", () => {
  const word = fixture([0x62,0x06,0,1,0x62,0x06,0,1]);
  word.put(0x100,[0x00,0x80,0xff,0x7f]);
  word.cpu.ax=0x8000;
  word.cpu.step();
  word.cpu.ax=0x7fff;
  word.cpu.step();
  assert.equal(word.cpu.eip,8);

  const dword=fixture([0x66,0x62,0x06,0,1]);
  dword.put(0x100,[0,0,0,0x80,0xff,0xff,0xff,0x7f]);
  dword.cpu.eax=0x80000000;
  dword.cpu.step();
  assert.equal(dword.cpu.eip,5);
});

test("BOUND raises restartable BR outside either signed endpoint", () => {
  for(const value of [0xfffe,3]) {
    const f=fixture([0x62,0x06,0,1]);
    f.put(0x100,[0xff,0xff,2,0]);
    f.cpu.ax=value;f.cpu.eflags=0x8d7;
    assert.throws(
      ()=>f.cpu.step(),
      (error)=>error instanceof I80386Fault&&error.vector===5&&error.errorCode===null,
    );
    assert.deepEqual([f.cpu.eip,f.cpu.ax,f.cpu.eflags],[0,value,0x8d7]);
  }
});

test("BOUND rejects register encodings and admits its complete source span before reads", () => {
  const register=fixture([0x62,0xc0]).cpu;
  assert.throws(()=>register.step(),(error)=>error instanceof I80386Fault&&error.vector===6);

  const span=fixture([0x66,0x62,0x06,0,1]);
  span.cpu.cr0=1;
  span.cpu.segmentCaches[3]={base:0,limit:0x106,default32:false,present:true,code:false,readable:true,writable:true};
  assert.throws(()=>span.cpu.step(),(error)=>error instanceof I80386Fault&&error.vector===13);
  assert.deepEqual(span.reads.filter((address)=>address>=0x100),[]);
});

test("delivered BR saves the faulting instruction address", () => {
  const f=fixture([0x62,0x06,0,1],{deliverFaults:true});
  f.put(0x100,[0,0,1,0]);
  f.cpu.ax=2;f.cpu.ss=0x10;f.cpu._loadSeg(2,0x10);f.cpu.sp=0x100;
  f.put(5*4,[0,2,0,0]);
  f.put(0x200,[0xf4]);
  f.cpu.step();
  assert.deepEqual([f.cpu.cs,f.cpu.eip,f.cpu.sp],[0,0x200,0xfa]);
  assert.deepEqual([0,1].map((index)=>f.memory.get(0x1fa+index)),[0,0]);
});
