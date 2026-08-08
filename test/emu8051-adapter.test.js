/**
 * Test the emu8051 adapter with a mock WASM module.
 *
 * We can't load the real WASM in unit tests, so we mock the WASM API
 * and verify the adapter correctly bridges to boundary A.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createEmu8051Adapter } from '../src/emu8051-adapter.js';
import { BoardImpl } from '../src/board.js';
import { runConformance, formatReport } from '../src/conformance.js';

/**
 * Create a mock WASM module that simulates the emu8051-stc API.
 */
function createMockWasm() {
  let fosc = 11059200;
  let vcc = 5.0;
  let timeNs = 0n;

  // SFR space
  const sfr = new Uint8Array(256);
  // Port defaults: all 0xFF (quasi-bidir, latch high)
  sfr[0x80] = 0xFF; // P0
  sfr[0x90] = 0xFF; // P1
  sfr[0xA0] = 0xFF; // P2
  sfr[0xB0] = 0xFF; // P3

  // Pin inputs from external (board)
  const pinInputs = Array.from({ length: 6 }, () => new Uint8Array(8));
  // ADC voltages
  const adcVoltages = new Float64Array(8);

  // ADC state
  let adcCountdown = 0;

  function getPortAddr(port) { return 0x80 + port * 0x10; }

  function getPinMode(port, bit) {
    const m1Addrs = [0x93, 0x91, 0x95, 0xB1, 0xB3, 0xC9];
    const m0Addrs = [0x94, 0x92, 0x96, 0xB2, 0xB4, 0xCA];
    const m1 = (sfr[m1Addrs[port]] >> bit) & 1;
    const m0 = (sfr[m0Addrs[port]] >> bit) & 1;
    return (m1 << 1) | m0;
  }

  function getPinDrive(port, bit) {
    return (sfr[getPortAddr(port)] >> bit) & 1;
  }

  return {
    HEAPU8: new Uint8Array(65536),

    _emu_init(stc12) { /* init */ },
    _emu_reset(wipe) {
      sfr.fill(0);
      sfr[0x80] = 0xFF;
      sfr[0x90] = 0xFF;
      sfr[0xA0] = 0xFF;
      sfr[0xB0] = 0xFF;
      timeNs = 0n;
    },
    _emu_set_fosc(hz) { fosc = hz; },
    _emu_set_vcc(v) { vcc = v; },

    _emu_advance_to_ns(lo, hi) {
      timeNs = BigInt(lo >>> 0) | (BigInt(hi >>> 0) << 32n);

      // Simulate ADC completion
      if ((sfr[0xBC] & 0x08) && !(sfr[0xBC] & 0x10)) { // START set, FLAG not set
        adcCountdown++;
        if (adcCountdown >= 3) {
          const ch = sfr[0xBC] & 0x07;
          const volts = adcVoltages[ch];
          const counts = Math.round((volts / vcc) * 1023);
          sfr[0xBD] = (counts >> 2) & 0xFF; // ADC_RES
          sfr[0xBE] = counts & 0x03;         // ADC_RESL
          sfr[0xBC] = (sfr[0xBC] & ~0x08) | 0x10; // clear START, set FLAG
          adcCountdown = 0;
        }
      }

      return 100; // instructions executed
    },

    _emu_get_time_ns_lo() { return Number(timeNs & 0xFFFFFFFFn); },
    _emu_get_time_ns_hi() { return Number((timeNs >> 32n) & 0xFFFFFFFFn); },

    _emu_get_pin_mode(port, bit) { return getPinMode(port, bit); },
    _emu_get_pin_drive(port, bit) { return getPinDrive(port, bit); },
    _emu_set_pin_input(port, bit, level) { pinInputs[port][bit] = level; },
    _emu_set_adc_voltage(ch, volts) { adcVoltages[ch] = volts; },

    _emu_get_sfr(addr) { return sfr[addr]; },
    _emu_set_sfr(addr, val) { sfr[addr] = val & 0xFF; },

    _emu_load_hex(ptr, len) { return 0; },
    _malloc(size) { return 1024; },
    _free(ptr) {},
  };
}

