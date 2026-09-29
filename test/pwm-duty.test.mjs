/**
 * PWM DUTY REACHES THE CIRCUIT — LED average current, DC motor speed and
 * servo angle follow the program's duty cycle, on every route that drives
 * pins.
 *
 * Two kinds of route exist, and this file holds both to the SAME numbers:
 *
 *  1. Emulated timers (avr8js OCR1A, rp2040js PWM slices) publish their own
 *     edges through setPin at the right board time. That already worked; it
 *     is held here from REAL PROGRAMS so the duty stays honoured: Arduino's
 *     `analogWrite(9, K)` exactly as wiring.c programs Timer1 on an Uno, a
 *     Servo-style Timer1 mode-14 frame, and a bare-metal Pico program writing
 *     the PWM slice registers (what the SDK's pwm_set_wrap / pwm_set_chan_level
 *     / pwm_set_enabled write).
 *
 *  2. Hosts with no cycle-level timer (the Scratch VM drivers, the MakeCode
 *     simulator bridge, the micro:bit+ extension) can only say "this pin is at
 *     25 %". Before setPwm() they either dropped it (the stc12 JS driver
 *     guards on `b.setPwm`, which no board had) or drove on/off at half scale
 *     (`pct >= 50`), so a 25 % LED was DARK and a 75 % LED was FULL ON.
 *     setPwm() makes the board switch the pin itself — measured below to give
 *     the emulated routes' numbers.
 *
 * Programs are hand-assembled from their avr-gcc / arm-none-eabi-gcc output
 * (source quoted beside each), so no toolchain is needed to run this file.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { createAvr8jsAdapter } from '../src/avr8js-adapter.js';
import { createRp2040jsAdapter } from '../src/rp2040js-adapter.js';
import { registerAllDevices } from '../src/register-all.js';

registerAllDevices();

const MS = 1_000_000n;
const LED_I_RATED = 0.02; // ledBrightness() is average current / 20 mA

// ─── benches ────────────────────────────────────────────────────────────────

/** pin → 220 Ω → red LED → GND: the canonical analogWrite dimmer. */
function ledBench(pin, vcc) {
  const board = new BoardImpl(vcc);
  board.setNetlist([
    { id: 'mcu', kind: 'mcu', params: { pins: [pin] }, terminals: [pin] },
    { id: 'r1', kind: 'resistor', params: { ohms: 220 }, terminals: ['a', 'b'] },
    { id: 'led1', kind: 'led', params: { vf: 2.0, color: 'red' }, terminals: ['anode', 'cathode'] },
    { id: 'g', kind: 'gnd', params: {}, terminals: ['gnd'] },
  ], [
    { id: 'n1', terminals: [{ part: 'mcu', terminal: pin }, { part: 'r1', terminal: 'a' }] },
    { id: 'n2', terminals: [{ part: 'r1', terminal: 'b' }, { part: 'led1', terminal: 'anode' }] },
    { id: 'n3', terminals: [{ part: 'led1', terminal: 'cathode' }, { part: 'g', terminal: 'gnd' }] },
  ]);
  board.setPower(true);
  return board;
}

/** pin → DC motor → GND (default winding: 10 Ω, kV 0.01, J 0.001). */
function motorBench(pin, vcc) {
  const board = new BoardImpl(vcc);
  board.setNetlist([
    { id: 'mcu', kind: 'mcu', params: { pins: [pin] }, terminals: [pin] },
    { id: 'm1', kind: 'dc_motor', params: {}, terminals: ['a', 'b'] },
    { id: 'g', kind: 'gnd', params: {}, terminals: ['gnd'] },
  ], [
    { id: 'n1', terminals: [{ part: 'mcu', terminal: pin }, { part: 'm1', terminal: 'a' }] },
    { id: 'n2', terminals: [{ part: 'm1', terminal: 'b' }, { part: 'g', terminal: 'gnd' }] },
  ]);
  board.setPower(true);
  return board;
}

