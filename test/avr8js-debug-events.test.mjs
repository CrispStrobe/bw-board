// AVR boundary-D event production against the real avr8js instruction and
// peripheral implementations. Flash words are hand assembled so the oracle
// does not depend on a host compiler.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAvr8jsAdapter } from '../src/avr8js-adapter.js';
import { createAvr8jsDebugTarget } from '../src/avr8js-debug.js';
import { createTWIBridge } from '../src/twi-bridge.js';

const ldiR16 = value => 0xe000 | ((value & 0xf0) << 4) | (value & 0x0f);
const STS_R16 = 0x9300;

// LDI r16,0xa4; STS TWCR,r16. TWINT|TWSTA|TWEN asks the real AVRTWI
// peripheral to issue START from its zero-delay clock callback.
const TWI_START = new Uint16Array([ldiR16(0xa4), STS_R16, 0x00bc, 0x0000]);

// Enable master SPI, then transmit a5 through SPDR. The transfer completes
// after the real AVRSPI clock delay while subsequent NOPs retire.
const SPI_TX = new Uint16Array([
  ldiR16(0x50), STS_R16, 0x004c,
  ldiR16(0xa5), STS_R16, 0x004e,
  ...new Array(40).fill(0x0000),
]);

// LDI r16,0x5a; STS 0x0140,r16; LDS r17,0x0140; RJMP .-2 — a write and a read
// of SRAM, which produced NO facts at all before this target shared the
// adapter's instrument.
const SRAM_TOUCH = new Uint16Array([
  ldiR16(0x5a), STS_R16, 0x0140, 0x9100 | (17 << 4), 0x0140, 0xcfff,
]);

function debug(program) {
  const adapter = createAvr8jsAdapter({ program });
  const target = createAvr8jsDebugTarget(adapter);
  const events = [];
  const dispose = target.onDebugEvent(event => events.push(event));
  return { adapter, target, events, dispose };
}

test('real AVR TWI access is ordered immediately before its owning retire', () => {
  const adapter = createAvr8jsAdapter({ program: TWI_START });
  const target = createAvr8jsDebugTarget(adapter);
  const events = [];
  let listenerRan = false;
  let rawSawListenerRan = null;
  target.onDebugEvent(event => {
    events.push(event);
    if (event.kind === 'device') listenerRan = true;
  });
  // Registered after the target's adapter listener: this runs inside the raw
  // bridge callback. A device event published there would already have set the
  // flag; queuing keeps consumers outside the instruction window.
  adapter.onDeviceAccess(() => { rawSawListenerRan = listenerRan; });
  target.step('insn', 2);
  assert.equal(target.runFor(10_000), 'halted');

  // THE SEQUENCE GREW BY ONE, AND THAT IS THE POINT OF THE FOLD. The STS that
  // starts the TWI transaction is a WRITE, and until this target shared the
  // adapter's instrument nobody reported it: the debugger published retires and
  // bridge notifications and no data accesses at all. Measured before the fold,
  // this same fixture produced zero memory facts. The claim this test is NAMED
  // for — the device access lands immediately before its owning retire — is
  // asserted positionally below rather than by pinning the whole sequence, so
  // it keeps meaning what it says as the stream gets richer.
  assert.deepEqual(events.map(event => `${event.kind}/${event.phase}`), [
    'instruction/retire', 'memory/access', 'device/access', 'instruction/retire',
  ]);
  const deviceAt = events.findIndex(event => event.kind === 'device');
  assert.equal(events[deviceAt + 1]?.kind, 'instruction', 'device fact is directly before a retire');
  assert.equal(events[deviceAt + 1]?.phase, 'retire');
  assert.equal(rawSawListenerRan, false,
    'canonical device fact waited until the raw instruction-window callback returned');
  assert.deepEqual(events[deviceAt].device,
    { id: 'twi0', bus: 'twi', event: 'start' });
  // The write the device fact is ABOUT, now visible: TWCR at data 0xbc.
  const write = events.find(event => event.kind === 'memory');
  assert.deepEqual([write.memory.direction, write.memory.address, write.memory.value],
    ['write', 0xbc, 0xa4]);
  assert.equal(write.cause, 'instruction-access', 'the CPU issued this one');
  assert.equal(events[deviceAt].cause, 'peripheral-access', 'the bridge contributed that one');
  assert.equal(events[deviceAt].fidelity, 'reconstructed');
  assert.equal(events[deviceAt + 1].fidelity, 'recorded');
  assert.equal(events[deviceAt + 1].pcBefore, 2);
  assert.equal(events[deviceAt + 1].pcAfter, 6, 'STS is one two-word AVR instruction');
  assert.ok(events[deviceAt].time.ticks < events[deviceAt + 1].time.ticks,
    'reconstructed access carries the instruction-start time, retire the completion time');
  assert.equal(write.time.ticks, events[deviceAt].time.ticks,
    'both accesses of one instruction share its start time, whoever observed them');
});

