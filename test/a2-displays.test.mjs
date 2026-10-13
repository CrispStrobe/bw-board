/**
 * A2 display device tests — SEVENSEG8 and LEDBANK8.
 *
 * Hand-computed oracles: segment bytes from the font table, digit select
 * from the 74HC138 3-bit address, active-low inversion for the LED bank;
 * for SEVENSEG8, scans driven in real board time in both write orders.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';
import { FONT, decodeSegments, PERSISTENCE_WINDOW_NS, DUTY_THRESHOLD } from '../src/devices/a2-displays.js';

registerAllDevices();

const net = (id, ...terms) => ({ id, terminals: terms.map(([p, t]) => ({ part: p, terminal: t })) });

// ─── SEVENSEG8 ──────────────────────────────────────────────────────────
//
// The model shows what the eye sees (Lite task B16): each segment's on-time
// while its digit is selected, over a 20 ms window, lit at >= 1/32 of it. The
// rigs below drive the pins with real board time, as an emulated ISR does.

const SEGS = ['seg_a', 'seg_b', 'seg_c', 'seg_d', 'seg_e', 'seg_f', 'seg_g', 'seg_dp'];
const US = 1_000n;
const MS = 1_000_000n;

function seg8Rig(params = {}) {
  const board = new BoardImpl(5.0);
  const mcuTerminals = [...SEGS, 'sel_a', 'sel_b', 'sel_c'];
  board.setNetlist([
    { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
    { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'MCU', kind: 'mcu', params: {}, terminals: mcuTerminals },
    { id: 'D1', kind: 'sevenseg8', params,
      terminals: ['vcc', 'gnd', ...SEGS, 'sel_a', 'sel_b', 'sel_c'] },
  ], [
    net('nv', ['VCC', 'vcc'], ['D1', 'vcc']),
    net('ng', ['GND', 'gnd'], ['D1', 'gnd']),
    ...SEGS.map(s => net(`n_${s}`, ['MCU', s], ['D1', s])),
    net('n_sel_a', ['MCU', 'sel_a'], ['D1', 'sel_a']),
    net('n_sel_b', ['MCU', 'sel_b'], ['D1', 'sel_b']),
    net('n_sel_c', ['MCU', 'sel_c'], ['D1', 'sel_c']),
  ]);
  board.setPower(true);
  const anode = /anode/i.test(params.common ?? '');
  /** Let `ns` of board time pass with the pins as they are. */
  const hold = (ns) => board.advanceTo(board.timeNs + ns);
  /** The segment port, one pin at a time, as the byte the eye should see. */
  const segments = (byte) => {
    const out = anode ? ~byte & 0xff : byte;
    for (let i = 0; i < 8; i++) board.setPin(SEGS[i], 'pushpull', !!((out >> i) & 1));
  };
  /** The 74HC138 address, one pin at a time (sel_a, sel_b, sel_c). */
  const select = (d) => {
    board.setPin('sel_a', 'pushpull', !!(d & 1));
    board.setPin('sel_b', 'pushpull', !!(d & 2));
    board.setPin('sel_c', 'pushpull', !!(d & 4));
  };
  const state = () => board.getDeviceState('D1');
  const shown = () => state().text.join('');
  return { board, hold, segments, select, state, shown };
}

/**
 * The compiled C's Timer-0 ISR (stc-compiler stc_pseudocode.py and
 * sb3-creator's C target, `_cSevenSegScan`): blank the segments, set the
 * three address pins, write the digit's segments, hold to the next tick.
 * The C spends a few microseconds of instructions on each write.
 */
function scanBlankSelectWrite(r, fb, frames, tickNs = 1n * MS) {
  for (let f = 0; f < frames; f++) {
    for (let d = 0; d < 8; d++) {
      r.segments(0); r.hold(2n * US);
      r.select(d); r.hold(3n * US);
      r.segments(fb[d]);
      r.hold(tickNs - 5n * US);
    }
  }
}

/**
 * The opposite order -- the next digit's segments first, then the address,
 * pin by pin, counting up -- with microseconds between writes: the address
 * passes through intermediate values (3 -> 4 is 3, 2, 0, 4) carrying the
 * new segments, and the old digit shows the new segments until the select
 * moves. Both are real transients of this order on silicon.
 */
function scanWriteThenSelect(r, fb, frames, tickNs = 1n * MS) {
  for (let f = 0; f < frames; f++) {
    for (let d = 0; d < 8; d++) {
      r.segments(fb[d]); r.hold(2n * US);
      r.board.setPin('sel_a', 'pushpull', !!(d & 1)); r.hold(1n * US);
      r.board.setPin('sel_b', 'pushpull', !!(d & 2)); r.hold(1n * US);
      r.board.setPin('sel_c', 'pushpull', !!(d & 4));
      r.hold(tickNs - 4n * US);
    }
  }
}

