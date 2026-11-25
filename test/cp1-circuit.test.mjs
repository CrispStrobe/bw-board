// SPDX-License-Identifier: MIT
// Actual BoardImpl/solver integration with original, synthetic 8049 firmware.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';
import { getDevice } from '../src/devices.js';
import { CP1_TERMINALS } from '../src/devices/cp1.js';
import { createCp1Adapter } from '../src/cp1-adapter.js';
import { extractCp1Machine } from '../src/cp1-extract.js';

registerAllDevices();

function connector(expansion = false) {
  return { id: 'trainer', kind: 'kosmos-cp1', params: { expansion }, terminals: [...CP1_TERMINALS] };
}

function echoFirmware() {
  const bytes = new Uint8Array(2048);
  bytes.set([
    0x23, 0xaf, // MOV A,#AF: base I/O, release reset, release keyboard pins
    0x3a,       // OUTL P2,A
    0xb8, 0x00, // MOV R0,#00: command register
    0x23, 0x0f, // MOV A,#0F: PA/PB/PC outputs
    0x90,       // MOVX @R0,A
    0xb8, 0x02, // MOV R0,#02: external port 2, base PB
    0x09,       // IN A,P1: sample the real switch network
    0x90,       // MOVX @R0,A: drive the real resistor/LED network
    0x04, 0x0a, // JMP input loop
  ]);
  return bytes;
}

function echoCircuit() {
  return {
    parts: [
      connector(),
      { id: 'series', kind: 'resistor', params: { ohms: 330 }, terminals: ['a', 'b'] },
      { id: 'lamp', kind: 'led', params: { vf: 2, color: 'red' }, terminals: ['anode', 'cathode'] },
      { id: 'contact', kind: 'switch', params: { closed: false }, terminals: ['a', 'b'] },
    ],
    nets: [
      { id: 'out', terminals: [{ part: 'trainer', terminal: 'P2.0' }, { part: 'series', terminal: 'a' }] },
      { id: 'led', terminals: [{ part: 'series', terminal: 'b' }, { part: 'lamp', terminal: 'anode' }] },
      { id: 'ground', terminals: [{ part: 'trainer', terminal: 'gnd' }, { part: 'contact', terminal: 'b' }, { part: 'lamp', terminal: 'cathode' }] },
      { id: 'input', terminals: [{ part: 'trainer', terminal: 'P1.0' }, { part: 'contact', terminal: 'a' }] },
    ],
  };
}

