import test from 'node:test';
import assert from 'node:assert/strict';
import {assembleRepPfPitRom,runRepPfPitOracle,assertRepPfPitOracle} from '../scripts/i80386-rep-pf-pit-oracle.mjs';
// Actual guest execution is cached once. Validator checkpoint reexecution uses
// the same engine and is explicitly not an independent architectural oracle.
const actual=runRepPfPitOracle({requireClean:false});
const copy=()=>structuredClone(actual);
const attack=(name,mutate,pattern=/REP\/PF\/PIT oracle/)=>test(name,()=>{const r=copy();mutate(r);assert.throws(()=>assertRepPfPitOracle(r),pattern);});
test('free linked 64KiB ROM retains cold reset vector and precise handlers',()=>{const {rom,symbols}=assembleRepPfPitRom();assert.equal(rom[0xfff0],0xea);assert.equal(symbols.setup,0x100);assert(symbols.pf_handler<0x1000);});
test('actual cold-reset board two faults, REP timer edge and STI IRQ qualify',()=>assert.deepEqual(assertRepPfPitOracle(actual),{successfulQuantums:135,failedAttempts:2,boardClocks:814,faults:2,irq:32,checkpointVerification:'same-engine-reexecution-not-independent-architectural-oracle'}));
attack('missing transitive PIT source rejects',r=>delete r.source.sourceHashes['src/i8254.js']);
attack('well formed wrong fixture hash rejects',r=>r.rom.sourceSha256='0'.repeat(64));
attack('wrong ROM hash rejects',r=>r.rom.sha256='0'.repeat(64));
attack('source-backed CR0 difference cannot claim raw parity',r=>r.nativeCr0SourceDifference.comparisonMasks=0x8000001f);
attack('raw reset EDX remains retained',r=>r.reset.cpu.edx=0);
attack('true reset physical fetch cannot be reduced to decoded alias',r=>r.events[0].address=0xfffff0);
attack('missing successful REP byte write rejects raw chronology',r=>r.events.splice(r.events.findIndex(e=>e.kind==='write'&&e.address===0x4ff8),1));
attack('duplicated physical write rejects raw chronology',r=>{const i=r.events.findIndex(e=>e.kind==='write'&&e.address===0x4ff8);r.events.splice(i,0,structuredClone(r.events[i]));});
attack('wrong paging A/D byte rejects backing',r=>{const e=r.events.find(e=>e.kind==='write'&&e.paging&&e.address===0xa014);e.value^=0x20;});
attack('paging attribution cannot disappear',r=>{for(const e of r.events)if(e.kind==='write')e.paging=false;});
attack('full backing digest cannot be substituted',r=>r.final.memorySha256='0'.repeat(64));
attack('fault-only attempt cannot earn clocks',r=>r.steps.find(s=>s.completed===0).charged=6,/failed attempts charge zero/);
attack('fault-only attempt cannot earn Q',r=>r.steps.find(s=>s.completed===0).completed=1,/actual completion counter/);
attack('zero REP must earn its one ordinary Q',r=>r.steps.find(s=>s.before.eip===r.rom.symbols.zero_rep).charged=0,/failed attempts charge zero/);
attack('final REP cannot double-charge',r=>r.steps.find(s=>s.before.eip===r.rom.symbols.rep_one).charged=12,/failed attempts charge zero/);
attack('partial CX progress retained at first PF',r=>r.deliveries[0].before.cpu.ecx=4,/REP fault partial progress/);
attack('partial DI progress retained at first PF',r=>r.deliveries[0].before.cpu.edi=0x4ff8,/REP fault partial progress/);
attack('precise REP restart offset retained',r=>r.deliveries[0].frame[4]^=1,/first precise fault frame/);
attack('fault error code retained',r=>r.deliveries[1].frame[0]=0,/second precise frame/);
attack('fault RF saved bit retained',r=>r.deliveries[0].frame[14]^=1,/first precise fault frame/);
attack('fault delivery zero clocks retained',r=>r.deliveries[0].after.board.cycles+=6,/delivery zero clocks/);
attack('IRQ delivery zero Q retained',r=>r.deliveries[2].after.cpu.cycles++,/delivery no successful Q/);
attack('IRQ must save STI successor return PC',r=>r.deliveries[2].frame[0]^=1,/STI successor IRQ frame/);
attack('actual master ACK vector retained',r=>r.events.find(e=>e.kind==='ack').vector=0x21,/actual master ACK/);
attack('ACK cannot move earlier than successor',r=>r.events.find(e=>e.kind==='ack').quantum--,/actual master ACK/);
attack('real PIT callback entry CX retained',r=>r.events.find(e=>e.kind==='pit-output'&&e.level===1).cpu.ecx=4,/actual edge precedes second REP fetch/);
attack('PIT edge cannot move out of REP',r=>r.events.find(e=>e.kind==='pit-output'&&e.level===1).quantum--,/actual edge precedes second REP fetch/);
attack('PIT independent fractional oscillator catches phase drift',r=>r.steps[80].boardAfter.pit.fraction+=0.1,/independent rational PIT oscillator/);
attack('actual chip advancement cannot lose elapsed clocks',r=>r.chipAdvances[0].n++,/advance resulting rational phase/);
attack('actual chip advancement snapshot keeps rational phase',r=>r.chipAdvances[0].after.pit.fraction+=0.1,/advance resulting rational phase/);
attack('whole configured chips cannot omit UART',r=>delete r.steps[10].boardAfter.chipStates.uart1);
attack('whole configured chip internal state cannot be replaced',r=>r.steps[10].boardAfter.chipStates.rtc1.seconds=123);
attack('settled board debt cannot remain pending',r=>r.final.board.debt=6);
attack('EOI cannot disappear',r=>r.events.find(e=>e.kind==='pio'&&e.port===0x20&&e.value===0x20).value=0);
attack('marker must be actual port writes',r=>r.events.find(e=>e.kind==='pio'&&e.port===0xe9).value=0);
attack('masked terminal HLT cannot expose IF',r=>r.final.cpu.eflags|=0x200);
attack('complete CPU cache state retained',r=>r.steps[80].after.segmentCaches[1].limit--);
attack('extra report field cannot hide alternative census',r=>r.syntheticInterrupt=true);

