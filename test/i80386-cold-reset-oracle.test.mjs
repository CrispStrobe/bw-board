import assert from 'node:assert/strict';
import test from 'node:test';
import {runColdResetOracle,assertColdResetOracle} from '../scripts/i80386-cold-reset-oracle.mjs';
let capture;
test('actual fresh JS board executes bounded free ROM from physical reset vector',()=>{
  capture=runColdResetOracle();
  assert.deepEqual(assertColdResetOracle(capture),{status:'javascript-board-cold-reset-oracle-pass',
    successfulQuanta:45,boardCycles:274,marker:'CRST001',nativeParity:false});
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
  ['native parity falsely claimed',r=>{r.claim='native-reset-parity';}],
];
for(const [name,change] of mutations)test(`rejects ${name}`,()=>{
  assert(capture,'actual baseline must run before report mutation');
  const r=structuredClone(capture);change(r);
  assert.throws(()=>assertColdResetOracle(r),/cold reset oracle/);
});