/** pin → servo signal, servo powered from VCC. */
function servoBench(pin, vcc, awayFrom) {
  const board = new BoardImpl(vcc);
  board.setNetlist([
    { id: 'mcu', kind: 'mcu', params: { pins: [pin] }, terminals: [pin] },
    { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
    { id: 's1', kind: 'servo', params: {}, terminals: ['signal', 'vcc', 'gnd'] },
    { id: 'g', kind: 'gnd', params: {}, terminals: ['gnd'] },
  ], [
    { id: 'n1', terminals: [{ part: 'mcu', terminal: pin }, { part: 's1', terminal: 'signal' }] },
    { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 's1', terminal: 'vcc' }] },
    { id: 'n2', terminals: [{ part: 's1', terminal: 'gnd' }, { part: 'g', terminal: 'gnd' }] },
  ]);
  board.setPower(true);
  // Start the servo AWAY from the angle under test (it powers up at 90°), so
  // an angle that is reached only because nothing decoded a pulse — a pin
  // stuck high or low — cannot pass: without decoded pulses it stays away.
  board.setDeviceControl('s1', 'angle', awayFrom <= 90 ? 180 : 0);
  return board;
}

/**
 * The LED's AVERAGE current, independent of window phase: ledBrightness() is
 * a 20 ms window, and at a carrier whose period does not divide 20 ms (the
 * Uno's 490 Hz) one reading is off by up to period/20 ms of full-on depending
 * on where the window starts. Averaging readings taken at 40 instants spread
 * over 200 ms, at a step incommensurate with the carrier, removes that phase
 * term and leaves the duty average.
 */
function averageLedMa(board, runTo) {
  let sum = 0;
  const n = 40;
  for (let i = 0; i < n; i++) {
    runTo(200n * MS + BigInt(i) * 4_999_937n);
    sum += board.ledBrightness('led1') * LED_I_RATED * 1000;
  }
  return sum / n;
}

// ─── programs ───────────────────────────────────────────────────────────────

/** LDI r24/r25, K (1110 KKKK dddd KKKK, d = Rd - 16). */
const ldi = (rd, k) => 0xE000 | ((k & 0xF0) << 4) | ((rd - 16) << 4) | (k & 0x0F);
/** STS addr, r24/r25 (1001 001r rrrr 0000, then the address word). */
const sts = (addr, rr) => [0x9200 | (rr << 4), addr];

/**
 * `analogWrite(9, k)` on an Uno, as the Arduino core does it:
 *   init():      TCCR1B = CS11|CS10 (clk/64), TCCR1A = WGM10 (phase-correct 8-bit)
 *   pinMode:     DDRB |= 1<<PB1
 *   analogWrite: TCCR1A |= COM1A1; OCR1A = k
 * → 16 MHz / 64 / 510 = 490.196 Hz, duty k/255 on D9. Encodings are
 * avr-gcc -Os's for exactly that sequence (with the read-modify-write folded).
 */
function avrAnalogWrite9(k) {
  return new Uint16Array([
    ldi(24, 0x03), ...sts(0x81, 24),       // TCCR1B = 3
    ldi(24, 0x01), ...sts(0x80, 24),       // TCCR1A = WGM10
    0x9A21,                                // SBI DDRB,1
    ldi(24, 0x81), ...sts(0x80, 24),       // TCCR1A = COM1A1|WGM10
    ldi(24, k), ldi(25, 0), ...sts(0x89, 25), ...sts(0x88, 24), // OCR1A = k (high byte first)
    0xCFFF,                                // RJMP .-2
  ]);
}

/**
 * A Servo frame on D9: Timer1 mode 14 (fast PWM, TOP = ICR1), clk/8 = 0.5 µs
 * ticks, ICR1 = 39999 → 20 ms (50 Hz), OCR1A = 2 × pulse µs, COM1A1.
 */
function avrServo9(pulseUs) {
  const ocr = pulseUs * 2;
  return new Uint16Array([
    0x9A21,                                           // SBI DDRB,1
    ldi(24, 0x3F), ldi(25, 0x9C), ...sts(0x87, 25), ...sts(0x86, 24), // ICR1 = 39999
    ldi(24, ocr & 0xFF), ldi(25, ocr >> 8), ...sts(0x89, 25), ...sts(0x88, 24), // OCR1A
    ldi(24, 0x82), ...sts(0x80, 24),                  // TCCR1A = COM1A1|WGM11
    ldi(24, 0x1A), ...sts(0x81, 24),                  // TCCR1B = WGM13|WGM12|CS11
    0xCFFF,
  ]);
}

function runAvr(program, board) {
  const a = createAvr8jsAdapter({ program });
  a.attachBoard(board);
  let now = 0n;
  return (tNs) => { if (tNs > now) { a.advanceNs(Number(tNs - now)); now = tNs; } };
}

