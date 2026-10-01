import test from 'node:test';
import assert from 'node:assert/strict';
import {deriveHotRuntime} from '../scripts/bochs-cpu3-native-hot-direct/runtime.mjs';
import {hotNativeProfile as p} from '../scripts/bochs-cpu3-native-hot-direct/profile.mjs';
import {HotDirectBoardFacade} from '../scripts/bochs-cpu3-native-hot-direct/board.mjs';
import {loadHotNative} from '../scripts/bochs-cpu3-native-hot-direct/loader.mjs';
test('fixed native derivative retains per-resume guards and total checks precede callbacks',()=>{
 const s=deriveHotRuntime().toString();assert.ok(s.includes(p.romSha256));assert.ok(s.includes('ticks>600||!quanta||quanta>300'));assert.ok(s.includes('max_successful_quanta>300'));assert.ok(s.includes('bw_successful_quanta>=150000'));assert.ok(s.indexOf('hot-native-total-before-callback')<s.indexOf('bw_callbacks.native_tick(bw_callbacks.context, count)'));assert.ok(s.includes('direct-page-sha256'));assert.ok(s.includes('mapping-boundary-kind'));assert.ok(s.includes('physical-overflow')||s.includes('bw_raw_span_ok'));assert.ok(s.includes('RPGH001'));
});
test('manual actual-board total caps and unsupported kind reject before effects',()=>{
 const b=new HotDirectBoardFacade(new Uint8Array(65536));b.beginRun();b.successfulQuanta=p.totalQuanta;b.nativeTicks=p.totalNativeTicks;const cycles=b.machine.cycles,debt=b.machine._chipDebt;assert.throws(()=>b.quantum(0),/total Q/);assert.throws(()=>b.quantum(2),/work kind/);assert.throws(()=>b.nativeTick(),/total N/);assert.equal(b.machine.cycles,cycles);assert.equal(b.machine._chipDebt,debt);b.endRun();b.close();
});
test('compact callback evidence retains order without whole-board snapshots',()=>{
 const events=[],b=new HotDirectBoardFacade(new Uint8Array(65536),{compactSink:e=>events.push(e)});b.inspect=()=>{throw Error('full snapshot forbidden');};b.beginRun();b.quantum(0);b.nativeTick();assert.deepEqual(events.map(e=>[e.ordinal,e.operation,e.successfulQuanta,e.nativeTicks]),[[1,'quantum',1,0],[2,'nativeTick',1,1]]);b.endRun();b.close();
});
test('loader denies arbitrary or original guest before addon admission',()=>{assert.throws(()=>loadHotNative('/missing.node','0'.repeat(64),new Uint8Array(65536)),/authenticated hot ROM/);});

test('compact bound denies work before board effect and writes preserve operands',()=>{const events=[],b=new HotDirectBoardFacade(new Uint8Array(65536),{compactSink:e=>events.push(e)});b.beginRun();b.writePhysical(0x580,Uint8Array.of(7));assert.deepEqual([...events[0].args[2]],[7]);b.compactCount=500000;const before=b.machine.cycles;assert.throws(()=>b.quantum(0),/before effect/);assert.equal(b.machine.cycles,before);b.endRun();b.close();});

test('residual admission rejects exhaustion before callbacks and clamps non-multiple totals',()=>{
 const s=deriveHotRuntime().toString(),start=s.indexOf('int bw_cpu3_combined_paging_ram_resume('),resume=s.slice(start,s.indexOf('extern "C" int bw_direct_initialize',start));
 assert.ok(resume.indexOf('if (bw_ticks>=160000 || bw_successful_quanta>=150000) return 0;')<resume.indexOf('bw_callbacks = *callbacks;'));
 assert.ok(resume.indexOf('bw_quantum_budget=max_successful_quanta<hot_remaining_quanta')<resume.indexOf('cpu_loop()'));
 assert.ok(resume.indexOf('if (bw_native_budget>hot_remaining_ticks)')<resume.indexOf('cpu_loop()'));
 // Independent concrete remainder requirements for eventual native controls.
 for(const [currentN,currentQ,requestN,requestQ,expectedN,expectedQ] of [[159999,149999,600,300,1,1],[159983,149743,600,300,17,257],[159401,149701,600,300,599,299]]){
  assert.equal(Math.min(requestN,p.totalNativeTicks-currentN),expectedN);assert.equal(Math.min(requestQ,p.totalQuanta-currentQ),expectedQ);
 }
});
test('callback reentry cannot clobber owned outer compact write operand',()=>{
 let event;const b=new HotDirectBoardFacade(new Uint8Array(65536),{compactSink:e=>{event=e;assert.throws(()=>b.writePhysical(0x581,Uint8Array.of(99)),/before argument mutation/);assert.throws(()=>b.readPhysical(0x580,1),/before argument mutation/);}});b.beginRun();b.writePhysical(0x580,Uint8Array.of(7));assert.deepEqual([...event.args[2]],[7]);assert.equal(b.machine.mem[0x580],7);assert.equal(b.machine.mem[0x581],0);b.endRun();b.close();
});
