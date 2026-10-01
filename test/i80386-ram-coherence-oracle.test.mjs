import test from 'node:test';
import assert from 'node:assert/strict';
import {runRamCoherenceOracle,assertRamCoherenceOracle} from '../scripts/i80386-ram-coherence-oracle.mjs';
// Unit execution permits unrelated CI setup files. Every measured executable
// remains committed and authenticated before/after. CLI qualification remains
// strict about the complete worktree. This baseline is actual guest execution.
const actual=runRamCoherenceOracle({requireClean:false});
const find=(r,predicate)=>r.events.find(predicate);
const byte=(address,quantum)=>e=>e.kind==='fetch'&&e.address===address&&e.quantum===quantum;
test('actual guest creates executable RAM, updates both A20 aliases, and reaches CLI HLT',()=>{
  const result=assertRamCoherenceOracle(actual);
  assert.deepEqual([result.successfulQuanta,result.boardCycles,result.ramEntries,result.a20Transitions],[71,430,7,2]);
  assert.equal(result.nativeParity,false);
  assert.equal(result.checkpointValidation,'source-bound-fresh-same-engine-reexecution');
});
const mutations=[
  ['preseeded executable RAM seed identity',r=>{r.seed.sha256='1'.repeat(64);}],
  ['missing transitive PIT source input',r=>{delete r.source.sourceHashes['src/i8254.js'];}],
  ['valid hex measured CPU source substitution',r=>{r.source.sourceHashes['src/experimental/i80386.js']='1'.repeat(64);}],
  ['ROM binary substitution',r=>{r.rom.sha256='1'.repeat(64);}],
  ['reset hidden physical fetch alias replaced',r=>{r.events[0].address=0xf0000;r.events[0].decoded=0xf0000;}],
  ['reset CR0 normalized toward native profile',r=>{r.reset.cpu.cr0=0x7ffffff0;r.steps[0].before.cr0=0x7ffffff0;}],
  ['lost low guest code commit',r=>{const e=find(r,e=>e.kind==='write'&&e.address===0x7000);e.after=0;}],
  ['stale low instruction operand after first patch',r=>{find(r,byte(0x7001,22)).value=0x11;}],
  ['A20OFF high fetch decodes to high backing',r=>{find(r,byte(0x107001,30)).decoded=0x107001;}],
  ['raw high alias patch commits high backing while OFF',r=>{const e=find(r,e=>e.kind==='write'&&e.address===0x107001&&!e.a20Enabled);e.decoded=0x107001;}],
  ['low cached alias misses raw high patch',r=>{find(r,byte(0x7001,35)).value=0x22;}],
  ['high cached alias misses same decoded patch',r=>{find(r,byte(0x107001,39)).value=0x22;}],
  ['A20ON high fetch reuses low bytes',r=>{find(r,byte(0x107001,47)).value=0x55;}],
  ['high SMC fetch reuses old high operand',r=>{find(r,byte(0x107001,52)).value=0x33;}],
  ['actual function result loses alias progress',r=>{r.steps[35].after.ebx=0x2222;r.steps[36].before.ebx=0x2222;}],
  ['missing effective mapping epoch transition',r=>{find(r,e=>e.kind==='pio'&&e.port===0x60&&e.value===1).mappingEpoch=0;}],
  ['8042 reset request replaces valid OFF command',r=>{find(r,e=>e.kind==='pio'&&e.port===0x60&&e.value===1).value=0;}],
  ['fabricated fast A20 OR source',r=>{r.steps[28].boardAfter.fastA20Latch=2;r.steps[29].boardBefore.fastA20Latch=2;}],
  ['RAM read backing byte altered',r=>{find(r,e=>e.kind==='read').value^=1;}],
  ['bus completion ordering changed',r=>{r.events[20].ordinal++;}],
  ['failed or idle instruction charged as success',r=>{r.steps[20].charged=12;}],
  ['functional board debt erased',r=>{r.steps[20].boardAfter.debt=0;r.steps[21].boardBefore.debt=0;}],
  ['plausible PIT fraction uses different oscillator',r=>{r.steps[20].boardAfter.pit.fraction+=0.001;r.steps[21].boardBefore.pit.fraction+=0.001;}],
  ['coherent full CPU interior checkpoint mutation',r=>{r.steps[42].after.eax^=0x10000;r.steps[43].before.eax^=0x10000;}],
  ['coherent DMA checkpoint mutation',r=>{r.steps[42].boardAfter.dma1.channels[0].curAddr=1;r.steps[43].boardBefore.dma1.channels[0].curAddr=1;}],
  ['unobserved RAM32 fetch callback invented',r=>{r.providers.fetchRam32Used++;}],
  ['seven witness parity counterexample',r=>{r.final.witnesses[8]=0x22;}],
  ['high backing overwritten during OFF alias patch',r=>{r.final.highCode=[0xbb,0x55,0x55,0xcb];}],
  ['terminal CPU idle hidden after settle',r=>{r.final.cpu.cycles++;}],
  ['marker byte changed',r=>{find(r,e=>e.kind==='pio'&&e.port===0xe9).value=0x58;}],
  ['final physical backing digest substituted',r=>{r.final.memorySha256='1'.repeat(64);}],
];
for(const [name,mutate] of mutations)test(`rejects ${name}`,()=>{
  const changed=structuredClone(actual);mutate(changed);
  assert.throws(()=>assertRamCoherenceOracle(changed),/RAM coherence oracle:/);
});
