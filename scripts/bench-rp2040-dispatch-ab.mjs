/**
 * A/B throughput bench for the RP2040 switch-dispatch fork
 * (src/vendor/rp2040js-fast/execute-instruction.js) vs the stock rp2040js
 * linear decode chain.
 *
 * Protocol (noisy dev box, ~30% spread — report the RATIO, not absolutes):
 *   - Both cores are built through the SAME adapter; the stock baseline is
 *     obtained with { fastDispatch: false }, the fork with the default.
 *   - Trials are INTERLEAVED (stock, fork, stock, fork, …) so slow patches
 *     of the box hit both sides equally; medians are reported.
 *   - A same-config NOISE FLOOR (stock-vs-stock median ratio) is measured
 *     the same way: any A/B ratio inside the noise floor is not a signal.
 *
 * The definitive figure needs the off-box CI runner; this is a local read.
 *
 * Usage: node scripts/bench-rp2040-dispatch-ab.mjs [stepsPerTrial] [trials]
 */
import { createRp2040jsAdapter, RAM_START } from '../src/rp2040js-adapter.js';

const STEPS = Number(process.argv[2] ?? 4_000_000);
const TRIALS = Number(process.argv[3] ?? 15);

// Hot loop: MOVS (deep in the alpha chain, ~#45), ADDS, LSLS, LDR/STR
// (immediate), PUSH/POP (~#50) — the ops the diagnosis flagged as costly
// because they sit far down the linear chain. r0 holds a live SRAM base so
// the loads/stores stay mapped. Program ends with an unconditional-ish tail;
// the driver wraps PC back to the top when it runs past the block.
const PROG = new Uint16Array([
  0x200a, // movs r0, #10        (overwritten below with the SRAM base)
  0x2205, // movs r2, #5
  0x3201, // adds r2, #1
  0x009b, // lsls r3, r3, #2
  0x6801, // ldr  r1, [r0, #0]
  0x6041, // str  r1, [r0, #4]
  0xb40c, // push {r2, r3}
  0xbc0c, // pop  {r2, r3}
  0x1c52, // adds r2, r2, #1
  0x0812, // lsrs r2, r2, #0? -> lsrs r2,r2,#0 (still exercises LSRS decode)
]);
const PROG_BYTES = PROG.length * 2;
const PROG_END = RAM_START + PROG_BYTES;
const SRAM_BASE = 0x20008000;

function buildCore(fast) {
  const mcu = createRp2040jsAdapter(fast ? {} : { fastDispatch: false });
  mcu.loadProgram(PROG, RAM_START);
  const core = mcu.core;
  core.registers[0] = SRAM_BASE; // valid SRAM base for ldr/str
  return { mcu, core };
}

/** Run STEPS instructions, wrapping PC to the loop top past the block.
 *  Returns elapsed ms. */
function timeRun(core) {
  core.PC = RAM_START;
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < STEPS; i++) {
    core.executeInstruction();
    if ((core.PC & ~1) >= PROG_END) core.PC = RAM_START;
    core.registers[0] = SRAM_BASE; // keep base pinned (movs may clobber r0)
  }
  const t1 = process.hrtime.bigint();
  return Number(t1 - t0) / 1e6;
}

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function bench() {
  const stock = buildCore(false);
  const fork = buildCore(true);
  // Warm up JIT for both paths.
  for (let w = 0; w < 3; w++) { timeRun(stock.core); timeRun(fork.core); }

  const stockMs = [];
  const forkMs = [];
  const stock2Ms = []; // second stock core for the noise floor
  const stockB = buildCore(false);
  for (let w = 0; w < 3; w++) timeRun(stockB.core);

  for (let t = 0; t < TRIALS; t++) {
    // Interleave: stock, fork, stockB (noise floor), each timed adjacently.
    stockMs.push(timeRun(stock.core));
    forkMs.push(timeRun(fork.core));
    stock2Ms.push(timeRun(stockB.core));
  }

  const mStock = median(stockMs);
  const mFork = median(forkMs);
  const mStock2 = median(stock2Ms);
  const clk = 125e6;
  const ips = (ms) => (STEPS / (ms / 1000));
  console.log(`steps/trial=${STEPS.toLocaleString()}  trials=${TRIALS}`);
  console.log(`stock  median ${mStock.toFixed(1)} ms   ${(ips(mStock) / 1e6).toFixed(1)} Minstr/s   RTx≈${(ips(mStock) / clk).toFixed(3)}`);
  console.log(`fork   median ${mFork.toFixed(1)} ms   ${(ips(mFork) / 1e6).toFixed(1)} Minstr/s   RTx≈${(ips(mFork) / clk).toFixed(3)}`);
  console.log(`stockB median ${mStock2.toFixed(1)} ms  (noise-floor core)`);
  console.log(`SPEEDUP  fork/stock throughput = ${(mStock / mFork).toFixed(3)}x`);
  console.log(`NOISE FLOOR stock/stockB throughput = ${(mStock / mStock2).toFixed(3)}x (should be ~1.00)`);
}

bench();
