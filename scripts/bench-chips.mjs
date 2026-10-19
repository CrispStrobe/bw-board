// RTx (x-real-time) benchmark for the emulated cores/chips, the sibling of
// bench-i8086.mjs. Metric: emulated cycles per WALL second / the chip's real
// clock. 1.0x = real time. Box timing is noisy (~30% here) — run OFF-BOX for a
// trustworthy figure; a fresh CI runner is far quieter. Each core runs a small
// representative loop (ALU + memory + branch), not a nop spin.
import { Z80Machine, SEARLE } from '../src/z80-machine.js';
import { M6502Machine } from '../src/m6502-machine.js';

const arg = (k, d) => { const i = process.argv.indexOf('--'+k); return i>=0 ? +process.argv[i+1] : d; };
const STEPS = arg('instructions', 20_000_000);
const ONLY = process.argv.includes('--only-labwired');
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
  const { CPU } = await import('avr8js');
  // Run the SWITCH-DISPATCH FORK (src/vendor/avr8js-fast), the decoder the
  // avr8js adapter — and so the widgets pane — actually uses (~1.45x off-box
  // over avr8js's stock linear decoder). Measuring stock here would understate
  // what a user gets.
  const { fastAvrInstruction } = await import('../src/vendor/avr8js-fast/instruction.js');
  const HZ = 16_000_000;                                  // ATmega328P at 16 MHz
  const prog = new Uint16Array(1024);
  prog.set([0x0c01, 0x9403, 0xcffd]);                     // add r0,r1; inc r0; rjmp -3
  const cpu = new CPU(prog);
  const { cy, secs } = timed(() => { const c0=cpu.cycles; for(let i=0;i<STEPS;i++) fastAvrInstruction(cpu); return cpu.cycles-c0; });
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
async function benchLabwired() {
  // The heavy tier: LabWired's multi-arch (STM32/RISC-V/Xtensa) WASM engine, run
  // here as an STM32F0 (Cortex-M0, 48 MHz). Gated on LABWIRED_WASM pointing at the
  // wasm-bindgen NODEJS out-dir (CI downloads the prebuilt release; locally, set it
  // to a `node scripts/build-labwired-wasm.mjs` out/nodejs). The engine is a full
  // peripheral-accurate model; the guarded production batch path now clears real time.
  const WASM_DIR = process.env.LABWIRED_WASM;
  if (!WASM_DIR) throw new Error('set LABWIRED_WASM to the wasm-bindgen nodejs out-dir');
  const { readFileSync, existsSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const { createRequire } = await import('node:module');
  const HERE = dirname(fileURLToPath(import.meta.url));
  const wasmJs = join(WASM_DIR, 'labwired_wasm.js');
  if (!existsSync(wasmJs)) throw new Error(`no labwired_wasm.js in ${WASM_DIR}`);
  const wasm = createRequire(import.meta.url)(wasmJs);
  if (!wasm.WasmSimulator) throw new Error('labwired glue exposes no WasmSimulator');
  const { toLoadableElf } = await import('../src/bin-to-elf.js');
  const FX = join(HERE, '..', 'test', 'fixtures', 'labwired');
  const systemYaml = readFileSync(join(FX, 'f0-system.yaml'), 'utf8');
  const chipYaml   = readFileSync(join(FX, 'stm32f0-chip.yaml'), 'utf8');
  const HZ = 48_000_000;                                  // STM32F0 at 48 MHz
  // A minimal valid F0 image, hand-rolled so the bench needs no ARM toolchain: a
  // vector table (SP, reset) then the same ALU+memory+branch loop shape the other
  // cores run — flash @0x08000000, RAM @0x20000000. Reset vectors to the handler
  // @0x08000008 with the Thumb bit set.
  const u16 = [0x2000,0x2000, 0x0009,0x0800,             // SP=0x20002000, reset=0x08000009
               0x2000, 0x2120, 0x0609,                    // movs r0,#0; movs r1,#0x20; lsls r1,#24 -> r1=0x20000000
               0x3001, 0x6008, 0x680a, 0xe7fb];           // loop: adds r0,#1; str r0,[r1]; ldr r2,[r1]; b loop
  const bin = new Uint8Array(u16.length * 2);
  u16.forEach((h, i) => { bin[i*2] = h & 0xff; bin[i*2+1] = (h >> 8) & 0xff; });
  const sim = wasm.WasmSimulator.new_from_config(systemYaml, chipYaml, toLoadableElf(bin), undefined);
  // Measure the execution policy used by the adapter.  The engine returns 1
  // for any bus that cannot safely batch and 512 for a walk-deleted bus such
  // as this STM32F0 fixture.
  if (process.env.LABWIRED_EXACT_TICK !== '1'
      && sim.recommended_tick_interval && sim.set_peripheral_tick_interval) {
    const tick = Number(process.env.LABWIRED_TICK || sim.recommended_tick_interval());
    sim.set_peripheral_tick_interval(tick);
  }
  const BATCH = 50_000;
  const N = Math.min(STEPS, 8_000_000);                  // rate-based; cap so the heavy engine stays quick
  sim.step_batch(BATCH);                                  // warm up + fail fast on a bad image
  if (process.env.LABWIRED_PROFILE === '1') wasm.profile_start?.();
  const { cy, secs } = timed(() => { let c=0; for(let i=0;i<N;i+=BATCH){ sim.step_batch(BATCH); c+=BATCH; } return c; });
  if (process.env.LABWIRED_PROFILE === '1') {
    wasm.profile_stop?.();
    console.error(sim.profile_report?.());
  }
  return { name:'labwired STM32F0 (48 MHz)', realHz:HZ, cyPerSec: cy/secs };
}
async function tryBench(fn, label) {
  try { return await fn(); } catch (e) { return { name:label, skipped:String(e.message||e).slice(0,80) }; }
}

const rows = [];
if (!ONLY) {
  rows.push(await tryBench(benchZ80, 'Z80'));
  rows.push(await tryBench(bench6502, '6502'));
  rows.push(await tryBench(benchAVR, 'AVR ATmega328P'));
  // WASM/firmware-gated cores: honestly reported as needing their engine.
  rows.push(await tryBench(benchRP2040, 'RP2040 Cortex-M0+'));
  rows.push(await tryBench(bench8051, '8051 (emu8051 STC)'));
}
rows.push(await tryBench(benchLabwired, 'labwired STM32F0 (48 MHz)'));

// Two decimals below 10x, one below 100x, whole above — so a sub-real-time
// heavy tier reads as 0.03x, not a rounded-away 0.0x.
const fmtx = (x) => (x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(1) : x.toFixed(2));
console.log('core                             emulated cycles/s     x real time   STEPS='+STEPS);
for (const r of rows) {
  if (r.skipped) { console.log(`${r.name.padEnd(32)} SKIPPED — ${r.skipped}`); continue; }
  if (r.rtxDirect !== undefined) { console.log(`${r.name.padEnd(32)} ${'(emulated/wall)'.padStart(15)}   ${fmtx(r.rtxDirect).padStart(7)}x`); continue; }
  const rtx = r.cyPerSec / r.realHz;
  console.log(`${r.name.padEnd(32)} ${String(Math.round(r.cyPerSec)).padStart(15)}   ${fmtx(rtx).padStart(7)}x`);
}
console.log('\nBox timing is noisy — read as order-of-magnitude; the off-box CI run is the figure.');
