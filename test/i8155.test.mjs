import test from 'node:test';
import assert from 'node:assert/strict';
import { Intel8155, Unsupported8155ModeError } from '../src/i8155.js';

function timer(chip, count, mode, command = 0xc0) {
  chip.writeIO(4, count & 255);
  chip.writeIO(5, (count >> 8) | (mode << 6));
  chip.writeIO(0, command);
}

test('8155 reset preserves RAM and programmed count, while power-on is explicitly deterministic', () => {
  const chip = new Intel8155();
  chip.writeMemory(255, 0xa7);
  timer(chip, 1234, 1);
  chip.clockTimer(10);
  chip.writeIO(0, 0x0f);
  chip.writeIO(1, 0xab);
  chip.reset();
  assert.equal(chip.ram[255], 0xa7);
  assert.equal(chip.timerReload, 0x4000 | 1234);
  assert.equal(chip.timerRemaining, 1224);
  assert.equal(chip.timerRunning, false);
  assert.equal(chip.command, 0);
  assert.deepEqual(chip.output, { a: 0, b: 0, c: 0 });
  chip.powerCycle();
  assert.equal(chip.ram[255], 0);
  assert.equal(chip.timerReload, 0);
});

test('8155 basic ports read inputs, ignore input writes, clear latches on input, and mask PC to six bits', () => {
  const external = { a: 0x12, b: 0xa5, c: 0xef };
  const changes = [];
  const chip = new Intel8155({ readPort: port => external[port], onPortChange: (port, state) => changes.push([port, state.direction, state.value]) });
  assert.equal(chip.readIO(1), 0x12);
  assert.equal(chip.readIO(2), 0xa5);
  assert.equal(chip.readIO(3), 0x2f);
  chip.writeIO(1, 0xff);
  assert.equal(chip.output.a, 0);
  chip.writeIO(0, 0x0f);
  assert.equal(chip.readIO(1), 0);
  chip.writeIO(1, 0x5a);
  chip.writeIO(2, 0x81);
  chip.writeIO(3, 0xff);
  assert.equal(chip.readIO(1), 0x5a);
  assert.equal(chip.readIO(2), 0x81);
  assert.equal(chip.readIO(3), 0x3f);
  chip.writeIO(0, 0);
  assert.deepEqual(chip.output, { a: 0, b: 0, c: 0 });
  chip.writeIO(0, 0x0f);
  assert.equal(chip.readIO(1), 0);
  assert.ok(changes.some(([port, direction]) => port === 'a' && direction === 'input'));
});

test('8155 ALE captures address, mode and select; unselected cycles do not mutate storage', () => {
  const chip = new Intel8155();
  chip.latchAddress(27, false, true);
  chip.writeLatched(0x83);
  assert.equal(chip.readLatched(), 0x83);
  chip.latchAddress(27, false, false);
  chip.writeLatched(0x19);
  assert.equal(chip.readLatched(), 0xff);
  assert.equal(chip.ram[27], 0x83);
  chip.latchAddress(0, true, true);
  chip.writeLatched(0x0f);
  chip.latchAddress(9, true, true); // upper I/O address bits do not select another register.
  chip.writeLatched(0x6d);
  assert.equal(chip.readIO(1), 0x6d);
  assert.equal(chip.readIO(6), 0xff);
  chip.setReset(true);
  chip.writeLatched(0x87);
  assert.equal(chip.readLatched(), 0xff);
  assert.equal(chip.ram[27], 0x83);
});

test('8155 unsupported strobed modes and invalid timer START fail before any register changes', () => {
  const chip = new Intel8155();
  chip.writeCommand(0x0f);
  chip.writeIO(1, 0x42);
  const before = chip.saveState();
  assert.throws(() => chip.writeCommand(0x05), Unsupported8155ModeError);
  assert.deepEqual(chip.saveState(), before);
  assert.throws(() => chip.writeCommand(0xc0), /count must be/);
  assert.deepEqual(chip.saveState(), before);
});

test('8155 odd square-wave count has the longer high half; terminal status clears on read', () => {
  const chip = new Intel8155();
  timer(chip, 9, 0);
  assert.equal(chip.timerOutput, 1);
  chip.clockTimer(4);
  assert.equal(chip.timerOutput, 1);
  chip.clockTimer();
  assert.equal(chip.timerOutput, 0);
  chip.clockTimer(4);
  assert.equal(chip.timerRunning, false);
  assert.equal(chip.timerOutput, 1);
  assert.equal(chip.readIO(0), 0x40);
  assert.equal(chip.readIO(0), 0);
  assert.equal(chip.timerRemaining, 0);
});

test('8155 continuous timer repeats its active count until a new START reaches terminal count', () => {
  const chip = new Intel8155();
  timer(chip, 4, 1);
  chip.clockTimer(2);
  chip.writeIO(4, 6);
  chip.clockTimer(2);
  assert.equal(chip.timerRemaining, 4, 'writing the reload register alone must not reprogram the running period');
  chip.writeCommand(0xc0);
  chip.clockTimer(3);
  assert.equal(chip.timerLength, 4);
  chip.clockTimer();
  assert.equal(chip.timerLength, 6);
  assert.equal(chip.timerRemaining, 6);
  assert.equal(chip.timerRunning, true);
  chip.writeCommand(0x80);
  chip.clockTimer(5);
  assert.equal(chip.timerRunning, true);
  chip.clockTimer();
  assert.equal(chip.timerRunning, false);
});

test('8155 timer pulses are low for one input clock and STOP freezes the running counter', () => {
  for (const mode of [2, 3]) {
    const chip = new Intel8155();
    timer(chip, 3, mode);
    chip.clockTimer(3);
    assert.equal(chip.timerOutput, 0);
    assert.equal(chip.timerRunning, mode === 3);
    chip.clockTimer();
    assert.equal(chip.timerOutput, 1);
    if (mode === 3) {
      assert.equal(chip.timerRemaining, 2);
      chip.writeCommand(0x40);
      chip.clockTimer(100);
      assert.equal(chip.timerRemaining, 2);
    }
  }
});

test('8155 status reports interrupt-enable fields in their actual bit positions', () => {
  const chip = new Intel8155();
  chip.writeCommand(0x30);
  assert.equal(chip.readIO(0), 0x24);
  chip.writeCommand(0x10);
  assert.equal(chip.readIO(0), 0x04);
  chip.writeCommand(0x20);
  assert.equal(chip.readIO(0), 0x20);
});

test('8155 snapshots are detached and reject malformed trailing data transactionally', () => {
  const chip = new Intel8155();
  timer(chip, 8, 3, 0xcf);
  chip.clockTimer(3);
  chip.writeIO(1, 0xab);
  chip.ram[255] = 0xde;
  const snapshot = chip.saveState();
  const restored = new Intel8155();
  restored.loadState(snapshot);
  assert.deepEqual(restored.saveState(), snapshot);
  const invalid = structuredClone(snapshot);
  invalid.ram[255] = 256;
  assert.throws(() => restored.loadState(invalid), RangeError);
  assert.deepEqual(restored.saveState(), snapshot);
  invalid.ram[255] = 0xde;
  invalid.timerRemaining = 9;
  assert.throws(() => restored.loadState(invalid), /Inconsistent/);
  assert.deepEqual(restored.saveState(), snapshot);
  snapshot.ram[255] = 0;
  assert.equal(chip.ram[255], 0xde);
});
