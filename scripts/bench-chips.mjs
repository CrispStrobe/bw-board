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
async function benchRP2040() {
  const { createRp2040jsAdapter } = await import('../src/rp2040js-adapter.js');
  const HZ = 125_000_000;                                 // RP2040 Cortex-M0+ at 125 MHz
  // adds r0,#1 ; adds r0,#1 ; b .-4  (a tight ALU loop in SRAM)
  const prog = new Uint16Array([0x3001, 0x3001, 0xe7fc]);
  const a = createRp2040jsAdapter({ clockHz: HZ, program: prog });
  const core = a.core;
  const { cy, secs } = timed(() => { let c=0; for(let i=0;i<STEPS;i++) c+=core.executeInstruction(); return c; });
  return { name:'RP2040 Cortex-M0+ (125 MHz)', realHz:HZ, cyPerSec: cy/secs };
}
async function bench8051() {
  const { ancestorCandidates } = await import('../test/helpers/sibling-checkout.mjs');
  const { existsSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname } = await import('node:path');
  const { createRequire } = await import('node:module');
  const HERE = dirname(fileURLToPath(import.meta.url));
  const wasmJs = ancestorCandidates(HERE, ['emu8051-stc','build','emu8051.js']).find(existsSync);
  if (!wasmJs) throw new Error('emu8051-stc sibling not found (clone CrispStrobe/emu8051-stc beside bw-board)');
  const req = createRequire(import.meta.url);
  let mod; try { mod = req(wasmJs); } catch { mod = (await import(wasmJs)).default; }
  const createEmu8051 = typeof mod === 'function' ? mod : mod?.default;
  const Module = await createEmu8051();
  const { createEmu8051Adapter } = await import('../src/emu8051-adapter.js');
  const adapter = createEmu8051Adapter(Module, {});
  const rec = (addr, bytes) => { const b=[bytes.length,(addr>>8)&0xff,addr&0xff,0x00,...bytes]; const sum=(0x100-(b.reduce((a,v)=>a+v,0)&0xff))&0xff; return ':'+[...b,sum].map(x=>x.toString(16).padStart(2,'0')).join('').toUpperCase(); };
  const hex = rec(0x0000,[0x04,0x24,0x05,0x80,0xFB]) + '\n:00000001FF\n';   // INC A; ADD A,#5; SJMP -5
  const loadHex = Module.cwrap('emu_load_hex','number',['string','number']);
  loadHex(hex, hex.length);
  const T_NS = 2_000_000_000;                             // 2 s of emulated 8051 time
  const t = process.hrtime.bigint();
  adapter.runNs(BigInt(T_NS));
  const wallNs = Number(process.hrtime.bigint()-t);
  return { name:'8051 (emu8051 STC)', rtxDirect: T_NS / wallNs };  // RTx = emulated/wall, clock-independent
}
async function tryBench(fn, label) {
  try { return await fn(); } catch (e) { return { name:label, skipped:String(e.message||e).slice(0,80) }; }
}

const rows = [];
rows.push(await tryBench(benchZ80, 'Z80'));
rows.push(await tryBench(bench6502, '6502'));
rows.push(await tryBench(benchAVR, 'AVR ATmega328P'));
// WASM/firmware-gated cores: honestly reported as needing their engine.
rows.push(await tryBench(benchRP2040, 'RP2040 Cortex-M0+'));
rows.push(await tryBench(bench8051, '8051 (emu8051 STC)'));
rows.push({ name:'labwired STM32/RISC-V/Xtensa', skipped:'needs the 20 MB labwired-wasm engine' });

console.log('core                             emulated cycles/s     x real time   STEPS='+STEPS);
for (const r of rows) {
  if (r.skipped) { console.log(`${r.name.padEnd(32)} SKIPPED — ${r.skipped}`); continue; }
  if (r.rtxDirect !== undefined) { console.log(`${r.name.padEnd(32)} ${'(emulated/wall)'.padStart(15)}   ${r.rtxDirect.toFixed(1).padStart(7)}x`); continue; }
  const rtx = r.cyPerSec / r.realHz;
  console.log(`${r.name.padEnd(32)} ${String(Math.round(r.cyPerSec)).padStart(15)}   ${rtx.toFixed(1).padStart(7)}x`);
}
console.log('\nBox timing is noisy — read as order-of-magnitude; the off-box CI run is the figure.');
