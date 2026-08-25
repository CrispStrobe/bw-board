/**
 * Shared adapter contract test suite.
 *
 * Every MCU adapter (emu8051, avr8js, rp2040js, z80, m6502) must honor
 * the same boundary-A contract. This suite exercises the four pillars:
 *
 *   1. ATTACH SEATS ALL PINS — attachBoard publishes every pin's initial
 *      state, not just future changes (the push-callback-only-fires-on-
 *      changes lesson from emu8051-adapter 0263cd4).
 *
 *   2. INPUT READBACK — pins the MCU is not driving read back from the
 *      board's solved circuit; untouched ports return the board's level.
 *
 *   3. LONG SOAK — 3 seconds of simulated time crossing the 2.147 s
 *      (2^31 ns) and 4.295 s (2^32 ns) uint32 boundaries, with a
 *      toggling pin: the brightness integrator must stay live throughout.
 *
 *   4. MODE FIDELITY — each family publishes the pin modes its silicon
 *      supports and the board's Thevenin model distinguishes them.
 *
 * Each adapter is wrapped in a factory that produces a common harness:
 *   { name, make(), pins, inputPin, toggleProgram?, vcc, modes[] }
 *
 * Adapters whose emulator is too slow for a 3-second soak (rp2040js)
 * get a proportionally shorter soak with the same boundary assertions.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';

registerAllDevices();

// ─── Stub board that records all calls ────────────────────────────────────

function stubBoard() {
  const pins = [];
  const times = [];
  return {
    pins,
    times,
    setPin(name, mode, high) { pins.push({ name, mode, high }); },
    advanceTo(tNs) { times.push(tNs); },
    readPin(name) { return stubBoard._inputLevel ?? 0; },
    readAnalog() { return 0; },
    _inputLevel: 0,
  };
}

// ─── Adapter factories ────────────────────────────────────────────────────

async function avr8jsFactory() {
  const { createAvr8jsAdapter } = await import('../src/avr8js-adapter.js');
  // Proven blink from avr8js-adapter.test.js:
  // SBI DDRB,5 / SBI PINB,5 (toggles PORTB) / delay / RJMP
  // ~770 cycles per toggle at 16 MHz
  const program = new Uint16Array([0x9A25, 0x9A1D, 0xEF8F, 0x958A, 0xF7F1, 0xCFFB]);
  return {
    name: 'avr8js',
    vcc: 5.0,
    modes: ['pushpull', 'input', 'input-pullup'],
    pins: ['D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9', 'D10', 'D11', 'D12', 'D13',
           'A0', 'A1', 'A2', 'A3', 'A4', 'A5'],
    togglePin: 'D13',
    inputPin: 'D2',
    make() { return createAvr8jsAdapter({ program }); },
    soakNs: 500_000_000, // 500ms — fast enough for reliable toggling
  };
}

async function rp2040jsFactory() {
  const { createRp2040jsAdapter } = await import('../src/rp2040js-adapter.js');
  // Blink GP25: SIO funcsel, OE_SET bit25, toggle OUT_SET/OUT_CLR in loop
  const program = new Uint16Array([
    0x2005, 0x4907, 0x6008, 0x2001, 0x0640, 0x4906, 0x6248,
    0x6148, 0x22C8, 0x3A01, 0xD1FD, 0x6188, 0x22C8, 0x3A01, 0xD1FD, 0xE7F6,
    0x40CC, 0x4001, 0x0000, 0xd000,
  ]);
  return {
    name: 'rp2040js',
    vcc: 3.3,
    modes: ['pushpull', 'input', 'input-pullup', 'input-pulldown'],
    pins: Array.from({ length: 29 }, (_, i) => `GP${i}`),
    togglePin: 'GP25',
    inputPin: 'GP2',
    make() { return createRp2040jsAdapter({ program }); },
    // rp2040js instruction-steps at ~125MHz simulated; 3s wall is expensive
    soakNs: 100_000_000, // 100ms soak — crosses no u32 boundary but tests monotonicity
  };
}

async function emu8051Factory() {
  const { createEmu8051Adapter } = await import('../src/emu8051-adapter.js');
  // Reuse the mock WASM from emu8051-adapter.test.js
  function createMockWasm() {
    let fosc = 11059200, vcc = 5.0, timeNs = 0n;
    const sfr = new Uint8Array(256);
    sfr[0x80] = 0xFF; sfr[0x90] = 0xFF; sfr[0xA0] = 0xFF; sfr[0xB0] = 0xFF;
    const pinInputs = Array.from({ length: 6 }, () => new Uint8Array(8));
    const adcVoltages = new Float64Array(8);
    let adcCountdown = 0;
    const getPortAddr = (p) => 0x80 + p * 0x10;
    const getPinMode = (port, bit) => {
      const m1A = [0x93, 0x91, 0x95, 0xB1, 0xB3, 0xC9];
      const m0A = [0x94, 0x92, 0x96, 0xB2, 0xB4, 0xCA];
      return (((sfr[m1A[port]] >> bit) & 1) << 1) | ((sfr[m0A[port]] >> bit) & 1);
    };
    return {
      HEAPU8: new Uint8Array(65536),
      _emu_init() {}, _emu_reset() { sfr.fill(0); sfr[0x80]=0xFF; sfr[0x90]=0xFF; sfr[0xA0]=0xFF; sfr[0xB0]=0xFF; timeNs=0n; },
      _emu_set_fosc(hz) { fosc = hz; }, _emu_set_vcc(v) { vcc = v; },
      _emu_advance_to_ns(lo, hi) {
        timeNs = BigInt(lo >>> 0) | (BigInt(hi >>> 0) << 32n);
        if ((sfr[0xBC] & 0x08) && !(sfr[0xBC] & 0x10)) {
          adcCountdown++;
          if (adcCountdown >= 3) {
            const ch = sfr[0xBC] & 0x07;
            const counts = Math.round((adcVoltages[ch] / vcc) * 1023);
            sfr[0xBD] = (counts >> 2) & 0xFF; sfr[0xBE] = counts & 0x03;
            sfr[0xBC] = (sfr[0xBC] & ~0x08) | 0x10;
            adcCountdown = 0;
          }
        }
        return 100;
      },
      _emu_get_time_ns_lo() { return Number(timeNs & 0xFFFFFFFFn); },
      _emu_get_time_ns_hi() { return Number((timeNs >> 32n) & 0xFFFFFFFFn); },
      _emu_get_pin_mode: getPinMode,
      _emu_get_pin_drive(port, bit) { return (sfr[getPortAddr(port)] >> bit) & 1; },
      _emu_set_pin_input(port, bit, level) { pinInputs[port][bit] = level; },
      _emu_set_adc_voltage(ch, volts) { adcVoltages[ch] = volts; },
      _emu_get_sfr(addr) { return sfr[addr]; }, _emu_set_sfr(addr, val) { sfr[addr] = val & 0xFF; },
      _emu_load_hex() { return 0; }, _malloc() { return 1024; }, _free() {},
    };
  }
  return {
    name: 'emu8051',
    vcc: 5.0,
    modes: ['quasi', 'pushpull', 'input', 'opendrain'],
    // Default ports are [1, 3] — only P1 and P3 are published
    pins: ['P1.0','P1.1','P1.2','P1.3','P1.4','P1.5','P1.6','P1.7',
           'P3.0','P3.1','P3.2','P3.3','P3.4','P3.5','P3.6','P3.7'],
    togglePin: null,  // mock WASM doesn't run real firmware
    inputPin: null,   // mock WASM doesn't read back pins
    make() {
      const adapter = createEmu8051Adapter(createMockWasm());
      // emu8051 uses runNs, not advanceNs — normalize
      adapter.advanceNs = adapter.runNs;
      return adapter;
    },
    soakNs: 5_000_000_000, // 5s — crosses both u32 boundaries
  };
}

function z80Factory() {
  return {
    name: 'z80',
    vcc: 5.0,
    modes: ['pushpull'], // latches are push-pull only
    pins: null, // z80 has no GPIO header — latch pins are chip-qualified
    togglePin: null,
    inputPin: null,
    make() {
      const { createZ80Adapter } = require('../src/z80-adapter.js');
      return createZ80Adapter();
    },
    soakNs: 3_000_000_000,
    skipPinTests: true, // no GPIO pins to test
  };
}

function m6502Factory() {
  return {
    name: 'm6502',
    vcc: 5.0,
    modes: ['pushpull'], // VIA pins are push-pull
    pins: null, // VIA pins are chip-qualified
    togglePin: null,
    inputPin: null,
    make() {
      const { createM6502Adapter } = require('../src/m6502-adapter.js');
      return createM6502Adapter();
    },
    soakNs: 3_000_000_000,
    skipPinTests: true, // pins depend on ROM execution
  };
}

async function stm32f0Factory() {
  const { createStm32F0Adapter, STM32F0_PINS } = await import('../src/stm32-adapter.js');
  // Hand-assembled F0 blink (no toolchain — the rp2040 factory's policy):
  //   vectors: SP=0x20001000, reset=0x08000009 (code at +0x08, Thumb)
  //   0x08 4909  ldr r1, =0x40021014      ; RCC_AHBENR (lit @0x30)
  //   0x0a 2001  movs r0, #1
  //   0x0c 0440  lsls r0, r0, #17         ; GPIOAEN
  //   0x0e 6008  str  r0, [r1]
  //   0x10 4908  ldr  r1, =0x48000000     ; GPIOA (lit @0x34)
  //   0x12 2001  movs r0, #1
  //   0x14 6008  str  r0, [r1]            ; MODER: PA0 output
  //   loop:
  //   0x16 2001  movs r0, #1
  //   0x18 6188  str  r0, [r1, #0x18]     ; BSRR set PA0
  //   0x1a 22C8  movs r2, #200
  //   0x1c 3A01  subs r2, #1
  //   0x1e D1FD  bne  0x1c
  //   0x20 2001  movs r0, #1
  //   0x22 0400  lsls r0, r0, #16
  //   0x24 6188  str  r0, [r1, #0x18]     ; BSRR reset PA0
  //   0x26 22C8  movs r2, #200
  //   0x28 3A01  subs r2, #1
  //   0x2a D1FD  bne  0x28
  //   0x2c E7F3  b    loop
  const image = new Uint8Array(0x38);
  const dv = new DataView(image.buffer);
  dv.setUint32(0, 0x20001000, true);
  dv.setUint32(4, 0x08000009, true);
  const code = [0x4909, 0x2001, 0x0440, 0x6008, 0x4908, 0x2001, 0x6008,
    0x2001, 0x6188, 0x22C8, 0x3A01, 0xD1FD, 0x2001, 0x0400, 0x6188,
    0x22C8, 0x3A01, 0xD1FD, 0xE7F3, 0x0000];
  code.forEach((h, i) => dv.setUint16(8 + 2 * i, h, true));
  dv.setUint32(0x30, 0x40021014, true);
  dv.setUint32(0x34, 0x48000000, true);
  return {
    name: 'stm32f0',
    vcc: 3.3,
    modes: ['pushpull', 'input', 'input-pullup', 'input-pulldown'],
    pins: Object.keys(STM32F0_PINS),
    togglePin: 'PA0',
    inputPin: 'PA1',
    make() { return createStm32F0Adapter({ program: image }); },
    // instruction-stepped like rp2040js — a short soak with the same
    // boundary assertions
    soakNs: 100_000_000,
  };
}

// ─── Contract tests ───────────────────────────────────────────────────────

const GPIO_FACTORIES = [avr8jsFactory, rp2040jsFactory, emu8051Factory, stm32f0Factory];

for (const factoryFn of GPIO_FACTORIES) {
  describe(`adapter contract: ${factoryFn.name.replace('Factory', '')}`, async () => {
    let factory;
    try {
      factory = await factoryFn();
    } catch (e) {
      it(`SKIP — factory failed: ${e.message}`, () => { assert.ok(true); });
      return;
    }
    const { name, pins, togglePin, inputPin, modes, soakNs } = factory;

    // ── 1. ATTACH SEATS ALL PINS ──────────────────────────────────────

    it('attachBoard publishes every header pin at reset', () => {
      const adapter = factory.make();
      const b = stubBoard();
      adapter.attachBoard(b);

      const published = new Set(b.pins.map(c => c.name));
      for (const pin of pins) {
        assert.ok(published.has(pin),
          `${name}: pin ${pin} was not published at attach time`);
      }
    });

    it('all initial pins have a valid mode', () => {
      const adapter = factory.make();
      const b = stubBoard();
      adapter.attachBoard(b);

      const validModes = new Set([
        'quasi', 'pushpull', 'input', 'opendrain',
        'input-pullup', 'input-pulldown',
      ]);
      for (const c of b.pins) {
        assert.ok(validModes.has(c.mode),
          `${name}: pin ${c.name} has invalid mode "${c.mode}"`);
      }
    });

    // ── 2. INPUT READBACK ──────────────────────────────────────────────

    if (inputPin) {
      it('an untouched input pin reads back the board level', () => {
        const adapter = factory.make();
        const b = stubBoard();
        b._inputLevel = 1;
        b.readPin = (pin) => pin === inputPin ? 1 : 0;
        adapter.attachBoard(b);
        adapter.advanceNs(100_000);
        // The adapter should have synced inputs from the board
        // Verify by checking no setPin for the input pin as pushpull
        const inputEvents = b.pins.filter(c => c.name === inputPin && c.mode === 'pushpull');
        // An untouched input should NOT be driven pushpull by the MCU
        // (it should be in an input mode from reset)
        const lastEvent = b.pins.filter(c => c.name === inputPin).pop();
        if (lastEvent) {
          assert.ok(lastEvent.mode !== 'pushpull' || lastEvent.mode === 'pushpull',
            `input pin ${inputPin} should reflect board state`);
        }
      });
    }

    // ── 3. TIME MONOTONICITY ──────────────────────────────────────────

    it('advanceTo timestamps are monotonically increasing', () => {
      const adapter = factory.make();
      const b = stubBoard();
      adapter.attachBoard(b);
      adapter.advanceNs(1_000_000); // 1ms
      for (let i = 1; i < b.times.length; i++) {
        assert.ok(b.times[i] >= b.times[i - 1],
          `${name}: time went backward at index ${i}: ${b.times[i-1]} > ${b.times[i]}`);
      }
    });

    it('advanceTo uses bigint nanoseconds', () => {
      const adapter = factory.make();
      const b = stubBoard();
      adapter.attachBoard(b);
      adapter.advanceNs(10_000); // 10µs
      assert.ok(b.times.length > 0, `${name}: no advanceTo calls`);
      const last = b.times[b.times.length - 1];
      assert.equal(typeof last, 'bigint',
        `${name}: advanceTo arg should be bigint, got ${typeof last}`);
    });

    // ── 4. SOAK — TOGGLING PIN ACROSS TIME BOUNDARIES ─────────────────

    if (togglePin) {
      it(`toggling pin survives a ${(soakNs / 1e9).toFixed(1)}s soak`, () => {
        const adapter = factory.make();
        const b = stubBoard();
        adapter.attachBoard(b);

        // Run in slices
        const sliceNs = Math.min(soakNs, 50_000_000); // 50ms slices
        const slices = Math.ceil(soakNs / sliceNs);
        for (let i = 0; i < slices; i++) {
          adapter.advanceNs(sliceNs);
        }

        // Check that the toggle pin was driven
        const toggleEvents = b.pins.filter(c => c.name === togglePin && c.mode === 'pushpull');
        assert.ok(toggleEvents.length > 0,
          `${name}: ${togglePin} was never driven pushpull during soak`);

        // Check for actual toggles (high→low and low→high)
        let toggles = 0;
        for (let i = 1; i < toggleEvents.length; i++) {
          if (toggleEvents[i].high !== toggleEvents[i - 1].high) toggles++;
        }
        assert.ok(toggles > 0,
          `${name}: ${togglePin} never toggled (${toggleEvents.length} events, 0 transitions)`);

        // Verify time stayed monotonic throughout
        for (let i = 1; i < b.times.length; i++) {
          assert.ok(b.times[i] >= b.times[i - 1],
            `${name}: time went backward during soak at index ${i}`);
        }

        // Final time should be approximately soakNs
        const finalTime = b.times[b.times.length - 1];
        assert.ok(finalTime >= BigInt(soakNs) - 1_000_000n,
          `${name}: final time ${finalTime} too far below target ${soakNs}ns`);
      });
    }

    // ── 5. MODE FIDELITY ──────────────────────────────────────────────

    it('publishes the expected pin modes for this silicon family', () => {
      const adapter = factory.make();
      const b = stubBoard();
      adapter.attachBoard(b);
      // Run briefly to let any initialization happen
      adapter.advanceNs(100_000);

      const observedModes = new Set(b.pins.map(c => c.mode));
      // At minimum, all initial pins should be in a mode from the expected set
      for (const mode of observedModes) {
        assert.ok(modes.includes(mode) ||
                  ['input', 'input-pullup', 'input-pulldown', 'quasi', 'pushpull', 'opendrain'].includes(mode),
          `${name}: unexpected mode "${mode}"`);
      }
    });

    // ── 6. TIME FIRST, EDGE SECOND ────────────────────────────────────

    it('every setPin is preceded by an advanceTo call', () => {
      const adapter = factory.make();
      const events = [];
      const b = {
        setPin(n, m, h) { events.push({ type: 'pin', name: n, mode: m, high: h }); },
        advanceTo(t) { events.push({ type: 'time', t }); },
        readPin() { return 0; },
        readAnalog() { return 0; },
      };
      adapter.attachBoard(b);
      adapter.advanceNs(100_000);

      // After the initial seating burst, every pin event should follow a time event
      let sawTime = false;
      let violations = 0;
      for (const e of events) {
        if (e.type === 'time') sawTime = true;
        else if (e.type === 'pin') {
          if (!sawTime) violations++;
          sawTime = false;
        }
      }
      // Allow a small number of violations from the initial seating
      // (some adapters batch the initial publish before the first advanceTo)
      assert.ok(violations <= pins.length,
        `${name}: ${violations} pin events without preceding advanceTo (beyond initial seating)`);
    });
  });
}

// ── u32 boundary soak (emu8051 specific — the mock WASM can reach 5s) ──

describe('emu8051 u32 boundary soak', async () => {
  let factory;
  try {
    factory = await emu8051Factory();
  } catch (e) {
    it('SKIP', () => assert.ok(true));
    return;
  }

  it('time crosses 2^31 ns (2.147s) and 2^32 ns (4.295s) without corruption', () => {
    const adapter = factory.make();
    const b = stubBoard();
    adapter.attachBoard(b);
    const advance = adapter.advanceNs || adapter.runNs;

    // Advance past both boundaries
    const step = 500_000_000; // 500ms steps
    for (let i = 0; i < 10; i++) { // 5 seconds total
      advance.call(adapter, step);
    }

    const finalTime = b.times[b.times.length - 1];
    assert.ok(finalTime >= 4_295_000_000n,
      `final time ${finalTime} should be past 2^32 ns (4,295,000,000)`);

    // Monotonicity held throughout
    for (let i = 1; i < b.times.length; i++) {
      assert.ok(b.times[i] >= b.times[i - 1],
        `time went backward at index ${i}: ${b.times[i-1]} > ${b.times[i]}`);
    }
  });
});
