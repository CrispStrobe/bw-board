import test from 'node:test';
import assert from 'node:assert/strict';
import {assertFatalControlWitness} from '../scripts/audit-i80386-native-direct-board-adapter.mjs';
// Validator unit tests only: these strings are synthetic witnesses, never guest receipts.
test('fatal witness checker requires the exact native cause and child SIGABRT',()=>{
 const sample={error:null,signal:'SIGABRT',stderr:'BWSD1\tFAIL\tdirect-page-sha256\n'};
 assert.doesNotThrow(()=>assertFatalControlWitness('bad-page-sha',sample));
 for(const change of [{signal:'SIGTERM'},{error:'timeout'},{stderr:'BWSD1\tFAIL\tdirect-page-callback\n'}])assert.throws(()=>assertFatalControlWitness('bad-page-sha',{...sample,...change}));
});
