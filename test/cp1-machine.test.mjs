import test from 'node:test';
import assert from 'node:assert/strict';
import { Cp1Machine, CP1_KEY_ROWS } from '../src/cp1-machine.js';
import { createCp1Adapter } from '../src/cp1-adapter.js';
import { identifyCp1Rom, sha1Bytes } from '../src/cp1-rom-profiles.js';

// Every firmware byte in this test file was authored for these tests.
function rom(bytes = [0x04, 0x00]) {
  const image = new Uint8Array(2048);
  image.set(bytes);
  return image;
}
function machine(options = {}) { return new Cp1Machine({ rom: rom(), ...options }); }
function baseIO(cp1, command = 0x0f) {
  cp1.writeCpuPort(2, 0xaf); // I/O, reset low, CP3 off, base selected; keypad released.
  cp1.writeExternal(0, command);
}

test('CP1 requires user firmware and identifies detached 2 KiB ROM bytes', () => {
  assert.throws(() => new Cp1Machine(), /user-supplied/);
  assert.throws(() => new Cp1Machine({ rom: new Uint8Array(2047) }), /2048/);
  assert.equal(sha1Bytes(new Uint8Array()), 'da39a3ee5e6b4b0d3255bfef95601890afd80709');
  assert.equal(sha1Bytes(new TextEncoder().encode('abc')), 'a9993e364706816aba3e25717850c26c9cd0d89d');
  const source = rom();
  const cp1 = new Cp1Machine({ rom: source });
  assert.equal(cp1.romProfile.known, false);
  assert.deepEqual(cp1.romProfile, identifyCp1Rom(source));
  source[0] = 0xff;
  assert.equal(cp1.cpu.rom[0], 0x04);
  const copy = cp1.rom;
  copy[0] = 0xfe;
  assert.equal(cp1.rom[0], 0x04);
});

test('8049 MOVX actually traverses the shared CP1 bus', () => {
  const cp1 = machine({ rom: rom([
    0x23, 0x20, // MOV A,#20: memory, reset released, base selected
    0x3a,       // OUTL P2,A
    0xb8, 0x11, // MOV R0,#11
    0x23, 0x5a, // MOV A,#5A
    0x90,       // MOVX @R0,A
    0x23, 0x00, // MOV A,#00
    0x80,       // MOVX A,@R0
    0x04, 0x0b, // JMP self
  ]) });
  for (let i = 0; i < 7; i++) cp1.step();
  assert.equal(cp1.cpu.a, 0x5a);
  assert.equal(cp1.base.ram[0x11], 0x5a);
  assert.equal(cp1.cycles, cp1.cpu.cycles);
  assert.equal(cp1.tMs, cp1.cycles / 400);
});

test('both selected 8155 chips receive writes; independent selects and bus conflict are observable', () => {
  const cp1 = machine({ expansion: true });
  cp1.writeCpuPort(2, 0x00);
  cp1.writeExternal(254, 0xe7);
  assert.equal(cp1.base.ram[254], 0xe7);
  assert.equal(cp1.expansionChip.ram[254], 0xe7);
  cp1.writeCpuPort(2, 0x10);
  cp1.writeExternal(254, 0x5b);
  assert.equal(cp1.base.ram[254], 0xe7);
  assert.equal(cp1.readExternal(254), 0x5b);
  cp1.writeCpuPort(2, 0x20);
  assert.equal(cp1.readExternal(254), 0xe7);
  cp1.writeCpuPort(2, 0x30);
  cp1.writeExternal(254, 0x00);
  assert.equal(cp1.readExternal(254), 0xff);
  cp1.writeCpuPort(2, 0x00);
  assert.equal(cp1.readExternal(254), 0xe7 & 0x5b);
  assert.equal(cp1.busContentionMask, 0xe7 ^ 0x5b);
  assert.equal(cp1.busContentionCount, 1);
});

