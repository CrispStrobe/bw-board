import test from 'node:test';
import assert from 'node:assert/strict';
import {createGuestSnapshotCohort} from '../scripts/xv6-js-rollback-direct-v8-guest-site-cohort/cohort.mjs';
const fixture=(fn=()=>({}))=>{
 const p={};Object.defineProperty(p,'_snapshotInstruction',{value:fn,writable:true,configurable:true});return Object.create(p);
};
test('64 source returns retain identity and restore inherited method before once-only extraction',()=>{
 let cpu,calls=0;const returned=[];
 cpu=fixture(function(...args){assert.equal(this,cpu);assert.deepEqual(args,[1,'a']);calls++;const r={calls};returned.push(r);return r;});
 const original=cpu._snapshotInstruction,s=createGuestSnapshotCohort(cpu);
 for(let i=0;i<64;i++)assert.equal(cpu._snapshotInstruction(1,'a'),returned[i]);
 assert.equal(calls,64);assert.equal(cpu._snapshotInstruction,original);assert.equal(Object.hasOwn(cpu,'_snapshotInstruction'),false);
 assert.equal(s.status().phase,'captured');assert.ok(Object.isFrozen(s.status()));
 const roots=s.extract();assert.ok(Object.isFrozen(roots));assert.equal(roots.length,64);for(let i=0;i<64;i++)assert.equal(roots[i],returned[i]);
 assert.equal(s.status().phase,'closed');assert.throws(()=>s.extract());cpu._snapshotInstruction(1,'a');assert.equal(calls,65);assert.equal(s.status().capturedRoots,64);
});
test('throw identity and exactly one original invocation preserved',()=>{
 const thrown={};let calls=0;const cpu=fixture(()=>{calls++;throw thrown;}),original=cpu._snapshotInstruction,s=createGuestSnapshotCohort(cpu);
 assert.throws(()=>cpu._snapshotInstruction(),e=>e===thrown);assert.equal(calls,1);assert.equal(s.status().firstFailure,'snapshot-threw');s.dispose();assert.equal(cpu._snapshotInstruction,original);assert.throws(()=>s.extract());
});
test('duplicate and malformed roots refuse while original return preserved',()=>{
 for(const value of [{},null,1,new Proxy({}, {})]){
  const cpu=fixture(()=>value),s=createGuestSnapshotCohort(cpu);assert.equal(cpu._snapshotInstruction(),value);
  if(s.status().firstFailure===null)assert.equal(cpu._snapshotInstruction(),value);
  assert.equal(s.status().phase,'invalid');assert.throws(()=>s.extract());s.dispose();
 }
});
test('reentry keeps first refusal and ordinary calls',()=>{
 let inner=false,calls=0;const cpu=fixture(function(){calls++;if(!inner){inner=true;this._snapshotInstruction();}return {};});const s=createGuestSnapshotCohort(cpu);
 cpu._snapshotInstruction();assert.equal(calls,2);assert.equal(s.status().firstFailure,'observer-reentry');assert.equal(s.status().capturedRoots,0);s.dispose();
});
test('accessor CPU and prototype/callable proxies never invoke hooks',()=>{
 let effects=0;const cpu={};Object.defineProperty(cpu,'_snapshotInstruction',{get(){effects++;return ()=>({});}});assert.throws(()=>createGuestSnapshotCohort(cpu));
 const proxy=new Proxy({}, {getPrototypeOf(){effects++;return null;},getOwnPropertyDescriptor(){effects++;return {};}});assert.throws(()=>createGuestSnapshotCohort(proxy));assert.throws(()=>createGuestSnapshotCohort(Object.create(proxy)));
 const call=new Proxy(()=>({}),{apply(){effects++;return {};}});assert.throws(()=>createGuestSnapshotCohort(fixture(call)));assert.equal(effects,0);
});
test('prior own flags restore including writable nonconfigurable descriptor',()=>{
 for(const configurable of [true,false]){
  const cpu={},prior={value:()=>({}),writable:true,enumerable:true,configurable};Object.defineProperty(cpu,'_snapshotInstruction',prior);const s=createGuestSnapshotCohort(cpu);cpu._snapshotInstruction();s.dispose();assert.deepEqual(Object.getOwnPropertyDescriptor(cpu,'_snapshotInstruction'),prior);
 }
 const cpu={};Object.defineProperty(cpu,'_snapshotInstruction',{value:()=>({}),writable:false,configurable:false});assert.throws(()=>createGuestSnapshotCohort(cpu));
});
test('replacement never overwritten by cleanup',()=>{
 const cpu=fixture(),s=createGuestSnapshotCohort(cpu),foreign=()=>({});cpu._snapshotInstruction=foreign;assert.equal(s.status().firstFailure,'descriptor-changed');s.dispose();assert.equal(cpu._snapshotInstruction,foreign);assert.equal(s.status().firstFailure,'descriptor-changed');
});
test('replacement during original preserves returned object and foreign descriptor',()=>{
 const result={},foreign=()=>({});const cpu=fixture(function(){Object.defineProperty(this,'_snapshotInstruction',{value:foreign,configurable:false});return result;}),s=createGuestSnapshotCohort(cpu);
 assert.equal(cpu._snapshotInstruction(),result);assert.equal(s.status().firstFailure,'descriptor-changed');s.dispose();assert.equal(cpu._snapshotInstruction,foreign);
});
test('disposed saved wrapper and changed prototype refuse without destructive cleanup',()=>{
 const cpu=fixture(),s=createGuestSnapshotCohort(cpu),wrapper=cpu._snapshotInstruction;s.dispose();assert.equal(s.status().phase,'disposed');assert.deepEqual(wrapper.call(cpu),{});assert.equal(s.status().firstFailure,'stale-wrapper');
 const other=fixture(),t=createGuestSnapshotCohort(other);Object.setPrototypeOf(other,{});assert.equal(t.status().firstFailure,'descriptor-changed');t.dispose();assert.ok(Object.hasOwn(other,'_snapshotInstruction'));
});
test('wrong receiver and premature/caller-root extraction refused',()=>{
 const cpu=fixture(),s=createGuestSnapshotCohort(cpu);assert.deepEqual(cpu._snapshotInstruction.call({}),{});assert.equal(s.status().firstFailure,'receiver-changed');s.dispose();
 for(const args of [[],[[]]]){const o=fixture(),t=createGuestSnapshotCohort(o);assert.throws(()=>t.extract(...args));assert.equal(t.status().phase,'invalid');t.dispose();}
});
test('bounded prototype depth and nonextensible instance refuse',()=>{
 let cpu=fixture();for(let i=0;i<16;i++)cpu=Object.create(cpu);assert.throws(()=>createGuestSnapshotCohort(cpu));assert.throws(()=>createGuestSnapshotCohort(Object.preventExtensions(fixture())));
});
test('captured descriptor drift refuses extraction without overwriting new owner',()=>{
 const cpu=fixture(),s=createGuestSnapshotCohort(cpu);for(let i=0;i<64;i++)cpu._snapshotInstruction();const foreign=()=>({});cpu._snapshotInstruction=foreign;assert.throws(()=>s.extract());assert.equal(s.status().firstFailure,'descriptor-changed');s.dispose();assert.equal(cpu._snapshotInstruction,foreign);
});

