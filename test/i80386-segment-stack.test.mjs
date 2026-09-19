import test from "node:test";
import assert from "node:assert/strict";
import I80386 from "../src/experimental/i80386.js";

function fixture(bytes) {
  const memory = new Map(bytes.map((value, index) => [index, value]));
  const writes = [];
  const cpu = new I80386({
    read: (address) => memory.get(address >>> 0) ?? 0,
    fetch: (address) => memory.get(address >>> 0) ?? 0,
    write(address, value) {
      writes.push([address >>> 0, value & 255]);
      memory.set(address >>> 0, value & 255);
    },
  });
  return { cpu, memory, writes };
}

test("segment PUSH/POP covers ES/CS/SS/DS/FS/GS", () => {
  const f = fixture([
    0x06,0x0e,0x16,0x1e,0x0f,0xa0,0x0f,0xa8,
    0x0f,0xa9,0x0f,0xa1,0x1f,0x17,0x07,
  ]);
  Object.assign(f.cpu, { es:1, cs:2, ss:0, ds:4, fs:5, gs:6, esp:0x200 });
  for (let index = 0; index < 6; index++) f.cpu.step();
  assert.equal(f.cpu.sp, 0x1f4);
  for (const expected of [6,5,4,0,2,1]) {
    assert.equal(f.memory.get(f.cpu.sp) | (f.memory.get(f.cpu.sp + 1) << 8), expected);
    f.cpu.sp = (f.cpu.sp + 2) & 0xffff;
  }
  f.cpu.sp = 0x1f4;
  for (let index = 0; index < 5; index++) f.cpu.step();
  assert.deepEqual([f.cpu.gs,f.cpu.fs,f.cpu.ds,f.cpu.ss,f.cpu.es], [6,5,4,0,2]);
  assert.equal(f.cpu.sp, 0x1fe);
});

test("32-bit segment PUSH decrements by four but writes only selector bytes", () => {
  const f = fixture([0x66,0x1e]);
  f.cpu.ds = 0x1234;
  f.cpu.esp = 0x100;
  f.memory.set(0xfc, 0xaa); f.memory.set(0xfd, 0xbb);
  f.memory.set(0xfe, 0xcc); f.memory.set(0xff, 0xdd);
  f.cpu.step();
  assert.equal(f.cpu.sp, 0xfc);
  assert.deepEqual([0xfc,0xfd,0xfe,0xff].map(a=>f.memory.get(a)), [0x34,0x12,0xcc,0xdd]);
  assert.deepEqual(f.writes, [[0xfc,0x34],[0xfd,0x12]]);
});

test("32-bit segment POP advances by four and selector failure is atomic", () => {
  const f = fixture([0x66,0x1f]);
  f.cpu.esp = 0x100;
  [0x34,0x12,0xaa,0xbb].forEach((v,i)=>f.memory.set(0x100+i,v));
  f.cpu.step();
  assert.deepEqual([f.cpu.ds,f.cpu.sp], [0x1234,0x104]);

  const bad = fixture([0x66,0x1f]);
  bad.cpu.cr0 = 1;
  bad.cpu.esp = 0x100;
  bad.memory.set(0x100, 8);
  bad.cpu.gdtr = {base:0x200,limit:7};
  assert.throws(() => bad.cpu.step(), (error)=>error?.vector===13);
  assert.deepEqual([bad.cpu.ds,bad.cpu.esp], [0,0x100]);
});

test("POP SS establishes IRQ/NMI/debug shadows", () => {
  const f = fixture([0x17,0x90]);
  f.cpu.sp=0x100; f.memory.set(0x100,0x20); f.memory.set(0x101,0);
  f.cpu.eflags|=0x300;
  f.cpu.step();
  assert.equal(f.cpu.interrupt(0x20),false);
  assert.equal(f.cpu.interrupt(2,{nmi:true}),false);
  f.cpu.step();
  assert.equal(f.cpu._debugShadow,0);
});
