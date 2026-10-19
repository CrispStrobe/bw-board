/**
 * Performance benchmark for bw-board.
 *
 * Measures throughput of the three main code paths:
 *   1. advanceTo() with pin toggling (simulated 1 kHz PWM loop)
 *   2. branchCurrent() — MNA solver
 *   3. setPin() — closed-form solver
 *
 * Run: node bench/perf.js
 */

import { BoardImpl } from '../src/board.js';

// ─── Netlist: 10 parts ──────────────────────────────────────────────────────
// VCC, GND, MCU, 2× (LED + resistor), 1 pot, 1 button + pull-up resistor, 1 buzzer

const parts = [
  { id: 'VCC',  kind: 'vcc',       params: {},              terminals: ['vcc'] },
  { id: 'GND',  kind: 'gnd',       params: {},              terminals: ['gnd'] },
  { id: 'MCU',  kind: 'mcu',       params: {},              terminals: ['P1.0', 'P1.1', 'P1.3', 'P1.5', 'P3.2'] },
  // LED1 chain: VCC → R1 → LED1 → P1.0 (active-low)
  { id: 'R1',   kind: 'resistor',  params: { ohms: 1000 },  terminals: ['a', 'b'] },
  { id: 'LED1', kind: 'led',       params: { vf: 2.0 },     terminals: ['anode', 'cathode'] },
  // LED2 chain: VCC → R2 → LED2 → P1.1 (active-low)
  { id: 'R2',   kind: 'resistor',  params: { ohms: 1000 },  terminals: ['a', 'b'] },
  { id: 'LED2', kind: 'led',       params: { vf: 2.0 },     terminals: ['anode', 'cathode'] },
  // Potentiometer: VCC → pot → GND, wiper → P1.3
  { id: 'POT',  kind: 'potentiometer', params: { ohms: 10000 }, terminals: ['a', 'b', 'wiper'] },
  // Button with pull-up: VCC → R3 → P3.2, button → GND
  { id: 'R3',   kind: 'resistor',  params: { ohms: 10000 }, terminals: ['a', 'b'] },
  { id: 'BTN',  kind: 'button',    params: {},              terminals: ['a', 'b'] },
  // Buzzer: P1.5 → buzzer → GND
  { id: 'BUZ',  kind: 'buzzer',    params: {},              terminals: ['a', 'b'] },
];

