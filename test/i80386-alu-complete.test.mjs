import test from "node:test";
import assert from "node:assert/strict";
import I80386 from "../src/experimental/i80386.js";

const CF = 1, PF = 4, AF = 0x10, ZF = 0x40, SF = 0x80, OF = 0x800;
const STATUS = CF | PF | AF | ZF | SF | OF;

function fixture(bytes) {
  const memory = new Map(bytes.map((value, index) => [index, value]));
  const reads = [];
  const cpu = new I80386({
    read(address) {
      reads.push(address >>> 0);
      return memory.get(address >>> 0) ?? 0;
    },
    fetch: (address) => memory.get(address >>> 0) ?? 0,
    write: (address, value) => memory.set(address >>> 0, value & 0xff),
  });
  return { cpu, memory, reads };
}

test("ADC and SBB include carry or borrow in 8/16/32-bit results and flags", () => {
  const cases = [
    { bytes: [0x14, 0], width: 8, initial: 0xff, result: 0, flags: CF | PF | AF | ZF },
    { bytes: [0x14, 0], width: 8, initial: 0x7f, result: 0x80, flags: AF | SF | OF },
    { bytes: [0x1c, 0], width: 8, initial: 0, result: 0xff, flags: CF | PF | AF | SF },
    { bytes: [0x15, 0, 0], width: 16, initial: 0xffff, result: 0, flags: CF | PF | AF | ZF },
    { bytes: [0x66, 0x15, 0, 0, 0, 0], width: 32, initial: 0x7fffffff, result: 0x80000000, flags: AF | PF | SF | OF },
    { bytes: [0x66, 0x1d, 0, 0, 0, 0], width: 32, initial: 0, result: 0xffffffff, flags: CF | PF | AF | SF },
  ];
  for (const item of cases) {
    const { cpu } = fixture([0xf9, ...item.bytes]);
    if (item.width === 8) cpu.al = item.initial;
    else cpu.eax = item.initial;
    cpu.step();
    cpu.step();
    assert.equal(item.width === 8 ? cpu.al : item.width === 16 ? cpu.ax : cpu.eax, item.result);
    assert.equal(cpu.eflags & STATUS, item.flags);
  }
});

test("OR/AND/ADC/SBB cover both ModRM directions and group-1 immediates", () => {
  const { cpu, memory } = fixture([
    0x08, 0x06, 0x00, 0x02,
    0x22, 0x1e, 0x00, 0x02,
    0x11, 0x0e, 0x02, 0x02,
    0x1b, 0x16, 0x02, 0x02,
    0x80, 0x0e, 0x04, 0x02, 0x0f,
    0x80, 0x26, 0x04, 0x02, 0xf3,
    0x80, 0x16, 0x05, 0x02, 0x00,
    0x80, 0x1e, 0x06, 0x02, 0x00,
  ]);
  memory.set(0x200, 0x30);
  memory.set(0x202, 0xff);
  memory.set(0x203, 0xff);
  memory.set(0x204, 0xf0);
  memory.set(0x205, 0xff);
  memory.set(0x206, 0);
  cpu.al = 0x0f;
  cpu.bx = 0x1234;
  cpu.cx = 0;
  cpu.dx = 0xffff;
  for (let i = 0; i < 8; i++) {
    if (i === 2 || i === 6 || i === 7) cpu.eflags |= CF;
    cpu.step();
  }
  assert.equal(memory.get(0x200), 0x3f);
  assert.equal(cpu.ebx & 0xff, 0x34 & 0x3f);
  assert.equal(memory.get(0x202) | (memory.get(0x203) << 8), 0);
  assert.equal(cpu.dx, 0xfffe);
  assert.deepEqual([memory.get(0x204), memory.get(0x205), memory.get(0x206)], [0xf3, 0x00, 0xff]);
});

test("32-bit OR/AND/ADC/SBB ModRM directions preserve full register width", () => {
  const cases = [
    { op: 0x09, eax: 0x00ff00ff, ebx: 0xff000000, out: 0xffff00ff, reg: "ebx" },
    { op: 0x0b, eax: 0x00ff00ff, ebx: 0xff000000, out: 0xffff00ff, reg: "eax" },
    { op: 0x21, eax: 0x0fff0fff, ebx: 0xffff0000, out: 0x0fff0000, reg: "ebx" },
    { op: 0x23, eax: 0x0fff0fff, ebx: 0xffff0000, out: 0x0fff0000, reg: "eax" },
    { op: 0x11, eax: 0xffffffff, ebx: 0, out: 0, reg: "ebx", carry: true },
    { op: 0x13, eax: 0xffffffff, ebx: 0, out: 0, reg: "eax", carry: true },
    { op: 0x19, eax: 0, ebx: 0, out: 0xffffffff, reg: "ebx", carry: true },
    { op: 0x1b, eax: 0, ebx: 0, out: 0xffffffff, reg: "eax", carry: true },
  ];
  for (const item of cases) {
    const { cpu } = fixture([0x66, item.op, 0xc3]);
    cpu.eax = item.eax;
    cpu.ebx = item.ebx;
    if (item.carry) cpu.eflags |= CF;
    cpu.step();
    assert.equal(cpu[item.reg], item.out, `opcode ${item.op.toString(16)}`);
  }
});

test("writing ALU forms preflight protected permissions before operand reads", () => {
  for (const opcode of [0x08, 0x10, 0x18, 0x20]) {
    const f = fixture([opcode, 0x06, 0x00, 0x01]);
    f.cpu.cr0 = 1;
    f.cpu.segmentCaches[3].writable = false;
    assert.throws(
      () => f.cpu.step(),
      (error) => error?.vector === 13 && error.errorCode === 0,
    );
    assert.equal(f.reads.length, 0);
  }
  const cmp = fixture([0x38, 0x06, 0x00, 0x01]);
  cmp.cpu.cr0 = 1;
  cmp.cpu.segmentCaches[3].writable = false;
  cmp.cpu.step();
  assert.deepEqual(cmp.reads, [0x100]);
});
