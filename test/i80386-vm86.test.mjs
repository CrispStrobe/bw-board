import test from "node:test";
import assert from "node:assert/strict";
import I80386, { I80386Fault } from "../src/experimental/i80386.js";

function fixture(target = 0x10) {
  const memory = new Map([[0, 0xcf]]);
  const ports = [];
  const cpu = new I80386({
    read: (address) => memory.get(address >>> 0) ?? 0,
    fetch: (address) => memory.get(address >>> 0) ?? 0,
    write: (address, value) => memory.set(address >>> 0, value & 0xff),
    inPort: (port, width) => {
      ports.push([port, width]);
      return 0x5a;
    },
  });
  cpu.cr0 = 1;
  cpu.cs = 8;
  cpu.ss = 0x10;
  cpu.eip = 0;
  cpu.esp = 0x100;
  cpu.segmentCaches[1] = {
    base: 0,
    limit: 0xffff,
    default32: true,
    present: true,
    code: true,
    readable: true,
    writable: false,
  };
  cpu.segmentCaches[2] = {
    base: 0x1000,
    limit: 0xffff,
    default32: true,
    present: true,
    code: false,
    readable: true,
    writable: true,
  };
  const frame = [target, 0x1234, 0x23202, 0x200, 0x2000, 0x3000, 0x4000, 0x5000, 0x6000];
  frame.forEach((value, index) => {
    for (let byte = 0; byte < 4; byte++)
      memory.set(0x1100 + index * 4 + byte, (value >>> (byte * 8)) & 0xff);
  });
  return { cpu, memory, ports };
}

function put(memory, address, bytes) {
  bytes.forEach((value, index) => memory.set(address + index, value & 0xff));
}

function descriptor(base, access) {
  return [0xff,0xff,base,base>>>8,base>>>16,access,0xcf,base>>>24];
}

test("IRETD enters VM86 with real-address caches and executes 16-bit code", () => {
  const { cpu, memory } = fixture();
  memory.set(0x12350, 0xb8);
  memory.set(0x12351, 0x78);
  memory.set(0x12352, 0x56);
  cpu.step();
  assert.equal(cpu.virtual8086, true);
  assert.deepEqual(
    [cpu.cs, cpu.eip, cpu.ss, cpu.esp, cpu.es, cpu.ds, cpu.fs, cpu.gs],
    [0x1234, 0x10, 0x2000, 0x200, 0x3000, 0x4000, 0x5000, 0x6000],
  );
  assert.deepEqual(
    [1, 2, 0, 3, 4, 5].map((id) => cpu.segmentCaches[id].base),
    [0x12340, 0x20000, 0x30000, 0x40000, 0x50000, 0x60000],
  );
  cpu.step();
  assert.equal(cpu.ax, 0x5678);
  assert.equal(cpu.eip, 0x13);
});

test("VM86 IRET validates the complete frame and 16-bit target before commit", () => {
  const short = fixture();
  short.cpu.segmentCaches[2].limit = 0x11f;
  const beforeShort = short.cpu._snapshotInstruction();
  assert.throws(() => short.cpu.step(), (error) => error instanceof I80386Fault && error.vector === 12);
  assert.deepEqual(short.cpu._snapshotInstruction(), beforeShort);

  const badTarget = fixture(0x10000);
  const beforeTarget = badTarget.cpu._snapshotInstruction();
  assert.throws(() => badTarget.cpu.step(), (error) => error instanceof I80386Fault && error.vector === 13 && error.errorCode === 0);
  assert.deepEqual(badTarget.cpu._snapshotInstruction(), beforeTarget);
});

test("VM86 privilege checks use CPL3 rather than visible CS RPL", () => {
  const { cpu, memory } = fixture();
  memory.set(0x12350, 0xfa);
  cpu.step();
  cpu.eflags &= ~0x3000;
  assert.throws(() => cpu.step(), (error) => error instanceof I80386Fault && error.vector === 13 && error.errorCode === 0);
  assert.equal(cpu.eip, 0x10);
});

test("a VM86 software interrupt builds the extended inner frame and IRETD returns", () => {
  const { cpu, memory } = fixture();
  cpu.gdtr = { base: 0x200, limit: 0x2ff };
  cpu.idtr = { base: 0x300, limit: 0x7ff };
  cpu.tr = { selector: 0x28, base: 0x600, limit: 0x67, present: true, type: 11 };
  put(memory, 0x208, descriptor(0x100000, 0x9a));
  put(memory, 0x210, descriptor(0x120000, 0x92));
  put(memory, 0x604, [0,4,0,0,0x10,0]);
  put(memory, 0x300 + 0x20 * 8, [0,1,8,0,0,0xee,0,0]);
  put(memory, 0x12350, [0xcd,0x20]);
  put(memory, 0x100100, [0xcf]);
  cpu.step();
  cpu.step();
  assert.deepEqual([cpu.virtual8086,cpu.cs,cpu.eip,cpu.ss,cpu.esp],[false,8,0x100,0x10,0x3dc]);
  const dword = (address) =>
    [0,1,2,3].reduce((value, byte) => value + (memory.get(address + byte) ?? 0) * 2 ** (byte * 8), 0) >>> 0;
  assert.deepEqual(
    Array.from({ length: 9 }, (_, index) => dword(0x1203dc + index * 4)),
    [0x12,0x1234,0x23202,0x200,0x2000,0x3000,0x4000,0x5000,0x6000],
  );
  cpu.step();
  assert.deepEqual(
    [cpu.virtual8086,cpu.cs,cpu.eip,cpu.ss,cpu.esp,cpu.es,cpu.ds,cpu.fs,cpu.gs],
    [true,0x1234,0x12,0x2000,0x200,0x3000,0x4000,0x5000,0x6000],
  );
});

