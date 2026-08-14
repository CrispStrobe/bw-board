/**
 * HD44780 character-LCD oracle tests.
 *
 * Every expected value is hand-computed from the HD44780U datasheet
 * (ADE-207-272(Z), Rev. 0.0, 1999-09-29). This file tests:
 *
 *  1. 8-bit mode: write characters, read them back, verify DDRAM
 *  2. 4-bit mode: nibble sequencing, same character writes
 *  3. Busy flag timing per Table 6
 *  4. DDRAM addressing: line 1 (0x00), line 2 (0x40), visible text
 *  5. Clear display and return home
 *  6. Entry mode: increment / decrement
 *  7. Display shift
 *  8. Cursor move
 *  9. CGRAM addressing
 * 10. Board-level integration: registered device, stamp, update cycle
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  createHD44780, hd44780Write8, hd44780Write4, hd44780ReadBF,
} from '../src/devices/hd44780.js';
import { registerHD44780 } from '../src/devices/hd44780.js';
import { unregisterDevice, getDevice } from '../src/devices.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Standard 4-bit init sequence from HD44780U datasheet §Figure 24 (p.46). */
function init4Bit(state, tNs = 0n) {
  // The three 0x3 writes before busy-flag polling is available
  // (these are 8-bit function-set attempts; only the high nibble matters)
  // In the procedural API, we use hd44780Write8 for these since
  // the LCD is still in 8-bit mode at power-on.
  hd44780Write8(state, 0, 0x30, tNs);        // Function set (8-bit)
  tNs += 5_000_000n;
  hd44780Write8(state, 0, 0x30, tNs);        // repeat
  tNs += 200_000n;
  hd44780Write8(state, 0, 0x30, tNs);        // repeat
  tNs += 200_000n;
  hd44780Write8(state, 0, 0x20, tNs);        // Switch to 4-bit mode
  tNs += 100_000n;

  // Now in 4-bit mode: function set (2-line, 5x8)
  // 0x28 = 0010_1000 → high nibble 0x2, low nibble 0x8
  hd44780Write4(state, 0, 0x02, tNs); tNs += 1_000n;
  hd44780Write4(state, 0, 0x08, tNs); tNs += 100_000n;

  // Display on, cursor on, blink on (0x0F)
  hd44780Write4(state, 0, 0x00, tNs); tNs += 1_000n;
  hd44780Write4(state, 0, 0x0f, tNs); tNs += 100_000n;

  // Entry mode: increment, no shift (0x06)
  hd44780Write4(state, 0, 0x00, tNs); tNs += 1_000n;
  hd44780Write4(state, 0, 0x06, tNs); tNs += 100_000n;

  // Clear display (0x01)
  hd44780Write4(state, 0, 0x00, tNs); tNs += 1_000n;
  hd44780Write4(state, 0, 0x01, tNs); tNs += 2_000_000n;

  return tNs;
}

/** Write a string in 4-bit mode. */
function writeString4(state, str, tNs) {
  for (const ch of str) {
    const code = ch.charCodeAt(0);
    hd44780Write4(state, 1, (code >> 4) & 0x0f, tNs); tNs += 1_000n;
    hd44780Write4(state, 1, code & 0x0f, tNs); tNs += 100_000n;
  }
  return tNs;
}

// ─── 8-bit mode tests ───────────────────────────────────────────────────────

