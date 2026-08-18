/**
 * MATRIX8X8 per-pixel brightness-level surface tests.
 *
 * Hand-computed oracles: duty cycle → brightness → quantized level.
 * MATRIX_LEVELS = 3 → thresholds at 1/6, 1/2, 5/6 (round boundaries).
 *   duty  0.00 → level 0  (off)
 *   duty  0.25 → level 1  (dim)   — round(0.25*3)=round(0.75)=1
 *   duty  0.50 → level 2  (mid)   — round(0.50*3)=round(1.50)=2
 *   duty  0.75 → level 2  (mid)   — round(0.75*3)=round(2.25)=2
 *   duty  0.85 → level 3  (full)  — round(0.85*3)=round(2.55)=3
 *   duty  1.00 → level 3  (full)  — round(1.00*3)=round(3.00)=3
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';
import { MATRIX_LEVELS } from '../src/devices/matrix8x8.js';

registerAllDevices();

const net = (id, ...terms) => ({
  id,
  terminals: terms.map(([p, t]) => ({ part: p, terminal: t })),
});

/** Build an 8×8 matrix rig with col-active-high, row-active-high. */
function matrixRig() {
  const board = new BoardImpl(5.0);
  const colPins = Array.from({ length: 8 }, (_, i) => `col${i}`);
  const rowPins = Array.from({ length: 8 }, (_, i) => `row${i}`);
  board.setNetlist(
    [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'MCU', kind: 'mcu', params: {}, terminals: [...colPins, ...rowPins] },
      { id: 'M1', kind: 'matrix8x8', params: {},
        terminals: [...colPins, ...rowPins] },
    ],
    [
      ...colPins.map(c => net(`n_${c}`, ['MCU', c], ['M1', c])),
      ...rowPins.map(r => net(`n_${r}`, ['MCU', r], ['M1', r])),
    ],
  );
  board.setPower(true);
  let t = 0n;
  const tick = (ns = 1000n) => { t += ns; board.advanceTo(t); };

  /** Drive a single pixel (col, row) on/off for a fraction of a 20 ms window. */
  const drivePixelDuty = (col, row, duty) => {
    const windowNs = 20_000_000n; // default POV window
    const onNs = BigInt(Math.round(Number(windowNs) * duty));
    const offNs = windowNs - onNs;
    // All off first
    for (let c = 0; c < 8; c++) board.setPin(`col${c}`, 'pushpull', false);
    for (let r = 0; r < 8; r++) board.setPin(`row${r}`, 'pushpull', false);
    tick(1000n);
    // Turn on the target pixel
    board.setPin(`col${col}`, 'pushpull', true);
    board.setPin(`row${row}`, 'pushpull', true);
    if (onNs > 0n) tick(onNs);
    // Turn off
    board.setPin(`col${col}`, 'pushpull', false);
    board.setPin(`row${row}`, 'pushpull', false);
    if (offNs > 0n) tick(offNs);
    // One extra window to flush
    tick(windowNs);
  };

  return { board, tick };
}