attack('raw high physical RAM cannot silently receive 24-bit truncation',r=>{const e=r.events.find(e=>e.kind==='write'&&e.address===0x520);e.address=0x01000520;},/actual fixed-ON AT decode/);
attack('noncanonical physical byte cannot truncate into valid RAM data',r=>{const e=r.events.find(e=>e.kind==='write'&&e.address===0x520);e.value+=256;},/canonical uint8 bus value/);
attack('configured video RAM is not ordinary guest data RAM',r=>{const e=r.events.find(e=>e.kind==='write'&&e.address===0x520);e.address=e.decoded=0xb8000;},/write before byte|ordinary configured RAM write excludes video/);
function erasePhysicalEvent(r,index){
 const ordinal=index+1;r.events.splice(index,1);r.events.forEach((e,i)=>e.ordinal=i+1);
 for(const rows of [r.steps,r.deliveries,r.chipAdvances])for(const row of rows){if(row.firstOrdinal>ordinal)row.firstOrdinal--;if(row.lastOrdinal>=ordinal)row.lastOrdinal--;}
}
attack('coherent renumbered missing REP data reaches backing replay',r=>erasePhysicalEvent(r,r.events.findIndex(e=>e.kind==='write'&&e.address===0x5004)),/full backing replay/);
attack('coherent full chip mutation reaches same-engine checkpoint comparison',r=>{r.steps[80].boardAfter.chipStates.rtc1.seconds=123;r.steps[81].boardBefore.chipStates.rtc1.seconds=123;},/cached same-engine checkpoint reexecution steps/);
attack('coherent full CPU cache mutation reaches same-engine checkpoint comparison',r=>{r.steps[80].after.segmentCaches[1].limit--;r.steps[81].before.segmentCaches[1].limit--;},/cached same-engine checkpoint reexecution steps/);

attack('coherent active mode-0 CE mutation reaches independent counter arithmetic',r=>{
 const a=r.chipAdvances.find(a=>a.before.pit.counters[0].armed&&a.before.pit.counters[0].ce>0);a.after.pit.counters[0].ce++;
},/independent mode-0 counter transition/);
attack('coherent terminal mode-0 OUT mutation reaches independent output arithmetic',r=>{
 const a=r.chipAdvances.find(a=>a.before.pit.counters[0].ce>0&&a.after.pit.counters[0].ce===0);a.after.pit.counters[0].out=0;
},/independent mode-0 output transition/);