test('CP1 connector declares 38 GPIO terminals, six-bit P5, and real 5 V / ground supply drives', () => {
  const model = getDevice('kosmos-cp1');
  assert.equal(model.gpioFollowsPinStates, true);
  assert.equal(CP1_TERMINALS.length, 40);
  assert.ok(CP1_TERMINALS.includes('P5.5'));
  assert.ok(!CP1_TERMINALS.includes('P5.6'));
  const board = new BoardImpl(5);
  board.setNetlist([
    connector(),
    { id: 'r', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
  ], [
    { id: 'supply', terminals: [{ part: 'trainer', terminal: '5v' }, { part: 'r', terminal: 'a' }] },
    { id: 'ground', terminals: [{ part: 'trainer', terminal: 'gnd' }, { part: 'r', terminal: 'b' }] },
  ]);
  assert.ok(board.nodeVoltage('supply') > 4.99);
  assert.ok(board.nodeVoltage('ground') < 0.001);
  assert.ok(Math.abs(board.branchCurrent('r', 'a')) > 0.0049);
});

for (const qualified of [false, true]) {
  test(`real ${qualified ? 'part-qualified' : 'bare'} CP1 pins connect switch → firmware → resistor → LED on one timeline`, () => {
    const circuit = echoCircuit();
    const board = new BoardImpl(5);
    board.setNetlist(circuit.parts, circuit.nets);
    const edges = [];
    const times = [];
    const originalSetPin = board.setPin.bind(board);
    const originalAdvance = board.advanceTo.bind(board);
    board.advanceTo = time => { times.push(time); return originalAdvance(time); };
    board.setPin = (pin, mode, high) => { edges.push({ pin, mode, high, time: board.timeNs }); return originalSetPin(pin, mode, high); };
    const adapter = createCp1Adapter({ rom: echoFirmware(), ...(qualified ? { partId: 'trainer' } : {}) });
    adapter.attachBoard(board);
    adapter.advanceNs(100000);
    const machine = adapter.machine;
    const outputName = qualified ? 'trainer.P2.0' : 'P2.0';
    assert.equal(machine.cpu.a, 0xff);
    assert.equal(machine.getPortState(2).value, 0xff);
    assert.equal(machine.getPortState(2).contentionMask, 0, 'stale pre-output input sample is not another physical driver');
    assert.equal(machine.getPortState(1).externalDrivenMask, 1, 'unwired input bits must remain released');
    assert.ok(board.nodeVoltage('input') > 4.9);
    assert.ok(board.nodeVoltage('out') > 4.5);
    assert.ok(board.ledBrightnessNow('lamp') > 0.3);
    assert.ok(Math.abs(board.branchCurrent('series', 'a')) > 0.006);
    const outputEdges = edges.filter(edge => edge.pin === outputName && edge.mode === 'pushpull');
    assert.deepEqual(outputEdges.slice(0, 2).map(({ high, time }) => [high, time]), [[false, 20000n], [true, 35000n]]);
    assert.equal(board.timeNs, adapter.timeNs());
    assert.equal(board.timeNs, 100000n);

    // The user can change the external switch while the CPU is paused.
    // The solver changes its input voltage; it does not secretly execute code.
    board.setControl('contact', 1);
    assert.ok(board.nodeVoltage('input') < 0.001);
    assert.equal(machine.cycles, 40);
    assert.equal(machine.snapshot().ports.P2.value, 0xff);
    assert.ok(board.ledBrightnessNow('lamp') > 0.3);
    adapter.advanceNs(100000);
    assert.equal(machine.cpu.a, 0xfe);
    assert.equal(machine.getPortState(2).value, 0xfe);
    assert.ok(board.nodeVoltage('out') < 0.001);
    assert.equal(board.ledBrightnessNow('lamp'), 0);
    assert.equal(board.timeNs, adapter.timeNs());

    board.setControl('contact', 0);
    adapter.advanceNs(100000);
    assert.equal(machine.cpu.a, 0xff);
    assert.equal(machine.getPortState(2).value, 0xff);
    assert.ok(board.ledBrightnessNow('lamp') > 0.3);
    for (let i = 1; i < times.length; i++) assert.ok(times[i] >= times[i - 1]);
    const count = times.length;
    const at = board.timeNs;
    machine.snapshot(); machine.getDisplay();
    assert.equal(times.length, count);
    assert.equal(board.timeNs, at);
    assert.match(adapter.capabilities.electricalPinModel, /not calibrated NMOS/);
  });
}

test('unwired and singleton CP1 input nets stay released, including after circuit rewiring', () => {
  const circuit = echoCircuit();
  circuit.parts[0].params.expansion = true;
  circuit.nets.push({ id: 'isolated', terminals: [{ part: 'trainer', terminal: 'P1.1' }] });
  const board = new BoardImpl(5);
  board.setNetlist(circuit.parts, circuit.nets);
  const adapter = createCp1Adapter({ rom: echoFirmware(), partId: 'trainer', expansion: true });
  adapter.attachBoard(board);
  board.setControl('contact', 1);
  adapter.advanceNs(100000);
  assert.equal(adapter.machine.getPortState(1).value, 0xfe);
  assert.equal(adapter.machine.getPortState(1).externalDrivenMask, 1);
  assert.equal(adapter.machine.getPortState(3).value, 0xff);
  assert.equal(adapter.machine.getPortState(3).floatingMask, 0xff);
  board.setNetlist(circuit.parts, circuit.nets.filter(net => net.id !== 'input'));
  adapter.advanceNs(100000);
  assert.equal(adapter.machine.getPortState(1).value, 0xff);
  assert.equal(adapter.machine.getPortState(1).externalDrivenMask, 0);
});

test('a fresh CP1 adopts an already-running board clock without double advancement or reset rewind', () => {
  const circuit = echoCircuit();
  const board = new BoardImpl(5);
  board.setNetlist(circuit.parts, circuit.nets);
  board.advanceTo(100000000n);
  const calls = [];
  const edges = [];
  const advance = board.advanceTo.bind(board);
  const setPin = board.setPin.bind(board);
  board.advanceTo = at => {
    assert.ok(at >= board.timeNs, 'the adapter must never ask an existing board to move backwards');
    calls.push(at);
    return advance(at);
  };
  board.setPin = (pin, mode, high) => {
    edges.push({ pin, mode, high, at: board.timeNs });
    return setPin(pin, mode, high);
  };
  const adapter = createCp1Adapter({ rom: echoFirmware(), partId: 'trainer' });
  adapter.attachBoard(board);
  assert.equal(adapter.timeNs(), 0n, 'debugger time remains relative to this machine');
  assert.equal(adapter.machine.cycles, 0, 'adoption does not invent execution to catch up');
  assert.equal(board.timeNs, 100000000n);
  assert.ok(calls.every(at => at === 100000000n));

  // This is the runner's boardTimeBase convention: board minus target.
  const runnerBaseNs = board.timeNs - adapter.timeNs();
  adapter.advanceNs(100000);
  assert.equal(adapter.timeNs(), 100000n);
  assert.equal(board.timeNs, 100100000n);
  assert.deepEqual(edges.filter(edge => edge.pin === 'trainer.P2.0' && edge.mode === 'pushpull')
    .slice(0, 2).map(({ high, at }) => [high, at]), [[false, 100020000n], [true, 100035000n]]);
  const beforeRunnerPublish = board.timeNs;
  board.advanceTo(adapter.timeNs() + runnerBaseNs);
  assert.equal(board.timeNs, beforeRunnerPublish, 'runner publication must not add the offset twice');
  assert.ok(board.ledBrightnessNow('lamp') > 0.3);

  adapter.reset();
  assert.equal(adapter.timeNs(), 100000n);
  assert.equal(board.timeNs, 100100000n);
  assert.equal(adapter.machine.cpu.cycles, 0);
  adapter.advanceNs(100000);
  assert.equal(adapter.timeNs(), 200000n);
  assert.equal(board.timeNs, 100200000n);

  // A paused runner can return ownership to the designer before restarting.
  board.advanceTo(150000000n);
  adapter.reset();
  assert.equal(adapter.timeNs(), 200000n);
  assert.equal(board.timeNs, 150000000n);
  const restartedBaseNs = board.timeNs - adapter.timeNs();
  adapter.advanceNs(100000);
  assert.equal(board.timeNs, 150100000n);
  board.advanceTo(adapter.timeNs() + restartedBaseNs);
  assert.equal(board.timeNs, 150100000n);

  // Teardown/configuration changes create a new relative-time lifetime.
  adapter.detachBoard();
  const replacement = createCp1Adapter({ rom: echoFirmware(), partId: 'trainer', expansion: true });
  replacement.attachBoard(board);
  assert.equal(replacement.timeNs(), 0n);
  assert.equal(board.timeNs, 150100000n);
  replacement.advanceNs(100000);
  assert.equal(replacement.timeNs(), 100000n);
  assert.equal(board.timeNs, 150200000n);
});

function connectedCircuit(terminal, nested, expansion, reverse = false) {
  const cp = { part: 'trainer', terminal };
  const r = { part: 'r', terminal: 'a' };
  const from = reverse ? r : cp;
  const to = reverse ? cp : r;
  const wire = nested ? { from, to } : { from: from.part, fromTerminal: from.terminal, to: to.part, toTerminal: to.terminal };
  return {
    parts: [connector(expansion), { id: 'r', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] }],
    wires: [wire],
  };
}

