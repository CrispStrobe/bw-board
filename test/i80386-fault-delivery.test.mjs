import test from "node:test";
import assert from "node:assert/strict";
import I80386, { I80386Fault } from "../src/experimental/i80386.js";

function fixture(options = {}) {
  const memory = new Map(),
    writes = [];
  const bus = {
    read: (address) => memory.get(address >>> 0) ?? 0,
    fetch: (address) => memory.get(address >>> 0) ?? 0,
    write: (address, value) => {
      writes.push([address >>> 0, value & 255]);
      memory.set(address >>> 0, value & 255);
    },
  };
  const cpu = new I80386(bus, options);
  const put = (address, bytes) =>
    bytes.forEach((byte, index) => memory.set(address + index, byte));
  const word = (address) =>
    (memory.get(address) ?? 0) | ((memory.get(address + 1) ?? 0) << 8);
  const dword = (address) => (word(address) | (word(address + 2) << 16)) >>> 0;
  return { cpu, memory, writes, put, word, dword, bus };
}

function descriptor(base, access = 0x9a, limit = 0xfffff, flags = 0xc0) {
  return [
    limit & 255,
    (limit >>> 8) & 255,
    base & 255,
    (base >>> 8) & 255,
    (base >>> 16) & 255,
    access,
    flags | ((limit >>> 16) & 15),
    (base >>> 24) & 255,
  ];
}

function gate(offset, selector, type = 0x0e, dpl = 0) {
  return [
    offset & 255,
    (offset >>> 8) & 255,
    selector & 255,
    selector >>> 8,
    0,
    0x80 | (dpl << 5) | type,
    (offset >>> 16) & 255,
    (offset >>> 24) & 255,
  ];
}

function protectedFixture(type = 0x0e) {
  const f = fixture({ deliverFaults: true });
  f.cpu.cr0 = 1;
  f.cpu.gdtr = { base: 0x200, limit: 0x17 };
  f.cpu.idtr = { base: 0x400, limit: 0x7ff };
  f.put(0x208, descriptor(0x100000));
  f.put(0x210, descriptor(0x120000, 0x92));
  f.put(0x400 + 0x20 * 8, gate(0x100, 8, type));
  f.cpu.cs = 8;
  f.cpu.ss = 0x10;
  f.cpu.segmentCaches[1] = { ...f.cpu._descriptor(8) };
  f.cpu.segmentCaches[2] = { ...f.cpu._descriptor(0x10) };
  f.cpu.esp = 0x400;
  return f;
}

test("real-mode #UD saves the faulting IP and IRET resumes after a repaired instruction", () => {
  const f = fixture({ deliverFaults: true });
  f.cpu.ss = 0x100;
  f.cpu._loadSeg(2, 0x100);
  f.cpu.sp = 0x100;
  f.cpu.eflags = 0x202;
  f.put(6 * 4, [0x00, 0x02, 0x00, 0x20]);
  f.put(0, [0x8e, 0xc8]);
  f.put(0x20200, [0xcf]);
  f.cpu.step();
  assert.deepEqual([f.cpu.cs, f.cpu.ip, f.cpu.sp], [0x2000, 0x200, 0xfa]);
  assert.deepEqual(
    [f.word(0x10fa), f.word(0x10fc), f.word(0x10fe)],
    [0, 0, 0x202],
  );
  f.put(0, [0xf4]);
  f.cpu.step();
  assert.deepEqual(
    [f.cpu.cs, f.cpu.ip, f.cpu.sp, f.cpu.flags],
    [0, 0, 0x100, 0x202],
  );
  f.cpu.step();
  assert.equal(f.cpu.halted, true);
});

test("32-bit interrupt and 16-bit trap gates build independently expected same-ring frames", () => {
  const interrupt = protectedFixture(0x0e);
  interrupt.cpu.eflags = 0x302;
  interrupt.put(0x100000, [0xcd, 0x20]);
  interrupt.put(0x100100, [0xcf]);
  interrupt.cpu.step();
  assert.deepEqual([interrupt.cpu.eip, interrupt.cpu.esp], [0x100, 0x3f4]);
  assert.deepEqual(
    [
      interrupt.dword(0x1203f4),
      interrupt.dword(0x1203f8),
      interrupt.dword(0x1203fc),
    ],
    [2, 8, 0x302],
  );
  assert.equal(
    interrupt.cpu.eflags & 0x300,
    0,
    "interrupt gates clear IF and TF",
  );
  interrupt.cpu.step();
  assert.deepEqual(
    [interrupt.cpu.eip, interrupt.cpu.esp, interrupt.cpu.eflags],
    [2, 0x400, 0x302],
  );

  const trap = protectedFixture(0x07);
  trap.cpu.eflags = 0x202;
  trap.put(0x100000, [0xcd, 0x20]);
  trap.cpu.step();
  assert.deepEqual([trap.cpu.eip, trap.cpu.esp], [0x100, 0x3fa]);
  assert.deepEqual(
    [trap.word(0x1203fa), trap.word(0x1203fc), trap.word(0x1203fe)],
    [2, 8, 0x202],
  );
  assert.equal(trap.cpu.eflags & 0x200, 0x200, "trap gates preserve IF");
});