/**
 * The stc12 blocks' zero-time push (extensions stc12.js `_segpush`): every
 * digit's segments, then its address one bit away in Gray-code order, each
 * select pin written twice -- all at one instant of board time.
 */
function pushGray(r, fb, from = 0) {
  const GRAY = [0, 1, 3, 2, 6, 7, 5, 4];
  const sel = ['sel_a', 'sel_b', 'sel_c'];
  let at = from;
  for (let i = 1; i <= 8; i++) {
    const to = GRAY[(GRAY.indexOf(from) + i) % 8];
    r.segments(fb[to]);
    const k = Math.log2((at ^ to) & 7);
    r.board.setPin(sel[k], 'pushpull', !!((to >> k) & 1));
    r.board.setPin(sel[k], 'pushpull', !!((to >> k) & 1));
    at = to;
  }
}

const FRAME = [1, 2, 3, 4, 5, 6, 7, 8].map(n => FONT[n]); // "12345678"

describe('SEVENSEG8', () => {
  it('the window and threshold are the stated ones', () => {
    assert.equal(PERSISTENCE_WINDOW_NS, 20_000_000n, '20 ms, the LED brightness window');
    assert.equal(DUTY_THRESHOLD, 1 / 32, 'a quarter of one digit\'s share of an 8-digit scan');
  });

  it('the compiled C\'s order (blank, select, segments) shows its digits', () => {
    // The order B16 was found on: the select changes while the segments are
    // blank, so a model latching at the select change read "        ".
    const r = seg8Rig();
    scanBlankSelectWrite(r, FRAME, 5);
    assert.equal(r.shown(), '12345678');
    assert.deepEqual(Array.from(r.state().digits), FRAME);
    // Every lit segment carries its digit's share of the window, 2 or 3 of
    // the 20 ticks (an 8-tick frame in a 20-tick window), less the 5 us blank.
    for (let d = 0; d < 8; d++) {
      const sel = r.state().selDuty[d];
      assert.ok(sel >= 0.1 - 1e-9 && sel <= 0.15 + 1e-9, `digit ${d} selected ${sel}`);
      for (let s = 0; s < 8; s++) {
        const on = r.state().segDuty[d * 8 + s];
        if ((FRAME[d] >> s) & 1) assert.ok(on > 0.09 && on < 0.15, `digit ${d} segment ${s} on ${on}`);
        else assert.equal(on, 0, `digit ${d} segment ${s} dark`);
      }
    }
  });

  it('the stc12 blocks\' zero-time push shows its digits at once, and after time passes', () => {
    const r = seg8Rig();
    pushGray(r, FRAME);
    assert.equal(r.shown(), '12345678', 'the instant of the push');
    r.hold(100n * MS);
    assert.equal(r.shown(), '12345678', 'after 100 ms with the last digit left selected');
  });

  it('a zero-time push onto a display that held a digit lights that digit after 1/32 of the window', () => {
    // The push ends where it started (digit 0, Gray order). Digit 0 was
    // selected and blank for the whole window, so at the instant of the push
    // the eye has seen it blank; the others had no time and show the frame.
    // Digit 0 lights once its new segments have 625 us of the 20 ms window.
    const r = seg8Rig();
    r.hold(30n * MS);
    pushGray(r, FRAME);
    assert.equal(r.shown(), ' 2345678', 'the instant of the push: digit 0 has had no time yet');
    r.hold(600n * US);
    assert.equal(r.shown(), ' 2345678', '600 us < 625 us');
    r.hold(50n * US);
    assert.equal(r.shown(), '12345678', '650 us >= 625 us');
    r.hold(100n * MS);
    assert.equal(r.shown(), '12345678');
  });

  it('both write orders show the same digits', () => {
    const fb = [0, 0, 0, 0x40, FONT[4], FONT[2], FONT[0], FONT[7]]; // "   -4207"
    const c = seg8Rig();
    scanBlankSelectWrite(c, fb, 6);
    const blocks = seg8Rig();
    pushGray(blocks, fb);
    blocks.hold(60n * MS);
    assert.equal(c.shown(), blocks.shown());
    assert.equal(c.shown().replace('0x40', '-'), '   -4207');
  });

  it('a scan\'s address and segment transients do not ghost', () => {
    // Write-then-select counting up: every address transition shows the next
    // digit's segments on the old digit for 2 us and on intermediate
    // addresses for 1-2 us. At 1/32 of 20 ms (625 us) none of it lights.
    const fb = [FONT[1], 0, 0, 0, 0, 0, 0, 0]; // only digit 0 has segments
    const r = seg8Rig();
    scanWriteThenSelect(r, fb, 5);
    assert.equal(r.shown(), '1       ', 'digit 0 alone');
    // The transients ARE in the record -- the threshold, not their absence,
    // keeps them dark: digit 7 shows digit 0's segments for 2 us a frame.
    assert.ok(r.state().segDuty[7 * 8 + 1] > 0, 'the 7 -> 0 transient reached digit 7');
    assert.ok(r.state().segDuty[7 * 8 + 1] < DUTY_THRESHOLD / 30);
  });

  it('a truly blank display stays blank', () => {
    const r = seg8Rig();
    scanBlankSelectWrite(r, new Array(8).fill(0), 5);
    assert.equal(r.shown(), '        ');
    const zero = seg8Rig();
    pushGray(zero, new Array(8).fill(0));
    zero.hold(50n * MS);
    assert.equal(zero.shown(), '        ');
  });

  it('a digit the scan stops visiting fades within the window', () => {
    const r = seg8Rig();
    scanBlankSelectWrite(r, FRAME, 5);
    // The scan stops on digit 0 with its segments lit; the others' last
    // latched frame is the blank the C writes before each select change.
    r.segments(0); r.select(0); r.segments(FONT[1]);
    r.hold(25n * MS);
    assert.equal(r.shown(), '1       ');
  });

  it('blank segments = space, dp-only = dot', () => {
    const r = seg8Rig();
    scanBlankSelectWrite(r, [0x00, 0x80, 0, 0, 0, 0, 0, 0], 5);
    const st = r.state();
    assert.equal(st.text[0], ' ', 'blank = space');
    assert.equal(st.text[1], '.', 'dp only = dot');
  });

  it('hex digits A-F decode correctly', () => {
    const r = seg8Rig();
    scanBlankSelectWrite(r, [10, 11, 12, 13, 14, 15, 0, 0].map((v, i) => (i < 6 ? FONT[v] : 0)), 5);
    assert.equal(r.shown(), 'ABCDEF  ');
  });

  it('common anode inverts segment logic', () => {
    const r = seg8Rig({ common: 'anode' });
    scanBlankSelectWrite(r, [FONT[1], 0, 0, 0, 0, 0, 0, 0], 5);
    assert.equal(r.state().digits[0], FONT[1], 'common anode inverts to show 1');
    assert.equal(r.state().text[0], '1');
    const z = seg8Rig({ common: 'anode' });
    pushGray(z, [FONT[1], 0, 0, 0, 0, 0, 0, 0]);
    assert.equal(z.state().text[0], '1', 'and on the zero-time push');
  });

  it('the running integral equals a direct integration of the pin trace', () => {
    // A pseudo-random trace of segment and address writes at random times.
    // The model keeps closed steps as running sums; recompute every duty
    // from the trace itself over the same window and compare exactly.
    const r = seg8Rig();
    let seed = 12345;
    const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
    const trace = [{ t: 0n, sel: 0, seg: 0 }];
    let sel = 0, seg = 0;
    for (let i = 0; i < 3000; i++) {
      if (rnd(3) === 0) { sel = rnd(8); r.select(sel); } else { seg = rnd(256); r.segments(seg); }
      trace.push({ t: r.board.timeNs, sel, seg });
      r.hold(BigInt(1 + rnd(400)) * US);
      if (i % 500 === 499) {
        const now = r.board.timeNs;
        const ws = now > PERSISTENCE_WINDOW_NS ? now - PERSISTENCE_WINDOW_NS : 0n;
        const want = new Float64Array(64);
        for (let k = 0; k < trace.length; k++) {
          const from = trace[k].t > ws ? trace[k].t : ws;
          const to = k + 1 < trace.length ? trace[k + 1].t : now;
          if (to <= from) continue;
          for (let s = 0; s < 8; s++) if ((trace[k].seg >> s) & 1) want[trace[k].sel * 8 + s] += Number(to - from);
        }
        const w = Number(now - ws);
        for (let j = 0; j < 64; j++) {
          assert.equal(r.state().segDuty[j], want[j] / w, `segDuty[${j}] at ${now} ns`);
        }
      }
    }
  });

  it('getDeviceState exposes state for the face', () => {
    const r = seg8Rig();
    scanBlankSelectWrite(r, FRAME, 1);
    const st = r.board.getDeviceState('D1');
    assert.ok(st.digits instanceof Uint8Array, 'digits is typed array');
    assert.equal(st.digits.length, 8);
    assert.ok(Array.isArray(st.text), 'text is array');
    assert.equal(st.text.length, 8);
    assert.equal(typeof st.selectedDigit, 'number');
    assert.equal(st.segDuty.length, 64);
    // Not segBrightness: bw-circuit-ui's canvas would draw that raw (path A),
    // and a zero-time push has no on-time to draw. The canvas keeps digits.
    assert.equal(st.segBrightness, undefined);
  });
});

