/**
 * Golden cube trace: replay a known pin sequence and verify
 * cubeBrightness matches the expected duty per voxel.
 *
 * This is the cross-check that pins bw-board's cubeBrightness and
 * bw-circuit-ui's scan accumulator together. Both should produce
 * the same 64 values for the same trace.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { cubeTrace, expectedBrightness } from './golden/cube-trace.js';

function buildCubeBoard() {
  const { scanLines, dataBits, polarity } = cubeTrace;

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

function replayTrace(board, selectPins, dataPins) {
  const { scanLines, dataBits, lineTimeNs, scans, dataPerLine } = cubeTrace;

  for (let scan = 0; scan < scans; scan++) {
    for (let line = 0; line < scanLines; line++) {
      const t = BigInt(scan * scanLines + line) * lineTimeNs;

      // Deselect all
      for (const sp of selectPins) board.setPin(sp, 'pushpull', false);

      // Set data bits
      const pattern = dataPerLine[line];
      for (let bit = 0; bit < dataBits; bit++) {
        board.setPin(dataPins[bit], 'pushpull', !!((pattern >> bit) & 1));
      }

      // Select this line
      board.setPin(selectPins[line], 'pushpull', true);
      board.advanceTo(t);
    }
  }
  // Final advance past the last scan
  board.advanceTo(BigInt(scans * scanLines) * lineTimeNs);
}

describe('golden cube trace: duty per voxel', () => {
  it('matches expected brightness for all 64 voxels', () => {
    const { parts, nets, selectPins, dataPins } = buildCubeBoard();
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);

    replayTrace(board, selectPins, dataPins);

    const actual = board.cubeBrightness('CUBE');
    assert.equal(actual.length, 64);

    let mismatches = 0;
    for (let v = 0; v < 64; v++) {
      const exp = expectedBrightness[v];
      const act = actual[v];
      const line = Math.floor(v / 8);
      const col = v % 8;

      // Allow ±10% tolerance: the last active scan line gets extra
      // time because it's still selected when we query. This is the
      // same timing artifact as in the LED POV tests.
      if (Math.abs(act - exp) > 0.10) {
        console.log(`# MISMATCH voxel [${line},${col}]: expected=${(exp*100).toFixed(1)}% actual=${(act*100).toFixed(1)}%`);
        mismatches++;
      }
    }

    assert.equal(mismatches, 0, `${mismatches} voxels differ from expected`);
  });

  it('lit voxels at 12.5%, dark voxels at 0%', () => {
    const { parts, nets, selectPins, dataPins } = buildCubeBoard();
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);

    replayTrace(board, selectPins, dataPins);

    const actual = board.cubeBrightness('CUBE');

    // Pattern: even lines have 0x0F (cols 0-3), odd lines have 0xF0 (cols 4-7)
    let litCount = 0, darkCount = 0;
    for (let v = 0; v < 64; v++) {
      const exp = expectedBrightness[v];
      if (exp > 0) {
        assert.ok(actual[v] > 0.08,
          `voxel ${v} should be lit: ${(actual[v]*100).toFixed(1)}%`);
        litCount++;
      } else {
        assert.ok(actual[v] < 0.02,
          `voxel ${v} should be dark: ${(actual[v]*100).toFixed(1)}%`);
        darkCount++;
      }
    }

    // With alternating 0x0F/0xF0: each line lights 4 of 8 cols → 32 lit, 32 dark
    assert.equal(litCount, 32, '32 voxels lit');
    assert.equal(darkCount, 32, '32 voxels dark');

    console.log(`# Cube trace: ${litCount} lit at ~12.5%, ${darkCount} dark`);
  });

  it('expected brightness array is self-consistent', () => {
    // Verify the oracle itself
    assert.equal(expectedBrightness.length, 64);

    const litVoxels = expectedBrightness.filter(b => b > 0);
    assert.equal(litVoxels.length, 32, '32 lit');
    for (const b of litVoxels) {
      assert.ok(Math.abs(b - 0.125) < 0.001, `expected duty: ${b} ≈ 0.125`);
    }
  });
});
