import test from 'node:test';
import assert from 'node:assert/strict';
import {types} from 'node:util';
import {readFileSync} from 'node:fs';
import {createRequire,syncBuiltinESMExports} from 'node:module';
import {createGuestSiteRuntime} from '../scripts/xv6-js-rollback-direct-v8-guest-site-runtime/runtime-ports.mjs';
test('source-owned tick returns genuine Promise and crosses retained turn',async()=>{
 const p=createGuestSiteRuntime();let done=false;const promise=p.tick();assert.ok(types.isPromise(promise));promise.then(()=>{done=true;});
 assert.equal(p.status().phase,'turn-pending');await Promise.resolve();assert.equal(done,false);await promise;assert.equal(done,true);assert.equal(p.status().phase,'ready');assert.equal(p.status().turnCompleted,true);
 const s=p.status();assert.ok(Object.isFrozen(s));assert.equal(s.runtimeQualified,false);assert.equal(s.sourceInstanceQualified,false);assert.equal(s.guestConnected,false);p.dispose();
});
test('caller tick or thenable arguments are refused without invoking hooks',()=>{
 let effects=0;const fake={get then(){effects++;return ()=>{};}};assert.throws(()=>createGuestSiteRuntime(fake));
 const p=createGuestSiteRuntime();assert.throws(()=>p.tick(fake));assert.equal(effects,0);assert.equal(p.status().firstFailure,'tick-arguments');assert.equal(p.status().turnScheduled,false);
});
test('repeated pending tick poisons original turn without second scheduling',async()=>{
 const p=createGuestSiteRuntime(),first=p.tick();const rejection=assert.rejects(first,/tick-order/);assert.throws(()=>p.tick());await rejection;
 assert.equal(p.status().firstFailure,'tick-order');assert.equal(p.status().turnCompleted,false);assert.throws(()=>p.minorPressure(0));
});
test('pressure before turn and premature finish refuse permanently',()=>{
 for(const method of ['minorPressure','finishPressure']){const p=createGuestSiteRuntime();assert.throws(()=>p[method](...(method==='minorPressure'?[0]:[])));assert.equal(p.status().phase,'invalid');assert.throws(()=>p.tick());}
});
test('private small pressure cohort is released without exposing arrays',async()=>{
 const p=createGuestSiteRuntime();await p.tick();assert.equal(p.minorPressure(0),undefined);assert.equal(p.minorPressure(1),undefined);
 assert.equal(p.status().retainedArrays,2);assert.equal(p.status().pressureCalls,2);assert.equal(p.status().pressureAttempts,2);p.finishPressure();assert.equal(p.status().retainedArrays,0);assert.equal(p.status().phase,'finished');assert.throws(()=>p.minorPressure(2));
});
test('pressure indices have strict types, contiguous order and closed bound',async()=>{
 for(const args of [[true],[0.5],[-1],[1],[512],[0,()=>{}],[]]){
  const p=createGuestSiteRuntime();await p.tick();assert.throws(()=>p.minorPressure(...args));assert.equal(p.status().pressureAttempts,0);assert.equal(p.status().retainedArrays,0);assert.equal(p.status().firstFailure,'pressure-index');
 }
});
test('duplicate pressure index clears retained arrays and keeps first refusal',async()=>{
 const p=createGuestSiteRuntime();await p.tick();p.minorPressure(0);assert.throws(()=>p.minorPressure(0));assert.equal(p.status().retainedArrays,0);assert.equal(p.status().pressureCalls,1);p.dispose();assert.equal(p.status().firstFailure,'pressure-index');
});
test('finish without pressure supports major-case release mechanics only',async()=>{
 const p=createGuestSiteRuntime();await p.tick();p.finishPressure();assert.equal(p.status().pressureCalls,0);assert.equal(p.status().phase,'finished');assert.throws(()=>p.finishPressure());assert.equal(p.status().firstFailure,'finish-order');
});
test('dispose pending turn rejects original promise and prevents completion',async()=>{
 const p=createGuestSiteRuntime(),promise=p.tick();const rejected=assert.rejects(promise,/turn-disposed/);p.dispose();await rejected;assert.equal(p.status().turnCompleted,false);assert.equal(p.status().retainedArrays,0);
});
test('dispose pressure drops roots; disposed helper cannot tick or allocate',async()=>{
 const p=createGuestSiteRuntime();await p.tick();p.minorPressure(0);p.dispose();assert.equal(p.status().retainedArrays,0);assert.throws(()=>p.tick());assert.throws(()=>p.minorPressure(1));
});
test('static pressure cap and source algorithm match held dimensions without512 allocations',()=>{
 const source=readFileSync(new URL('../scripts/xv6-js-rollback-direct-v8-guest-site-runtime/runtime-ports.mjs',import.meta.url),'utf8');
 assert.match(source,/MAX_CALLS=512, ELEMENTS=1024/);assert.match(source,/capturedArrayFrom\(\{length:ELEMENTS\},\(_,j\)=>i\+j\)/);assert.match(source,/i>=MAX_CALLS/);
 assert.match(source,/if\(busy\)\{refuse\('runtime-reentry'\)/);assert.doesNotMatch(source,/global\.gc|addon\.|Reflect\.apply/);
});
test('independent helper turns and cohorts do not share pressure state',async()=>{
 const a=createGuestSiteRuntime(),b=createGuestSiteRuntime();await Promise.all([a.tick(),b.tick()]);a.minorPressure(0);assert.equal(b.status().retainedArrays,0);a.dispose();b.finishPressure();
});

test('test-local captured allocation shim exercises swallowed synchronous reentry',async()=>{
 const original=Array.from;let helper;
 try{
  Array.from=function(...args){try{helper.status();}catch{}return Reflect.apply(original,Array,args);};
  const fresh=await import('../scripts/xv6-js-rollback-direct-v8-guest-site-runtime/runtime-ports.mjs?manufactured-reentry');
  helper=fresh.createGuestSiteRuntime();
 }finally{Array.from=original;}
 await helper.tick();assert.throws(()=>helper.minorPressure(0));assert.equal(helper.status().firstFailure,'runtime-reentry');assert.equal(helper.status().pressureAttempts,1);assert.equal(helper.status().pressureCalls,0);assert.equal(helper.status().retainedArrays,0);helper.dispose();
});

test('post-push fence refuses swallowed reentry without successful pressure credit',async()=>{
 const fresh=await import('../scripts/xv6-js-rollback-direct-v8-guest-site-runtime/runtime-ports.mjs?manufactured-push');
 const helper=fresh.createGuestSiteRuntime();await helper.tick();const original=Array.prototype.push;
 try{
  Array.prototype.push=function(...args){try{helper.status();}catch{}return Reflect.apply(original,this,args);};
  assert.throws(()=>helper.minorPressure(0));
 }finally{Array.prototype.push=original;}
 assert.equal(helper.status().firstFailure,'runtime-reentry');assert.equal(helper.status().pressureAttempts,1);assert.equal(helper.status().pressureCalls,0);assert.equal(helper.status().retainedArrays,0);helper.dispose();
});
test('captured builtin turn survives later synchronized named-export replacement',async()=>{
 const require=createRequire(import.meta.url),timers=require('node:timers');const original=timers.setImmediate;let replacements=0,promise;
 const helper=createGuestSiteRuntime();
 try{
  timers.setImmediate=function(...args){replacements++;return Reflect.apply(original,this,args);};syncBuiltinESMExports();
  promise=helper.tick();assert.equal(replacements,0);
 }finally{timers.setImmediate=original;syncBuiltinESMExports();}
 await promise;assert.equal(helper.status().turnCompleted,true);helper.dispose();
});

test('captured scheduler failure returns original rejected Promise without orphaning identity',async()=>{
 const require=createRequire(import.meta.url),timers=require('node:timers');const original=timers.setImmediate,thrown={schedulerFailure:true};let helper;
 try{
  timers.setImmediate=()=>{throw thrown;};syncBuiltinESMExports();
  const fresh=await import('../scripts/xv6-js-rollback-direct-v8-guest-site-runtime/runtime-ports.mjs?manufactured-scheduler-throw');helper=fresh.createGuestSiteRuntime();
 }finally{timers.setImmediate=original;syncBuiltinESMExports();}
 const promise=helper.tick();const rejection=assert.rejects(promise,error=>error===thrown);
 assert.ok(types.isPromise(promise));const status=helper.status();assert.equal(status.phase,'invalid');assert.equal(status.firstFailure,'tick-scheduling-threw');assert.equal(status.turnScheduled,false);assert.equal(status.turnCompleted,false);assert.equal(status.pressureCalls,0);
 await rejection;assert.throws(()=>helper.minorPressure(0));helper.dispose();assert.equal(helper.status().firstFailure,'tick-scheduling-threw');
});