// ─── LEDBANK8 ───────────────────────────────────────────────────────────

function ledRig(activeLow = true) {
  const board = new BoardImpl(5.0);
  const dataPins = Array.from({ length: 8 }, (_, i) => `d${i}`);
  board.setNetlist([
    { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
    { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'MCU', kind: 'mcu', params: {}, terminals: dataPins },
    { id: 'L1', kind: 'ledbank8', params: { activeLow },
      terminals: ['vcc', 'gnd', ...dataPins] },
  ], [
    net('nv', ['VCC', 'vcc'], ['L1', 'vcc']),
    net('ng', ['GND', 'gnd'], ['L1', 'gnd']),
    ...dataPins.map(d => net(`n_${d}`, ['MCU', d], ['L1', d])),
  ]);
  board.setPower(true);
  let t = 0n;
  const tick = () => { t += 1_000n; board.advanceTo(t); };
  const pin = (name, h) => { board.setPin(name, 'pushpull', h); tick(); };
  const setPort = (byte) => {
    for (let i = 0; i < 8; i++) pin(`d${i}`, !!((byte >> i) & 1));
  };
  return { board, pin, tick, setPort };
}

describe('LEDBANK8', () => {
  it('active-low: 0x00 = all on, 0xFF = all off', () => {
    const r = ledRig(true);
    r.setPort(0x00);
    let st = r.board.getDeviceState('L1');
    for (let i = 0; i < 8; i++) {
      assert.equal(st.leds[i], 1, `LED ${i} on when port LOW`);
    }
    r.setPort(0xff);
    st = r.board.getDeviceState('L1');
    for (let i = 0; i < 8; i++) {
      assert.equal(st.leds[i], 0, `LED ${i} off when port HIGH`);
    }
  });

  it('active-high: 0xFF = all on, 0x00 = all off', () => {
    const r = ledRig(false);
    r.setPort(0xff);
    let st = r.board.getDeviceState('L1');
    for (let i = 0; i < 8; i++) {
      assert.equal(st.leds[i], 1, `LED ${i} on when port HIGH`);
    }
    r.setPort(0x00);
    st = r.board.getDeviceState('L1');
    for (let i = 0; i < 8; i++) {
      assert.equal(st.leds[i], 0, `LED ${i} off when port LOW`);
    }
  });

  it('individual LED addressing: pattern 0xA5 active-low', () => {
    const r = ledRig(true);
    r.setPort(0xa5); // 10100101 → active-low inverts → 01011010
    const st = r.board.getDeviceState('L1');
    const expected = [0, 1, 0, 1, 1, 0, 1, 0]; // inverted 0xA5
    for (let i = 0; i < 8; i++) {
      assert.equal(st.leds[i], expected[i], `LED ${i}: expected ${expected[i]}`);
    }
  });

  it('portByte tracks the raw port value', () => {
    const r = ledRig(true);
    r.setPort(0x42);
    const st = r.board.getDeviceState('L1');
    assert.equal(st.portByte, 0x42);
  });

  it('getDeviceState exposes state for the face', () => {
    const r = ledRig(true);
    r.setPort(0x00);
    const st = r.board.getDeviceState('L1');
    assert.ok(st.leds instanceof Uint8Array, 'leds is typed array');
    assert.equal(st.leds.length, 8);
    assert.equal(typeof st.portByte, 'number');
    assert.equal(typeof st.activeLow, 'boolean');
  });
});

// ─── Font table ─────────────────────────────────────────────────────────

describe('7-segment font', () => {
  it('FONT has 16 entries (0-F)', () => {
    assert.equal(FONT.length, 16);
  });

  it('decodeSegments round-trips all hex digits', () => {
    for (let i = 0; i < 16; i++) {
      const decoded = decodeSegments(FONT[i]);
      assert.equal(decoded, i.toString(16).toUpperCase(), `FONT[${i}] decodes`);
    }
  });

  it('dp flag appends a dot', () => {
    assert.equal(decodeSegments(FONT[5] | 0x80), '5.');
    assert.equal(decodeSegments(0x80), '.');
    assert.equal(decodeSegments(0x00), ' ');
  });
});
