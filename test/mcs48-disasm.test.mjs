// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import { disasmMCS48, disassembleMCS48Range, MCS48_OPCODES } from '../src/mcs48-disasm.js';

test('disassembler separates byte lengths from machine-cycle costs', () => {
  const rows = disassembleMCS48Range(new Uint8Array([0x23, 0xa5, 0x39, 0x17, 0x83]), 0, 4);
  assert.deepEqual(rows.map((r) => [r.address, r.text, r.length, r.cycles]), [
    [0, 'MOV A,#0xA5', 2, 2], [2, 'OUTL P1,A', 1, 2],
    [3, 'INC A', 1, 1], [4, 'RET', 1, 2],
  ]);
  assert.deepEqual(rows[0].bytes, [0x23, 0xa5]);
});

test('disassembly branch destinations match operand-page rules and selected bank context', () => {
  const rom = new Uint8Array(4096);
  rom.set([0x96, 0x55], 0xfe);
  assert.equal(disasmMCS48(rom, 0xfe).target, 0x055);
  rom.set([0x96, 0x55], 0xff);
  assert.equal(disasmMCS48(rom, 0xff).target, 0x155);
  rom.set([0x64, 0x42], 0);
  assert.equal(disasmMCS48(rom, 0, { memoryBank: 1 }).text, 'JMP 0xB42');
  assert.equal(disasmMCS48(rom, 0, { memoryBank: 1, interruptInProgress: true }).target, 0x342);
});

test('reader callbacks see PC wrap within the active 2 KiB bank', () => {
  const addresses = [];
  const row = disasmMCS48((at) => { addresses.push(at); return at === 0xfff ? 0x23 : 0x5a; }, 0xfff);
  assert.deepEqual(addresses, [0xfff, 0x800]);
  assert.equal(row.text, 'MOV A,#0x5A');
});

test('undefined opcodes are data, not undocumented NMOS instructions', () => {
  const row = disasmMCS48([1]);
  assert.equal(row.text, 'DB 0x01');
  assert.equal(row.legal, false);
  assert.equal(row.length, 1);
  assert.equal(MCS48_OPCODES.filter((r) => r.legal).length, 230);
  assert.ok(Object.isFrozen(MCS48_OPCODES));
  assert.ok(Object.isFrozen(MCS48_OPCODES[0]));
});