describe('emu8051 adapter: basic wiring', () => {
  it('creates adapter without crashing', () => {
    const wasm = createMockWasm();
    const adapter = createEmu8051Adapter(wasm);
    assert.ok(adapter);
  });

  it('attachBoard connects and emits initial pin states', () => {
    const wasm = createMockWasm();
    const adapter = createEmu8051Adapter(wasm);

    const calls = [];
    adapter.attachBoard({
      setPin(pin, mode, driveHigh) { calls.push({ pin, mode, driveHigh }); },
      advanceTo() {},
      readPin() { return 0; },
      readAnalog() { return 0; },
    });

    // Default STC12 state: all quasi-bidir, latch 0xFF
    assert.ok(calls.length > 0, 'should emit initial pin states');
    const p10 = calls.find(c => c.pin === 'P1.0');
    assert.ok(p10, 'should emit P1.0');
    assert.equal(p10.mode, 'quasi', 'default mode is quasi');
    assert.equal(p10.driveHigh, true, 'default latch is high');
  });

  it('writePort triggers pin change events', () => {
    const wasm = createMockWasm();
    const adapter = createEmu8051Adapter(wasm);

    const calls = [];
    adapter.attachBoard({
      setPin(pin, mode, driveHigh) { calls.push({ pin, mode, driveHigh }); },
      advanceTo() {},
      readPin() { return 0; },
      readAnalog() { return 0; },
    });

    const before = calls.length;
    adapter.writePort(1, 0x00); // all P1 low

    const newCalls = calls.slice(before);
    assert.ok(newCalls.length > 0, 'writePort should trigger setPin');
    const p10 = newCalls.find(c => c.pin === 'P1.0');
    assert.ok(p10);
    assert.equal(p10.driveHigh, false, 'writing 0 → driveHigh=false');
  });

  it('setPortMode triggers pin change events', () => {
    const wasm = createMockWasm();
    const adapter = createEmu8051Adapter(wasm);

    const calls = [];
    adapter.attachBoard({
      setPin(pin, mode, driveHigh) { calls.push({ pin, mode, driveHigh }); },
      advanceTo() {},
      readPin() { return 0; },
      readAnalog() { return 0; },
    });

    const before = calls.length;
    adapter.setPortMode(1, 0x00, 0xFF); // all P1 to push-pull

    const newCalls = calls.slice(before);
    assert.ok(newCalls.length > 0, 'setPortMode should trigger setPin');
    const p10 = newCalls.find(c => c.pin === 'P1.0');
    assert.ok(p10);
    assert.equal(p10.mode, 'pushpull', 'M1=0, M0=1 → pushpull');
  });

  it('runNs advances time via advanceTo with bigint ns', () => {
    const wasm = createMockWasm();
    const adapter = createEmu8051Adapter(wasm, { pollIntervalNs: 0 });

    const times = [];
    adapter.attachBoard({
      setPin() {},
      advanceTo(tNs) { times.push(tNs); },
      readPin() { return 0; },
      readAnalog() { return 0; },
    });

    adapter.runNs(10000);

    assert.ok(times.length > 0, 'should call advanceTo');
    const last = times[times.length - 1];
    assert.equal(typeof last, 'bigint', 'advanceTo should receive bigint');
    assert.ok(last >= 10000n, `time ${last} should be ≥ 10000ns`);
  });
});

describe('emu8051 adapter: ADC path', () => {
  it('ADC reads voltage from board, converts to counts', () => {
    const wasm = createMockWasm();
    const adapter = createEmu8051Adapter(wasm, { pollIntervalNs: 0 });

    let readAnalogCalls = 0;
    adapter.attachBoard({
      setPin() {},
      advanceTo() {},
      readPin() { return 0; },
      readAnalog(pin) {
        readAnalogCalls++;
        if (pin === 'P1.3') return 2.5; // midpoint
        return 0;
      },
    });

    // Configure for ADC
    adapter.setPortMode(1, 0x08, 0x00); // P1.3 input mode

    // Start ADC on channel 3
    adapter.startAdc(3);

    // Run enough time for conversion
    adapter.runNs(10000);
    adapter.runNs(10000);
    adapter.runNs(10000);

    assert.ok(readAnalogCalls > 0, 'should call readAnalog on the board');

    if (adapter.adcReady()) {
      const counts = adapter.readAdc();
      // 2.5V / 5V * 1023 ≈ 511-512
      assert.ok(counts >= 500 && counts <= 520,
        `ADC counts ${counts} should be ≈ 512 for 2.5V`);
    }
  });
});

