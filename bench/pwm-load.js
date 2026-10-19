/**
 * PWM edge workload measurement.
 *
 * Three questions:
 *   1. Does setPin force a solve? (closed-form fast path vs MNA)
 *   2. What happens with a meter attached? (branchCurrent per edge)
 *   3. What is the sustainable edge rate?
 */

import { BoardImpl } from '../src/board.js';
import { inferNetlist } from '../src/infer-netlist.js';
import { readFileSync, existsSync } from 'node:fs';

import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const DIMMER_PINS = path.resolve(here, '../../stc/examples/06-dimmer/pins.json');

// ─── Build the 06-dimmer circuit ──────────────────────────────────────────

let stc;
if (existsSync(DIMMER_PINS)) {
  stc = JSON.parse(readFileSync(DIMMER_PINS, 'utf-8'));
} else {
  // Fallback: manual dimmer-like circuit
  stc = {
    pins: [
      { name: 'pot', port: 1, bit: 2, direction: 'analog', activeLow: false },
      { name: 'lamp', port: 1, bit: 3, direction: 'pwm', activeLow: true },
    ],
  };
}

const { parts, nets } = inferNetlist(stc);

// PCA 8-bit PWM parameters
const FOSC = 11059200;
const PCA_RATE = FOSC / 12 / 256; // ≈ 3600 Hz
const EDGES_PER_SEC = PCA_RATE * 2; // ≈ 7200 edges/sec (on + off)
const TICK_NS = 1085n; // 1/921600 s in ns
const PERIOD_NS = 256n * TICK_NS; // one PWM period

console.log('PWM Edge Workload Measurement');
console.log('═'.repeat(70));
console.log(`PCA rate: ${PCA_RATE.toFixed(0)} Hz, edges/sec: ${EDGES_PER_SEC.toFixed(0)}`);
console.log();

// ─── Q1: Does setPin force a solve? ───────────────────────────────────────

{
  console.log('Q1: Does setPin force a solve?');
  console.log('─'.repeat(70));

  const board = new BoardImpl(5.0);
  board.setNetlist(parts, nets);
  board.setPin('P1.2', 'input', false);
  board.setControl('POT_pot', 0.5);

  // Measure setPin alone (no branchCurrent)
  const N = 50000;
  const start = performance.now();
  for (let i = 0; i < N; i++) {
    board.setPin('P1.3', 'quasi', i % 2 === 0);
  }
  const elapsed = performance.now() - start;
  const setPinRate = N / (elapsed / 1000);

  // Measure advanceTo alone
  const board2 = new BoardImpl(5.0);
  board2.setNetlist(parts, nets);
  board2.setPin('P1.2', 'input', false);
  board2.setPin('P1.3', 'quasi', false);
  const start2 = performance.now();
  for (let i = 0; i < N; i++) {
    board2.advanceTo(BigInt(i) * 100n);
  }
  const elapsed2 = performance.now() - start2;
  const advanceRate = N / (elapsed2 / 1000);

  console.log(`  setPin alone:   ${(setPinRate / 1000).toFixed(1)}K ops/sec`);
  console.log(`  advanceTo alone: ${(advanceRate / 1000).toFixed(1)}K ops/sec`);
  console.log(`  setPin triggers the closed-form solver (_solve), NOT the MNA.`);
  console.log(`  MNA is only reached by branchCurrent/resistance.`);
  console.log();
}

// ─── Q2: What happens with a meter attached? ──────────────────────────────

{
  console.log('Q2: branchCurrent (MNA) called every edge — the performance cliff');
  console.log('─'.repeat(70));

  const board = new BoardImpl(5.0);
  board.setNetlist(parts, nets);
  board.setPin('P1.2', 'input', false);
  board.setPin('P1.3', 'quasi', false);
  board.setControl('POT_pot', 0.5);
  board.advanceTo(1_000_000n);

  // Measure branchCurrent per edge
  const N = 5000;
  const start = performance.now();
  for (let i = 0; i < N; i++) {
    board.setPin('P1.3', 'quasi', i % 2 === 0);
    board.branchCurrent('LED_lamp', 'anode'); // forces MNA
  }
  const elapsed = performance.now() - start;
  const mnaPerEdge = N / (elapsed / 1000);

  console.log(`  setPin + branchCurrent: ${(mnaPerEdge / 1000).toFixed(1)}K ops/sec`);
  console.log(`  PCA edge rate:          ${(EDGES_PER_SEC / 1000).toFixed(1)}K edges/sec (real time)`);
  console.log(`  Headroom at 1× real time: ${(mnaPerEdge / EDGES_PER_SEC).toFixed(1)}×`);
  console.log(`  Headroom at 10× real time: ${(mnaPerEdge / (EDGES_PER_SEC * 10)).toFixed(1)}×`);

  if (mnaPerEdge > EDGES_PER_SEC) {
    console.log(`  → FINE at real time.`);
  }
  if (mnaPerEdge > EDGES_PER_SEC * 10) {
    console.log(`  → FINE even at 10× real time.`);
  } else if (mnaPerEdge < EDGES_PER_SEC * 10) {
    console.log(`  → NOT fine at 10× real time. Meter blocks would need to sample,`);
    console.log(`    not solve per edge.`);
  }
  console.log();
}