test('real AVR SPI completion emits tx/rx fact before the following retire', () => {
  const { adapter, target, events } = debug(SPI_TX);
  let calls = 0;
  adapter.spiBridge.select({ onByte(value) { calls++; assert.equal(value, 0xa5); return 0x3c; } });
  target.step('insn', 45);
  assert.equal(target.runFor(100_000), 'halted');

  const at = events.findIndex(event => event.kind === 'device');
  assert.ok(at > 0, 'real AVRSPI clock completion emitted a device fact');
  assert.equal(events[at + 1]?.kind, 'instruction', 'device fact is directly before retire');
  assert.equal(events[at + 1]?.phase, 'retire');
  assert.deepEqual(events[at].device,
    { id: 'spi0', bus: 'spi', event: 'transfer', tx: 0xa5, rx: 0x3c });
  assert.equal(calls, 1, 'observation performs no second device read/transfer');
  assert.equal(adapter.cpu.data[0x4e], 0x3c, 'observer did not alter the AVR response');
});

test('an asynchronous SPI fact outside an instruction window is immediate and invents no retire', () => {
  const { adapter, events } = debug(new Uint16Array([0x0000]));
  adapter.cpu.data[0x4c] = 0x50; // enabled master; setup, not an instruction
  adapter.spiBridge.select({ onByte: () => 0x7e });
  adapter.spiBridge.onByte(0x19);
  adapter.cpu.cycles += adapter.spi.transferCycles;
  adapter.cpu.tick(); // fires the real scheduled completion outside target.runFor()

  assert.deepEqual(events.map(event => `${event.kind}/${event.phase}`), ['device/access']);
  assert.deepEqual(events[0].device,
    { id: 'spi0', bus: 'spi', event: 'transfer', tx: 0x19, rx: 0x7e });
});

test('device observation is disposable and cannot perturb a bridge transaction', () => {
  const adapter = createAvr8jsAdapter();
  let raw = 0;
  const unsubscribe = adapter.onDeviceAccess(() => { raw++; throw new Error('observer'); });
  const target = createAvr8jsDebugTarget(adapter);
  const events = [];
  const disposeDebug = target.onDebugEvent(event => events.push(event));

  assert.doesNotThrow(() => adapter.twiBridge.start(false));
  assert.equal(adapter.twi.status, 0x08, 'START completed despite throwing observer');
  assert.equal(raw, 1);
  assert.equal(events.length, 1, 'outside-window device notification was immediate');

  unsubscribe();
  disposeDebug();
  adapter.twiBridge.start(true);
  assert.equal(raw, 1, 'raw unsubscribe isolates later transactions');
  assert.equal(events.length, 1, 'debug unsubscribe isolates later transactions');
  target.destroy();

  const lifecycleTarget = createAvr8jsDebugTarget(adapter);
  const lifecycleEvents = [];
  lifecycleTarget.onDebugEvent(event => lifecycleEvents.push(event));
  lifecycleTarget.detach();
  adapter.twiBridge.start(false);
  assert.deepEqual(lifecycleEvents, [],
    'detaching the target removes its adapter observation subscription');
});