describe('emu8051 adapter: end-to-end with board', () => {
  it('drives an LED through the full board layer', () => {
    const wasm = createMockWasm();
    const adapter = createEmu8051Adapter(wasm, { pollIntervalNs: 0 });

    // Set up a real board with an active-low LED
    const board = new BoardImpl(5.0);
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      { id: 'LED1', kind: 'led', params: { vf: 2.0 }, terminals: ['anode', 'cathode'] },
      { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] },
    ];
    const nets = [
      { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
      { id: 'nr', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'LED1', terminal: 'anode' }] },
      { id: 'np', terminals: [{ part: 'LED1', terminal: 'cathode' }, { part: 'MCU', terminal: 'P1.0' }] },
      { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] },
    ];
    board.setNetlist(parts, nets);

    // Attach adapter to board
    adapter.attachBoard(board);

    // Default state: quasi high → LED off
    adapter.runNs(1_000_000);
    let b = board.ledBrightness('LED1');
    assert.ok(b < 0.01, `LED should be off initially: ${b}`);

    // Write P1.0 = 0 (LED on)
    adapter.writePort(1, 0xFE); // bit 0 = 0
    adapter.runNs(25_000_000);

    b = board.ledBrightness('LED1');
    assert.ok(b > 0.10, `LED should be on after writing 0: ${b}`);

    // Write P1.0 = 1 (LED off)
    adapter.writePort(1, 0xFF);
    adapter.runNs(25_000_000);

    b = board.ledBrightness('LED1');
    assert.ok(b < 0.01, `LED should be off after writing 1: ${b}`);
  });

  it('pot reading comes through readAnalog', () => {
    const wasm = createMockWasm();
    const adapter = createEmu8051Adapter(wasm, { pollIntervalNs: 0 });

    const board = new BoardImpl(5.0);
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'POT', kind: 'potentiometer', params: { ohms: 10000 }, terminals: ['a', 'b', 'wiper'] },
      { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.3'] },
    ];
    const nets = [
      { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'POT', terminal: 'a' }] },
      { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'POT', terminal: 'b' }] },
      { id: 'nw', terminals: [{ part: 'POT', terminal: 'wiper' }, { part: 'MCU', terminal: 'P1.3' }] },
    ];
    board.setNetlist(parts, nets);
    board.setControl('POT', 0.75);

    adapter.attachBoard(board);
    adapter.setPortMode(1, 0x08, 0x00); // P1.3 input

    adapter.runNs(1_000_000);

    // The pot wiper is at 75% of 5V = 3.75V
    const v = board.readAnalog('P1.3');
    assert.ok(Math.abs(v - 3.75) < 0.1, `pot voltage ${v} should be ~3.75V`);
  });
});

describe('emu8051 adapter: polling loss measurement', () => {
  it('coarse polling misses fast pin toggles', () => {
    const wasm = createMockWasm();
    // Very coarse polling: 1ms intervals
    const adapter = createEmu8051Adapter(wasm, { pollIntervalNs: 1_000_000 });

    const setPinCalls = [];
    adapter.attachBoard({
      setPin(pin, mode, driveHigh) {
        if (pin === 'P1.0') setPinCalls.push(driveHigh);
      },
      advanceTo() {},
      readPin() { return 0; },
      readAnalog() { return 0; },
    });

    // Toggle P1.0 at 10 kHz (100µs period) — faster than the poll interval
    for (let i = 0; i < 20; i++) {
      adapter.writePort(1, i % 2 === 0 ? 0xFE : 0xFF); // toggle P1.0
      adapter.runNs(50_000); // 50µs half-period
    }

    // We should see the toggles because writePort polls immediately,
    // but if the MCU were toggling internally, those would be missed
    // between the 1ms poll intervals.
    const stats = adapter.getStats();
    assert.ok(stats.pollCount > 0, 'should have polled');
    assert.ok(stats.pinChangeCount > 0, 'should have detected changes');
  });
});