describe('HD44780 8-bit mode', () => {
  it('writes and reads characters at DDRAM addresses', () => {
    const s = createHD44780();
    let t = 0n;

    // Function set: 8-bit, 2-line, 5x8 (0x38)
    hd44780Write8(s, 0, 0x38, t); t += 100_000n;
    assert.equal(s.is4Bit, false);
    assert.equal(s.twoLine, true);

    // Display on (0x0C)
    hd44780Write8(s, 0, 0x0c, t); t += 100_000n;
    assert.equal(s.displayOn, true);

    // Entry mode: increment (0x06)
    hd44780Write8(s, 0, 0x06, t); t += 100_000n;

    // Clear display
    hd44780Write8(s, 0, 0x01, t); t += 2_000_000n;
    assert.equal(s.ac, 0);

    // Write "Hi" starting at DDRAM 0x00
    hd44780Write8(s, 1, 0x48, t); t += 100_000n; // 'H'
    hd44780Write8(s, 1, 0x69, t); t += 100_000n; // 'i'

    // AC should have auto-incremented to 2
    assert.equal(s.ac, 2);

    // DDRAM[0] = 'H' (0x48), DDRAM[1] = 'i' (0x69)
    assert.equal(s.ddram[0], 0x48);
    assert.equal(s.ddram[1], 0x69);

    // Text should show "Hi" left-justified
    assert.ok(s.text[0].startsWith('Hi'), `expected "Hi..." got "${s.text[0]}"`);
  });

  it('writes to line 2 via set-DDRAM-address 0x40', () => {
    const s = createHD44780();
    let t = 0n;

    hd44780Write8(s, 0, 0x38, t); t += 100_000n; // 8-bit, 2-line
    hd44780Write8(s, 0, 0x0c, t); t += 100_000n; // display on
    hd44780Write8(s, 0, 0x06, t); t += 100_000n; // entry mode
    hd44780Write8(s, 0, 0x01, t); t += 2_000_000n; // clear

    // Set DDRAM address to 0x40 (line 2, col 0)
    hd44780Write8(s, 0, 0xc0, t); t += 100_000n; // 0x80 | 0x40
    assert.equal(s.ac, 0x40);

    // Write "L2"
    hd44780Write8(s, 1, 0x4c, t); t += 100_000n; // 'L'
    hd44780Write8(s, 1, 0x32, t); t += 100_000n; // '2'

    // DDRAM at flat index 40 and 41
    assert.equal(s.ddram[40], 0x4c);
    assert.equal(s.ddram[41], 0x32);

    // Text line 2 should start with "L2"
    assert.ok(s.text[1].startsWith('L2'), `expected "L2..." got "${s.text[1]}"`);
  });
});

// ─── Busy flag timing ───────────────────────────────────────────────────────

describe('HD44780 busy flag', () => {
  it('reports busy for 37µs after a normal instruction (Table 6)', () => {
    const s = createHD44780();
    // Function set at t=0
    hd44780Write8(s, 0, 0x38, 0n);

    // At t=36µs: still busy (37µs execution time)
    let bf = hd44780ReadBF(s, 36_000n);
    assert.equal(bf.busy, true, 'should be busy at 36µs');

    // At t=37µs: no longer busy
    bf = hd44780ReadBF(s, 37_000n);
    assert.equal(bf.busy, false, 'should be free at 37µs');
  });

  it('reports busy for 1.52ms after clear-display (Table 6)', () => {
    const s = createHD44780();
    hd44780Write8(s, 0, 0x38, 0n); // function set
    const t1 = 100_000n;
    hd44780Write8(s, 0, 0x01, t1); // clear display

    // At t1 + 1.51ms: still busy
    let bf = hd44780ReadBF(s, t1 + 1_510_000n);
    assert.equal(bf.busy, true, 'should be busy at 1.51ms after clear');

    // At t1 + 1.52ms: free
    bf = hd44780ReadBF(s, t1 + 1_520_000n);
    assert.equal(bf.busy, false, 'should be free at 1.52ms after clear');
  });

  it('reports busy for 1.52ms after return-home', () => {
    const s = createHD44780();
    hd44780Write8(s, 0, 0x38, 0n);
    const t1 = 100_000n;
    hd44780Write8(s, 0, 0x02, t1); // return home

    let bf = hd44780ReadBF(s, t1 + 1_510_000n);
    assert.equal(bf.busy, true);

    bf = hd44780ReadBF(s, t1 + 1_520_000n);
    assert.equal(bf.busy, false);
  });

  it('rejects writes while busy', () => {
    const s = createHD44780();
    hd44780Write8(s, 0, 0x38, 0n);
    // Try writing data at t=10µs — should be rejected (busy until 37µs)
    hd44780Write8(s, 1, 0x41, 10_000n); // 'A'
    // DDRAM should still be space (0x20), data rejected
    assert.equal(s.ddram[0], 0x20, 'write during busy should be rejected');
  });
});

// ─── 4-bit mode tests ───────────────────────────────────────────────────────