test('ALE latches the selected chips and IO/M until the next transfer', () => {
  const cp1 = machine({ expansion: true });
  cp1.base.ram[17] = 0xa5;
  cp1.expansionChip.ram[17] = 0x3c;
  cp1.writeCpuPort(2, 0x20);
  cp1.latchBusAddress(17);
  cp1.writeCpuPort(2, 0x90); // Change live CE and IO/M after ALE.
  assert.equal(cp1.readBus(), 0xa5);
  assert.equal(cp1.readExternal(17), 0xff); // New ALE selects CP3 port A, currently an input.
});

test('CP1 cell bounds and opcode/operand layout follow physical base and CP3 RAM', () => {
  const base = machine();
  base.writeCell(127, 12, 231);
  assert.deepEqual(Array.from(base.base.ram.slice(254)), [12, 231]);
  assert.deepEqual(base.readCell(127), { opcode: 12, operand: 231 });
  assert.throws(() => base.readCell(128), RangeError);
  assert.throws(() => base.writeCell(-1, 0, 0), RangeError);
  assert.throws(() => base.writeCell(0, 1, 256), RangeError);
  const expanded = machine({ expansion: true });
  expanded.writeCell(128, { opcode: 7, operand: 255 });
  expanded.writeCell(255, 1, 0);
  assert.deepEqual(Array.from(expanded.expansionChip.ram.slice(0, 2)), [7, 255]);
  assert.deepEqual(Array.from(expanded.expansionChip.ram.slice(254)), [1, 0]);
  assert.throws(() => expanded.readCell(256), RangeError);
});

test('program loading validates the entire operation before clearing or modifying RAM', () => {
  const cp1 = machine();
  cp1.writeCell(0, 3, 5);
  cp1.writeCell(127, 4, 6);
  const before = Array.from(cp1.base.ram);
  assert.throws(() => cp1.loadProgram([{ opcode: 1, operand: 0 }, { opcode: 2, operand: -1 }], { clear: true }), RangeError);
  assert.deepEqual(Array.from(cp1.base.ram), before);
  assert.throws(() => cp1.loadProgram([{ opcode: 0, operand: 0 }, { opcode: 0, operand: 0 }], { start: 127 }), /exceeds/);
  cp1.loadProgram([{ opcode: 6, operand: 120 }], { start: 127, clear: true });
  assert.deepEqual(cp1.readCell(0), { opcode: 0, operand: 0 });
  assert.deepEqual(cp1.readCell(127), { opcode: 6, operand: 120 });
});

test('all 20 keypad contacts follow the original pull-down schematic and crossed routing into P2', () => {
  const cp1 = machine();
  baseIO(cp1);
  assert.equal(cp1.sampleKeyColumns(), 0);
  CP1_KEY_ROWS.forEach((keys, row) => {
    cp1.writeExternal(3, 0x3f ^ (1 << row));
    keys.forEach((key, visualColumn) => {
      cp1.setKey(key, true);
      assert.equal(cp1.sampleKeyColumns(), 1 << visualColumn, `row ${row}, key ${key}`);
      assert.equal(cp1.readCpuPort(2) & 15, 1 << visualColumn);
      cp1.setKey(key, false);
    });
  });
  cp1.writeExternal(3, 0x1f); // Sixth display row has no keys.
  cp1.setKey('ACC', true);
  assert.equal(cp1.sampleKeyColumns(), 0);
  assert.throws(() => cp1.setKey('NOPE', true), /Unknown CP1 key/);
});

test('simultaneous and physically duplicated keys retain independent contact closures', () => {
  const cp1 = machine();
  baseIO(cp1);
  cp1.writeExternal(3, 0x2f);
  cp1.setKey('0', true, 0);
  cp1.setKey('0', true, 1);
  cp1.setKey('2', true);
  assert.equal(cp1.sampleKeyColumns(), 0x05);
  cp1.setKey('0', false, 0);
  assert.equal(cp1.sampleKeyColumns(), 0x05);
  cp1.setKey('0', false, 1);
  assert.equal(cp1.sampleKeyColumns(), 0x04);
  cp1.releaseKeys();
  assert.equal(cp1.sampleKeyColumns(), 0);
});

