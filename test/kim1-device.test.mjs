// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {getDevice} from '../src/devices.js';
import {registerKim1Device, KIM1_TERMINALS, kim1ClockHz} from '../src/devices/kim1.js';
import {KIM1_DEMOS, writeKim1Byte} from '../src/kim1-machine.js';
registerKim1Device();
const model = getDevice('kim-1');
function fixture(program = KIM1_DEMOS.counter.program) {
  const part = {id: 'kim', kind: 'kim-1', params: {program, clockHz: 1000}};
  const state = model.init(part), inputs = {};
  const read = pin => inputs[pin] ?? state.drives[pin]?.vTh ?? 0;
  const advance = target => {
    while (state._wakeNs !== null && state._wakeNs <= target) {
      const at = state._wakeNs;
      model.update(part, state, read, at);
      model.update(part, state, read, at); // Solver re-entry cannot execute twice.
    }
    model.update(part, state, read, target);
  };
  return {part, state, inputs, read, advance};
}

test('registered KIM pins exclude reserved PB6 and all inputs begin high impedance', () => {
  const {state} = fixture();
  assert.deepEqual(model.terminals, KIM1_TERMINALS); assert.equal(KIM1_TERMINALS.length, 17);
  assert.equal(KIM1_TERMINALS.includes('PB6'), false);
  for (const pin of KIM1_TERMINALS.filter(p => p.startsWith('P'))) assert.equal(state.drives[pin], null);
  assert.equal(state.drives['5v'].vTh, 5); assert.equal(state.drives.gnd.vTh, 0);
  assert.equal(state._wakeNs, null);
  for (const clockHz of [0, -1, 1.5, NaN, 1_000_001, '1000']) assert.throws(() => kim1ClockHz({params: {clockHz}}));
});

test('clocked output transitions are independent of caller advance chunks', () => {
  const run = chunks => {
    const f = fixture(); model.control(f.part, f.state, 'run');
    for (const target of chunks) f.advance(target);
    return {pc: f.state.pc, count: f.state.executed, a: f.state.portA, cycles: f.state.cpu.cycles};
  };
  const once = run([1_000_000_000n]);
  assert.equal(once.a, 110);
  assert.deepEqual(run(Array.from({length: 100}, (_, i) => BigInt(i + 1) * 10_000_000n)), once);
});

test('input voltages are sampled by a program; DDR outputs reach actual driver stamps', () => {
  const f = fixture(KIM1_DEMOS.echo.program);
  f.inputs.PB0 = 5; f.inputs.PB2 = 5;
  model.control(f.part, f.state, 'run'); f.advance(100_000_000n);
  assert.equal(f.state.portA, 5); assert.equal(f.state.drives.PA0.vTh, 5);
  assert.equal(f.state.drives.PA1.vTh, 0); assert.equal(f.state.drives.PB0, null);
  const count = f.state.executed;
  model.control(f.part, f.state, 'halt'); f.inputs.PB0 = 0; f.advance(200_000_000n);
  assert.equal(f.state.executed, count); assert.equal(f.state.portA, 5); assert.equal(f.state.portB, 4);
});

test('timers keep the shared clock while monitor is stopped and can pull PB7 low', () => {
  const f = fixture(); f.inputs.PB7 = 5;
  writeKim1Byte(f.state, 0x170d, 2); model.update(f.part, f.state, f.read, 0n);
  assert.equal(f.state._wakeNs, 17_000_000n); assert.equal(f.state.drives.PB7, null);
  f.advance(16_999_999n); assert.equal(f.state.riots[0].timer.expired, false);
  f.advance(17_000_000n); assert.equal(f.state.riots[0].timer.expired, true);
  assert.equal(f.state.drives.PB7.vTh, 0); assert.equal(f.state.running, false); assert.equal(f.state.executed, 0);
});

test('front-panel port/DDR edits immediately change electrical output drivers', () => {
  const f = fixture(), before = f.state.programSource;
  for (const key of ['AD', '1', '7', '0', '1', 'DA', 'F', 'F', 'AD', '1', '7', '0', '0', 'DA', 'A', '5']) model.control(f.part, f.state, 'key', key);
  assert.equal(f.state.drives.PA0.vTh, 5); assert.equal(f.state.drives.PA1.vTh, 0);
  assert.equal(f.state.drives.PA7.vTh, 5); assert.equal(f.state.programSource, before);
});

test('persisting canonical keypad edits does not reload or reset running state', () => {
  const f = fixture();
  for (const key of ['AD', '0', '3', '0', '0', 'DA', 'A', 'B', 'PC']) model.control(f.part, f.state, 'key', key);
  model.control(f.part, f.state, 'run'); f.advance(100_000_000n);
  const pc = f.state.pc, count = f.state.executed;
  f.part.params.program = f.state.programSource; model.update(f.part, f.state, f.read, 100_000_000n);
  assert.equal(f.state.running, true); assert.equal(f.state.pc, pc); assert.equal(f.state.executed, count);
  model.reset(f.part, f.state); assert.equal(f.state.ram[0x300], 0xab); assert.equal(f.state.drives.PA0, null);
  assert.equal(f.state._timeNs, 0n);
});

test('mounted ROM boots from the hardware vector and clocks RIOT writes on individual Board cycles', () => {
  const f = fixture();
  const applicationRom = new Uint8Array(1024);
  const keypadRom = new Uint8Array(1024);
  // SEI; LDA #$01; STA $170D; LDX #$05; LDA $17FF,X; JMP $1C0B.
  keypadRom.set([0x78, 0xa9, 1, 0x8d, 0x0d, 0x17, 0xa2, 5, 0xbd, 0xff, 0x17, 0x4c, 0x0b, 0x1c]);
  keypadRom.set([0x00, 0x1c], 0x3fc);
  assert.throws(() => model.control(f.part, f.state, 'loadRoms', [applicationRom]), /1,024-byte/);
  model.control(f.part, f.state, 'loadRoms', [applicationRom, keypadRom]);
  f.advance(7_000n);
  assert.equal(f.state.cpu.pc, 0x1c00);
  assert.equal(f.state.cpu.cycles, 7);
  f.advance(14_000n);
  assert.equal(f.state.riots[0].timer.active, false);
  f.advance(15_000n);
  assert.equal(f.state.riots[0].timer.active, true);
  assert.equal(f.state.riots[0].timer.count, 1);
  assert.equal(f.state.riots[0].timer.irqEnabled, true);
  f.advance(20_000n);
  assert.equal(f.state.riots[0].timer.irqEnabled, true);
  f.advance(21_000n);
  assert.equal(f.state.riots[0].timer.irqEnabled, false, 'indexed dummy read acknowledged the timer at $1704');
  f.advance(22_000n);
  assert.equal(f.state.cpu.pc, 0x1c0b);
  assert.equal(f.state.error, null);
  model.control(f.part, f.state, 'useTeachingMonitor');
  assert.equal(f.state.roms, null);
  assert.equal(f.state._wakeNs, null);
});
