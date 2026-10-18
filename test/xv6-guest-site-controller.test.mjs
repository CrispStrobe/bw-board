import test from 'node:test';
import assert from 'node:assert/strict';
import {createGuestSiteController} from '../scripts/xv6-js-rollback-direct-v8-guest-site-controller/controller.mjs';
function fixture(kind='minor-baseline'){
 const log=[];let gc=0,serial=0,controller;const roots=[];
 const cpu={_snapshotInstruction(){log.push('snapshot-root');const r={serial};roots.push(r);return r;}};
 const addon={begin(flags){log.push(`begin:${flags}`);gc=0;},facts(){return {gc:Array(gc).fill({})};},
  adopt(value){log.push(`adopt:${value.length}`);},snapshot(){log.push('profile');return {profile:true};},stop(){log.push('stop');}};
 const ports={cpu,addon,fullGC(){log.push('fullGC');if(log.some(s=>s.startsWith('begin:')))gc++;},
  boardStep(){log.push('board-start');cpu._snapshotInstruction();serial++;log.push('board-tail');return serial;},
  tick(){log.push('tick');return Promise.resolve();},minorPressure(i){log.push(`pressure:${i}`);gc++;},
  pause(){log.push('pause');},resume(){log.push('resume');},saveSnapshot(which){log.push(`save:${which}`);}};
 return {log,ports,cpu,addon,setGC:n=>{gc=n;},getSerial:()=>serial,create(){controller=createGuestSiteController(ports,kind);return controller;}};
}
function capture(f,c){c.start();for(let i=0;i<64;i++)assert.equal(c.advance(),i+1);}
test('minor lifecycle preserves full tail, fixed order and false authority',async()=>{
 const f=fixture(),c=f.create();capture(f,c);assert.equal(c.status().phase,'paused');
 assert.equal(f.log.at(-2),'board-tail');assert.equal(f.log.at(-1),'pause');
 await c.finish();const s=c.status();assert.equal(s.phase,'complete');assert.equal(s.boardCalls,64);
 assert.equal(s.guestConnected,false);assert.equal(s.sourceInstanceQualified,false);assert.ok(Object.isFrozen(s));
 assert.deepEqual(s.cuts,{afterInstallation:0,afterSnapshot:0,beforeRelease:0,afterRelease:0,finalGC:1});assert.ok(Object.isFrozen(s.cuts));
 assert.deepEqual(f.log.slice(0,2),['fullGC','begin:0']);
 assert.deepEqual(f.log.slice(-10),['pause','adopt:64','profile','save:pre','tick','pressure:0','profile','save:post','stop','resume']);
 assert.equal(f.getSerial(),64);assert.throws(()=>c.advance());
});
test('all four fixed flags and major collection order',async()=>{
 for(const [kind,flag] of [['minor-baseline',0],['minor-enabled',4],['major-baseline',0],['major-enabled',2]]){
  const f=fixture(kind),c=f.create();capture(f,c);await c.finish();assert.equal(f.log[1],`begin:${flag}`);
  assert.equal(f.log.filter(x=>x==='fullGC').length,kind.startsWith('major')?2:1);
 }
});
test('accessor and proxy ports refuse without hooks',()=>{
 let effects=0;const f=fixture();Object.defineProperty(f.ports,'tick',{get(){effects++;return ()=>{};}});
 assert.throws(()=>f.create());assert.equal(effects,0);
 assert.throws(()=>createGuestSiteController(new Proxy({}, {ownKeys(){effects++;return [];}}),'minor-baseline'));assert.equal(effects,0);
});
test('begin failure retains completed unarmed invocation and thrown identity',()=>{
 const f=fixture(),thrown={};f.addon.begin=()=>{throw thrown;};const c=f.create();
 assert.throws(()=>c.start(),e=>e===thrown);assert.equal(c.status().admissionStatus.fullGCCompleted,true);assert.equal(c.status().phase,'invalid');assert.ok(!f.log.includes('resume'));
});
test('fullGC failure keeps incomplete admission',()=>{
 const f=fixture();f.ports.fullGC=()=>{throw Error('manufactured');};const c=f.create();assert.throws(()=>c.start());assert.equal(c.status().admissionStatus.fullGCCompleted,false);
});
test('seam installation failure retains admission and cleans once',()=>{
 const f=fixture();Object.defineProperty(f.cpu,'_snapshotInstruction',{value:()=>({}),writable:false,configurable:false});
 const c=f.create();assert.throws(()=>c.start());assert.equal(c.status().admissionStatus.fullGCCompleted,true);assert.equal(f.log.filter(x=>x==='stop').length,1);
});
test('GC after installation or at pre serialization refuses before resume',async()=>{
 const f=fixture(),c=f.create();capture(f,c);f.ports.saveSnapshot=()=>f.setGC(1);
 // Descriptor swap itself refuses before the callback can be credited.
 await assert.rejects(c.finish());assert.equal(c.status().firstFailure,'ports-changed');assert.ok(!f.log.includes('resume'));
 const g=fixture();g.ports.saveSnapshot=which=>{g.log.push(`save:${which}`);if(which==='pre')g.setGC(1);};const d=g.create();capture(g,d);await assert.rejects(d.finish());assert.ok(!g.log.includes('resume'));
});
test('swallowed board callback status reentry gives no pause or resumed calls',()=>{
 const f=fixture();let c;const original=f.ports.boardStep;f.ports.boardStep=function(){const result=original();try{c.status();}catch{}return result;};c=f.create();c.start();
 assert.throws(()=>c.advance());assert.equal(f.getSerial(),1);assert.equal(c.status().firstFailure,'controller-reentry');assert.ok(!f.log.includes('pause'));assert.throws(()=>c.advance());
});
test('board exception identity and partial counter retained',()=>{
 const f=fixture(),thrown={};f.ports.boardStep=()=>{f.log.push('tail-before-throw');throw thrown;};const c=f.create();c.start();assert.throws(()=>c.advance(),e=>e===thrown);assert.equal(c.status().boardCalls,1);assert.equal(c.status().phase,'invalid');
});
test('duplicate root refuses without guest credit',()=>{
 const f=fixture(),root={};f.cpu._snapshotInstruction=()=>root;const c=f.create();c.start();c.advance();assert.throws(()=>c.advance());assert.equal(c.status().phase,'invalid');assert.ok(!f.log.includes('adopt:64'));
});
test('tick reentry and post-await owner substitution refuse',async()=>{
 for(const mutate of ['reentry','owner']){
  const f=fixture();let c;f.ports.tick=async()=>{if(mutate==='reentry'){try{c.dispose();}catch{}}else f.ports.cpu={};};c=f.create();capture(f,c);await assert.rejects(c.finish());assert.ok(!f.log.includes('resume'));
 }
});
test('minor no collection and multiple collections refuse',async()=>{
 for(const n of [0,2]){const f=fixture();f.ports.minorPressure=i=>{f.log.push(`pressure:${i}`);f.setGC(n);};const c=f.create();capture(f,c);await assert.rejects(c.finish());assert.equal(f.log.filter(x=>x.startsWith('pressure:')).length,n===0?512:1);assert.ok(!f.log.includes('resume'));}
});
test('foreign descriptor cleanup never overwrites and stop failure stays refused',()=>{
 const f=fixture(),c=f.create();c.start();const foreign=()=>({});f.cpu._snapshotInstruction=foreign;c.dispose();assert.equal(f.cpu._snapshotInstruction,foreign);
 const g=fixture();g.addon.stop=()=>{throw Error('manufactured');};const d=g.create();d.start();d.dispose();assert.equal(d.status().firstFailure,'cleanup-stop-threw');
});
test('start once, early finish and changed owner cleanup refuse',async()=>{
 const f=fixture(),c=f.create();c.start();assert.throws(()=>c.start());
 const g=fixture(),d=g.create();await assert.rejects(d.finish());assert.equal(d.status().phase,'invalid');
 const h=fixture(),e=h.create();e.start();h.ports.addon={};e.dispose();assert.equal(e.status().firstFailure,'cleanup-owner-changed');assert.ok(!h.log.includes('stop'));
});