/**
 * Bare-metal Pico, loaded to SRAM, parameters read from 0x20001000:
 *
 *   RESETS clear (io_bank0|pads_bank0|pwm), wait RESET_DONE
 *   IO_BANK0 GPIO0_CTRL = 4 (PWM: slice 0 channel A)
 *   PWM CH0_DIV = [0x20001000]; CH0_TOP = [0x20001004]; CH0_CC = [0x20001008]
 *   PWM CH0_CSR = EN; for (;;) wfi
 *
 * arm-none-eabi-gcc -mcpu=cortex-m0plus -mthumb -O2, linked at 0x20000000.
 * WFI lets the adapter jump alarm to alarm, so a second of PWM is cheap.
 */
const PICO_PWM = new Uint16Array([
  0xe000, 0x46c0, 0x4a0e, 0x4b0f, 0x0011, 0x480f, 0x601a, 0x6803, 0x4013, 0x428b,
  0xd1fb, 0x2204, 0x4b0c, 0x601a, 0x4b0c, 0x681a, 0x4b0c, 0x601a, 0x4b0c, 0x681a,
  0x4b0c, 0x601a, 0x4b0c, 0x681a, 0x4b0c, 0x601a, 0x2201, 0x4b0c, 0x601a, 0xbf30,
  0xe7fd, 0x46c0, 0x4120, 0x0000, 0xf000, 0x4000, 0xc008, 0x4000, 0x4004, 0x4001,
  0x1000, 0x2000, 0x0004, 0x4005, 0x1004, 0x2000, 0x0010, 0x4005, 0x1008, 0x2000,
  0x000c, 0x4005, 0x0000, 0x4005,
]);

/** Pico slice 0 A on GP0: clk_sys / div counts 0..top, high while counter < cc. */
function runPico(board, { div, top, cc }) {
  const a = createRp2040jsAdapter({ clockHz: 125_000_000, vcc: 3.3 });
  a.attachBoard(board);
  a.loadProgram(PICO_PWM);
  a.rp2040.writeUint32(0x20001000, div << 4);  // DIV.INT (8.4 fixed point)
  a.rp2040.writeUint32(0x20001004, top);
  a.rp2040.writeUint32(0x20001008, cc);
  let now = 0n;
  return (tNs) => { if (tNs > now) { a.advanceNs(Number(tNs - now)); now = tNs; } };
}

/** The host route: setPwm, and the board's own clock (the designer's advanceBy). */
function runDriven(board, pin, percent, opts) {
  assert.equal(board.setPwm(pin, percent, opts), true);
  return (tNs) => board.advanceTo(tNs);
}

// ─── LED: average current follows duty ──────────────────────────────────────

/** Full-on current of the bench, measured, not assumed. */
function fullOnMa(pin, vcc) {
  const b = ledBench(pin, vcc);
  b.setPin(pin, 'pushpull', true);
  b.advanceTo(40n * MS);
  return b.ledBrightness('led1') * LED_I_RATED * 1000;
}

