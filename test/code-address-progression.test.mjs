/**
 * Listing progression belongs to each target's real code-address space.
 *
 * A caller supplies instruction length; the target supplies normalisation and
 * wrap. This small consumer states the fail-closed half of the contract for
 * the later GUI integration without importing GUI code into bw-board.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createEmu8051DebugTarget} from '../src/emu8051-debug.js';
import {createM6502DebugTarget} from '../src/m6502-debug.js';
import {createZ80DebugTarget} from '../src/z80-debug.js';
import {createI8086DebugTarget} from '../src/i8086-debug.js';
import {createLabwiredDebugTarget} from '../src/labwired-debug.js';

const REFUSED = Symbol('refused');
const consumeNext = (target, addr, length) => {
  if (typeof target.nextCodeAddress !== 'function') return REFUSED;
  const next = target.nextCodeAddress(addr, length);
  if (!Number.isSafeInteger(next) || next < 0 || (length > 0 && next === addr)) return REFUSED;
  return next;
};

const emu8051Surface = Object.fromEntries([
  '_emu_dbg_state', '_emu_dbg_run', '_emu_dbg_halt', '_emu_dbg_step',
  '_emu_dbg_reset', '_emu_dbg_run_until_ns', '_emu_dbg_read_mem',
  '_emu_dbg_write_mem', '_emu_dbg_pc'
].map(name => [name, () => 0]));

const targets16 = () => [
  ['8051', createEmu8051DebugTarget(emu8051Surface)],
  ['6502', createM6502DebugTarget({machine: {cpu: {}}})],
  ['Z80', createZ80DebugTarget({machine: {cpu: {}}})]
];

test('8051, 6502 and Z80 normalise and wrap listing addresses at 16 bits', () => {
  for (const [name, target] of targets16()) {
    assert.equal(consumeNext(target, 0x10002, 0), 0x0002, `${name} normalisation`);
    assert.equal(consumeNext(target, 0xffff, 2), 0x0001, `${name} boundary wrap`);
  }
});

test('i8086 keeps a listing above 64 KiB instead of aliasing another byte', () => {
  const target = createI8086DebugTarget({machine: {cpu: {cs: 0x1000}}});
  assert.equal(consumeNext(target, 0x1f000, 0), 0x1f000,
    'a 16-bit normaliser would make the visible row name the wrong byte');
  assert.equal(consumeNext(target, 0x1f000, 3), 0x1f003);
});

test('i8086 advances across an IP wrap inside the same segment', () => {
  const target = createI8086DebugTarget({machine: {cpu: {cs: 0x2000}}});
  assert.equal(consumeNext(target, 0x2ffff, 2), 0x20001,
    'flattening segmented fetch would skip to physical 0x30001');
});

test('i8086 disassembly and progression share segment position across physical wrap', () => {
  const bytes = new Map([[0xfffff, 0xb8], [0x00000, 0x34], [0x00001, 0x12]]);
  const target = createI8086DebugTarget({machine: {
    cpu: {cs: 0xffff},
    _read: addr => bytes.get(addr) ?? 0x90
  }});
  const row = target.disasm(0xfffff);
  assert.equal(row.text, 'mov ax, 1234h',
    'disassembly must fetch following bytes through the same segment wrap');
  assert.equal(row.length, 3);
  assert.equal(consumeNext(target, 0xfffff, row.length), 0x00002,
    'the row after that instruction must begin after the bytes disassembled');
  assert.equal(consumeNext(target, 0xfffff, 1), 0x00000,
    'losing the 20-bit wrap would produce an address outside physical memory');
});

test('every progression target refuses malformed addresses and lengths', () => {
  const targets = [...targets16().map(([, target]) => target),
    createI8086DebugTarget({machine: {cpu: {cs: 0}}})];
  for (const target of targets) {
    for (const addr of [undefined, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.equal(consumeNext(target, addr, 1), REFUSED, `address ${String(addr)}`);
    }
    for (const length of [undefined, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.equal(consumeNext(target, 0, length), REFUSED, `length ${String(length)}`);
    }
  }
  assert.equal(consumeNext(targets.at(-1), 0x100000, 1), REFUSED,
    'i8086 direct address beyond 20 bits');
});

test('a missing progression method and a non-progressing target fail closed', () => {
  const labwired = createLabwiredDebugTarget({adapter: {
    clockHz: 48_000_000,
    timeNs: () => 0n,
    sim: {get_pc: () => 0x08000000}
  }});
  assert.equal(consumeNext(labwired, 0x08000000, 2), REFUSED,
    'PC-only LabWired disassembly must not be walked as though it were 8051 code');
  assert.equal(consumeNext({nextCodeAddress: addr => addr}, 0x1234, 1), REFUSED,
    'a repeated address must not render duplicate rows as fake progress');
});