test('status during original latches reentry with no positive root credit',()=>{
 let seam;const result={};const cpu=fixture(()=>{const status=seam.status();assert.equal(status.phase,'invalid');assert.equal(status.firstFailure,'observer-reentry');return result;});seam=createGuestSnapshotCohort(cpu);assert.equal(cpu._snapshotInstruction(),result);assert.equal(seam.status().capturedRoots,0);seam.dispose();
});
test('stale saved wrapper cannot grow captured count after64',()=>{
 const cpu=fixture(),seam=createGuestSnapshotCohort(cpu),saved=cpu._snapshotInstruction;for(let i=0;i<64;i++)cpu._snapshotInstruction();assert.deepEqual(saved.call(cpu),{});assert.equal(seam.status().firstFailure,'stale-wrapper');assert.equal(seam.status().capturedRoots,64);assert.throws(()=>seam.extract());
});

test('same instance cannot mint another seam after issuance or disposal',()=>{
 const cpu=fixture(),s=createGuestSnapshotCohort(cpu);assert.throws(()=>createGuestSnapshotCohort(cpu));s.dispose();assert.throws(()=>createGuestSnapshotCohort(cpu));
});
test('busy extraction and disposal refuse while preserving ordinary result',()=>{
 for(const operation of ['extract','dispose']){
  let seam;const result={};const cpu=fixture(()=>{if(operation==='extract')assert.throws(()=>seam.extract());else seam.dispose();return result;});seam=createGuestSnapshotCohort(cpu);assert.equal(cpu._snapshotInstruction(),result);assert.equal(seam.status().firstFailure,'observer-reentry');assert.equal(seam.status().capturedRoots,0);seam.dispose();
 }
});
test('intermediate prototype or own deletion during original refuses without overwrite',()=>{
 const parent=fixture();const middle=Object.create(Object.getPrototypeOf(parent));let cpu;
 Object.defineProperty(Object.getPrototypeOf(parent),'_snapshotInstruction',{value:function(){Object.setPrototypeOf(middle,{});return {};},writable:true,configurable:true});cpu=Object.create(middle);const seam=createGuestSnapshotCohort(cpu);assert.deepEqual(cpu._snapshotInstruction(),{});assert.equal(seam.status().firstFailure,'descriptor-changed');seam.dispose();assert.ok(Object.hasOwn(cpu,'_snapshotInstruction'));
 const other=fixture(function(){delete this._snapshotInstruction;return {};});const s=createGuestSnapshotCohort(other);assert.deepEqual(other._snapshotInstruction(),{});assert.equal(s.status().firstFailure,'descriptor-changed');s.dispose();assert.equal(Object.hasOwn(other,'_snapshotInstruction'),false);
});
test('nonconfigurable changed wrapper descriptor cleanup refuses without overwrite',()=>{
 const cpu=fixture(),s=createGuestSnapshotCohort(cpu),wrapper=cpu._snapshotInstruction;Object.defineProperty(cpu,'_snapshotInstruction',{value:wrapper,configurable:false,writable:false});const before=Object.getOwnPropertyDescriptor(cpu,'_snapshotInstruction');s.dispose();assert.equal(s.status().firstFailure,'cleanup-descriptor-changed');assert.deepEqual(Object.getOwnPropertyDescriptor(cpu,'_snapshotInstruction'),before);assert.deepEqual(cpu._snapshotInstruction(),{});assert.equal(s.status().capturedRoots,0);
});