describe('HD44780 4-bit mode', () => {
  it('initializes and writes characters via nibble pairs', () => {
    const s = createHD44780();
    let t = init4Bit(s);

    // Write "AB" in 4-bit mode
    // 'A' = 0x41 → high nibble 0x4, low nibble 0x1
    hd44780Write4(s, 1, 0x04, t); t += 1_000n;
    hd44780Write4(s, 1, 0x01, t); t += 100_000n;

    // 'B' = 0x42 → high nibble 0x4, low nibble 0x2
    hd44780Write4(s, 1, 0x04, t); t += 1_000n;
    hd44780Write4(s, 1, 0x02, t); t += 100_000n;

    assert.equal(s.ddram[0], 0x41, 'DDRAM[0] = A');
    assert.equal(s.ddram[1], 0x42, 'DDRAM[1] = B');
    assert.ok(s.text[0].startsWith('AB'));
  });

  it('writes a full line and reads text correctly', () => {
    const s = createHD44780();
    let t = init4Bit(s);

    t = writeString4(s, 'Hello, World!   ', t);

    assert.equal(s.text[0], 'Hello, World!   ');
  });

  it('writes to both lines', () => {
    const s = createHD44780();
    let t = init4Bit(s);

    t = writeString4(s, 'Line 1', t);

    // Set DDRAM to 0x40 (line 2) — 0xC0 = 0x80|0x40
    hd44780Write4(s, 0, 0x0c, t); t += 1_000n;
    hd44780Write4(s, 0, 0x00, t); t += 100_000n;

    t = writeString4(s, 'Line 2', t);

    assert.ok(s.text[0].startsWith('Line 1'));
    assert.ok(s.text[1].startsWith('Line 2'));
  });
});

// ─── Entry mode tests ───────────────────────────────────────────────────────

describe('HD44780 entry mode', () => {
  it('decrements AC when I/D=0', () => {
    const s = createHD44780();
    let t = 0n;
    hd44780Write8(s, 0, 0x38, t); t += 100_000n;
    hd44780Write8(s, 0, 0x0c, t); t += 100_000n;

    // Entry mode: decrement (0x04: I/D=0, S=0)
    hd44780Write8(s, 0, 0x04, t); t += 100_000n;

    // Set AC to position 5
    hd44780Write8(s, 0, 0x85, t); t += 100_000n; // 0x80 | 0x05
    assert.equal(s.ac, 5);

    // Write 'X' — AC should decrement to 4
    hd44780Write8(s, 1, 0x58, t); t += 100_000n;
    assert.equal(s.ac, 4);
    assert.equal(s.ddram[5], 0x58);
  });
});

// ─── Cursor/display shift ───────────────────────────────────────────────────

describe('HD44780 cursor and display shift', () => {
  it('shifts cursor right (S/C=0, R/L=1): AC increments', () => {
    const s = createHD44780();
    let t = 0n;
    hd44780Write8(s, 0, 0x38, t); t += 100_000n;
    hd44780Write8(s, 0, 0x01, t); t += 2_000_000n;

    assert.equal(s.ac, 0);
    // Shift cursor right: 0x14 (S/C=0, R/L=1)
    hd44780Write8(s, 0, 0x14, t); t += 100_000n;
    assert.equal(s.ac, 1);
    hd44780Write8(s, 0, 0x14, t); t += 100_000n;
    assert.equal(s.ac, 2);
  });

  it('shifts cursor left (S/C=0, R/L=0): AC decrements', () => {
    const s = createHD44780();
    let t = 0n;
    hd44780Write8(s, 0, 0x38, t); t += 100_000n;
    // Set AC to 5
    hd44780Write8(s, 0, 0x85, t); t += 100_000n;
    // Shift cursor left: 0x10 (S/C=0, R/L=0)
    hd44780Write8(s, 0, 0x10, t); t += 100_000n;
    assert.equal(s.ac, 4);
  });

  it('shifts display right (S/C=1, R/L=1)', () => {
    const s = createHD44780();
    let t = 0n;
    hd44780Write8(s, 0, 0x38, t); t += 100_000n;
    hd44780Write8(s, 0, 0x01, t); t += 2_000_000n;

    assert.equal(s.displayShift, 0);
    // Display shift right: 0x1C (S/C=1, R/L=1)
    hd44780Write8(s, 0, 0x1c, t); t += 100_000n;
    assert.equal(s.displayShift, 1);
  });
});

// ─── Clear display ──────────────────────────────────────────────────────────