test("ring-3 interrupt gates switch to the TSS stack and IRETD returns outward", () => {
  const f = fixture({ deliverFaults: true });
  f.cpu.cr0 = 1;
  f.cpu.gdtr = { base: 0x200, limit: 0x2f };
  f.cpu.idtr = { base: 0x400, limit: 0x7ff };
  f.put(0x208, descriptor(0x100000, 0x9a));
  f.put(0x210, descriptor(0x120000, 0x92));
  f.put(0x218, descriptor(0x140000, 0xfa));
  f.put(0x220, descriptor(0x160000, 0xf2));
  f.put(0x400 + 0x20 * 8, gate(0x100, 8, 0x0e, 3));
  f.cpu.tr = { selector: 0x28, base: 0x600, limit: 0x67, present: true, type: 11 };
  f.put(0x604, [0x00, 0x04, 0, 0, 0x10, 0]);
  f.cpu.cs = 0x1b;
  f.cpu.ss = 0x23;
  f.cpu.segmentCaches[1] = f.cpu._ringCodeDescriptor(0x1b);
  f.cpu.segmentCaches[2] = f.cpu._ringStackDescriptor(0x23, 3, { returnPath: true });
  f.cpu.esp = 0x800;
  f.cpu.eflags = 0x202;
  f.put(0x140000, [0xcd, 0x20]);
  f.put(0x100100, [0xcf]);

  f.cpu.step();
  assert.deepEqual([f.cpu.cs, f.cpu.eip, f.cpu.ss, f.cpu.esp], [8, 0x100, 0x10, 0x3ec]);
  assert.deepEqual([
    f.dword(0x1203ec), f.dword(0x1203f0), f.dword(0x1203f4),
    f.dword(0x1203f8), f.dword(0x1203fc),
  ], [2, 0x1b, 0x202, 0x800, 0x23]);
  f.cpu.step();
  assert.deepEqual([f.cpu.cs, f.cpu.eip, f.cpu.ss, f.cpu.esp, f.cpu.eflags],
    [0x1b, 2, 0x23, 0x800, 0x202]);
});

test("a 16-bit inner interrupt gate builds a word frame from 32-bit caller code",()=>{
  const f=fixture({deliverFaults:true});f.cpu.cr0=1;f.cpu.gdtr={base:0x200,limit:0x2f};f.cpu.idtr={base:0x400,limit:0x7ff};
  f.put(0x208,descriptor(0x100000,0x9a));f.put(0x210,descriptor(0x120000,0x92));f.put(0x218,descriptor(0x140000,0xfa));f.put(0x220,descriptor(0x160000,0xf2));
  f.put(0x400+0x20*8,gate(0x100,8,6,3));f.cpu.tr={selector:0x28,base:0x600,limit:0x67,present:true,type:11};f.put(0x604,[0,4,0,0,0x10,0]);
  f.cpu.cs=0x1b;f.cpu.ss=0x23;f.cpu.esp=0x800;f.cpu.eflags=0x202;f.cpu.segmentCaches[1]=f.cpu._ringCodeDescriptor(0x1b);f.cpu.segmentCaches[2]=f.cpu._ringStackDescriptor(0x23,3,{returnPath:true});
  f.put(0x140000,[0xcd,0x20]);f.put(0x100100,[0x66,0xcf]);f.cpu.step();
  assert.deepEqual([f.cpu.cs,f.cpu.eip,f.cpu.ss,f.cpu.esp],[8,0x100,0x10,0x3f6]);
  assert.deepEqual(Array.from({length:5},(_,index)=>f.word(0x1203f6+index*2)),[2,0x1b,0x202,0x800,0x23]);
  f.cpu.step();assert.deepEqual([f.cpu.cs,f.cpu.eip,f.cpu.ss,f.cpu.esp],[0x1b,2,0x23,0x800]);
});