test('changed addon owner still releases private seam and restores own descriptor or absence',()=>{
 for(const inherited of [false,true]){
  const f=fixture();const original=f.cpu._snapshotInstruction;
  if(inherited){delete f.cpu._snapshotInstruction;Object.setPrototypeOf(f.cpu,{_snapshotInstruction:original});}
  const prior=Object.getOwnPropertyDescriptor(f.cpu,'_snapshotInstruction');const c=f.create();c.start();c.advance();
  f.ports.addon={};c.dispose();assert.deepEqual(Object.getOwnPropertyDescriptor(f.cpu,'_snapshotInstruction'),prior);
  assert.equal(c.status().firstFailure,'cleanup-owner-changed');assert.equal(c.status().stopAttempted,false);assert.ok(!f.log.includes('stop'));
 }
});
test('changed CPU descriptor remains foreign during changed-owner cleanup',()=>{
 const f=fixture(),c=f.create();c.start();c.advance();const foreign=()=>({foreign:true});f.cpu._snapshotInstruction=foreign;f.ports.addon={};c.dispose();
 assert.equal(f.cpu._snapshotInstruction,foreign);assert.equal(c.status().firstFailure,'cleanup-cohort-refused');assert.equal(c.status().stopAttempted,false);
});
test('stopAttempted is false when the stop pre-fence refuses changed ownership',async()=>{
 const f=fixture();f.ports.saveSnapshot=which=>{f.log.push(`save:${which}`);if(which==='post')f.ports.addon={};};const c=f.create();capture(f,c);await assert.rejects(c.finish());assert.equal(c.status().stopAttempted,false);assert.ok(!f.log.includes('stop'));
});

test('hidden accessor and symbol extras violate closed own ports without getter calls',()=>{
 let effects=0;
 for(const target of ['ports','addon']){
  const f=fixture();Object.defineProperty(f[target],'hidden',{get(){effects++;return ()=>{};},enumerable:false});assert.throws(()=>f.create());
  const g=fixture();g[target][Symbol('extra')]=()=>{};assert.throws(()=>g.create());
 }
 assert.equal(effects,0);
 const f=fixture(),c=f.create();c.start();f.ports[Symbol('late')]=1;assert.throws(()=>c.advance());assert.equal(c.status().firstFailure,'ports-changed');
});
test('boardCalls records actual invocation, excluding pre-fence owner refusals',()=>{
 const f=fixture(),c=f.create();c.start();f.ports.boardStep=()=>{throw Error('must not invoke');};assert.throws(()=>c.advance());assert.equal(c.status().boardCalls,0);assert.equal(f.getSerial(),0);
});
