import test from 'node:test';
import assert from 'node:assert/strict';
import {assertCombinedDeepEqual} from '../scripts/i80386-native-combined-paging-ram-board-gate.mjs';
test('bounded proof assertions preserve strict deep comparison semantics',()=>{
 const pairs=[[{a:[1,2]}, {a:[1,2]},true],[new Uint8Array([1]),new Uint8Array([1]),true],[new Map([[1,{x:2}]]),new Map([[1,{x:2}]]),true],[{x:undefined},{},false],[Object.assign(Object.create(null),{x:1}),{x:1},false],[new Uint8Array([1]),new Int8Array([1]),false],[-0,0,false],[NaN,NaN,true],[{x:1},{x:'1'},false]];
 for(const [a,b,equal] of pairs){let ordinary=true;try{assert.deepStrictEqual(a,b);}catch{ordinary=false;}assert.equal(ordinary,equal);if(equal)assertCombinedDeepEqual(a,b,'strict proof');else assert.throws(()=>assertCombinedDeepEqual(a,b,'strict proof'),e=>e.name==='AssertionError'&&e.code==='ERR_ASSERTION'&&e.operator==='deepStrictEqual'&&e.message==='strict proof'&&e.actual===a&&e.expected===b);}
});
test('whole-journal rejection never invokes inspection or emits a giant diff',()=>{
 let inspections=0;const inspect=Symbol.for('nodejs.util.inspect.custom');
 const actual=Array.from({length:300},(_,i)=>({sequence:i,before:{board:{chipStates:{uart1:{lcr:0}}}},after:{board:{chipStates:{uart1:{lcr:0}}}},[inspect](){inspections++;throw Error('inspection forbidden');}}));
 const expected=actual.map(x=>({...x,before:{board:{chipStates:{uart1:{lcr:1}}}},after:{board:{chipStates:{uart1:{lcr:1}}}}}));
 assert.throws(()=>assertCombinedDeepEqual(actual,expected,'native combined paging/RAM/REP proof: actual host replay journal'),e=>e.message==='native combined paging/RAM/REP proof: actual host replay journal'&&e.actual===actual&&e.expected===expected);
 assert.equal(inspections,0);
});
