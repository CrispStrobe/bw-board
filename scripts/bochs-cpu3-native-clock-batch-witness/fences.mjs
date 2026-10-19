/** Diagnostic fences for the source-owned HotDirectBoardFacade; not batch ownership. */
import assert from 'node:assert/strict';
import {openSync,closeSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {writeJournalRecord} from '../bochs-cpu3-native-hot-direct/journal.mjs';
export function fenceWriter(path,board,{maxBytes=2*1024*1024}={}){
 assert.equal(typeof board.compactSink,'function','fences require enabled compact host journal');
 const fd=openSync(path,'wx'),hash=createHash('sha256');let ordinal=0,bytes=0,closed=false;
 return {
  record(phase,resume,native,extra={}){
   assert.ok(!closed,'fence lifecycle');
   const bounded=(value,max)=>{assert.ok((typeof value==='bigint'&&value>=0n&&value<=BigInt(max))||(typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<=max),'bounded NAPI ledger');return Number(value);};
   const converted={...extra};if(phase==='return'){converted.chargedNativeTicks=bounded(extra.chargedNativeTicks,600);converted.chargedQuanta=bounded(extra.chargedQuanta,300);}
   assert.ok(Object.values(converted).every(v=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0),'numeric fence extras');
   const row={...converted,ordinal:++ordinal,phase,resume,hostOrdinal:board.compactCount,n:board.nativeTicks,q:board.successfulQuanta,cycles:board.machine.cycles,debt:board.machine._chipDebt,deadline:board.machine._chipDeadline,epoch:board.mappingEpoch,a20:Number(board.machine._a20Enabled),nativeN:bounded(native.nativeTicks,160000),nativeQ:bounded(native.successfulQuanta,150000)};
   assert.ok(Object.values(row).every(v=>typeof v!=='number'||Number.isSafeInteger(v)),'fence safe integer fields');
   const line=JSON.stringify(row)+'\n',size=Buffer.byteLength(line);assert.ok(bytes+size<=maxBytes,'fence byte bound before write');writeJournalRecord(fd,line);hash.update(line);bytes+=size;
  },
  close(){assert.ok(!closed,'fence close once');closed=true;closeSync(fd);return {schema:'i80386.hot.resume-fences.v1',rows:ordinal,bytes,sha256:hash.digest('hex'),scope:'diagnostic fences; no new native batch ABI'};},
 };
}
