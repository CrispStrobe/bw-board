import test from "node:test";
import assert from "node:assert/strict";
import I80386 from "../src/experimental/i80386.js";

function fixture(bytes) {
  const memory = new Map(bytes.map((value, index) => [index, value]));
  const reads = [];
  const cpu = new I80386({
    read(address) { reads.push(address >>> 0); return memory.get(address >>> 0) ?? 0; },
    fetch: (address) => memory.get(address >>> 0) ?? 0,
    write: (address, value) => memory.set(address >>> 0, value & 255),
  });
  return { cpu, memory, reads };
}
const put = (memory, at, value, bytes) => {
  for (let index=0; index<bytes; index++) memory.set(at+index,(value >>> (8*index))&255);
};
const get = (memory, at, bytes) => {
  let value=0; for(let index=0;index<bytes;index++) value += (memory.get(at+index)??0)*2**(8*index);
  return value>>>0;
};

test("POP r/m uses post-pop ESP for an ESP-based effective address", () => {
  const f = fixture([0x66,0x67,0x8f,0x04,0x24]);
  f.cpu.segmentCaches[2].default32 = true;
  f.cpu.esp = 0x100;
  put(f.memory,0x100,0x89abcdef,4);
  f.cpu.step();
  assert.equal(f.cpu.esp,0x104);
  assert.equal(get(f.memory,0x104,4),0x89abcdef);

  const wrap = fixture([0x67,0x8f,0x44,0x24,0x02]);
  wrap.cpu.sp=0xfffe;
  put(wrap.memory,0xfffe,0x1234,2);
  wrap.cpu.step();
  assert.equal(wrap.cpu.sp,0);
  assert.equal(get(wrap.memory,2,2),0x1234);
});

test("POP r/m keeps operand size independent of stack address size", () => {
  const f = fixture([0x8f,0x06,0x00,0x02]);
  f.cpu.segmentCaches[2].default32=true;
  f.cpu.segmentCaches[2].limit=0xffffffff;
  f.cpu.esp=0x10000;
  put(f.memory,0x10000,0xbeef,2);
  f.cpu.step();
  assert.equal(f.cpu.esp,0x10002);
  assert.equal(get(f.memory,0x200,2),0xbeef);
});

test("POP r/m destination faults restore stack state after the source read", () => {
  const f=fixture([0x8f,0x06,0x00,0x02]);
  f.cpu.cr0=1; f.cpu.sp=0x100; put(f.memory,0x100,0x1234,2);
  f.cpu.segmentCaches[3].writable=false;
  assert.throws(()=>f.cpu.step(),error=>error?.vector===13&&error.errorCode===0);
  assert.equal(f.cpu.sp,0x100);
  assert.deepEqual(f.reads,[0x100,0x101]);
});

test("invalid POP r/m extensions raise #UD before reading the stack", () => {
  const f=fixture([0x8f,0xc8]);
  f.cpu.sp=0x100;
  assert.throws(()=>f.cpu.step(),error=>error?.vector===6&&error.errorCode===null);
  assert.deepEqual(f.reads,[]);
  assert.equal(f.cpu.sp,0x100);
});
