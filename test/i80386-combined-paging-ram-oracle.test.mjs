import test from 'node:test';
import assert from 'node:assert/strict';
import {assembleCombinedPagingRamRom,runCombinedPagingRamOracle,assertCombinedPagingRamOracle} from '../scripts/i80386-combined-paging-ram-oracle.mjs';
const actual=runCombinedPagingRamOracle({requireClean:false});
const find=(r,kind,p=()=>true)=>{const e=r.events.find(e=>e.kind===kind&&p(e));assert(e,`actual ${kind} witness`);return e;};
function cpus(r,change){change(r.reset.cpu);for(const s of r.steps){change(s.before);change(s.after);}for(const d of r.deliveries){change(d.before.cpu);change(d.after.cpu);}for(const e of r.events)if(e.cpu)change(e.cpu);change(r.beforeSettle.cpu);change(r.final.cpu);}
function boards(r,change){change(r.initialBoard);change(r.reset.board);for(const s of r.steps){change(s.boardBefore);change(s.boardAfter);}for(const d of r.deliveries){change(d.before.board);change(d.after.board);}for(const a of r.chipAdvances){change(a.before);change(a.after);}change(r.beforeSettle.board);change(r.final.board);}
function intervalChange(r,at,delta){for(const list of [r.steps,r.deliveries,r.chipAdvances])for(const x of list){if(x.firstOrdinal>=at)x.firstOrdinal+=delta;if(x.lastOrdinal>=at)x.lastOrdinal+=delta;}for(const e of r.events)if(e.kind==='translation'){if(e.firstOrdinal>=at)e.firstOrdinal+=delta;if(e.lastOrdinal>=at)e.lastOrdinal+=delta;}r.events.forEach((e,i)=>e.ordinal=i+1);}
function forbiddenFaultWrite(r){const s=r.steps.find(s=>!s.completed),at=s.lastOrdinal,event={...find(r,'write'),kind:'write',address:s.after.cr2,decoded:s.after.cr2,value:0,before:0,after:0,paging:false,attempt:s.attempt,quantum:s.quantum,boardCycles:s.boardBefore.cycles,mappingEpoch:0,a20Enabled:true};r.events.splice(at-1,0,event);intervalChange(r,at,1);}
function substitutedPde(r){const t=find(r,'translation',e=>e.pagingEnabled&&e.lastOrdinal>=e.firstOrdinal),reads=r.events.slice(t.firstOrdinal-1,t.lastOrdinal).filter(e=>e.kind==='read');assert.equal(reads.length,8);for(let i=0;i<4;i++){assert.equal(reads[i].address,0x9000+i);reads[i].address=reads[i].decoded=0xa028+i;}}

