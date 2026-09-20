import test from "node:test";
import assert from "node:assert/strict";
import I80386 from "../src/experimental/i80386.js";

const CF = 1, PF = 4, AF = 0x10, ZF = 0x40, SF = 0x80, OF = 0x800;

function execute(opcode, ax, flags = 2) {
  const bytes = [opcode];
  const cpu = new I80386({
    read: address => bytes[address] ?? 0,
    fetch: address => bytes[address] ?? 0,
    write: () => {},
  });
  cpu.ax = ax;
  cpu.eflags = flags;
  cpu.step();
  return cpu;
}

test("AAA and AAS adjust AX as one 16-bit value and define CF/AF", () => {
  let cpu = execute(0x37, 0x12fa, OF);
  assert.deepEqual([cpu.ax, cpu.eflags & (CF | AF | OF)], [0x1400, CF | AF | OF]);
  cpu = execute(0x3f, 0x120b, 0);
  assert.deepEqual([cpu.ax, cpu.eflags & (CF | AF)], [0x1105, CF | AF]);
  cpu = execute(0x3f, 0x1205, OF);
  assert.deepEqual([cpu.ax, cpu.eflags & (CF | AF | OF)], [0x1205, OF]);
});

test("DAA and DAS apply low/high corrections and defined result flags", () => {
  let cpu = execute(0x27, 0x009a, OF);
  assert.equal(cpu.al, 0x00);
  assert.equal(cpu.eflags & (CF | AF | PF | ZF | SF | OF), CF | AF | PF | ZF | OF);
  cpu = execute(0x2f, 0x0000, AF | OF);
  assert.equal(cpu.al, 0xfa);
  assert.equal(cpu.eflags & (CF | AF | PF | ZF | SF | OF), CF | AF | PF | SF | OF);
});
