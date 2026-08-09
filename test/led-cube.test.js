/**
 * LED cube: 4x4x4 multiplexed LED cube with POV integration.
 *
 * Polarity is a parameter, not an assumption: 'active-high' (default)
 * means pin HIGH lights the voxel; 'active-low' means pin LOW does.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';

function makeCube(polarity = 'active-high') {
  const selectPins = ['P2.0', 'P2.1', 'P2.2', 'P2.3'];
  const dataPins = [];
  for (let i = 0; i < 16; i++) dataPins.push(`P0.${i}`);

  const mcuTerminals = [...selectPins, ...dataPins];

  const parts = [
    { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
    { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'CUBE', kind: 'led_cube', params: {
      layers: 4, cols: 16, polarity, selectPins, dataPins,
    }, terminals: [] },
    { id: 'MCU', kind: 'mcu', params: {}, terminals: mcuTerminals },
  ];

  const nets = [
    { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }] },
    { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] },
  ];

  // Each MCU pin on its own net
  for (const pin of mcuTerminals) {
    nets.push({ id: `n_${pin}`, terminals: [{ part: 'MCU', terminal: pin }] });
  }

  return { parts, nets, selectPins, dataPins };
}

describe('LED cube: basic voxel control', () => {
  it('all dark initially', () => {
    const { parts, nets } = makeCube();
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);
    board.advanceTo(25_000_000n);

    const brightness = board.cubeBrightness('CUBE');
    assert.equal(brightness.length, 64, '4×4×4 = 64 voxels');
    assert.ok(brightness.every(b => b === 0), 'all dark');
  });

  it('one voxel lit: select layer 0, data col 0', () => {
    const { parts, nets, selectPins, dataPins } = makeCube();
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);

    // Select layer 0, data col 0
    board.setPin(selectPins[0], 'pushpull', true); // active-high: HIGH = active
    board.setPin(dataPins[0], 'pushpull', true);
    board.advanceTo(25_000_000n);

    const b = board.cubeBrightness('CUBE');
    assert.ok(b[0] > 0.9, `voxel [0,0] lit: ${b[0]}`);
    assert.ok(b[1] === 0, 'voxel [0,1] dark');
    assert.ok(b[16] === 0, 'voxel [1,0] dark (different layer)');
  });

  it('active-low polarity: LOW lights the voxel', () => {
    const { parts, nets, selectPins, dataPins } = makeCube('active-low');
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);

    // Active-low: LOW = active
    board.setPin(selectPins[0], 'pushpull', false); // LOW = select
    board.setPin(dataPins[0], 'pushpull', false); // LOW = lit
    board.advanceTo(25_000_000n);

    const b = board.cubeBrightness('CUBE');
    assert.ok(b[0] > 0.9, `active-low voxel [0,0]: ${b[0]}`);
  });

  it('active-low: HIGH means dark', () => {
    const { parts, nets, selectPins, dataPins } = makeCube('active-low');
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);

    board.setPin(selectPins[0], 'pushpull', false); // select
    board.setPin(dataPins[0], 'pushpull', true); // HIGH = dark in active-low
    board.advanceTo(25_000_000n);

    const b = board.cubeBrightness('CUBE');
    assert.ok(b[0] === 0, `active-low HIGH = dark: ${b[0]}`);
  });
});

describe('LED cube: POV scanning', () => {
  it('scanning 4 layers at 120Hz: each voxel ~25% brightness', () => {
    const { parts, nets, selectPins, dataPins } = makeCube();
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);

    // Scan 4 layers at 120 Hz = 2.083ms per layer
    // Each layer ON for 1/4 of the time
    const LAYER_NS = 2_083_333n; // ~2.083ms
    const SCAN_CYCLES = 15; // 15 full scans = ~125ms, well past 20ms window

    // Light all columns on every layer
    for (const dp of dataPins) {
      board.setPin(dp, 'pushpull', true);
    }

    for (let scan = 0; scan < SCAN_CYCLES; scan++) {
      for (let layer = 0; layer < 4; layer++) {
        const t = BigInt(scan * 4 + layer) * LAYER_NS;
        // Deselect all layers
        for (const sp of selectPins) {
          board.setPin(sp, 'pushpull', false);
        }
        // Select this layer
        board.setPin(selectPins[layer], 'pushpull', true);
        board.advanceTo(t);
      }
    }
    board.advanceTo(BigInt(SCAN_CYCLES * 4) * LAYER_NS);

    const b = board.cubeBrightness('CUBE');

    // Each voxel is lit ~1/4 of the time. The last active layer gets
    // a slightly larger share because it's still selected at query time.
    // Accept 0.15–0.40 to account for scan timing within the window.
    for (let v = 0; v < 64; v++) {
      assert.ok(b[v] > 0.15 && b[v] < 0.40,
        `voxel ${v}: ${b[v].toFixed(3)} ≈ 0.25`);
    }
  });

  it('one layer always on: 100% brightness for that layer', () => {
    const { parts, nets, selectPins, dataPins } = makeCube();
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);

    // Layer 0 always on, all columns on
    board.setPin(selectPins[0], 'pushpull', true);
    for (const dp of dataPins) {
      board.setPin(dp, 'pushpull', true);
    }
    board.advanceTo(25_000_000n);

    const b = board.cubeBrightness('CUBE');

    // Layer 0: 100% brightness
    for (let col = 0; col < 16; col++) {
      assert.ok(b[col] > 0.9, `layer 0 col ${col}: ${b[col]}`);
    }

    // Other layers: 0% brightness
    for (let v = 16; v < 64; v++) {
      assert.equal(b[v], 0, `layer ${Math.floor(v/16)} col ${v%16}: dark`);
    }
  });
});

describe('LED cube: performance', () => {
  it('120Hz scan rate: 960 select changes/sec', () => {
    const { parts, nets, selectPins, dataPins } = makeCube();
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);

    for (const dp of dataPins) {
      board.setPin(dp, 'pushpull', true);
    }

    const LAYER_NS = 2_083_333n;
    const SCANS = 120; // 1 second of scanning

    const start = performance.now();
    for (let scan = 0; scan < SCANS; scan++) {
      for (let layer = 0; layer < 4; layer++) {
        const t = BigInt(scan * 4 + layer) * LAYER_NS;
        for (const sp of selectPins) board.setPin(sp, 'pushpull', false);
        board.setPin(selectPins[layer], 'pushpull', true);
        board.advanceTo(t);
      }
    }
    const elapsed = performance.now() - start;

    console.log(`# Cube scan: ${SCANS} scans (${SCANS*4} layer changes) in ${elapsed.toFixed(0)}ms`);
    console.log(`# = ${(SCANS * 4 / (elapsed / 1000) / 1000).toFixed(1)}K layer changes/sec`);

    // cubeBrightness on 64 voxels
    const start2 = performance.now();
    for (let frame = 0; frame < 60; frame++) {
      board.cubeBrightness('CUBE');
    }
    const elapsed2 = performance.now() - start2;
    console.log(`# cubeBrightness: 60 frames in ${elapsed2.toFixed(0)}ms = ${(60/(elapsed2/1000)).toFixed(0)} fps`);

    assert.ok(elapsed < 2000, `scan should complete in <2s: ${elapsed.toFixed(0)}ms`);
    assert.ok(elapsed2 < 500, `60 brightness frames in <500ms: ${elapsed2.toFixed(0)}ms`);
  });
});