test('free combined guest assembles bounded cold-reset ROM',()=>{const {rom,symbols}=assembleCombinedPagingRamRom();assert.equal(rom.length,65536);assert.equal(symbols.setup,256);});
test('actual JS board executes combined paging REP/PF/IRQ and protected RAM SMC/A20 guest',()=>{const p=assertCombinedPagingRamOracle(actual);assert.deepEqual([p.successfulQuantums,p.failedAttempts,p.boardClocks,p.ramEntries,p.mappingEpochs],[192,2,1156,8,2]);assert.equal(p.architecturalStalePteParity,false);assert.equal(p.checkpointVerification,'same-engine-reexecution-not-independent-architectural-oracle');});
const cases=[
 ['unqualified diagnostic cannot qualify',r=>r.source.qualifiedSource=false,/unqualified diagnostic source rejected/],
 ['explicit A20 callback profile missing',r=>delete r.configuration.experimentalFastA20Port92,/actual board configuration/],
 ['raw high address cannot be silently masked',r=>{const e=find(r,'write');e.address+=0x1000000;},/actual raw A20 then reset-alias decode/],
 ['write must be canonical uint8',r=>find(r,'write').value=256,/canonical uint8 bus value/],
 ['video aperture cannot be ordinary RAM',r=>{const e=find(r,'write');e.address=e.decoded=0xb8000;},/ordinary configured RAM write excludes video\/MMIO/],
 ['same-value PTE cannot substitute PDE read',substitutedPde,/independent typed PDE\/PTE address roles/],
 ['AD update cannot change permission bits',r=>{const e=find(r,'write',e=>e.paging);e.value=e.after=e.value|4;},/AD preserves physical\/permission bits/],
 ['AD update must retain whole typed span',r=>{const e=find(r,'write',e=>e.paging&&(e.address&3)===2),at=e.ordinal;r.events.splice(at-1,1);intervalChange(r,at,-1);},/whole typed AD update/],
 ['fault attempt cannot write user destination',forbiddenFaultWrite,/failed attempt has no user destination write/],
 ['partial REP progress',r=>{r.deliveries[0].before.cpu.ecx=3;},/REP fault partial progress/],
 ['first PF restart frame RF',r=>r.deliveries[0].frame[14]=0,/first precise fault frame/],
 ['second PF CR2',r=>r.deliveries[1].after.cpu.cr2=0x5000,/ordinary fault restart/],
 ['fault delivery has zero clocks',r=>r.deliveries[0].after.board.cycles+=6,/delivery zero clocks/],
 ['IRQ delivery has zero successful work',r=>r.deliveries[2].after.cpu.cycles++,/delivery no successful Q/],
 ['IRQ saved successor',r=>r.deliveries[2].frame[0]^=1,/STI successor IRQ frame/],
 ['actual ACK vector',r=>find(r,'ack').vector=33,/actual master ACK/],
 ['zero REP remains one ordinary success',r=>r.steps.find(s=>s.before.eip===r.rom.symbols.zero_rep).charged=0,/failed attempts charge zero/],
 ['final REP charge once',r=>r.steps.find(s=>s.before.eip===r.rom.symbols.rep_one).charged=12,/failed attempts charge zero/],
 ['A20 generation clock tuple',r=>find(r,'translation-invalidate').generationAfter++,/actual translation generation ledger/],
 ['A20 hook origin cannot be relabeled',r=>find(r,'translation-invalidate',e=>e.origin==='a20-controller').origin='cpu-control',/two actual A20 controller invalidations/],
 ['AD excluded invalidation source',r=>find(r,'translation-invalidate').origin='board-paging-ad-write',/AD updates exclude cache invalidation/],
 ['ordinary OFF invalidation source',r=>find(r,'translation-invalidate',e=>e.origin==='board-a20-off-write').origin='cpu-control',/source-owned translation invalidation census/],
 ['A20 transition epoch',r=>find(r,'a20-transition').mappingEpoch=0,/actual event gate and epoch/],
 ['A20 output command byte',r=>find(r,'pio',e=>e.port===0x60).value=3,/actual 8042 command\/output sequence/],
 ['RAM witness mirror',r=>r.final.smcWitnesses[0]^=1,/RAM witness mirror/],
 ['low code mirror',r=>r.final.lowCode[1]^=1,/low code mirror/],
 ['high code mirror',r=>r.final.highCode[1]^=1,/high code mirror/],
 ['protected RAM cache limit coherent',r=>cpus(r,c=>{if([0x18,0x20].includes(c.cs))c.segmentCaches[1].limit=0x7fff;}),/protected RAM code cache/],
 ['protected CALL return frame coherent caller PC',r=>cpus(r,c=>{if(c.cs===8&&c.eip===r.rom.symbols.low_first){c.eip++;c.pc++;}}),/protected CALL actual return frame/],
 ['protected RETF restores stack',r=>cpus(r,c=>{if(c.cs===8&&c.eip===r.rom.symbols.low_first+5)c.esp-=2;}),/protected16 RETF/],
 ['full CPU checkpoint replay coherent',r=>cpus(r,c=>c.esi^=1),/cached same-engine checkpoint reexecution reset/],
 ['whole configured UART replay coherent',r=>boards(r,b=>b.chipStates.uart1.lcr^=1),/cached same-engine checkpoint reexecution initialBoard/],
 ['independent settled PIT phase coherent',r=>boards(r,b=>b.pit.fraction+=0.01),/independent rational PIT oscillator/],
 ['independent binary mode0 CE transition',r=>{const a=r.chipAdvances.find(a=>a.before.pit.counters[0].mode===0&&a.before.pit.counters[0].armed&&!a.before.pit.counters[0].nullCount);assert(a);a.after.pit.counters[0].ce++;a.after.chipStates.pit1.counters[0].ce++;},/independent mode-0 counter transition/],
 ['actual edge before second REP',r=>find(r,'pit-output').cpu.ecx=2,/actual edge precedes second REP fetch/],
];
for(const [name,mutate,pattern]of cases)test(`reject ${name}`,()=>{const r=structuredClone(actual);mutate(r);assert.throws(()=>assertCombinedPagingRamOracle(r),pattern);});
