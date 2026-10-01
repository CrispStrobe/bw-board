/** Bounded parser checks for actual JS hot measurements; no native parity. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {hotWorkload} from './i80386-free-combined-hot.mjs';
export function assertHotBaseline(report,journal){
 assert.equal(report.schema,'bw.js-combined-hot.baseline.v1');assert.equal(createHash('sha256').update(journal).digest('hex'),report.journal.sha256,'raw compact journal digest');
 assert.ok(report.journal.bytes<=32*1024*1024);assert.equal(Buffer.byteLength(journal),report.journal.bytes);
 let attempt=0,q=0,rows=0,registerEntries=0,memoryEntries=0;
 for(const line of journal.toString().trimEnd().split('\n')){
  const r=JSON.parse(line);rows++;assert.ok(['STEP','WRITE','PIO','DELIVERY'].includes(r[0]),'known raw event');
  if(r[0]==='STEP'){assert.equal(r.length,11);assert.equal(r[1],++attempt,'attempt chronology');assert.ok(r[2]===q||r[2]===q+1,'Q committed progression');q=r[2];assert.equal(r[8],q,'actual CPU successful work');assert.equal(r[9],4+6*q,'actual board epoch and work clocks');assert.ok(r[10]>=0&&r[10]<=r[9]);if(r[3]===8&&r[4]===report.rom.symbols.hot_register_loop)registerEntries++;if(r[3]===8&&r[4]===report.rom.symbols.hot_memory_loop)memoryEntries++;}
  else{assert.equal(r[1]==='fault'||r[1]==='irq'?r[3]:r[1],q,'effect owns preceding Q');}
 }
 assert.equal(rows,report.journal.rows);assert.equal(attempt,report.attempts);assert.equal(q,report.q,'final committed Q');assert.ok(q<hotWorkload.proposedTotalQuantaCap&&attempt<hotWorkload.proposedTotalNativeTickCap);assert.equal(registerEntries,hotWorkload.registerIterations,'executed register loop entries');assert.equal(memoryEntries,hotWorkload.memoryIterations,'executed memory loop entries');
 assert.equal(report.halted,true);assert.equal(report.reset.cpu.cpuProfile,'compatibility');assert.equal(report.reset.cpu.strict386,false,'compatibility profile');assert.equal(report.final.cpu.cpuProfile,'compatibility');assert.equal(report.final.cpu.strict386,false);
 assert.deepEqual(report.final.checksums,[hotWorkload.registerChecksum,hotWorkload.registerNext,hotWorkload.memoryChecksum],'hot checksums');assert.deepEqual(report.final.witnesses,[17,17,34,34,34,34,34,34,85,85,85,85,51,51,68,68],'original SMC witnesses');assert.equal(report.final.cpu.ebx,20001);assert.equal(report.final.cpu.ecx,0);assert.equal(report.final.cpu.cycles,q);assert.equal(report.final.board.cycles,4+6*q);assert.equal(report.final.board.debt,0,'settled device debt');
 assert.deepEqual(report.deliveries.map(d=>[d.kind,d.vector]),[['fault',14],['fault',14],['irq',32]]);
 assert.equal(report.boundaries.hot_register_end.q-report.boundaries.hot_register_loop.q,4*hotWorkload.registerIterations,'register boundary committed work');assert.equal(report.boundaries.hot_memory_end.q-report.boundaries.hot_memory_loop.q,5*hotWorkload.memoryIterations,'memory boundary committed work');
 assert.ok(report.ports.some(e=>e.dir==='out'&&e.port===33&&e.value===255));assert.equal(Buffer.from(report.ports.filter(e=>e.dir==='out'&&e.port===233).map(e=>e.value)).toString(),hotWorkload.marker);
 return {q,attempts:attempt,rows,registerEntries,memoryEntries};
}