test('IN A,P2 and MOVD A,P4 sample the same physical keys without an invented 8243', () => {
  const cp1 = machine({ rom: rom([0x0a, 0x0c, 0x04, 0x02]) });
  baseIO(cp1);
  cp1.writeExternal(3, 0x3e);
  cp1.setKey('CAS', true);
  cp1.step();
  assert.equal(cp1.cpu.a, 0xa1);
  cp1.step();
  assert.equal(cp1.cpu.a, 0x01);
  assert.equal(cp1.cpu.p2, 0xaf);
});

test('P1 released bits read high or external ground; CP3 floating input is explicitly distinguished', () => {
  const cp1 = machine({ expansion: true });
  assert.equal(cp1.readCpuPort(1), 0xff);
  cp1.setPortInput('P1', 0x00, 0x01);
  assert.equal(cp1.readCpuPort(1), 0xfe);
  cp1.writeCpuPort(1, 0xf0);
  assert.equal(cp1.readCpuPort(1), 0xf0);
  assert.equal(cp1.getPortState(1).direction, 'quasi');
  assert.equal(cp1.getPortState(1).floatingMask, 0);
  assert.equal(cp1.getPortState(3).value, 0xff);
  assert.equal(cp1.getPortState(3).floatingMask, 0xff);
  cp1.setPortInput(3, 0x05, 0x0f);
  assert.equal(cp1.getPortState(3).value, 0xf5);
  assert.equal(cp1.getPortState(3).floatingMask, 0xf0);
  assert.throws(() => machine().setPortInput(3, 0), /CP3/);
});

test('CP3 PA, PB and six-bit PC map to external ports 4, 3 and 5', () => {
  const cp1 = machine({ expansion: true });
  cp1.writeCpuPort(2, 0x9f);
  cp1.writeExternal(0, 0x0d);
  cp1.writeExternal(1, 0x82);
  cp1.writeExternal(3, 0xff);
  cp1.setPortInput(3, 0x55);
  assert.equal(cp1.readExternal(2), 0x55);
  assert.equal(cp1.getPortState(4).value, 0x82);
  assert.equal(cp1.getPortState(5).value, 0x3f);
  assert.equal(cp1.getPortState(5).width, 6);
  assert.equal(cp1.getPortState(3).direction, 'input');
  assert.throws(() => cp1.setPortInput(5, 0x80), RangeError);
});

test('display integrates simulated time, reverses hardware digit order, and models the fixed separator', () => {
  const cp1 = machine();
  baseIO(cp1);
  cp1.writeExternal(1, 0x01);
  cp1.writeExternal(3, 0x37); // PC3 selected: third visible digit, with fixed separator.
  cp1.advanceCycles(100);
  let display = cp1.getDisplay();
  assert.equal(display.digits[2], 0x81);
  assert.equal(display.hardwareDuty[3][0], 1);
  assert.equal(display.hardwareDuty[3][7], 1);
  cp1.writeExternal(1, 0x80); // PA7 is disconnected, not a CPU-driven decimal point.
  cp1.advanceCycles(100);
  display = cp1.getDisplay();
  assert.equal(display.hardwareDuty[3][0], 0.5);
  assert.equal(display.hardwareDuty[3][7], 1);
  assert.equal(display.rawDigits[2], 0x80);
  const before = cp1.saveState();
  for (let i = 0; i < 20; i++) cp1.getDisplay();
  assert.deepEqual(cp1.saveState(), before);
  cp1.writeExternal(3, 0x3f);
  cp1.advanceCycles(16000);
  assert.deepEqual(cp1.getDisplay().digits, [0, 0, 0, 0, 0, 0]);
});

test('instruction and advance budgets preserve one elapsed-time counter; reset does not erase RAM', () => {
  const cp1 = machine();
  cp1.writeCell(0, 7, 14);
  const result = cp1.advanceCycles(100, { maxInstructions: 3 });
  assert.equal(result.cycles, 6);
  assert.equal(result.reached, false);
  cp1.advanceToMs(1);
  assert.equal(cp1.cycles, 400);
  cp1.reset();
  assert.equal(cp1.cycles, 400);
  assert.deepEqual(cp1.readCell(0), { opcode: 7, operand: 14 });
  assert.equal(cp1.cpu.cycles, 0);
  cp1.step();
  assert.equal(cp1.cycles, 402);
  cp1.powerCycle();
  assert.equal(cp1.cycles, 402);
  assert.deepEqual(cp1.readCell(0), { opcode: 0, operand: 0 });
  assert.throws(() => cp1.advanceCycles(-1), RangeError);
});