test('TWI facts describe the completed transaction without extra device calls', () => {
  const completions = [];
  const facts = [];
  const twi = {
    completeStart: () => completions.push('start'),
    completeStop: () => completions.push('stop'),
    completeConnect: ack => completions.push(`connect:${ack}`),
    completeWrite: ack => completions.push(`write:${ack}`),
    completeRead: value => completions.push(`read:${value}`),
  };
  const bridge = createTWIBridge(twi, { onAccess: fact => facts.push(fact) });
  let addressCalls = 0;
  let writeCalls = 0;
  let readCalls = 0;
  bridge.devices = [{
    onAddress(address, rw) { addressCalls++; return address === 0x50 && rw === 0; },
    onWriteByte(value) { writeCalls++; return value === 0xde; },
    onReadByte() { readCalls++; return 0x42; },
  }];
  bridge.start(false);
  bridge.connectToSlave(0x50, true);
  bridge.writeByte(0xde);
  bridge.readByte(false);
  bridge.stop();

  assert.deepEqual(completions,
    ['start', 'connect:true', 'write:true', 'read:66', 'stop']);
  assert.deepEqual(facts, [
    { id: 'twi0', bus: 'twi', event: 'start' },
    { id: 'twi0', bus: 'twi', event: 'address', address: 0x50,
      direction: 'write', acknowledged: true },
    { id: 'twi0', bus: 'twi', event: 'write', value: 0xde, acknowledged: true },
    { id: 'twi0', bus: 'twi', event: 'read', value: 0x42, acknowledged: false },
    { id: 'twi0', bus: 'twi', event: 'stop' },
  ]);
  assert.deepEqual([addressCalls, writeCalls, readCalls], [1, 1, 1],
    'fact reconstruction performs no device operation of its own');

  const throwing = createTWIBridge(twi, { onAccess() { throw new Error('observer'); } });
  assert.doesNotThrow(() => throwing.start(false),
    'a bridge observer cannot perturb the already-completed transaction');
});

test('and the declaration is checked against a DRIVEN stream, not against itself', () => {
  // A capabilities list is a claim about behaviour, and until this test nothing
  // compared the two. `memory` was missing from the declaration for as long as
  // this target published no memory facts — correct then, wrong the moment it
  // shared the adapter's instrument. Comparing the list to a real run is the
  // only version of this assertion that notices.
  const adapter = createAvr8jsAdapter({ program: SRAM_TOUCH });
  const target = createAvr8jsDebugTarget(adapter);
  const seen = [];
  target.onDebugEvent(event => seen.push(event));
  adapter.spiBridge.select({ onByte: () => 0x3c });
  target.run();
  target.runFor(50_000);

  const produced = [...new Set(seen.map(event => event.kind))].sort();
  const declared = [...target.capabilities().events].sort();
  for (const kind of produced) {
    assert.ok(declared.includes(kind),
      `the target published ${kind} facts and does not declare them: ${declared}`);
  }
  assert.ok(produced.includes('memory'),
    'the fixture must actually touch memory, or this proves nothing');
});

test('capabilities claim exactly the event kinds this target actually produces', () => {
  const { target } = debug(new Uint16Array([0x0000]));
  const caps = target.capabilities();
  assert.deepEqual(caps.events, ['instruction', 'device', 'memory']);
  assert.deepEqual(caps.extensions,
    { eventBreakpointBoundary: 'instruction-retire' });
  assert.equal(caps.eventKinds, undefined,
    'there is one canonical source of event capability truth');
  assert.equal(caps.checkpoints, undefined);
  assert.equal(caps.reverse, undefined);
  assert.ok(!caps.steps.includes('cycle'));
});