test("VM86 uses CPL3 for paging and system instructions even when CS low bits are zero", () => {
  const { cpu, memory } = fixture();
  cpu.step();
  cpu.cs = 0xf000;
  cpu.segmentCaches[1] = cpu._virtualSegmentCache(1, cpu.cs);
  cpu.cr3 = 0x1000;
  cpu.cr0 = 0x80000001;
  put(memory, 0x1000, [1,0x20,0,0]);
  put(memory, 0x2000, [1,0x30,0,0]);
  assert.throws(
    () => cpu._translate(0, { write: false }),
    (error) => error instanceof I80386Fault && error.vector === 14 && error.errorCode === 5,
  );
  cpu.cr0 = 1;
  cpu.eip = 0;
  put(memory, 0xf0000, [0x0f,0x00,0xd0]);
  assert.throws(
    () => cpu.step(),
    (error) => error instanceof I80386Fault && error.vector === 6,
  );
});

test("original-386 VM86 sensitive instructions require IOPL3", () => {
  for (const bytes of [[0x9c],[0x9d],[0xcd,0x20],[0xf0,0x90]]) {
    const { cpu, memory } = fixture();
    cpu.step();
    cpu.eflags &= ~0x3000;
    put(memory,0x12350,bytes);
    assert.throws(
      () => cpu.step(),
      (error) => error instanceof I80386Fault && error.vector === 13 && error.errorCode === 0,
    );
    assert.equal(cpu.eip,0x10);
  }
});

test("VM86 INT3 bypasses the IOPL check and enters its ring-0 gate", () => {
  const { cpu, memory } = fixture();
  cpu.gdtr = { base: 0x200, limit: 0x2ff };
  cpu.idtr = { base: 0x300, limit: 0x7ff };
  cpu.tr = { selector: 0x28, base: 0x600, limit: 0x67, present: true, type: 11 };
  put(memory, 0x208, descriptor(0x100000, 0x9a));
  put(memory, 0x210, descriptor(0x120000, 0x92));
  put(memory, 0x604, [0,4,0,0,0x10,0]);
  put(memory, 0x300 + 3 * 8, [0,1,8,0,0,0x8e,0,0]);
  put(memory, 0x12350, [0xcc]);
  cpu.step();
  cpu.eflags &= ~0x3000;
  cpu.step();
  assert.deepEqual([cpu.virtual8086,cpu.cs,cpu.eip,cpu.esp],[false,8,0x100,0x3dc]);
});

test("VM86 IRET preserves IOPL and VM while 32-bit IRET can restore RF", () => {
  for (const width of [16,32]) {
    const { cpu, memory } = fixture();
    cpu.step();
    cpu.eflags |= 0x4000;
    put(memory,0x12350,width===32?[0x66,0xcf]:[0xcf]);
    const stack=0x20200;
    const values=[0x20,0x2222,0x10002];
    values.forEach((value,index)=>{
      for(let byte=0;byte<width/8;byte++)
        memory.set(stack+index*(width/8)+byte,(value>>>(byte*8))&255);
    });
    cpu.step();
    assert.deepEqual([cpu.cs,cpu.eip,cpu.esp&0xffff],[0x2222,0x20,0x200+3*(width/8)]);
    assert.equal(cpu.eflags&0x23000,0x23000,"VM and IOPL remain set");
    assert.equal(cpu.eflags&0x4000,0,"NT follows the stacked image without task return");
    assert.equal(!!(cpu.eflags&0x10000),width===32,"only IRETD restores RF");
  }
});

test("VM86 I/O consults the TSS bitmap even at IOPL3", () => {
  const { cpu, memory, ports } = fixture();
  cpu.step();
  cpu.tr={selector:0x28,base:0x600,limit:0x80,present:true,type:11};
  put(memory,0x666,[0x68,0]);
  memory.set(0x66c,1);
  put(memory,0x12350,[0xe4,0x20]);
  assert.throws(
    () => cpu.step(),
    (error) => error instanceof I80386Fault && error.vector === 13 && error.errorCode === 0,
  );
  assert.deepEqual(ports,[]);
});