test("outer IRET validates the return stack selector before the target offset", () => {
  const f = fixture();
  f.cpu.cr0 = 1;
  f.cpu.gdtr = { base: 0x200, limit: 0x2f };
  f.put(0x208, descriptor(0x100000, 0x9a));
  f.put(0x210, descriptor(0x120000, 0x92));
  f.put(0x218, descriptor(0x140000, 0xfa, 0xff));
  f.cpu.cs = 8; f.cpu.ss = 0x10; f.cpu.esp = 0x300;
  f.cpu.segmentCaches[1] = f.cpu._ringCodeDescriptor(8);
  f.cpu.segmentCaches[2] = f.cpu._ringStackDescriptor(0x10, 0, { returnPath: true });
  f.put(0x100000, [0xcf]);
  f.put(0x120300, [0x00,0x01,0,0, 0x1b,0,0,0, 2,2,0,0, 0,8,0,0, 0,0,0,0]);
  assert.throws(() => f.cpu.step(), error => error instanceof I80386Fault && error.vector === 13 && error.errorCode === 0);
  assert.deepEqual([f.cpu.cs, f.cpu.eip, f.cpu.ss, f.cpu.esp], [8, 0, 0x10, 0x300]);
});

test("external inner-stack selector faults carry EXT without an old-stack frame", () => {
  const f = fixture();
  f.cpu.cr0 = 1;
  f.cpu.gdtr = { base: 0x200, limit: 0x17 };
  f.cpu.idtr = { base: 0x400, limit: 0x7ff };
  f.put(0x208, descriptor(0x100000, 0x9a));
  f.put(0x210, descriptor(0x120000, 0x92));
  f.put(0x400 + 0x20 * 8, gate(0x100, 8));
  f.cpu.tr = { selector: 0x18, base: 0x600, limit: 0x67, present: true, type: 11 };
  f.put(0x604, [0x00, 0x04, 0, 0, 0x30, 0]);
  f.cpu.cs = 3; f.cpu.ss = 0x13; f.cpu.esp = 0x800;
  const writes = f.writes.length;
  assert.throws(
    () => f.cpu._deliverProtected(0x20, 0x44, null, { external: true }),
    error => error instanceof I80386Fault && error.vector === 10 && error.errorCode === 0x31,
  );
  assert.equal(f.writes.length, writes);
  assert.deepEqual([f.cpu.cs, f.cpu.ss, f.cpu.esp], [3, 0x13, 0x800]);
});

test("inner interrupt stack faults precede target-offset faults and use exact error codes", () => {
  const make = (ss, esp) => {
    const f=fixture();f.cpu.cr0=1;f.cpu.gdtr={base:0x200,limit:0x17};f.cpu.idtr={base:0x400,limit:0x7ff};
    f.put(0x208,descriptor(0x100000,0x9a,0xff,0x40));f.put(0x210,descriptor(0x120000,0x92));
    f.put(0x400+0x20*8,gate(0x100,8));f.cpu.tr={selector:0x18,base:0x600,limit:0x67,present:true,type:11};
    f.put(0x604,[esp,esp>>>8,esp>>>16,esp>>>24,ss,ss>>>8]);f.cpu.cs=3;f.cpu.ss=0x13;f.cpu.esp=0x800;
    return f;
  };
  const badSelector=make(0x30,0x400);
  assert.throws(()=>badSelector.cpu._deliverProtected(0x20,0x44,null,{external:true}),
    error=>error instanceof I80386Fault&&error.vector===10&&error.errorCode===0x31);
  const shortStack=make(0x10,8);
  assert.throws(()=>shortStack.cpu._deliverProtected(0x20,0x44,null,{external:true}),
    error=>error instanceof I80386Fault&&error.vector===12&&error.errorCode===0);
});

