/** SOURCE ONLY derivation. No addon load or guest execution. */
import assert from 'node:assert/strict';import {readFileSync,writeFileSync}from 'node:fs';import {createHash}from 'node:crypto';import {resolve,dirname}from 'node:path';
const root='/tmp/bw-board-386-native-owned-main-20261002',out=dirname(new URL(import.meta.url).pathname),sha=x=>createHash('sha256').update(x).digest('hex');
const source=JSON.parse(readFileSync('/mnt/volume1/tmp-astra/native-owned-main-source-20261002/source-freeze.json')).source;assert.equal(source.revision,'bab751825473d55d8bf6da8c6ad5786921ffcfe1');for(const [p,h]of Object.entries(source.hashes))assert.equal(sha(readFileSync(resolve(root,p))),h);
const files=[];
function derive(path,name,changes){const original=readFileSync(resolve(root,path),'utf8');let text=original;for(const [a,b]of changes){assert.equal(text.split(a).length,2,a);text=text.replace(a,b);}let inverse=text;for(const [a,b]of [...changes].reverse()){assert.equal(inverse.split(b).length,2);inverse=inverse.replace(b,a);}assert.equal(inverse,original);writeFileSync(resolve(out,name),text);files.push({path,name,originalSha256:sha(original),derivedSha256:sha(text),changes});}
const provider='scripts/bochs-cpu3-native-owned-clock/provider.mjs';
derive(provider,'provider.mjs',[
 ["import assert from 'node:assert/strict';","import assert from 'node:assert/strict';\nimport {now,add,measure}from './timing.mjs';"],
 ["from '../bochs-cpu3-native-hot-direct/board.mjs'",`from '${root}/scripts/bochs-cpu3-native-hot-direct/board.mjs'`],
 ["from '../i80386-free-combined-hot.mjs'",`from '${root}/scripts/i80386-free-combined-hot.mjs'`],
 ["const call=(k,args=[])=>apply(methods[k],board,args);","const call=(k,args=[])=>measure('dispatch.'+k,()=>apply(methods[k],board,args));"],
 ["const checkState=()=>{const s=state();","const checkState=()=>measure('checkState',()=>{const s=state();"],
 ["assert.ok(s[6]<=1);return s;};","assert.ok(s[6]<=1);return s;});"],
 ["clockTransfer(words,reason){","clockTransfer(words,reason){const transferStart=now(),preflightStart=now();"],
 ["n=nextN;q=nextQ;mappingPending=nextMapping;active=true;try{","n=nextN;q=nextQ;mappingPending=nextMapping;add('clock.preflight',preflightStart);active=true;try{const replayStart=now();"],
 ["for(const word of words)call(word===1?'nativeTick':'quantum',word===1?[]:[word===3?1:0]);","for(const word of words)call(word===1?'nativeTick':'quantum',word===1?[]:[word===3?1:0]);add('clock.replay',replayStart);"],
 ["return Uint32Array.from(s);","return measure('clock.reply',()=>Uint32Array.from(s));"],
 ["}finally{active=false;}\n  }","}finally{active=false;add('clock.inclusive',transferStart);}\n  }"]
]);
const driver='scripts/run-i80386-native-owned-main.mjs';const old=readFileSync(resolve(root,driver),'utf8');const imports=[...old.matchAll(/(?:from\s+|import\s*)['"](\.[^'"]+)['"]/g)].map(m=>m[1]);const absolute=[...new Set(imports)].map(p=>[`'${p}'`,`'${resolve(root,'scripts',p)}'`]);
derive(driver,'driver.mjs',[
 ...absolute,
 [`from '${root}/scripts/bochs-cpu3-native-owned-clock/provider.mjs'`,"from './provider.mjs'"],
 ["checkBootstrap(import.meta.url);","checkBootstrap(import.meta.url);"+"\n"+"// Distinct timing derivative: production source identity stays separately authenticated."],
 ["const path=process.argv[2];","import {measure,begin as beginTiming,end as endTiming,snapshot as timingSnapshot}from './timing.mjs';\nimport {derivativeIdentity}from './identity.mjs';\nconst diagnosticIdentity=derivativeIdentity();\nconst path=process.argv[2];"],
 ["try{result=resume(n,q,d);}","try{result=measure('native.resume.inclusive',()=>resume(n,q,d));}"],
 ["return provider.checkpoint();","return measure('board.checkpoint',()=>provider.checkpoint());"],
 ["const executionStart=process.hrtime.bigint();","const executionStart=process.hrtime.bigint();beginTiming();"],
 ["const executionNs=Number(process.hrtime.bigint()-executionStart)","endTiming();const executionNs=Number(process.hrtime.bigint()-executionStart)"],
 ["const report={status:","assert.deepEqual(derivativeIdentity(),diagnosticIdentity);const report={attribution:{identity:diagnosticIdentity,buckets:timingSnapshot(),scope:'Execution-only overlapping diagnostic wall buckets, per-word timer overhead and shared scheduling distort values; native.resume includes C/NAPI snapshot construction; not CPU shares or speed gate'},status:"]
]);
writeFileSync(resolve(out,'derivation.json'),JSON.stringify({status:'SOURCE_INVERSE_PASS_NO_EXECUTION',sourceRevision:source.revision,sourceHashes:source.hashes,generatorSha256:sha(readFileSync(new URL(import.meta.url))),timingSha256:sha(readFileSync(resolve(out,'timing.mjs'))),files},null,2)+'\n');console.log('PASS exact inverse',files.length);
