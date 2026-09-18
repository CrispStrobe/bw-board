/**
 * Interleaved A/B for the lean machine step() hot path (z80/6502) vs the stock
 * master step(). Same protocol as bench-rp2040-dispatch-ab: interleaved trials,
 * medians, a same-code noise floor. Report the RATIO — absolutes are box-noisy.
 *
 * The stock machine is git-show'd into src/<name>.stock.js at CI time (see
 * .github/workflows/machine-step-ab.yml) so its relative imports resolve; it is
 * never committed. Locally, create those two files the same way to run this.
 *
 * Usage: node scripts/bench-machine-step-ab.mjs [stepsPerTrial] [trials]
 */
const STEPS = Number(process.argv[2] ?? 30_000_000);
const TRIALS = Number(process.argv[3] ?? 15);

const median = (xs) => { const s=[...xs].sort((a,b)=>a-b); return s[s.length>>1]; };

async function abZ80() {
  const { Z80Machine: Lean, SEARLE } = await import('../src/z80-machine.js');
  const { Z80Machine: Stock } = await import('../src/z80-machine.stock.js');
  const prog = [0x3c,0x06,0x05,0x80,0x18,0xfa];               // INC A; LD B,5; ADD A,B; JR -6
  const run = (Cls) => { const m=new Cls(SEARLE,{}); m.load(prog,0); m.cpu.pc=0;
    const t=process.hrtime.bigint(); for(let i=0;i<STEPS;i++) m.step(); return Number(process.hrtime.bigint()-t)/1e6; };
  return abPair('Z80 (SEARLE)', run, Stock, Lean);
}
async function abZ80Chips() {
  // chip-HEAVY: several advancing chips (CTCs + CRTC), all advanced every
  // instruction on stock, deadline-batched on lean. This is what the batching
  // targets (the chip-light SEARLE case above should be a wash).
  const { Z80Machine: Lean } = await import('../src/z80-machine.js');
  const { Z80Machine: Stock } = await import('../src/z80-machine.stock.js');
  const cfg = { clockHz: 3_500_000, regions: [], ports: [
    { kind: 'ctc', name: 'ctc1', at: 0x10 }, { kind: 'ctc', name: 'ctc2', at: 0x20 },
    { kind: 'ctc', name: 'ctc3', at: 0x30 }, { kind: 'crtc', name: 'crtc1', at: 0x40, vramSize: 2048, charH: 8 } ] };
  const run = (Cls) => { const m=new Cls(cfg); m.load([0x3c,0x06,0x05,0x80,0x18,0xfa],0); m.cpu.pc=0;
    const t=process.hrtime.bigint(); for(let i=0;i<STEPS;i++) m.step(); return Number(process.hrtime.bigint()-t)/1e6; };
  return abPair('Z80 (4 chips)', run, Stock, Lean);
}
async function ab6502() {
  const { M6502Machine: Lean } = await import('../src/m6502-machine.js');
  const { M6502Machine: Stock } = await import('../src/m6502-machine.stock.js');
  const setup = (Cls) => { const m=new Cls({clockHz:1e6,regions:[{kind:'ram',start:0,end:0xffff}],chips:[]});
    m.mem.set([0xe8,0xa5,0x10,0x65,0x11,0x85,0x12,0x4c,0x00,0x02],0x0200); m.mem[0xfffc]=0x00; m.mem[0xfffd]=0x02; m.reset(); return m; };
  const run = (Cls) => { const m=setup(Cls); const t=process.hrtime.bigint(); for(let i=0;i<STEPS;i++) m.step(); return Number(process.hrtime.bigint()-t)/1e6; };
  return abPair('6502 (RAM)', run, Stock, Lean);
}

function abPair(label, run, Stock, Lean) {
  run(Stock); run(Lean);                                       // warm both
  const stock=[], lean=[], stockB=[];
  for (let k=0;k<TRIALS;k++){ stock.push(run(Stock)); lean.push(run(Lean)); stockB.push(run(Stock)); }
  const ms=median(stock), ml=median(lean), mb=median(stockB);
  console.log(`${label}: stock ${ms.toFixed(1)}ms  lean ${ml.toFixed(1)}ms  => SPEEDUP ${(ms/ml).toFixed(3)}x   [noise floor stock/stockB ${(ms/mb).toFixed(3)}x]`);
}

console.log(`steps/trial=${STEPS.toLocaleString()} trials=${TRIALS}`);
await abZ80();
await abZ80Chips();
await ab6502();
