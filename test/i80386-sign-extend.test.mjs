import test from "node:test";
import assert from "node:assert/strict";
import I80386 from "../src/experimental/i80386.js";

function cpu(bytes) {
  const memory = new Map(bytes.map((value, index) => [index, value]));
  return new I80386({
    read: (address) => memory.get(address) ?? 0,
    fetch: (address) => memory.get(address) ?? 0,
    write: (address, value) => memory.set(address, value & 0xff),
  });
}

test("CBW and CWDE sign-extend the operand-size accumulator without flags", () => {
  const c = cpu([0x98, 0x66, 0x98]);
  c.eax = 0x12345680;
  c.eflags = 0x8d7;
  c.step();
  assert.equal(c.eax, 0x1234ff80);
  assert.equal(c.eflags, 0x8d7);
  c.ax = 0x8001;
  c.step();
  assert.equal(c.eax, 0xffff8001);
  assert.equal(c.eflags, 0x8d7);
});

test("CWD and CDQ sign-extend AX or EAX into the high dividend", () => {
  const c = cpu([0x99, 0x66, 0x99]);
  c.eax = 0xabcd8000;
  c.edx = 0x12345678;
  c.eflags = 0x246;
  c.step();
  assert.equal(c.edx, 0x1234ffff);
  c.eax = 0x7fffffff;
  c.step();
  assert.equal(c.edx, 0);
  assert.equal(c.eflags, 0x246);
});
