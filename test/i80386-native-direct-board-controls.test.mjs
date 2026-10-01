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
