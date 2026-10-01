import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {runColdResetOracle,assertColdResetOracle} from '../scripts/i80386-cold-reset-oracle.mjs';
let capture;
test('actual fresh JS board executes bounded free ROM from physical reset vector',()=>{
  // CI may prepare unrelated dependencies or firmware. Every measured source
  // blob still must match its committed revision and remain stable throughout
  // execution; standalone CLI qualification retains its clean-tree default.
  capture=runColdResetOracle({requireClean:false});
  assert.deepEqual(assertColdResetOracle(capture),{status:'javascript-board-cold-reset-oracle-pass',
    successfulQuanta:49,boardCycles:298,marker:'CRST001',nativeParity:false});
});
test('unrelated CI files preserve unit evidence while qualification requires clean source',()=>{
  const probe=mkdtempSync(fileURLToPath(new URL('../cold-reset-ci-untracked-',import.meta.url)));
  try{
    writeFileSync(probe+'/probe.txt','unrelated CI preparation\n',{flag:'wx'});
    assert.throws(()=>runColdResetOracle(),/qualification requires a clean source tree/);
    const report=runColdResetOracle({requireClean:false});
    assert.equal(assertColdResetOracle(report).status,'javascript-board-cold-reset-oracle-pass');
    assert.deepEqual(report.source,capture.source);
  }finally{rmSync(probe,{recursive:true,force:true});}
});
const mutations=[
  ['reset fetch aliases low instead of high',r=>{r.events[0].address=0xffff0;}],
  ['far jump retains reset hidden cache',r=>{r.steps[0].after.segmentCaches[1].base=0xffff0000;}],
  ['undefined CR0 difference silently normalized',r=>{r.reset.cpu.cr0=0x7ffffff0;}],
  ['missing reset cache attributes',r=>{delete r.reset.cpu.segmentCaches[1].readable;}],
  ['ROM write committed',r=>{r.events.find(e=>e.effect==='rom-ignored').after=0;}],
  ['openbus write took effect',r=>{r.events.find(e=>e.effect==='openbus-ignored').after=0x12;}],
  ['read byte changed',r=>{r.events.find(e=>e.kind==='read').value^=1;}],
  ['RAM signature changed',r=>{r.final.ram[0]^=1;}],
  ['guest-produced raw reset witness changed',r=>{r.final.resetWitness[1]=0;}],
  ['marker precedes instruction clock',r=>{r.events.find(e=>e.kind==='pio').boardCycles+=6;}],
  ['successful work charged twice',r=>{r.steps[0].charged=12;}],
  ['reset clocks omitted',r=>{r.reset.board.cycles=0;}],
  ['idle step added while settling',r=>{r.final.cpu.cycles++;}],
  ['plausible PIT fractional drift',r=>{r.final.board.pit.fraction=(r.final.board.pit.fraction+0.1)%1;}],
  ['A20 source disabled',r=>{r.reset.board.a20.outputPort&=~2;}],
  ['ROM identity changed',r=>{r.rom.sha256='0'.repeat(64);}],
  ['seed identity changed',r=>{r.seed.sha256='0'.repeat(64);}],
  ['source identity changed',r=>{r.source.boardRevision='0'.repeat(40);}],
  ['measured executable source hash changed',r=>{
    r.source.sourceHashes['src/experimental/i80386.js']='0'.repeat(64);
  }],
  ['strict386 semantics falsely claimed',r=>{r.reset.cpu.cpuProfile='strict386';r.reset.cpu.strict386=true;}],
  ['native parity falsely claimed',r=>{r.claim='native-reset-parity';}],
];
for(const [name,change] of mutations)test(`rejects ${name}`,()=>{
  assert(capture,'actual baseline must run before report mutation');
  const r=structuredClone(capture);change(r);
  assert.throws(()=>assertColdResetOracle(r),/cold reset oracle/);
});
