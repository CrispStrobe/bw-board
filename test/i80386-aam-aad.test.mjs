import test from "node:test";
import assert from "node:assert/strict";
import I80386 from "../src/experimental/i80386.js";

const cpu = bytes => new I80386({ fetch: address => bytes[address] ?? 0 });

test("AAM and AAD use their encoded base and define only SF/ZF/PF", () => {
  const aam = cpu([0xd4, 10]);
  aam.al = 123;
  aam.eflags = 0x811;
  aam.step();
  assert.deepEqual([aam.ah, aam.al, aam.eflags & 0x8d5], [12, 3, 0x815]);

  const aad = cpu([0xd5, 10]);
  aad.ax = 0x0c03;
  aad.eflags = 0x811;
  aad.step();
  assert.deepEqual([aad.ah, aad.al, aad.eflags & 0x8d5], [0, 123, 0x815]);

  const binary = cpu([0xd5, 2]);
  binary.ax = 0x0180;
  binary.step();
  assert.deepEqual([binary.ah, binary.al, binary.eflags & 0xc4], [0, 0x82, 0x84]);
});

test("AAM base zero raises restartable divide error before AX changes", () => {
  const fault = cpu([0xd4, 0]);
  fault.ax = 0x1234;
  assert.throws(() => fault.step(), error => error?.vector === 0 && error.errorCode === null);
  assert.deepEqual([fault.ax, fault.eip], [0x1234, 0]);
});