// ─── Q3: Realistic PWM loop (setPin + advanceTo, no MNA) ─────────────────

{
  console.log('Q3: Realistic PWM loop (setPin + advanceTo, no meter)');
  console.log('─'.repeat(70));

  const board = new BoardImpl(5.0);
  board.setNetlist(parts, nets);
  board.setPin('P1.2', 'input', false);
  board.setControl('POT_pot', 0.5);

  // Simulate 1 second of PCA PWM at 50% duty
  const CYCLES = 3600;
  const start = performance.now();
  for (let c = 0; c < CYCLES; c++) {
    const base = BigInt(c) * PERIOD_NS;
    board.advanceTo(base);
    board.setPin('P1.3', 'quasi', false); // on
    board.advanceTo(base + 128n * TICK_NS);
    board.setPin('P1.3', 'quasi', true);  // off
  }
  board.advanceTo(BigInt(CYCLES) * PERIOD_NS);
  const elapsed = performance.now() - start;

  const totalCalls = CYCLES * 4; // 2 advanceTo + 2 setPin per cycle
  const callsPerSec = totalCalls / (elapsed / 1000);
  const simSeconds = 1.0; // we simulated 1 second
  const realTimeRatio = simSeconds / (elapsed / 1000);

  console.log(`  ${totalCalls} calls in ${elapsed.toFixed(0)}ms`);
  console.log(`  = ${(callsPerSec / 1000).toFixed(1)}K calls/sec`);
  console.log(`  Simulated 1 second in ${elapsed.toFixed(0)}ms wall time`);
  console.log(`  = ${realTimeRatio.toFixed(1)}× real time`);
  console.log(`  LED brightness: ${board.ledBrightness('LED_lamp').toFixed(4)}`);
  console.log();
}

// ─── Q3b: Shift register burst pattern ────────────────────────────────────

{
  console.log('Q3b: 74HC595 burst pattern (24 edges per write)');
  console.log('─'.repeat(70));

  const board = new BoardImpl(5.0);
  // Simple circuit: 3 MCU pins + GND
  board.setNetlist(
    [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P3.4', 'P3.5', 'P3.6'] },
    ],
    [
      { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }] },
      { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] },
      { id: 'nd', terminals: [{ part: 'MCU', terminal: 'P3.4' }] },
      { id: 'nl', terminals: [{ part: 'MCU', terminal: 'P3.5' }] },
      { id: 'nc', terminals: [{ part: 'MCU', terminal: 'P3.6' }] },
    ],
  );

  // 595 write: 8 bits × (set data + clock high + clock low) = 24 edges + latch
  const WRITES = 10000;
  const start = performance.now();
  let t = 0n;
  for (let w = 0; w < WRITES; w++) {
    for (let bit = 0; bit < 8; bit++) {
      board.setPin('P3.4', 'pushpull', (w >> bit) & 1 ? true : false); // data
      board.advanceTo(t); t += 1000n;
      board.setPin('P3.6', 'pushpull', true);  // clock high
      board.advanceTo(t); t += 1000n;
      board.setPin('P3.6', 'pushpull', false); // clock low
      board.advanceTo(t); t += 1000n;
    }
    board.setPin('P3.5', 'pushpull', true);  // latch high
    board.advanceTo(t); t += 1000n;
    board.setPin('P3.5', 'pushpull', false); // latch low
    board.advanceTo(t); t += 1000n;
  }
  const elapsed = performance.now() - start;
  const edgesPerWrite = 8 * 3 + 2; // 26 edges per write
  const totalEdges = WRITES * edgesPerWrite;
  const edgesPerSec = totalEdges / (elapsed / 1000);

  console.log(`  ${WRITES} 595 writes (${totalEdges} total edges) in ${elapsed.toFixed(0)}ms`);
  console.log(`  = ${(edgesPerSec / 1000).toFixed(0)}K edges/sec`);
  console.log();
}

console.log('═'.repeat(70));
console.log('Summary:');
console.log('  setPin does NOT trigger MNA — only the closed-form solver.');
console.log('  MNA is triggered ONLY by branchCurrent/resistance calls.');
console.log('  A meter block polling branchCurrent per edge is the cliff.');
console.log('  Fix if needed: meter blocks sample at display rate (~60Hz),');
console.log('  not per edge.');