describe('LED average current follows duty', () => {
  const full5 = fullOnMa('D9', 5);
  const full33 = fullOnMa('GP0', 3.3);

  it('bench full-on is a real LED current, not a clamp', () => {
    assert.ok(full5 > 11 && full5 < 14, `5 V full-on ${full5} mA`);
    assert.ok(full33 > 5 && full33 < 7, `3.3 V full-on ${full33} mA`);
  });

  for (const k of [0, 32, 64, 128, 191, 255]) {
    it(`AVR analogWrite(9, ${k}) → ${(k / 255 * 100).toFixed(1)} % of full-on`, () => {
      const board = ledBench('D9', 5);
      const ma = averageLedMa(board, runAvr(avrAnalogWrite9(k), board));
      const want = full5 * k / 255;
      assert.ok(Math.abs(ma - want) <= 0.01 * full5,
        `analogWrite(9, ${k}): ${ma.toFixed(4)} mA, want ${want.toFixed(4)} mA (±1 % of full-on)`);
    });
  }

  for (const cc of [0, 100, 250, 500, 750, 1000]) {
    it(`Pico PWM slice CC=${cc}/TOP=999 at 1 kHz → ${cc / 10} % of full-on`, () => {
      const board = ledBench('GP0', 3.3);
      const ma = averageLedMa(board, runPico(board, { div: 125, top: 999, cc }));
      const want = full33 * Math.min(1, cc / 1000);
      assert.ok(Math.abs(ma - want) <= 0.005 * full33,
        `CC=${cc}: ${ma.toFixed(4)} mA, want ${want.toFixed(4)} mA (±0.5 % of full-on)`);
    });
  }

  for (const pct of [0, 10, 25, 50, 75, 100]) {
    it(`setPwm(D9, ${pct}) → ${pct} % of full-on, one window read, no phase error at 500 Hz`, () => {
      const board = ledBench('D9', 5);
      const run = runDriven(board, 'D9', pct);
      for (let t = 50n; t <= 1000n; t += 50n) run(t * MS); // the designer's 50 ms tick
      const ma = board.ledBrightness('led1') * LED_I_RATED * 1000;
      const want = full5 * pct / 100;
      // 2 ms divides the 20 ms window: the reading is the exact duty average.
      assert.ok(Math.abs(ma - want) <= 0.001 * full5,
        `setPwm ${pct} %: ${ma.toFixed(4)} mA, want ${want.toFixed(4)} mA`);
    });
  }

  it('setPwm and the emulated AVR timer agree at the same duty and carrier', () => {
    const k = 64;
    const avr = ledBench('D9', 5);
    const viaAvr = averageLedMa(avr, runAvr(avrAnalogWrite9(k), avr));
    const host = ledBench('D9', 5);
    const viaHost = averageLedMa(host, runDriven(host, 'D9', k / 255 * 100, { hz: 16e6 / 64 / 510 }));
    assert.ok(Math.abs(viaAvr - viaHost) <= 0.01 * full5,
      `AVR ${viaAvr.toFixed(4)} mA vs setPwm ${viaHost.toFixed(4)} mA`);
  });

  it('BEFORE: the half-scale on/off rule every duty-blind host used is wrong in the middle', () => {
    // micro:bit+ analogwrite and the MakeCode bridge drove `pct >= 50`. Held
    // here as the measured "before" for the record: 25 % read 0 mA, 75 % full.
    for (const [pct, want] of [[25, 0], [75, full5]]) {
      const b = ledBench('D9', 5);
      b.setPin('D9', 'pushpull', pct >= 50);
      b.advanceTo(100n * MS);
      assert.ok(Math.abs(b.ledBrightness('led1') * 20 - want) < 0.01);
    }
  });
});

// ─── DC motor: speed follows duty ───────────────────────────────────────────

describe('DC motor speed follows duty', () => {
  /** ω after `sec` of drive, relative to 100 % on the same route. */
  function omegaAfter(bench, run, sec) {
    for (let t = 50n; t <= BigInt(sec * 1000); t += 50n) run(t * MS);
    return bench.getDeviceState('m1').omega;
  }

  it('AVR analogWrite(9, k): ω ∝ k/255', () => {
    const w = {};
    for (const k of [0, 64, 128, 255]) {
      const b = motorBench('D9', 5);
      w[k] = omegaAfter(b, runAvr(avrAnalogWrite9(k), b), 0.3);
    }
    assert.ok(w[255] > 0.3, `full speed ${w[255]} rad/s`);
    assert.equal(w[0], 0);
    for (const k of [64, 128]) {
      assert.ok(Math.abs(w[k] / w[255] - k / 255) < 0.02,
        `k=${k}: ω ratio ${(w[k] / w[255]).toFixed(4)}, want ${(k / 255).toFixed(4)}`);
    }
  });

  it('Pico PWM slice: ω ∝ CC/(TOP+1)', () => {
    const w = {};
    for (const cc of [250, 500, 1000]) {
      const b = motorBench('GP0', 3.3);
      w[cc] = omegaAfter(b, runPico(b, { div: 125, top: 999, cc }), 0.3);
    }
    assert.ok(w[1000] > 0.2, `full speed ${w[1000]} rad/s`);
    for (const cc of [250, 500]) {
      assert.ok(Math.abs(w[cc] / w[1000] - cc / 1000) < 0.02,
        `CC=${cc}: ω ratio ${(w[cc] / w[1000]).toFixed(4)}`);
    }
  });

  it('setPwm: ω ∝ duty, and agrees with the AVR timer at the same duty', () => {
    const w = {};
    for (const pct of [0, 25, 50, 100]) {
      const b = motorBench('D9', 5);
      w[pct] = omegaAfter(b, runDriven(b, "D9", pct), 0.3);
    }
    for (const pct of [25, 50]) {
      assert.ok(Math.abs(w[pct] / w[100] - pct / 100) < 0.02,
        `${pct} %: ω ratio ${(w[pct] / w[100]).toFixed(4)}`);
    }
    const avr = motorBench('D9', 5);
    const wAvr = omegaAfter(avr, runAvr(avrAnalogWrite9(128), avr), 0.3);
    const host = motorBench('D9', 5);
    const wHost = omegaAfter(host, runDriven(host, 'D9', 128 / 255 * 100, { hz: 16e6 / 64 / 510 }), 0.3);
    assert.ok(Math.abs(wAvr - wHost) / wAvr < 0.02, `AVR ω ${wAvr} vs setPwm ω ${wHost}`);
  });
});