describe('MATRIX8X8 brightness levels', () => {
  it('MATRIX_LEVELS is exported and equals 3', () => {
    assert.equal(MATRIX_LEVELS, 3);
  });

  it('levels array exists in device state with correct size', () => {
    const { board, tick } = matrixRig();
    tick(1000n);
    const st = board.getDeviceState('M1');
    assert.ok(st.levels instanceof Uint8Array, 'levels is Uint8Array');
    assert.equal(st.levels.length, 64, '8×8 = 64 pixels');
  });

  it('all-off → all levels are 0', () => {
    const { board, tick } = matrixRig();
    // All pins low (default), advance past one window
    tick(25_000_000n);
    const st = board.getDeviceState('M1');
    for (let i = 0; i < 64; i++) {
      assert.equal(st.levels[i], 0, `pixel ${i} is off`);
    }
  });

  it('100% duty → level MATRIX_LEVELS (full on)', () => {
    const { board, tick } = matrixRig();
    // Light pixel (0,0) for an entire window
    board.setPin('col0', 'pushpull', true);
    board.setPin('row0', 'pushpull', true);
    tick(20_000_000n); // one full window
    tick(20_000_000n); // second window flushes the first
    const st = board.getDeviceState('M1');
    assert.equal(st.levels[0], MATRIX_LEVELS, 'pixel (0,0) at full');
    assert.equal(st.brightness[0], 1.0, 'analog brightness is 1.0');
  });

  it('0% duty → level 0 (off)', () => {
    const { board, tick } = matrixRig();
    // All pins default low, advance two windows
    tick(40_000_000n);
    const st = board.getDeviceState('M1');
    assert.equal(st.levels[0], 0, 'pixel (0,0) is off');
    assert.equal(st.brightness[0], 0.0, 'analog brightness is 0.0');
  });

  it('~50% duty → level 2 (mid)', () => {
    const { board, tick } = matrixRig();
    const windowNs = 20_000_000n;
    // Run two identical 50% duty windows so the second window's result
    // reflects the duty (the first window is needed to prime _prevOn).
    for (let pass = 0; pass < 2; pass++) {
      board.setPin('col0', 'pushpull', true);
      board.setPin('row0', 'pushpull', true);
      tick(windowNs / 2n);
      board.setPin('col0', 'pushpull', false);
      board.setPin('row0', 'pushpull', false);
      tick(windowNs / 2n);
    }
    const st = board.getDeviceState('M1');
    // round(0.5 * 3) = round(1.5) = 2
    assert.equal(st.levels[0], 2, '50% duty → level 2 (mid)');
  });

  it('~25% duty → level 1 (dim)', () => {
    const { board, tick } = matrixRig();
    const windowNs = 20_000_000n;
    const onNs = windowNs / 4n;
    for (let pass = 0; pass < 2; pass++) {
      board.setPin('col0', 'pushpull', true);
      board.setPin('row0', 'pushpull', true);
      tick(onNs);
      board.setPin('col0', 'pushpull', false);
      board.setPin('row0', 'pushpull', false);
      tick(windowNs - onNs);
    }
    const st = board.getDeviceState('M1');
    // round(0.25 * 3) = round(0.75) = 1
    assert.equal(st.levels[0], 1, '25% duty → level 1 (dim)');
  });

  it('on/off is sugar: on = MAX, off = 0', () => {
    const { board, tick } = matrixRig();
    const windowNs = 20_000_000n;
    // Fully on
    board.setPin('col0', 'pushpull', true);
    board.setPin('row0', 'pushpull', true);
    tick(windowNs);
    tick(windowNs);
    let st = board.getDeviceState('M1');
    assert.equal(st.levels[0], MATRIX_LEVELS, '"on" = level MAX');
    // Turn off
    board.setPin('col0', 'pushpull', false);
    board.setPin('row0', 'pushpull', false);
    tick(windowNs);
    tick(windowNs);
    st = board.getDeviceState('M1');
    assert.equal(st.levels[0], 0, '"off" = level 0');
  });

  it('different pixels can have different levels simultaneously', () => {
    const { board, tick } = matrixRig();
    const windowNs = 20_000_000n;
    // Two passes so the second window has the correct duty.
    // Pixel (0,0): 100% on (level 3)
    // Pixel (1,0): ~50% on (level 2)
    // Pixel (2,0): 0% (level 0)
    for (let pass = 0; pass < 2; pass++) {
      board.setPin('col0', 'pushpull', true);
      board.setPin('col1', 'pushpull', true);
      board.setPin('row0', 'pushpull', true);
      tick(windowNs / 2n);
      // Turn off col1 for second half
      board.setPin('col1', 'pushpull', false);
      tick(windowNs / 2n);
    }
    const st = board.getDeviceState('M1');
    assert.equal(st.levels[0], MATRIX_LEVELS, 'pixel (0,0) full');
    assert.equal(st.levels[1], 2, 'pixel (1,0) mid');
    assert.equal(st.levels[2], 0, 'pixel (2,0) off');
  });

  it('levels grid is row-major: row*cols+col', () => {
    const { board, tick } = matrixRig();
    const windowNs = 20_000_000n;
    // Light pixel at col=3, row=2 → index 2*8+3 = 19
    board.setPin('col3', 'pushpull', true);
    board.setPin('row2', 'pushpull', true);
    tick(windowNs);
    tick(windowNs);
    const st = board.getDeviceState('M1');
    assert.equal(st.levels[2 * 8 + 3], MATRIX_LEVELS, 'pixel (3,2) at index 19');
    // All others should be 0
    for (let i = 0; i < 64; i++) {
      if (i !== 19) assert.equal(st.levels[i], 0, `pixel ${i} is off`);
    }
  });
});