test("IRETD restores full ESP independently of the returned stack B bit", () => {
  const f = fixture();
  f.cpu.cr0 = 1;
  f.cpu.gdtr = { base: 0x200, limit: 0x27 };
  f.put(0x208, descriptor(0x100000, 0x9a));
  f.put(0x210, descriptor(0x120000, 0x92));
  f.put(0x218, descriptor(0x140000, 0xfa));
  f.put(0x220, descriptor(0x160000, 0xf2, 0xffff, 0x80));
  f.cpu.cs=8;f.cpu.ss=0x10;f.cpu.esp=0x300;
  f.cpu.segmentCaches[1]=f.cpu._ringCodeDescriptor(8);
  f.cpu.segmentCaches[2]=f.cpu._ringStackDescriptor(0x10,0,{returnPath:true});
  f.put(0x100000,[0xcf]);
  f.put(0x120300,[1,0,0,0, 0x1b,0,0,0, 2,0,0,0, 0x00,0x08,0x34,0x12, 0x23,0,0,0]);
  f.cpu.step();
  assert.deepEqual([f.cpu.cs,f.cpu.eip,f.cpu.ss,f.cpu.esp],[0x1b,1,0x23,0x12340800]);
});

test("ring-3 IRETD ignores stacked VM and reserved bits and cannot raise IOPL or IF",()=>{
  const f=fixture();f.cpu.cr0=1;f.cpu.gdtr={base:0x200,limit:0x27};
  f.put(0x218,descriptor(0x140000,0xfa));f.put(0x220,descriptor(0x160000,0xf2));
  f.cpu.cs=0x1b;f.cpu.ss=0x23;f.cpu.esp=0x300;f.cpu.eflags=2;
  f.cpu.segmentCaches[1]=f.cpu._ringCodeDescriptor(0x1b);
  f.cpu.segmentCaches[2]=f.cpu._ringStackDescriptor(0x23,3,{returnPath:true});
  f.put(0x140000,[0xcf]);
  f.put(0x160300,[1,0,0,0, 0x1b,0,0,0, 0xff,0xff,0xff,0xff]);
  f.cpu.step();
  assert.deepEqual([f.cpu.cs,f.cpu.eip,f.cpu.esp],[0x1b,1,0x30c]);
  assert.equal(f.cpu.eflags,0x14dd7,'defined user-modifiable flags restore while VM/IOPL/IF/reserved bits do not');
});

test("fault delivery distinguishes benign replacement, contributory #DF, and failed #DF shutdown", () => {
  const matrix = fixture().cpu;
  assert.equal(
    matrix._formsDoubleFault(9, 13),
    true,
    "386 vector 9 is contributory",
  );
  assert.equal(
    matrix._formsDoubleFault(13, 14),
    false,
    "contributory then page fault is serial",
  );
  assert.equal(
    matrix._formsDoubleFault(14, 13),
    true,
    "page fault then contributory is #DF",
  );
  assert.equal(
    matrix._formsDoubleFault(6, 13),
    false,
    "#UD is benign on the 386",
  );
  const serial = protectedFixture();
  serial.put(0x400 + 6 * 8, gate(0x100, 8, 0x04));
  serial.put(0x400 + 13 * 8, gate(0x180, 8, 0x0e));
  serial.put(0x100000, [0x8e, 0xc8]);
  serial.cpu.step();
  assert.deepEqual([serial.cpu.eip, serial.cpu.esp], [0x180, 0x3f0]);
  assert.equal(
    serial.dword(0x1203f0),
    2 | (6 << 3),
    "#GP reports the failed #UD IDT selector",
  );
  assert.equal(
    serial.dword(0x1203f4),
    0,
    "replacement fault retains the original restart EIP",
  );
  assert.equal(
    serial.dword(0x1203fc) & 0x10000,
    0x10000,
    "fault frames set RF",
  );

  const doubled = protectedFixture();
  doubled.put(0x400 + 13 * 8, gate(0x100, 0, 0x0e));
  doubled.put(0x400 + 8 * 8, gate(0x180, 8, 0x0e));
  doubled.put(0x100000, [0x2e, 0x89, 0x03]);
  doubled.cpu.ebx = 0x20;
  doubled.cpu.step();
  assert.deepEqual([doubled.cpu.eip, doubled.cpu.esp], [0x180, 0x3f0]);
  assert.equal(doubled.dword(0x1203f0), 0, "#DF always pushes error code zero");
  assert.equal(
    doubled.dword(0x1203fc) & 0x10000,
    0,
    "#DF is an abort and does not synthesize RF",
  );

  const shutdown = protectedFixture();
  shutdown.put(0x400 + 13 * 8, gate(0x100, 0, 0x0e));
  shutdown.put(0x400 + 8 * 8, gate(0x180, 0, 0x0e));
  shutdown.put(0x100000, [0x2e, 0x89, 0x03]);
  shutdown.cpu.ebx = 0x20;
  shutdown.cpu.step();
  assert.equal(shutdown.cpu.shutdown, true);
});