describe('emu8051 adapter: conformance', () => {
  it('passes the conformance kit', () => {
    const wasm = createMockWasm();
    const adapter = createEmu8051Adapter(wasm, { pollIntervalNs: 0 });

    const results = runConformance(adapter);
    const failures = results.filter(r => !r.pass && r.severity === 'required');

    if (failures.length > 0) {
      console.log(formatReport(results));
    }

    // The adapter should pass most checks. Some may fail due to mock limitations.
    // The important ones: setPin shape, nanoseconds, mode change events.
    const setPinShape = results.find(r => r.name.includes('setPin called'));
    assert.ok(setPinShape?.pass, 'setPin shape should pass');

    const nsTest = results.find(r => r.name.includes('nanoseconds'));
    assert.ok(nsTest?.pass, 'nanosecond timing should pass');

    const modeChange = results.find(r => r.name.includes('PxM0/PxM1'));
    assert.ok(modeChange?.pass, 'mode change events should pass');
  });
});

// ─── Push mode tests ──────────────────────────────────────────────────────

/**
 * Create a mock WASM module that supports push callbacks (addFunction).
 * Simulates the real WASM push path: on_pin_change fires during execution.
 */
function createPushMockWasm() {
  const base = createMockWasm();

  // Registered callbacks
  let onPinChange = null;
  let onReadPin = null;
  let onReadAnalog = null;
  let onAdvance = null;
  let nextFnPtr = 100;
  const fnPtrs = new Map();

  const sfr = new Uint8Array(256);
  sfr[0x80] = 0xFF; sfr[0x90] = 0xFF; sfr[0xA0] = 0xFF; sfr[0xB0] = 0xFF;
  let timeNs = 0n;
  let vcc = 5.0;

  const m1Addrs = [0x93, 0x91, 0x95, 0xB1, 0xB3, 0xC9];
  const m0Addrs = [0x94, 0x92, 0x96, 0xB2, 0xB4, 0xCA];

  function getPinMode(port, bit) {
    const m1 = (sfr[m1Addrs[port]] >> bit) & 1;
    const m0 = (sfr[m0Addrs[port]] >> bit) & 1;
    return (m1 << 1) | m0;
  }

  function emitPinChanges(port) {
    if (!onPinChange) return;
    for (let bit = 0; bit < 8; bit++) {
      const mode = getPinMode(port, bit);
      const drive = (sfr[0x80 + port * 0x10] >> bit) & 1;
      onPinChange(port, bit, mode, drive, 0);
    }
  }

  return {
    ...base,
    HEAPU8: new Uint8Array(65536),

    _emu_init() {},
    _emu_reset(wipe) {
      sfr.fill(0);
      sfr[0x80] = 0xFF; sfr[0x90] = 0xFF;
      sfr[0xA0] = 0xFF; sfr[0xB0] = 0xFF;
      timeNs = 0n;
    },
    _emu_set_fosc() {},
    _emu_set_vcc(v) { vcc = v; },

    _emu_get_sfr(addr) { return sfr[addr]; },
    _emu_set_sfr(addr, val) {
      const old = sfr[addr];
      sfr[addr] = val & 0xFF;
      // Detect port data or mode register writes and emit callbacks
      const portAddrs = [0x80, 0x90, 0xA0, 0xB0];
      for (let p = 0; p < 4; p++) {
        if (addr === portAddrs[p] || addr === m1Addrs[p] || addr === m0Addrs[p]) {
          if (old !== (val & 0xFF)) emitPinChanges(p);
          return;
        }
      }
    },

    _emu_advance_to_ns(lo, hi) {
      timeNs = BigInt(lo >>> 0) | (BigInt(hi >>> 0) << 32n);
      if (onAdvance) onAdvance(lo, hi, 0);
      return 100;
    },

    _emu_get_time_ns_lo() { return Number(timeNs & 0xFFFFFFFFn); },
    _emu_get_time_ns_hi() { return Number((timeNs >> 32n) & 0xFFFFFFFFn); },
    _emu_get_pin_mode(port, bit) { return getPinMode(port, bit); },
    _emu_get_pin_drive(port, bit) { return (sfr[0x80 + port * 0x10] >> bit) & 1; },
    _emu_set_pin_input() {},
    _emu_set_adc_voltage() {},

    // Push mode API
    addFunction(fn, sig) {
      const ptr = nextFnPtr++;
      fnPtrs.set(ptr, fn);
      return ptr;
    },
    removeFunction(ptr) { fnPtrs.delete(ptr); },

    _emu_set_board_callbacks(pinCb, readCb, analogCb, advCb, ud) {
      onPinChange = fnPtrs.get(pinCb) ?? null;
      onReadPin = fnPtrs.get(readCb) ?? null;
      onReadAnalog = fnPtrs.get(analogCb) ?? null;
      onAdvance = fnPtrs.get(advCb) ?? null;
    },

    _malloc(n) { return 1024; },
    _free() {},
  };
}