test('machine snapshots restore all components and reject wrong ROM, topology, and malformed display without mutation', () => {
  const cp1 = machine({ expansion: true });
  baseIO(cp1);
  cp1.writeExternal(1, 0x5b);
  cp1.writeExternal(3, 0x3d);
  cp1.setKey('STEP', true);
  cp1.setPortInput(3, 0x51, 0x7f);
  cp1.writeCell(255, 2, 9);
  cp1.advanceCycles(50);
  const state = cp1.saveState();
  const expectedSnapshot = cp1.snapshot();
  cp1.advanceCycles(50);
  cp1.releaseKeys();
  cp1.loadState(state);
  assert.deepEqual(cp1.snapshot(), expectedSnapshot);
  assert.deepEqual(cp1.saveState(), state);
  for (const change of [
    s => { s.romSha1 = 'wrong'; },
    s => { s.expansion = false; },
    s => { s.cpu.rom[0] = 0; },
    s => { s.expansionChip.ram[255] = 256; },
    s => { s.display.drive.segments = 0x7f; },
    s => { s.keys.push('UNKNOWN:0'); },
  ]) {
    const bad = structuredClone(state);
    change(bad);
    assert.throws(() => cp1.loadState(bad));
    assert.deepEqual(cp1.saveState(), state);
  }
  const snapshot = cp1.snapshot();
  snapshot.cells[255].operand = 0;
  snapshot.display.duty[0][0] = 123;
  assert.equal(cp1.readCell(255).operand, 9);
  assert.notEqual(cp1.getDisplay().duty[0][0], 123);
});

test('adapter publishes every pin after advancing the same board timeline and samples released input pins', () => {
  const cp1 = machine({ expansion: true });
  cp1.advanceCycles(20);
  const adapter = createCp1Adapter({ machine: cp1 });
  const events = [];
  const board = {
    advanceTo(time) { events.push(['time', time]); },
    setPin(pin, mode, high) { events.push(['pin', pin, mode, high]); },
    readPin(pin) { return pin === 'P1.0' ? 0 : 1; },
  };
  adapter.attachBoard(board);
  assert.equal(adapter.machine, cp1);
  assert.equal(cp1.cycles, 20, 'attaching must not secretly reset the running machine');
  assert.equal(cp1.readCpuPort(1), 0xfe);
  assert.equal(adapter.unloggedBoardInputs(), true);
  assert.ok(events.some(event => event[0] === 'pin' && event[1] === 'P1.0' && event[2] === 'quasi' && event[3]));
  assert.ok(events.some(event => event[0] === 'pin' && event[1] === 'P5.5'));
  assert.ok(!events.some(event => event[0] === 'pin' && event[1] === 'P5.6'));
  let lastTime = -1n;
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    if (event[0] === 'time') { assert.ok(event[1] >= lastTime); lastTime = event[1]; }
    else assert.equal(events[i - 1][0], 'time');
  }
  adapter.advanceNs(100000);
  assert.equal(adapter.timeNs(), BigInt(Math.round(cp1.tMs * 1e6)));
  adapter.detachBoard();
  assert.equal(adapter.unloggedBoardInputs(), false);
});

test('adapter scheduling credit makes subinstruction chunks independent of rendering frequency', () => {
  const split = createCp1Adapter({ rom: rom() });
  const whole = createCp1Adapter({ rom: rom() });
  for (let i = 0; i < 100; i++) split.advanceNs(100);
  whole.advanceNs(10000);
  assert.equal(split.timeNs(), whole.timeNs());
  assert.equal(split.machine.cycles, 4);
  const before = split.timeNs();
  split.snapshot(); split.machine.getDisplay();
  assert.equal(split.timeNs(), before);
  split.machine.step(); // Explicit debugger step uses the same CPU.
  split.advanceNs(5000);
  assert.equal(split.machine.cycles, 8);
});