test("stack preflight faults have no frame writes and host bus errors are never reclassified", () => {
  const preflight = protectedFixture();
  preflight.cpu.segmentCaches[2].limit = 0x3f8;
  preflight.put(0x100000, [0xcd, 0x20]);
  const before = preflight.writes.length;
  preflight.cpu.step();
  assert.equal(preflight.cpu.shutdown, true);
  const effects = preflight.writes.slice(before);
  assert.deepEqual(
    effects.map(([address]) => address),
    [],
    "frame admission precedes descriptor accessed and stack writes",
  );

  const marker = new Error("host write failed");
  const host = protectedFixture();
  host.put(0x100000, [0xcd, 0x20]);
  host.cpu.write = () => {
    throw marker;
  };
  assert.throws(
    () => host.cpu.step(),
    (error) => error === marker,
  );
  assert.equal(host.cpu.shutdown, false);
});

test("decode cannot wrap from FFFFFFFF to zero within one instruction", () => {
  const f = fixture({ deliverFaults: false });
  f.cpu.segmentCaches[1] = {
    base: 0,
    limit: 0xffffffff,
    default32: true,
    present: true,
    code: true,
    readable: true,
    writable: false,
  };
  f.cpu.eip = 0xffffffff;
  f.put(0xffffffff, [0x66]);
  f.put(0, [0xf4]);
  assert.throws(
    () => f.cpu.step(),
    (error) => error instanceof I80386Fault && error.vector === 13,
  );
  assert.equal(f.cpu.eip, 0xffffffff);
  assert.equal(f.cpu.halted, false);

  const tooLong = protectedFixture();
  tooLong.put(0x400 + 13 * 8, gate(0x180, 8, 0x0e));
  tooLong.put(0x100000, [...Array(15).fill(0x66), 0x40]);
  tooLong.cpu.step();
  assert.deepEqual([tooLong.cpu.eip, tooLong.cpu.esp], [0x180, 0x3f0]);
  assert.deepEqual(
    [tooLong.dword(0x1203f0), tooLong.dword(0x1203f4), tooLong.dword(0x1203f8)],
    [0, 0, 8],
    "the architectural #GP(0) frame restarts at the overlong instruction",
  );
});

test("external delivery preserves EXT in a replacement fault and wakes HLT", () => {
  const f = protectedFixture();
  f.put(0x400 + 0x20 * 8, gate(0x100, 0, 0x0e));
  f.put(0x400 + 13 * 8, gate(0x180, 8, 0x0e));
  f.cpu.eflags |= 0x200;
  f.cpu.halted = true;
  assert.equal(f.cpu.interrupt(0x20), true);
  assert.equal(f.cpu.halted, false);
  assert.deepEqual(
    [f.cpu.eip, f.cpu.esp, f.dword(0x1203f0)],
    [0x180, 0x3f0, 1],
  );
});

test("fault frames set RF while traps/software interrupts do not, and TF uses the completed EIP", () => {
  const traced = protectedFixture();
  traced.put(0x400 + 1 * 8, gate(0x180, 8, 0x0e));
  traced.put(0x100000, [0x40]);
  traced.cpu.eflags = 0x302;
  traced.cpu.step();
  assert.deepEqual(
    [traced.cpu.eip, traced.cpu.eax, traced.cpu.esp],
    [0x180, 1, 0x3f4],
  );
  assert.equal(
    traced.dword(0x1203f4),
    1,
    "#DB saves the completed instruction EIP",
  );
  assert.equal(
    traced.dword(0x1203fc) & 0x10300,
    0x300,
    "single-step trap image contains TF and IF, not RF",
  );
  assert.equal(
    traced.cpu.eflags & (0x100 | 0x10000),
    0,
    "handler live flags clear TF and RF",
  );

  const software = protectedFixture();
  software.put(0x100000, [0xcd, 0x20]);
  software.cpu.eflags = 0x202;
  software.cpu.step();
  assert.equal(
    software.dword(0x1203fc) & 0x10000,
    0,
    "software INT frame does not invent RF",
  );

  const ordinary = fixture();
  ordinary.cpu.eflags |= 0x10000;
  ordinary.put(0, [0x40]);
  ordinary.cpu.step();
  assert.equal(
    ordinary.cpu.eflags & 0x10000,
    0,
    "ordinary completion clears RF",
  );

  const returned = protectedFixture();
  returned.put(0x100000, [0xcf, 0x40]);
  returned.put(0x120400, [1, 0, 0, 0, 8, 0, 0, 0, 2, 0, 1, 0]);
  returned.cpu.step();
  assert.equal(
    returned.cpu.eflags & 0x10000,
    0x10000,
    "IRET preserves the popped RF value",
  );
  returned.cpu.step();
  assert.equal(
    returned.cpu.eflags & 0x10000,
    0,
    "the instruction after IRET clears RF",
  );
});