test('CP1 extraction handles flat and nested wire endpoints in either direction and preserves the machine identity', () => {
  for (const nested of [false, true]) for (const reverse of [false, true]) {
    const circuit = connectedCircuit('P2.0', nested, false, reverse);
    const before = structuredClone(circuit);
    const extracted = extractCp1Machine(circuit);
    assert.equal(extracted.ok, true);
    assert.equal(extracted.kind, 'cp1');
    assert.deepEqual(extracted.config, { expansion: false, clockHz: 6000000, partId: 'trainer' });
    assert.deepEqual(circuit, before, 'extraction must not rewrite the user circuit');
  }
});

test('base machines reject CP3 pins for both wire formats, either endpoint, casing, and netlists', () => {
  for (const terminal of ['P3.0', 'P4.7', 'P5.5', 'p3.2']) {
    for (const nested of [false, true]) for (const reverse of [false, true]) {
      const result = extractCp1Machine(connectedCircuit(terminal, nested, false, reverse));
      assert.equal(result.ok, false);
      assert.ok(result.reasons.includes('Ports 3, 4 and 5 require the CP3 expansion.'));
    }
  }
  const result = extractCp1Machine({ parts: [connector(false)], nets: [
    { id: 'n', terminals: [{ part: 'trainer', terminal: 'P3.0' }] },
  ] });
  assert.equal(result.ok, false);
  assert.match(result.reasons.join(' '), /CP3/);
});

test('CP3 extraction accepts only existing physical pins and never invents P5 bits 6 or 7', () => {
  for (const terminal of ['P1.7', 'P2.7', 'P3.7', 'P4.7', 'P5.5', '5v', 'gnd']) {
    const result = extractCp1Machine(connectedCircuit(terminal, true, true));
    assert.equal(result.ok, true, terminal);
    assert.equal(result.config.expansion, true);
  }
  for (const terminal of ['P5.6', 'P5.7', 'P2.8', 'P0.0', 'P6.0', 'PA0', '']) {
    const result = extractCp1Machine(connectedCircuit(terminal, false, true));
    assert.equal(result.ok, false, terminal);
    assert.match(result.reasons.join(' '), /Unknown Kosmos CP1 terminal/);
  }
});

test('CP1 extraction rejects missing/duplicate CPUs, mixed controllers, unsupported clock, and nonboolean expansion', () => {
  assert.equal(extractCp1Machine(null).ok, false);
  assert.equal(extractCp1Machine({ parts: [connector(), { ...connector(), id: 'second' }] }).ok, false);
  for (const kind of ['mcu', 'z80', 'arduino_uno']) {
    const result = extractCp1Machine({ parts: [connector(), { id: 'other', kind }] });
    assert.equal(result.ok, false, kind);
    assert.match(result.reasons.join(' '), /another computer/);
  }
  const invalid = connector(); invalid.params.clockHz = 12000000;
  assert.match(extractCp1Machine({ parts: [invalid] }).reasons.join(' '), /6 MHz/);
  invalid.params.clockHz = 6000000; invalid.params.expansion = 'false';
  assert.match(extractCp1Machine({ parts: [invalid] }).reasons.join(' '), /true or false/);
});
