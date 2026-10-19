/**
 * Exhaustive stock-vs-fork differential for the avr8js switch-dispatch fork
 * (src/vendor/avr8js-fast/instruction.js). For every one of the 65536 opcodes,
 * on several seeded register/SRAM states, the fork must leave data[], pc and
 * cycles byte-identical to avr8js's own avrInstruction -- and throw exactly when
 * it does. The fork is a mechanical switch(opcode>>12) restructuring with bodies
 * copied verbatim (scripts/gen-avr8js-fast.mjs), so this is what proves the
 * restructuring changed only dispatch, not semantics.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { fastAvrInstruction } from '../src/vendor/avr8js-fast/instruction.js';

const require = createRequire(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'));
const avr = require('avr8js');
const stock = avr.avrInstruction;
const CPUClass = avr.CPU;

const nn = (x, y) => x === y || (Number.isNaN(x) && Number.isNaN(y)); // both-NaN pc = same (RET off garbage stack)

test('fastAvrInstruction is byte-identical to avr8js avrInstruction for all 65536 opcodes', () => {
  assert.equal(typeof stock, 'function', 'avr8js avrInstruction not found');
  const c1 = new CPUClass(new Uint16Array(8), 2048);
  const c2 = new CPUClass(new Uint16Array(8), 2048);
  c1.onWatchdogReset = c2.onWatchdogReset = () => {};
  c1.onBreak = c2.onBreak = () => {};
  const N = c1.data.length;
  const base = new Uint8Array(N);
  const seeds = [0x1234, 0xabcd, 0x7f00, 0x00ff];
  let checked = 0, mism = 0, firstBad = '';

  for (let op = 0; op < 65536; op++) {
    for (const seed of seeds) {
      let s = seed >>> 0;
      for (let a = 0; a < N; a++) { s = (s * 1664525 + 1013904223) >>> 0; base[a] = s >>> 24; }
      c1.data.set(base); c2.data.set(base);
      c1.progMem[0] = op; c2.progMem[0] = op;
      const w = (op * 2654435761) & 0xffff; c1.progMem[1] = w; c2.progMem[1] = w;
      c1.pc = 0; c2.pc = 0; c1.cycles = 0; c2.cycles = 0;

      let t1 = false, t2 = false;
      try { stock(c1); } catch { t1 = true; }
      try { fastAvrInstruction(c2); } catch { t2 = true; }
      if (t1 || t2) { if (t1 !== t2) { mism++; if (!firstBad) firstBad = `op 0x${op.toString(16)}: throw ${t1}/${t2}`; } continue; }
      checked++;
      let bad = null;
      if (!nn(c1.pc, c2.pc)) bad = `pc ${c1.pc} vs ${c2.pc}`;
      else if (!nn(c1.cycles, c2.cycles)) bad = `cycles ${c1.cycles} vs ${c2.cycles}`;
      else for (let a = 0; a < N; a++) if (c1.data[a] !== c2.data[a]) { bad = `data[${a}] ${c1.data[a]} vs ${c2.data[a]}`; break; }
      if (bad) { mism++; if (!firstBad) firstBad = `op 0x${op.toString(16).padStart(4, '0')} seed 0x${seed.toString(16)}: ${bad}`; }
    }
  }
  assert.equal(mism, 0, `${mism} stock-vs-fork mismatches; first: ${firstBad}`);
  assert.ok(checked > 200_000, `only ${checked} states checked -- differential did not run`);
  console.log(`# avr fast-dispatch differential: ${checked} states across 65536 opcodes, 0 mismatches`);
});
