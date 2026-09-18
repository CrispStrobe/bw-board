// RTx (x-real-time) benchmark for the emulated cores/chips, the sibling of
// bench-i8086.mjs. Metric: emulated cycles per WALL second / the chip's real
// clock. 1.0x = real time. Box timing is noisy (~30% here) — run OFF-BOX for a
// trustworthy figure; a fresh CI runner is far quieter. Each core runs a small
// representative loop (ALU + memory + branch), not a nop spin.
import { Z80Machine, SEARLE } from '../src/z80-machine.js';
import { M6502Machine } from '../src/m6502-machine.js';

const arg = (k, d) => { const i = process.argv.indexOf('--'+k); return i>=0 ? +process.argv[i+1] : d; };
const STEPS = arg('instructions', 20_000_000);
const timed = (fn) => { const t=process.hrtime.bigint(); const cy=fn(); return { cy, secs:Number(process.hrtime.bigint()-t)/1e9 }; };

function benchZ80() {
  const HZ = 4_000_000;                                   // a 4 MHz Z80 (SEARLE runs 7.37; RTx vs a 4 MHz part)
  const m = new Z80Machine(SEARLE, {});
  m.load([0x3c,0x06,0x05,0x80,0x18,0xfa], 0);             // INC A; LD B,5; ADD A,B; JR -6
  m.cpu.pc = 0;
  const { cy, secs } = timed(() => { let c=0; for(let i=0;i<STEPS;i++) c+=m.step(); return c; });
  return { name:'Z80 (4 MHz)', realHz:HZ, cyPerSec: cy/secs };
}
function bench6502() {
  const HZ = 1_000_000;                                   // a 1 MHz 6502
  const m = new M6502Machine({ clockHz: HZ, regions:[{kind:'ram',start:0,end:0xffff}], chips:[] });
  m.mem.set([0xe8,0xa5,0x10,0x65,0x11,0x85,0x12,0x4c,0x00,0x02], 0x0200);  // loop at 0200
  m.mem[0xfffc]=0x00; m.mem[0xfffd]=0x02;                 // reset vector -> 0200
  m.reset();
  const { cy, secs } = timed(() => { let c=0; for(let i=0;i<STEPS;i++) c+=m.step(); return c; });
  return { name:'6502 (1 MHz)', realHz:HZ, cyPerSec: cy/secs };
}
async function benchAVR() {
  const { CPU, avrInstruction } = await import('avr8js');
  const HZ = 16_000_000;                                  // ATmega328P at 16 MHz
  const prog = new Uint16Array(1024);
  prog.set([0x0c01, 0x9403, 0xcffd]);                     // add r0,r1; inc r0; rjmp -3
  const cpu = new CPU(prog);
  const { cy, secs } = timed(() => { const c0=cpu.cycles; for(let i=0;i<STEPS;i++) avrInstruction(cpu); return cpu.cycles-c0; });
  return { name:'AVR ATmega328P (16 MHz)', realHz:HZ, cyPerSec: cy/secs };
}
async function tryBench(fn, label) {
  try { return await fn(); } catch (e) { return { name:label, skipped:String(e.message||e).slice(0,80) }; }
}

const rows = [];
rows.push(await tryBench(benchZ80, 'Z80'));
rows.push(await tryBench(bench6502, '6502'));
rows.push(await tryBench(benchAVR, 'AVR ATmega328P'));
// WASM/firmware-gated cores: honestly reported as needing their engine.
rows.push({ name:'RP2040 (rp2040js, 125 MHz)', skipped:'needs a Cortex-M0+ firmware image — separate harness' });
rows.push({ name:'8051 (emu8051)', skipped:'needs the emu8051 WASM module' });
rows.push({ name:'labwired STM32/RISC-V/Xtensa', skipped:'needs the 20 MB labwired-wasm engine' });

console.log('core                             emulated cycles/s     x real time   STEPS='+STEPS);
for (const r of rows) {
  if (r.skipped) { console.log(`${r.name.padEnd(32)} SKIPPED — ${r.skipped}`); continue; }
  const rtx = r.cyPerSec / r.realHz;
  console.log(`${r.name.padEnd(32)} ${String(Math.round(r.cyPerSec)).padStart(15)}   ${rtx.toFixed(1).padStart(7)}x`);
}
console.log('\nBox timing is noisy — read as order-of-magnitude; the off-box CI run is the figure.');
