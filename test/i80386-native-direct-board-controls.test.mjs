import test from 'node:test';
import assert from 'node:assert/strict';
import {assertFatalControlWitness} from '../scripts/audit-i80386-native-direct-board-adapter.mjs';
// Validator unit tests only: these strings are synthetic witnesses, never guest receipts.
test('fatal witness checker requires the exact native cause and child SIGABRT',()=>{
 const sample={error:null,signal:'SIGABRT',stderr:'BWSD1\tFAIL\tdirect-page-sha256\n'};
 assert.doesNotThrow(()=>assertFatalControlWitness('bad-page-sha',sample));
 for(const change of [{signal:'SIGTERM'},{error:'timeout'},{stderr:'BWSD1\tFAIL\tdirect-page-callback\n'}])assert.throws(()=>assertFatalControlWitness('bad-page-sha',{...sample,...change}));
});

test('actual 8042 mapping metadata changes before the following successful quantum',async()=>{
 const {DirectBoardFacade}=await import('../scripts/bochs-cpu3-native-direct-board/board.mjs');
 // Manual callback contract fixture, not an assembled/native guest execution.
 const board=new DirectBoardFacade(new Uint8Array(65536));board.beginRun();
 try{
  assert.deepEqual(board.mappingState(),{boardA20:1,mappingEpoch:0});
  board.outPort(0x64,1,0xd1);const before=board.inspect();
  assert.deepEqual(board.outPort(0x60,1,1),{value:0,boardA20:0,mappingEpoch:1});
  const committed=board.inspect();assert.equal(committed.nativeTicks,before.nativeTicks);assert.equal(committed.successfulQuanta,before.successfulQuanta);
  const cycles=committed.board.cycles;board.quantum(0);
  assert.deepEqual(board.mappingState(),{boardA20:0,mappingEpoch:1});assert.equal(board.inspect().board.cycles,cycles+6);
  board.outPort(0x64,1,0xd1);assert.deepEqual(board.outPort(0x60,1,3),{value:0,boardA20:1,mappingEpoch:2});board.quantum(0);
  assert.deepEqual(board.mappingState(),{boardA20:1,mappingEpoch:2});assert.equal(board.inspect().nativeTicks,0);
 }finally{board.endRun();board.close();}
});

test('fresh-process duration summary preserves the measured distribution',async()=>{
 const {summarizeFreshProcessSamples}=await import('../scripts/audit-i80386-native-direct-board-adapter.mjs');
 assert.deepEqual(summarizeFreshProcessSamples([{executionNs:30},{executionNs:10},{executionNs:20}]),{unit:'nanoseconds',samples:3,min:10,median:20,max:30,sorted:[10,20,30]});
 assert.throws(()=>summarizeFreshProcessSamples([{executionNs:0},{executionNs:1},{executionNs:2}]),/positive canonical/);
});

test('child Bochs configuration preserves every setting except its owned log path',async()=>{
 const {ownedChildConfiguration}=await import('../scripts/audit-i80386-native-direct-board-adapter.mjs');
 const configuration='megs: 16\nlog: /preserved/smoke.log\ncpu: count=1,ips=6000000\n';
 const first=ownedChildConfiguration(configuration,'/new/continuous-true'),second=ownedChildConfiguration(configuration,'/new/budget1-false');
 assert.equal(first.text,'megs: 16\nlog: "/new/continuous-true.bochs.log"\ncpu: count=1,ips=6000000\n');
 assert.equal(first.sourceSha256,second.sourceSha256);assert.notEqual(first.sha256,second.sha256);assert.notEqual(first.logPath,second.logPath);
 assert.match(configuration,/log: \/preserved\/smoke.log/);
 assert.throws(()=>ownedChildConfiguration('megs: 16\n','/new/child'),/exactly one/);
 assert.throws(()=>ownedChildConfiguration(configuration+'log: another\n','/new/child'),/exactly one/);
});

test('adversarial metadata fixture detaches its bytes exactly on decoded lookup',async()=>{
 const {detachBytesOnDecodedLookup}=await import('../scripts/audit-i80386-native-direct-board-adapter.mjs');
 const result=detachBytesOnDecodedLookup({decoded:0x7000,bytes:Uint8Array.from([0xbb,0x11,0x11,0xcb])});
 const copied=Uint8Array.from(result.bytes);assert.equal(result.bytes.byteLength,4);
 assert.equal(result.decoded,0x7000);assert.equal(result.bytes.byteLength,0);assert.deepEqual([...copied],[0xbb,0x11,0x11,0xcb]);
 // This verifies the attack fixture; only actual child controls test the N-API fix.
});