test("STI/MOV SS inhibit interrupts while MOV SS suppresses only its own debug boundary", () => {
  const irq = fixture({ deliverFaults: true });
  irq.put(0, [0xfb, 0x40]);
  irq.put(0x20 * 4, [0x00, 0x02, 0x00, 0x20]);
  irq.cpu.ss = 0x100;
  irq.cpu._loadSeg(2, 0x100);
  irq.cpu.sp = 0x100;
  irq.cpu.step();
  assert.equal(irq.cpu.interrupt(0x20), false);
  irq.cpu.step();
  assert.equal(irq.cpu.interrupt(0x20), true);

  const debug = fixture({ deliverFaults: true });
  debug.put(1 * 4, [0x00, 0x02, 0x00, 0x20]);
  debug.put(0, [0x8e, 0xd0, 0x40, 0x40]);
  debug.cpu.ax = 0x100;
  debug.cpu.ss = 0x100;
  debug.cpu._loadSeg(2, 0x100);
  debug.cpu.sp = 0x100;
  debug.cpu.eflags = 0x102;
  debug.cpu.step();
  assert.equal(debug.cpu.ip, 2);
  debug.cpu.step();
  assert.deepEqual(
    [debug.cpu.cs, debug.cpu.ip, debug.cpu.ax],
    [0x2000, 0x200, 0x101],
  );
  assert.equal(
    debug.word(0x10fa),
    3,
    "TF traps after the instruction following MOV SS",
  );

  const nmi = fixture({ deliverFaults: true });
  nmi.put(0, [0x8e, 0xd0, 0x40]);
  nmi.cpu.ax = 0x100;
  nmi.cpu.ss = 0x100;
  nmi.cpu._loadSeg(2, 0x100);
  nmi.cpu.sp = 0x100;
  nmi.cpu.step();
  assert.equal(nmi.cpu.interrupt(2, { nmi: true }), false);
  nmi.cpu.step();
  assert.equal(nmi.cpu.interrupt(2, { nmi: true }), true);
  assert.equal(
    nmi.cpu.interrupt(2, { nmi: true }),
    false,
    "NMI remains blocked until IRET",
  );
  assert.equal(
    nmi.cpu.ip,
    0,
    "accepted NMI uses the real-mode vector after the MOV SS shadow",
  );
  nmi.cpu._iret(16);
  assert.equal(
    nmi.cpu.interrupt(2, { nmi: true }),
    true,
    "IRET releases NMI blocking",
  );
  nmi.cpu._iret(16);
});

test("32-bit POP SS advances ESP by four and invalid IRET modes are atomic", () => {
  const pop = protectedFixture();
  pop.put(0x100000, [0x17]);
  pop.put(0x120400, [0x10, 0, 0, 0]);
  pop.cpu.step();
  assert.deepEqual([pop.cpu.ss, pop.cpu.esp], [0x10, 0x404]);

  const nested = protectedFixture();
  nested.cpu.eflags |= 0x4000;
  nested.put(0x100000, [0xcf]);
  assert.throws(() => nested.cpu.step(), /nested-task IRET/);
  assert.deepEqual([nested.cpu.eip, nested.cpu.esp], [0, 0x400]);

  const vm = protectedFixture();
  vm.put(0x100000, [0xcf]);
  vm.put(0x120400, [1, 0, 0, 0, 8, 0, 0, 0, 2, 0, 2, 0]);
  vm.cpu.step();
  assert.deepEqual([vm.cpu.virtual8086, vm.cpu.eip, vm.cpu.cs], [true, 1, 8]);

  const real = fixture();
  real.cpu.ss = 0x100;
  real.cpu._loadSeg(2, 0x100);
  real.cpu.sp = 0x100;
  real.put(0, [0x66, 0xcf]);
  real.put(0x1100, [0, 0, 1, 0, 0, 0, 0, 0, 2, 0, 0, 0]);
  assert.throws(
    () => real.cpu.step(),
    (error) => error instanceof I80386Fault && error.vector === 13,
  );
  assert.deepEqual([real.cpu.eip, real.cpu.sp, real.cpu.cs], [0, 0x100, 0]);
});
