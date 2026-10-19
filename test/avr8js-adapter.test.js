// The avr8js boundary-A adapter, proven against a HAND-ASSEMBLED program —
// no toolchain in the loop, every opcode computed from the AVR instruction
// set manual, so the oracle is arithmetic, not trust.
//
//   word  addr  instr           encoding
//   0     0x00  SBI DDRB,5      1001 1010 0010 0101 = 0x9A25  (DDRB=IO 0x04)
//   1     0x01  SBI PINB,5      1001 1010 0001 1101 = 0x9A1D  (write PINB toggles PORTB)
//   2     0x02  LDI r24,0xFF    1110 1111 1000 1111 = 0xEF8F
//   3     0x03  DEC r24         1001 0101 1000 1010 = 0x958A
//   4     0x04  BRNE .-2        1111 0111 1111 0001 = 0xF7F1  (back to DEC)
//   5     0x05  RJMP .-5        1100 1111 1111 1011 = 0xCFFB  (back to SBI PINB)
//
// Inner delay: 255 × (DEC 1cy + BRNE 2cy taken) ≈ 765 cycles, plus SBI(2) +
// LDI(1) + RJMP(2) ≈ 770 cycles per toggle → ~48 µs at 16 MHz → ~41 toggles
// in 2 ms. The assertion brackets that arithmetic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAvr8jsAdapter, ATMEGA328P_PINS } from '../src/avr8js-adapter.js';
import { BoardImpl as BoardImplRef } from '../src/board.js';

const BLINK = new Uint16Array([0x9A25, 0x9A1D, 0xEF8F, 0x958A, 0xF7F1, 0xCFFB]);

function stubBoard() {
  const calls = [];
  return {
    calls,
    setPin: (name, mode, high) => calls.push({ name, mode, high }),
    advanceTo: (tNs) => calls.push({ advanceTo: tNs }),
    readAnalog: () => 0,
  };
}

test('pin map: D13 is PB5, A0 is PC0 — the Arduino names the sidecar uses', () => {
  assert.deepEqual(ATMEGA328P_PINS.D13, { port: 'B', bit: 5 });
  assert.deepEqual(ATMEGA328P_PINS.A0, { port: 'C', bit: 0 });
  assert.deepEqual(ATMEGA328P_PINS.D0, { port: 'D', bit: 0 });
});

test('hand-assembled blink: D13 toggles push-pull at the computed rate', () => {
  const a = createAvr8jsAdapter({ program: BLINK });
  const b = stubBoard();
  a.attachBoard(b);
  a.advanceNs(2_000_000); // 2 ms simulated

  const d13 = b.calls.filter(c => c.name === 'D13' && c.mode === 'pushpull');
  assert.ok(d13.length > 0, 'D13 driven push-pull');
  // Count actual level CHANGES (the port listener publishes whole ports,
  // so consecutive same-level records are legal).
  let toggles = 0;
  for (let i = 1; i < d13.length; i++) if (d13[i].high !== d13[i - 1].high) toggles++;
  assert.ok(toggles >= 30 && toggles <= 55,
    `~41 toggles expected from the cycle arithmetic, saw ${toggles}`);

  const adv = b.calls.filter(c => c.advanceTo !== undefined);
  assert.ok(adv.length > 0, 'board clock advanced');
  const last = adv[adv.length - 1].advanceTo;
  // 2 ms simulated = 2,000,000 ns, overshoot bounded by one instruction.
  assert.ok(last >= 2_000_000n && last <= 2_000_400n, `advanceTo=${last}`);
});

test('board time tracks CPU cycles at 16 MHz exactly', () => {
  const a = createAvr8jsAdapter({ program: BLINK });
  const b = stubBoard();
  a.attachBoard(b);
  a.advanceNs(1_000_000); // 1 ms
  const t = a.timeNs();
  // Cycle boundary may overshoot by one instruction (≤ 3 cycles = 187 ns).
  assert.ok(t >= 1_000_000n && t <= 1_000_400n, `timeNs=${t}`);
});