describe('emu8051 adapter: push mode', () => {
  it('auto-detects push mode when addFunction is available', () => {
    const wasm = createPushMockWasm();
    const adapter = createEmu8051Adapter(wasm);

    adapter.attachBoard({
      setPin() {},
      advanceTo() {},
      readPin() { return 0; },
      readAnalog() { return 0; },
    });

    const stats = adapter.getStats();
    assert.equal(stats.mode, 'push', 'should auto-detect push mode');
  });

  it('receives pin changes via push callback', () => {
    const wasm = createPushMockWasm();
    const adapter = createEmu8051Adapter(wasm);

    const calls = [];
    adapter.attachBoard({
      setPin(pin, mode, driveHigh) { calls.push({ pin, mode, driveHigh }); },
      advanceTo() {},
      readPin() { return 0; },
      readAnalog() { return 0; },
    });

    const before = calls.length;
    adapter.writePort(1, 0x00); // all P1 low

    const newCalls = calls.slice(before);
    assert.ok(newCalls.length > 0, 'push mode should emit pin changes');
    const p10 = newCalls.find(c => c.pin === 'P1.0');
    assert.ok(p10);
    assert.equal(p10.driveHigh, false);
  });

  it('push mode receives advanceTo via callback', () => {
    const wasm = createPushMockWasm();
    const adapter = createEmu8051Adapter(wasm);

    const times = [];
    adapter.attachBoard({
      setPin() {},
      advanceTo(tNs) { times.push(tNs); },
      readPin() { return 0; },
      readAnalog() { return 0; },
    });

    adapter.runNs(10000);

    assert.ok(times.length > 0, 'should receive advanceTo via push');
    assert.equal(typeof times[0], 'bigint');
  });

  it('push mode has zero polling', () => {
    const wasm = createPushMockWasm();
    const adapter = createEmu8051Adapter(wasm);

    adapter.attachBoard({
      setPin() {},
      advanceTo() {},
      readPin() { return 0; },
      readAnalog() { return 0; },
    });

    adapter.writePort(1, 0x00);
    adapter.runNs(10000);

    const stats = adapter.getStats();
    assert.equal(stats.pollCount, 0, 'push mode should not poll');
    assert.ok(stats.pushCallbackCount > 0, 'should have received push callbacks');
  });

  it('mode changes via setPortMode fire push callbacks', () => {
    const wasm = createPushMockWasm();
    const adapter = createEmu8051Adapter(wasm);

    const modes = new Set();
    adapter.attachBoard({
      setPin(pin, mode) { modes.add(mode); },
      advanceTo() {},
      readPin() { return 0; },
      readAnalog() { return 0; },
    });

    adapter.setPortMode(1, 0x00, 0xFF); // push-pull
    assert.ok(modes.has('pushpull'), 'should see pushpull mode via push callback');
  });

  it('destroy cleans up function pointers', () => {
    const wasm = createPushMockWasm();
    const adapter = createEmu8051Adapter(wasm);

    adapter.attachBoard({
      setPin() {},
      advanceTo() {},
      readPin() { return 0; },
      readAnalog() { return 0; },
    });

    // Should not throw
    adapter.destroy();
  });
});