describe('HD44780 clear display', () => {
  it('fills DDRAM with spaces and resets AC', () => {
    const s = createHD44780();
    let t = 0n;
    hd44780Write8(s, 0, 0x38, t); t += 100_000n;
    hd44780Write8(s, 0, 0x06, t); t += 100_000n;

    // Write some data
    hd44780Write8(s, 1, 0x41, t); t += 100_000n; // 'A'
    hd44780Write8(s, 1, 0x42, t); t += 100_000n; // 'B'
    assert.equal(s.ddram[0], 0x41);

    // Clear
    hd44780Write8(s, 0, 0x01, t); t += 2_000_000n;
    assert.equal(s.ddram[0], 0x20, 'DDRAM[0] should be space after clear');
    assert.equal(s.ddram[1], 0x20);
    assert.equal(s.ac, 0, 'AC should be 0 after clear');
    assert.equal(s.increment, true, 'I/D should be 1 after clear');
    assert.equal(s.displayShift, 0, 'display shift should be 0 after clear');
  });
});

// ─── Return home ────────────────────────────────────────────────────────────

describe('HD44780 return home', () => {
  it('resets AC to 0 without clearing DDRAM', () => {
    const s = createHD44780();
    let t = 0n;
    hd44780Write8(s, 0, 0x38, t); t += 100_000n;
    hd44780Write8(s, 0, 0x06, t); t += 100_000n;

    // Write 'X' at position 0, then 'Y' at position 1
    hd44780Write8(s, 1, 0x58, t); t += 100_000n;
    hd44780Write8(s, 1, 0x59, t); t += 100_000n;
    assert.equal(s.ac, 2);

    // Return home
    hd44780Write8(s, 0, 0x02, t); t += 2_000_000n;
    assert.equal(s.ac, 0, 'AC should be 0 after return home');
    // Data preserved
    assert.equal(s.ddram[0], 0x58, 'DDRAM should be preserved');
    assert.equal(s.ddram[1], 0x59);
  });
});

// ─── CGRAM ──────────────────────────────────────────────────────────────────

describe('HD44780 CGRAM', () => {
  it('writes and reads CGRAM at the correct addresses', () => {
    const s = createHD44780();
    let t = 0n;
    hd44780Write8(s, 0, 0x38, t); t += 100_000n;

    // Set CGRAM address 0 (0x40 | 0x00)
    hd44780Write8(s, 0, 0x40, t); t += 100_000n;
    assert.equal(s.acIsCgram, true, 'should be in CGRAM mode');
    assert.equal(s.ac, 0);

    // Write 8 bytes for custom character 0
    const pattern = [0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11, 0x00]; // 'A' pattern
    for (const b of pattern) {
      hd44780Write8(s, 1, b, t); t += 100_000n;
    }

    // Verify CGRAM contents
    for (let i = 0; i < 8; i++) {
      assert.equal(s.cgram[i], pattern[i], `CGRAM[${i}]`);
    }
    assert.equal(s.ac, 8, 'AC should have advanced through 8 CGRAM bytes');
  });

  it('returns to DDRAM mode after set-DDRAM-address', () => {
    const s = createHD44780();
    let t = 0n;
    hd44780Write8(s, 0, 0x38, t); t += 100_000n;
    hd44780Write8(s, 0, 0x40, t); t += 100_000n; // CGRAM mode
    assert.equal(s.acIsCgram, true);

    hd44780Write8(s, 0, 0x80, t); t += 100_000n; // Set DDRAM addr 0
    assert.equal(s.acIsCgram, false, 'should return to DDRAM mode');
  });
});

// ─── Board-level integration ────────────────────────────────────────────────

describe('HD44780 device registration', () => {
  beforeEach(() => { registerHD44780(); });
  afterEach(() => { try { unregisterDevice('hd44780'); } catch {} });

  it('registers with the correct terminal list', () => {
    const model = getDevice('hd44780');
    assert.ok(model, 'hd44780 should be registered');
    assert.deepEqual(model.terminals, [
      'vss', 'vdd', 'v0', 'rs', 'rw', 'e',
      'd0', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7',
      'a', 'k',
    ]);
  });

  it('init creates a valid state with text array', () => {
    const model = getDevice('hd44780');
    const state = model.init({ params: { cols: 16, rows: 2 } });
    assert.ok(Array.isArray(state.text));
    assert.equal(state.text.length, 2);
    assert.equal(state.text[0].length, 16);
    assert.equal(state.ddram.length, 80);
  });
});

// ─── RS/RW nibble-phase reset (via device model update()) ──────────────────
// The HD44780's internal nibble counter resets when RS or RW changes.
// This test exercises the device model's update() function directly,
// simulating the E-pulse sequence that BeebEater's firmware generates.