const nets = [
  // LED1 chain
  { id: 'n_vcc_r1',  terminals: [{ part: 'VCC', terminal: 'vcc' },   { part: 'R1', terminal: 'a' },    { part: 'POT', terminal: 'a' }, { part: 'R3', terminal: 'a' }] },
  { id: 'n_r1_led1', terminals: [{ part: 'R1',  terminal: 'b' },     { part: 'LED1', terminal: 'anode' }] },
  { id: 'n_led1_p',  terminals: [{ part: 'LED1', terminal: 'cathode' }, { part: 'MCU', terminal: 'P1.0' }] },
  // LED2 chain
  { id: 'n_vcc_r2',  terminals: [{ part: 'VCC', terminal: 'vcc' },   { part: 'R2', terminal: 'a' }] },
  { id: 'n_r2_led2', terminals: [{ part: 'R2',  terminal: 'b' },     { part: 'LED2', terminal: 'anode' }] },
  { id: 'n_led2_p',  terminals: [{ part: 'LED2', terminal: 'cathode' }, { part: 'MCU', terminal: 'P1.1' }] },
  // Pot
  { id: 'n_pot_gnd', terminals: [{ part: 'POT', terminal: 'b' },     { part: 'GND', terminal: 'gnd' }, { part: 'BTN', terminal: 'b' }, { part: 'BUZ', terminal: 'b' }] },
  { id: 'n_pot_w',   terminals: [{ part: 'POT', terminal: 'wiper' }, { part: 'MCU', terminal: 'P1.3' }] },
  // Button with pull-up
  { id: 'n_btn_p',   terminals: [{ part: 'R3', terminal: 'b' },      { part: 'BTN', terminal: 'a' }, { part: 'MCU', terminal: 'P3.2' }] },
  // Buzzer
  { id: 'n_buz_p',   terminals: [{ part: 'MCU', terminal: 'P1.5' },  { part: 'BUZ', terminal: 'a' }] },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createBoard() {
  const board = new BoardImpl(5.0);
  board.setNetlist(parts, nets);

  // Set initial pin modes
  board.setPin('P1.0', 'quasi', true);       // LED1 off
  board.setPin('P1.1', 'quasi', true);       // LED2 off
  board.setPin('P1.3', 'input', false);      // pot ADC input
  board.setPin('P1.5', 'pushpull', false);   // buzzer
  board.setPin('P3.2', 'input', false);      // button input

  board.setControl('POT', 0.5);
  board.setControl('BTN', 0);

  return board;
}

/**
 * Run a function for at least `minMs` and return ops/sec.
 * @param {string} name
 * @param {() => void} fn
 * @param {number} minMs - minimum wall-clock time to run
 * @returns {{ name: string, ops: number, totalMs: number, opsPerSec: number }}
 */
function bench(name, fn, minMs = 2000) {
  // Warmup
  for (let i = 0; i < 100; i++) fn();

  let ops = 0;
  const start = performance.now();
  let elapsed = 0;
  while (elapsed < minMs) {
    fn();
    ops++;
    // Check time every 256 ops to reduce overhead
    if ((ops & 0xFF) === 0) {
      elapsed = performance.now() - start;
    }
  }
  elapsed = performance.now() - start;
  const opsPerSec = (ops / elapsed) * 1000;
  return { name, ops, totalMs: elapsed, opsPerSec };
}

function formatResult(r) {
  const opsStr = r.opsPerSec >= 1e6
    ? `${(r.opsPerSec / 1e6).toFixed(2)}M`
    : r.opsPerSec >= 1e3
      ? `${(r.opsPerSec / 1e3).toFixed(1)}K`
      : r.opsPerSec.toFixed(0);
  return `  ${r.name.padEnd(45)} ${opsStr.padStart(10)} ops/sec  (${r.ops} ops in ${r.totalMs.toFixed(0)}ms)`;
}

// ─── Benchmarks ──────────────────────────────────────────────────────────────

console.log('bw-board performance benchmark');
console.log('='.repeat(80));
console.log();

// 1. advanceTo() throughput with PWM toggling
//    Simulates a 1 kHz PWM loop: each iteration = one full period (on+off)
{
  const board = createBoard();
  const periodNs = 1_000_000n; // 1 ms
  let cycle = 0n;

  const result = bench('advanceTo + setPin (1kHz PWM, 2 LEDs)', () => {
    const t = cycle * periodNs;
    board.advanceTo(t);
    board.setPin('P1.0', 'quasi', false);   // LED1 on
    board.setPin('P1.1', 'quasi', false);   // LED2 on
    board.advanceTo(t + periodNs / 2n);
    board.setPin('P1.0', 'quasi', true);    // LED1 off
    board.setPin('P1.1', 'quasi', true);    // LED2 off
    cycle++;
  });

  console.log('1) advanceTo() throughput (PWM loop with pin toggling)');
  console.log(formatResult(result));
  // Each iteration has 2 advanceTo + 4 setPin calls
  const innerOps = result.opsPerSec * 6;
  const innerStr = innerOps >= 1e6
    ? `${(innerOps / 1e6).toFixed(2)}M`
    : `${(innerOps / 1e3).toFixed(1)}K`;
  console.log(`  (${innerStr} individual advanceTo/setPin calls/sec)`);
  console.log();
}

// 2. MNA solver throughput — branchCurrent()
{
  const board = createBoard();
  board.setPin('P1.0', 'pushpull', false);  // LED1 on, strong drive
  board.setPin('P1.1', 'pushpull', false);  // LED2 on
  board.advanceTo(1_000_000n);

  const result = bench('branchCurrent (MNA solve)', () => {
    board.branchCurrent('LED1', 'anode');
  });

  console.log('2) MNA solver throughput (branchCurrent)');
  console.log(formatResult(result));

  // Sanity check: print the actual current
  const i = board.branchCurrent('LED1', 'anode');
  console.log(`  LED1 anode current: ${(i * 1000).toFixed(2)} mA`);
  console.log();
}

// 3. Closed-form solver throughput — setPin()
{
  const board = createBoard();
  board.advanceTo(1_000_000n);
  let toggle = false;

  const result = bench('setPin (closed-form solve)', () => {
    toggle = !toggle;
    board.setPin('P1.0', 'pushpull', toggle);
  });

  console.log('3) Closed-form solver throughput (setPin)');
  console.log(formatResult(result));
  console.log();
}

// 4. readAnalog throughput (pot reading, no re-solve)
{
  const board = createBoard();
  board.setControl('POT', 0.5);
  board.advanceTo(1_000_000n);

  const result = bench('readAnalog (pot, no solve)', () => {
    board.readAnalog('P1.3');
  });

  console.log('4) readAnalog throughput (no re-solve)');
  console.log(formatResult(result));
  console.log();
}

// 5. setControl (pot) — triggers closed-form re-solve
{
  const board = createBoard();
  board.advanceTo(1_000_000n);
  let pos = 0;

  const result = bench('setControl pot (closed-form re-solve)', () => {
    pos = (pos + 0.01) % 1.0;
    board.setControl('POT', pos);
  });

  console.log('5) setControl throughput (pot adjustment + re-solve)');
  console.log(formatResult(result));
  console.log();
}

// 6. ledBrightness() integration — read-only, no solve
{
  const board = createBoard();
  // Build up some LED history first
  const periodNs = 1_000_000n;
  for (let i = 0; i < 100; i++) {
    const t = BigInt(i) * periodNs;
    board.advanceTo(t);
    board.setPin('P1.0', 'pushpull', false);
    board.advanceTo(t + periodNs / 2n);
    board.setPin('P1.0', 'pushpull', true);
  }
  board.advanceTo(100n * periodNs);

  const result = bench('ledBrightness (integration over history)', () => {
    board.ledBrightness('LED1');
  });

  console.log('6) ledBrightness throughput (integration)');
  console.log(formatResult(result));
  console.log();
}

console.log('='.repeat(80));
console.log('Done.');
