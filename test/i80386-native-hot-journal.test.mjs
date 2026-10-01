import test from 'node:test';
import assert from 'node:assert/strict';
import {writeJournalRecord} from '../scripts/bochs-cpu3-native-hot-direct/journal.mjs';
test('partial compact writes preserve exact UTF-8 bytes and offsets',()=>{const input=Buffer.from('event: λ\n'),observed=[];assert.equal(writeJournalRecord(1,input,{write:(fd,b,offset,length)=>{const n=Math.min(2,length);observed.push(...b.subarray(offset,offset+n));return n;}}),input.length);assert.deepEqual(Buffer.from(observed),input);});
test('zero or impossible progress fails instead of authenticating truncated records',()=>{for(const count of [0,-1,100,NaN])assert.throws(()=>writeJournalRecord(1,'x',{write:()=>count}),/invalid progress/);});