describe('HD44780 device model: nibble phase resets on RS/RW change', () => {
  beforeEach(() => { registerHD44780(); });
  afterEach(() => { try { unregisterDevice('hd44780'); } catch {} });

  it('stray write nibble is discarded when RW changes to 1 (read)', () => {
    const model = getDevice('hd44780');
    const part = { id: 'LCD', kind: 'hd44780', params: { cols: 16, rows: 2 } };
    const state = model.init(part);
    const pins = {
      vss: 0, vdd: 5, v0: 2.5, rs: 0, rw: 0, e: 0,
      d0: 0, d1: 0, d2: 0, d3: 0, d4: 0, d5: 0, d6: 0, d7: 0,
      a: 5, k: 0,
    };
    const read = (t) => pins[t] ?? 0;
    let t = 0n;

    // 8-bit function set: set 4-bit mode (0x20 = DL=0)
    pins.d5 = 5; // D5=1 → bit 5 of 0x20
    pins.e = 5; model.update(part, state, read, t); t += 1000n; // E rise
    pins.e = 0; model.update(part, state, read, t); t += 100_000n; // E fall → latch
    assert.equal(state.is4Bit, true, 'should switch to 4-bit mode');
    pins.d5 = 0;

    // Stray write nibble (0x08 on D4-D7): high nibble of garbage
    pins.d7 = 5; // D7=1 → nibble 0x08
    pins.e = 5; model.update(part, state, read, t); t += 1000n;
    pins.e = 0; model.update(part, state, read, t); t += 100_000n;
    // nibblePhase should be 1 (waiting for low nibble)
    assert.equal(state._nibblePhase, 1, 'stray nibble should set phase=1');
    pins.d7 = 0;

    // RW changes to 1 (read mode, like busy-flag poll) → phase resets
    pins.rw = 5;
    pins.e = 5; model.update(part, state, read, t); t += 1000n;
    pins.e = 0; model.update(part, state, read, t); t += 100_000n;
    // Phase should have reset to 0 when RW changed
    // Then the read E pulse advanced it: 0→1
    assert.equal(state._nibblePhase, 1, 'read E pulse: 0→1');

    pins.e = 5; model.update(part, state, read, t); t += 1000n;
    pins.e = 0; model.update(part, state, read, t); t += 100_000n;
    assert.equal(state._nibblePhase, 0, 'second read E pulse: 1→0');

    // RW changes back to 0 → phase resets again
    pins.rw = 0;

    // Now write a real command: 0x0F (display on, cursor on, blink on)
    // High nibble: 0x0 (D4-D7 all 0)
    pins.e = 5; model.update(part, state, read, t); t += 1000n;
    pins.e = 0; model.update(part, state, read, t); t += 100_000n;
    assert.equal(state._nibblePhase, 1);

    // Low nibble: 0xF (D4-D7 all 1)
    pins.d4 = 5; pins.d5 = 5; pins.d6 = 5; pins.d7 = 5;
    pins.e = 5; model.update(part, state, read, t); t += 1000n;
    pins.e = 0; model.update(part, state, read, t); t += 100_000n;

    // The 0x0F command should have been executed correctly
    assert.equal(state.displayOn, true, 'display should be on');
    assert.equal(state.cursorOn, true, 'cursor should be on');
    assert.equal(state.blinkOn, true, 'blink should be on');
  });
});

// ─── AC wrapping (§5.1) ────────────────────────────────────────────────────

describe('HD44780 address counter wrapping', () => {
  it('wraps from end of line 1 (0x27) to start of line 2 (0x40) in 2-line mode', () => {
    const s = createHD44780();
    let t = 0n;
    hd44780Write8(s, 0, 0x38, t); t += 100_000n; // 2-line
    hd44780Write8(s, 0, 0x06, t); t += 100_000n; // increment

    // Position at end of line 1
    hd44780Write8(s, 0, 0x80 | 0x27, t); t += 100_000n;
    assert.equal(s.ac, 0x27);

    // Write one char — should advance from 0x27 to 0x40
    hd44780Write8(s, 1, 0x41, t); t += 100_000n;
    assert.equal(s.ac, 0x40, 'AC should wrap from 0x27 to 0x40');
  });

  it('wraps from end of line 2 (0x67) back to start of line 1 (0x00)', () => {
    const s = createHD44780();
    let t = 0n;
    hd44780Write8(s, 0, 0x38, t); t += 100_000n;
    hd44780Write8(s, 0, 0x06, t); t += 100_000n;

    hd44780Write8(s, 0, 0x80 | 0x67, t); t += 100_000n;
    assert.equal(s.ac, 0x67);

    hd44780Write8(s, 1, 0x41, t); t += 100_000n;
    assert.equal(s.ac, 0x00, 'AC should wrap from 0x67 to 0x00');
  });
});

