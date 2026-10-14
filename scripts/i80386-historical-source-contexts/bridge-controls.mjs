import test from 'node:test';
import assert from 'node:assert/strict';
import {validateReady,validateClosed} from './bridge.mjs';
const pins={'context-table.json':'bc25ea1cbc780719c43cc5efc1be8ba361262b15b2b8f93ef7b1796e6c2b4e97','original-proofs.json':'b850c7f709bf07044b4c6b74d8b9a673f460045620ab816eab18be64ccb482cd'};
const table={selectors:{known:['scripts/fixed.mjs']}};
const ready=()=>({schema:'bw.historical-owner-ready.v1',repository:'CrispStrobe/bw-board',head:'c3ada315e9dfc51cd70ac6403d9e1ab18a0faf5c',root:'/tmp/bw-held-fixture/source',rowCount:186,pins:structuredClone(pins),selectors:structuredClone(table.selectors),runtimeQualified:false,currentCpuQualified:false});
const closed=()=>({schema:'bw.historical-owner-closed.v1',readyIssued:true,releaseObserved:true,firstFailure:null,historicalRuntimeQualified:false,currentCpuQualified:false,observations:{schema:'bw.historical-materializer-observations.v1',materialized:true,readbackComplete:true,finalReadbackComplete:true,releaseAttempted:true,releaseComplete:true,cleanupUncertain:false,hostedQualified:false,continuousOwnershipQualified:false,hardDeadlineQualified:false,historicalRuntimeQualified:false,currentCpuQualified:false}});
test('fixed READY accepts only issued context and selectors',()=>{assert.equal(validateReady(ready(),table),'/tmp/bw-held-fixture/source');});
test('foreign roots, revisions and hidden selectors refuse',()=>{for(const change of [v=>v.root='/foreign/source',v=>v.head='0'.repeat(40),v=>v.selectors.known.push('test/old.test.mjs'),v=>v.pins['context-table.json']='0'.repeat(64),v=>v.rowCount=true,v=>v.extra=true,v=>v.runtimeQualified=true]){const v=ready();change(v);assert.throws(()=>validateReady(v,table));}});
test('observed CLOSED requires readback, release and false authority',()=>{validateClosed(closed());for(const change of [v=>v.releaseObserved=false,v=>v.observations.finalReadbackComplete=false,v=>v.observations.cleanupUncertain=true,v=>v.firstFailure={type:'OSError',message:'first'},v=>v.observations.currentCpuQualified=true,v=>v.observations.extra=true]){const v=closed();change(v);assert.throws(()=>validateClosed(v));}});

// Only the private test harness replaces the builtin spawn binding. No caller
// factory or command route is exported by the bridge.
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {readFileSync} from 'node:fs';
import {historicalContext} from './bridge.mjs';
const actualTable=JSON.parse(readFileSync(new URL('./context-table.json',import.meta.url)));
function fakeChild(readyValue,closedValue){
 const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();
 child.kill=()=>{throw new Error('no kill expected');};
 child.stdin={end(command){queueMicrotask(()=>{if(command==='CLOSE\n')child.stdout.write(JSON.stringify(closedValue)+'\n');child.stdout.end();child.stderr.end();child.emit('close',command==='CLOSE\n'?0:1,null);});}};
 queueMicrotask(()=>child.stdout.write(JSON.stringify(readyValue)+'\n'));
 return child;
}
test('fixed spawned owner retains one READY through explicit CLOSE',async()=>{
 const original=childProcess.spawn;let calls=0;
 const r=ready();r.selectors=actualTable.selectors;
 childProcess.spawn=(binary,args,options)=>{calls++;assert.equal(binary,'/usr/bin/python3');assert.deepEqual(args.slice(0,2),['-I','-B']);assert.equal(args.length,3);assert.ok(args[2].endsWith('/i80386-historical-source-contexts/owner.py'));assert.equal(options.shell,false);assert.equal(options.env.PATH,'/usr/bin:/bin');return fakeChild(r,closed());};syncBuiltinESMExports();
 try{const c=await historicalContext(new URL('../../test/i80386-protected-ram-source.test.mjs',import.meta.url));assert.equal(c.root,'/tmp/bw-held-fixture/source');assert.ok(c.file('src/experimental/i80386.js').href.endsWith('/src/experimental/i80386.js'));await assert.rejects(c.module('test/i80386-protected-ram-source.test.mjs'));await c.close();await assert.rejects(c.close());assert.equal(calls,1);}
 finally{childProcess.spawn=original;syncBuiltinESMExports();}
});
test('uncertain CLOSED or bad READY never grants release',async()=>{
 const original=childProcess.spawn;
 try{for(const bad of ['ready','closed']){const r=ready();r.selectors=actualTable.selectors;const c=closed();if(bad==='ready')r.head='0'.repeat(40);else c.observations.cleanupUncertain=true;childProcess.spawn=()=>fakeChild(r,c);syncBuiltinESMExports();if(bad==='ready')await assert.rejects(historicalContext(new URL('../../test/i80386-protected-ram-source.test.mjs',import.meta.url)));else{const context=await historicalContext(new URL('../../test/i80386-protected-ram-source.test.mjs',import.meta.url));await assert.rejects(context.close());}}}
 finally{childProcess.spawn=original;syncBuiltinESMExports();}
});