// ─── Servo: angle follows pulse width ───────────────────────────────────────

describe('servo angle follows pulse width', () => {
  const cases = [[500, 0], [1000, 45], [1500, 90], [2500, 180]];

  for (const [us, deg] of cases) {
    it(`AVR Timer1 mode 14, ${us} µs pulse → ${deg}°`, () => {
      const b = servoBench('D9', 5, deg);
      const run = runAvr(avrServo9(us), b);
      for (let t = 100n; t <= 1000n; t += 100n) run(t * MS);
      assert.ok(Math.abs(b.getDeviceState('s1').actualAngle - deg) < 0.5,
        `${us} µs: ${b.getDeviceState('s1').actualAngle}°`);
    });

    it(`Pico slice at 1 MHz count, TOP=19999 (50 Hz), CC=${us} → ${deg}°`, () => {
      const b = servoBench('GP0', 3.3, deg);
      const run = runPico(b, { div: 125, top: 19999, cc: us });
      for (let t = 100n; t <= 1000n; t += 100n) run(t * MS);
      assert.ok(Math.abs(b.getDeviceState('s1').actualAngle - deg) < 0.5,
        `${us} µs: ${b.getDeviceState('s1').actualAngle}°`);
    });

    it(`setPwm(D9, _, {hz: 50, pulseUs: ${us}}) → ${deg}°`, () => {
      const b = servoBench('D9', 5, deg);
      const run = runDriven(b, 'D9', 0, { hz: 50, pulseUs: us });
      for (let t = 100n; t <= 1000n; t += 100n) run(t * MS);
      assert.ok(Math.abs(b.getDeviceState('s1').actualAngle - deg) < 0.5,
        `${us} µs: ${b.getDeviceState('s1').actualAngle}°`);
    });
  }
});

// ─── setPwm contract ────────────────────────────────────────────────────────

describe('setPwm contract', () => {
  it('reports the driven PWM, and a direct setPin takes the pin back', () => {
    const b = ledBench('D9', 5);
    b.setPwm('D9', 25);
    assert.deepEqual(b.getPwm('d9'), { duty: 0.25, hz: 500 });
    b.advanceTo(50n * MS);
    b.setPin('D9', 'pushpull', false);          // digitalWrite(9, LOW)
    assert.equal(b.getPwm('D9'), null);
    b.advanceTo(100n * MS);
    assert.equal(b.ledBrightness('led1'), 0, 'no edges after the direct write');
  });

  it('the same PWM written again keeps its phase (a loop re-issuing analogWrite)', () => {
    const once = ledBench('D9', 5);
    once.setPwm('D9', 25);
    const again = ledBench('D9', 5);
    again.setPwm('D9', 25);
    for (let t = 1n; t <= 40n; t++) {
      once.advanceTo(t * 777_777n);
      again.setPwm('D9', 25);
      again.advanceTo(t * 777_777n);
    }
    assert.equal(again.ledBrightness('led1'), once.ledBrightness('led1'));
  });

  it('0 % and 100 % are steady levels with no edges', () => {
    const b = ledBench('D9', 5);
    let edges = 0;
    b.onChange(e => { if (e.type === 'pin') edges++; });
    b.setPwm('D9', 100);
    b.advanceTo(100n * MS);
    b.setPwm('D9', 0);
    b.advanceTo(200n * MS);
    assert.equal(edges, 2, 'one level per setPwm, nothing in between');
  });

  it('survives snapshot/restore (the designer restores around every edit)', () => {
    const b = ledBench('D9', 5);
    b.setPwm('D9', 50);
    b.advanceTo(30n * MS);
    const snap = b.snapshot();
    b.restore(snap);
    b.advanceTo(80n * MS);
    assert.deepEqual(b.getPwm('D9'), { duty: 0.5, hz: 500 });
    assert.ok(Math.abs(b.ledBrightness('led1') - 0.5 * fullOnMa('D9', 5) / 20) < 0.002);
  });

  it('refuses a non-number rather than guessing, and says so', () => {
    const b = ledBench('D9', 5);
    assert.equal(b.setPwm('D9', 'bright'), false);
    assert.equal(b.getPwm('D9'), null);
    assert.ok(b.getWarnings().some(w => /pwm/i.test(JSON.stringify(w))), JSON.stringify(b.getWarnings()));
  });
});