// ─── char_lcd: the designer-catalog skin of the same silicon ────────────────
// bw-circuit-ui ships the part as 'char_lcd' with the designer's house
// terminal names (vcc/gnd/vo/bl_a/bl_k). The alias registration must be
// the SAME model — proven by driving it through the alias names only.

describe('char_lcd alias (designer terminal names)', () => {
  beforeEach(() => { registerHD44780(); });
  afterEach(() => {
    try { unregisterDevice('hd44780'); } catch {}
    try { unregisterDevice('char_lcd'); } catch {}
  });

  it('registers with the designer catalog terminal list', () => {
    const model = getDevice('char_lcd');
    assert.ok(model, 'char_lcd should be registered');
    assert.deepEqual(model.terminals, [
      'rs', 'rw', 'e', 'd0', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7',
      'vcc', 'gnd', 'vo', 'bl_a', 'bl_k',
    ]);
  });

  it('writes land in DDRAM and text through the alias names', () => {
    const model = getDevice('char_lcd');
    const part = { id: 'LCD1', kind: 'char_lcd', params: { cols: 16, rows: 2 } };
    const state = model.init(part);
    // Pins keyed by the DESIGNER's names — vdd/a/k must never appear.
    const pins = {
      vcc: 5, gnd: 0, vo: 2.5, rs: 0, rw: 0, e: 0,
      d0: 0, d1: 0, d2: 0, d3: 0, d4: 0, d5: 0, d6: 0, d7: 0,
      bl_a: 5, bl_k: 0,
    };
    const read = (t) => pins[t] ?? 0;
    let t = 0n;
    const setData = (byte) => { for (let i = 0; i < 8; i++) pins[`d${i}`] = (byte >> i) & 1 ? 5 : 0; };
    const pulse = (rs, byte) => {
      pins.rs = rs ? 5 : 0; setData(byte);
      pins.e = 5; model.update(part, state, read, t); t += 1000n;
      pins.e = 0; model.update(part, state, read, t); t += 100_000n;
    };

    pulse(0, 0x38); // function set: 8-bit, 2-line
    pulse(0, 0x0c); // display on
    pulse(0, 0x06); // entry mode: increment
    pulse(0, 0x01); t += 2_000_000n; // clear
    pulse(1, 0x48); // 'H'
    pulse(1, 0x49); // 'I'

    assert.equal(state.displayOn, true);
    assert.equal(state.text[0].slice(0, 2), 'HI');
  });
});

// ─── Board attach: char_lcd gets live registry state on a real board ───────
describe('char_lcd on BoardImpl', () => {
  it('a seated char_lcd part carries device state readable by the UI', async () => {
    const { BoardImpl } = await import('../src/board.js');
    const { registerAllDevices } = await import('../src/register-all.js');
    registerAllDevices();
    const parts = [
      { id: 'vcc1', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'gnd1', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'lcd1', kind: 'char_lcd', params: { cols: 16, rows: 2 },
        terminals: ['rs', 'rw', 'e', 'd0', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7',
          'vcc', 'gnd', 'vo', 'bl_a', 'bl_k'] },
    ];
    const nets = [
      { id: 'n_vcc', terminals: [{ part: 'vcc1', terminal: 'vcc' }, { part: 'lcd1', terminal: 'vcc' }, { part: 'lcd1', terminal: 'bl_a' }] },
      { id: 'n_gnd', terminals: [{ part: 'gnd1', terminal: 'gnd' }, { part: 'lcd1', terminal: 'gnd' }, { part: 'lcd1', terminal: 'bl_k' }] },
    ];
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);
    board.advanceTo(1n);
    const ds = board.getDeviceState('lcd1');
    assert.ok(ds, 'char_lcd must have registry device state on the board');
    assert.equal(ds.text.length, 2);
    assert.equal(ds.text[0].length, 16);
    assert.equal(ds.displayOn, false, 'display starts off, like real silicon');
  });
});