test('undriven pin with PORT bit set publishes as input-pullup', () => {
  const a = createAvr8jsAdapter();
  const b = stubBoard();
  // PORTB bit 0 set, DDRB clear → D8 has the internal pull-up.
  a.cpu.data[0x25] = 0x01;
  a.attachBoard(b);
  const d8 = b.calls.filter(c => c.name === 'D8');
  assert.equal(d8[d8.length - 1].mode, 'input-pullup');
  const d9 = b.calls.filter(c => c.name === 'D9');
  assert.equal(d9[d9.length - 1].mode, 'input', 'plain input without the pull-up');
});

test('full boundary A: the hand-assembled blink lights a real engine LED', () => {
  const a = createAvr8jsAdapter({ program: BLINK });
  const { BoardImpl } = awaitBoard();
  const board = new BoardImpl(5);
  board.setNetlist(
    [
      { id: 'nano', kind: 'mcu', params: { pins: ['D13'] }, terminals: ['D13'] },
      { id: 'r1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      { id: 'led1', kind: 'led', params: { vf: 2.0, color: 'red' }, terminals: ['anode', 'cathode'] },
      { id: 'g', kind: 'gnd', params: {}, terminals: ['gnd'] },
    ],
    [
      { id: 'n1', terminals: [{ part: 'nano', terminal: 'D13' }, { part: 'r1', terminal: 'a' }] },
      { id: 'n2', terminals: [{ part: 'r1', terminal: 'b' }, { part: 'led1', terminal: 'anode' }] },
      { id: 'n3', terminals: [{ part: 'led1', terminal: 'cathode' }, { part: 'g', terminal: 'gnd' }] },
    ]
  );
  board.setPower(true);
  a.attachBoard(board);
  // A ~48 µs toggle IS PWM: the engine's LED persistence averages it the way
  // an eye would, so the honest oracle is the DUTY-CYCLE MIDBAND, not
  // on/off flicker. Full-on would be (5-2)/1k / 20 mA = 0.15; at ~50 % duty
  // the average must sit near half that — proof that BOTH pin states reach
  // the physics.
  a.advanceNs(2_000_000); // settle 2 ms of toggling
  const bright = board.ledBrightness('led1');
  assert.ok(bright > 0.04 && bright < 0.12,
    `PWM midband expected (~0.075 of full 0.15), got ${bright}`);
});

function awaitBoard() {
  // node:test runs ESM; import synchronously via the already-loaded module
  // graph. (BoardImpl import placed here to keep the header's oracle story
  // uncluttered.)
  return { BoardImpl: BoardImplRef };
}

// FOLLOWER — the digital-input leg, hand-assembled: PB0 (D8) mirrors
// PB1 (D9), which the BOARD drives. Encodings from the instruction set
// manual:
//   word 0  SBI DDRB,0     0x9A20   (D8 output; D9 stays input)
//   word 1  IN r24,PINB    0xB183   <- loop
//   word 2  SBRC r24,1     0xFD81   (skip if D9 low)
//   word 3  SBI PORTB,0    0x9A28   (D8 high)
//   word 4  SBRS r24,1     0xFF81   (skip if D9 high)
//   word 5  CBI PORTB,0    0x9828   (D8 low)
//   word 6  RJMP .-6       0xCFFA   (back to IN)
test('digital input: D8 follows the board level on D9 within a slice', () => {
  const FOLLOWER = new Uint16Array([0x9A20, 0xB183, 0xFD81, 0x9A28, 0xFF81, 0x9828, 0xCFFA]);
  const a = createAvr8jsAdapter({ program: FOLLOWER });
  let d9Level = 0;
  const b = stubBoard();
  b.readPin = (name) => (name === 'D9' ? d9Level : 0);
  a.attachBoard(b);

  const lastD8 = () => {
    const d8 = b.calls.filter(c => c.name === 'D8' && c.mode === 'pushpull');
    return d8.length ? d8[d8.length - 1].high : undefined;
  };

  a.advanceNs(100_000);
  assert.equal(lastD8(), false, 'D9 low -> D8 low');
  d9Level = 1;
  a.advanceNs(100_000);
  assert.equal(lastD8(), true, 'the board raised D9 -> D8 follows high');
  d9Level = 0;
  a.advanceNs(100_000);
  assert.equal(lastD8(), false, 'and back down');
});