import {fileURLToPath} from 'node:url';
async function manufacturedImportBridge(importer){
 // Test-only source wiring substitutes the internal import expression. It does
 // not add a production caller delegate or execute any held module.
 const raw=readFileSync(new URL('./bridge.mjs',import.meta.url),'utf8');
 const namespace=fileURLToPath(new URL('.',import.meta.url)).replace(/\/$/,'');
 const source=raw.replace('const namespace=dirname(fileURLToPath(import.meta.url));','const namespace='+JSON.stringify(namespace)+';')
  .replace('await import(pathToFileURL(join(root,relative)).href)','await globalThis.__historicalControlImport()');
 globalThis.__historicalControlImport=importer;
 return import('data:text/javascript;base64,'+Buffer.from(source).toString('base64')+'#'+Math.random());
}
test('post READY owner exit, error and cap freeze URL and imports',async()=>{
 const original=childProcess.spawn;let calls=0;
 try{const bridge=await manufacturedImportBridge(async()=>{calls++;return {};});
 for(const reason of ['exit','error','cap']){
  let child;const r=ready();r.selectors=actualTable.selectors;
  childProcess.spawn=()=>{child=fakeChild(r,closed());return child;};syncBuiltinESMExports();
  const c=await bridge.historicalContext(new URL('../../test/i80386-protected-ram-source.test.mjs',import.meta.url));
  if(reason==='exit')child.emit('close',1,null);
  else if(reason==='error')child.emit('error',new Error('owned failure'));
  else child.stdout.write(Buffer.alloc(32769,65));
  assert.throws(()=>c.file('src/experimental/i80386.js'));
  await assert.rejects(c.module(actualTable.selectors['protected-ram-source'][0]));
  await assert.rejects(c.close());
 }
 assert.equal(calls,0);
 }finally{childProcess.spawn=original;syncBuiltinESMExports();delete globalThis.__historicalControlImport;}
});
test('owner poison during awaited import prevents export return',async()=>{
 const original=childProcess.spawn;let resolveImport;let imports=0;let child;
 try{const bridge=await manufacturedImportBridge(()=>{imports++;return new Promise(resolve=>{resolveImport=resolve;});});
 const r=ready();r.selectors=actualTable.selectors;
 childProcess.spawn=()=>{child=fakeChild(r,closed());return child;};syncBuiltinESMExports();
 const c=await bridge.historicalContext(new URL('../../test/i80386-protected-ram-source.test.mjs',import.meta.url));
 const pending=c.module(actualTable.selectors['protected-ram-source'][0]);
 assert.equal(imports,1);child.emit('error',new Error('during import'));resolveImport({fixture:true});
 await assert.rejects(pending,/during import/);await assert.rejects(c.close());
 }finally{childProcess.spawn=original;syncBuiltinESMExports();delete globalThis.__historicalControlImport;}
});
