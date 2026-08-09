/**
 * LED cube: multiplexed LED cube with POV integration.
 *
 * Default: 8 scan lines × 8 data bits (matching the STC12 cube hardware:
 * 4 layers × 2 colour groups, P0 as 8-bit data, P2 as 8-bit select).
 *
 * A voxel lit on exactly one of 8 scan lines has 12.5% duty (1/8).
 *
 * Polarity is a parameter, not an assumption.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';

function makeCube(opts = {}) {
  const scanLines = opts.scanLines ?? 8;
  const dataBits = opts.dataBits ?? 8;
  const polarity = opts.polarity ?? 'active-high';

  const selectPins = [];
  for (let i = 0; i < scanLines; i++) selectPins.push(`P2.${i}`);
  const dataPins = [];
  for (let i = 0; i < dataBits; i++) dataPins.push(`P0.${i}`);

  const mcuTerminals = [...selectPins, ...dataPins];

  const parts = [
    { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
    { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'CUBE', kind: 'led_cube', params: {
      layers: scanLines, cols: dataBits, polarity, selectPins, dataPins,
    }, terminals: [] },
    { id: 'MCU', kind: 'mcu', params: {}, terminals: mcuTerminals },
  ];

  const nets = [
    { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }] },
    { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] },
  ];
  for (const pin of mcuTerminals) {
    nets.push({ id: `n_${pin}`, terminals: [{ part: 'MCU', terminal: pin }] });
  }

  return { parts, nets, selectPins, dataPins };
}

describe('LED cube: basic voxel control', () => {
  it('default: 8 scan × 8 data = 64 voxels', () => {
    const { parts, nets } = makeCube();
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);
    board.advanceTo(25_000_000n);

    const b = board.cubeBrightness('CUBE');
    assert.equal(b.length, 64);
    assert.ok(b.every(v => v === 0), 'all dark');
  });

  it('one voxel lit: select line 0, data bit 0', () => {
    const { parts, nets, selectPins, dataPins } = makeCube();
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);
    board.setPin(selectPins[0], 'pushpull', true);
    board.setPin(dataPins[0], 'pushpull', true);
    board.advanceTo(25_000_000n);

    const b = board.cubeBrightness('CUBE');
    assert.ok(b[0] > 0.9, `voxel [0,0]: ${b[0]}`);
    assert.equal(b[1], 0);
    assert.equal(b[8], 0, 'different scan line');
  });
});

describe('LED cube: polarity parameter', () => {
  it('active-high: HIGH = lit', () => {
    const { parts, nets, selectPins, dataPins } = makeCube();
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);
    board.setPin(selectPins[0], 'pushpull', true);
    board.setPin(dataPins[0], 'pushpull', true);
    board.advanceTo(25_000_000n);
    assert.ok(board.cubeBrightness('CUBE')[0] > 0.9);
  });

  it('active-low: LOW = lit', () => {
    const { parts, nets, selectPins, dataPins } = makeCube({ polarity: 'active-low' });
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);
    board.setPin(selectPins[0], 'pushpull', false);
    board.setPin(dataPins[0], 'pushpull', false);
    board.advanceTo(25_000_000n);
    assert.ok(board.cubeBrightness('CUBE')[0] > 0.9);
  });

  it('flipping polarity inverts the result', () => {
    const drive = (pol) => {
      const { parts, nets, selectPins, dataPins } = makeCube({ polarity: pol });
      const board = new BoardImpl(5.0);
      board.setNetlist(parts, nets);
      board.setPin(selectPins[0], 'pushpull', true);
      board.setPin(dataPins[0], 'pushpull', true);
      board.advanceTo(25_000_000n);
      return board.cubeBrightness('CUBE')[0];
    };
    assert.ok(drive('active-high') > 0.9);
    assert.equal(drive('active-low'), 0);
  });
});

describe('LED cube: POV duty cycle', () => {
  it('8-line scan: 1/8 duty = 12.5% brightness per voxel', () => {
    const { parts, nets, selectPins, dataPins } = makeCube();
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);

    for (const dp of dataPins) board.setPin(dp, 'pushpull', true);

    // 8 scan lines at ~1.006ms each (measured from emu8051-stc)
    const LINE_NS = 1_006_000n;
    const SCANS = 20;

    for (let scan = 0; scan < SCANS; scan++) {
      for (let line = 0; line < 8; line++) {
        const t = BigInt(scan * 8 + line) * LINE_NS;
        for (const sp of selectPins) board.setPin(sp, 'pushpull', false);
        board.setPin(selectPins[line], 'pushpull', true);
        board.advanceTo(t);
      }
    }
    board.advanceTo(BigInt(SCANS * 8) * LINE_NS);

    const b = board.cubeBrightness('CUBE');

    // 1/8 duty = 12.5%. Allow scan-edge timing variance.
    for (let v = 0; v < 64; v++) {
      assert.ok(b[v] > 0.08 && b[v] < 0.22,
        `voxel ${v}: ${(b[v]*100).toFixed(1)}% ≈ 12.5%`);
    }
  });

  it('4-line custom cube: 1/4 duty = 25%', () => {
    const { parts, nets, selectPins, dataPins } = makeCube({ scanLines: 4 });
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);

    for (const dp of dataPins) board.setPin(dp, 'pushpull', true);

    const LINE_NS = 2_000_000n;
    const SCANS = 15;

    for (let scan = 0; scan < SCANS; scan++) {
      for (let line = 0; line < 4; line++) {
        const t = BigInt(scan * 4 + line) * LINE_NS;
        for (const sp of selectPins) board.setPin(sp, 'pushpull', false);
        board.setPin(selectPins[line], 'pushpull', true);
        board.advanceTo(t);
      }
    }
    board.advanceTo(BigInt(SCANS * 4) * LINE_NS);

    const b = board.cubeBrightness('CUBE');
    // The last active scan line gets extra time (still selected at query).
    // Accept wider range for that line.
    for (let v = 0; v < 32; v++) {
      assert.ok(b[v] > 0.12 && b[v] < 0.45,
        `voxel ${v}: ${(b[v]*100).toFixed(1)}% ≈ 25%`);
    }
  });

  it('static single line: 100% for that line, 0% for others', () => {
    const { parts, nets, selectPins, dataPins } = makeCube();
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);

    board.setPin(selectPins[0], 'pushpull', true);
    for (const dp of dataPins) board.setPin(dp, 'pushpull', true);
    board.advanceTo(25_000_000n);

    const b = board.cubeBrightness('CUBE');
    for (let col = 0; col < 8; col++) assert.ok(b[col] > 0.9);
    for (let v = 8; v < 64; v++) assert.equal(b[v], 0);
  });
});

describe('LED cube: performance', () => {
  it('120Hz scan of 8 lines + 60fps cubeBrightness', () => {
    const { parts, nets, selectPins, dataPins } = makeCube();
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);
    for (const dp of dataPins) board.setPin(dp, 'pushpull', true);

    const LINE_NS = 1_006_000n;
    const SCANS = 120;

    const s1 = performance.now();
    for (let scan = 0; scan < SCANS; scan++) {
      for (let line = 0; line < 8; line++) {
        const t = BigInt(scan * 8 + line) * LINE_NS;
        for (const sp of selectPins) board.setPin(sp, 'pushpull', false);
        board.setPin(selectPins[line], 'pushpull', true);
        board.advanceTo(t);
      }
    }
    const e1 = performance.now() - s1;
    console.log(`# Cube scan: ${SCANS*8} line changes in ${e1.toFixed(0)}ms`);

    const s2 = performance.now();
    for (let f = 0; f < 60; f++) board.cubeBrightness('CUBE');
    const e2 = performance.now() - s2;
    console.log(`# cubeBrightness: 60 frames in ${e2.toFixed(0)}ms = ${(60/(e2/1000)).toFixed(0)} fps`);

    assert.ok(e1 < 2000);
    assert.ok(e2 < 500);
  });
});
