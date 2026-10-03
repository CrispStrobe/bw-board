import {readFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
const root='/mnt/volume1/code/lego/.fastpath-census-evidence.kYeuzx/window-profile-20261003';
const repo='/mnt/volume1/code/lego/wt-bw-fastpath-census-20261002';
const source='68a70a71cfc71ea434eb38765e90ae6e8b47ca94',corrected='1d7023e9813d8a574301b42e0447a02e383032e0';
const gh=args=>execFileSync('gh',args,{encoding:'utf8',maxBuffer:32*1024*1024});
const git=args=>execFileSync('git',args,{cwd:repo,encoding:'utf8'});
const hash=b=>createHash('sha256').update(b).digest('hex');
function add(name,value){const path=root+'/'+name,text=JSON.stringify(value,null,2)+'\n';
 if(existsSync(path))assert.equal(readFileSync(path,'utf8'),text);
 else execFileSync('apply_patch',[],{input:`*** Begin Patch\n*** Add File: ${path}\n${text.trimEnd().split('\n').map(l=>'+'+l).join('\n')}\n*** End Patch\n`,maxBuffer:4*1024*1024});
}
const runs=[];
for(const id of [37111247913,37111250672]){
 const run=JSON.parse(gh(['run','view',String(id),'-R','CrispStrobe/bw-board','--json','status,conclusion,headSha,jobs,url']));
 assert.equal(run.headSha,source);assert.equal(run.status,'completed');assert.equal(run.conclusion,'failure');
 const log=gh(['run','view',String(id),'-R','CrispStrobe/bw-board','--log-failed']);
 assert(log.includes('every guard-then-skip test is in the census or named as debt'));
 assert(log.includes('labwired-f0-gpio-window-profile.test.mjs'));
 const failures=[...log.matchAll(/Z # fail (\d+)$/gm)].map(m=>Number(m[1]));assert.deepEqual(failures,[1]);
 const raw=Buffer.from(log),compressed=gzipSync(raw);
 add(`initial-ci-${id}-failed-step-log.json`,{encoding:'gzip+base64',originalBytes:raw.length,originalSha256:hash(raw),compressedBytes:compressed.length,data:compressed.toString('base64')});
 runs.push({id,run,failedStepLog:`initial-ci-${id}-failed-step-log.json`,failures:1});
}
const changed=git(['diff','--name-only',source,corrected]).trim().split('\n');assert.deepEqual(changed,['scripts/oracle-census.mjs','test/window-profile-scope.test.mjs']);
const unchanged=['.github/workflows/labwired-window-profile.yml','scripts/lib/window-cpu-profiler.mjs','scripts/profile-labwired-f0-windows.mjs','test/labwired-f0-gpio-window-profile.test.mjs'].map(path=>{
 const a=git(['show',source+':'+path]),b=git(['show',corrected+':'+path]);assert.equal(a,b);return {path,sha256:hash(a)};
});
add('initial-census-failure.json',{source,corrected,runs,changed,unchanged,correctionDiff:git(['diff',source,corrected]),ratchetUnchanged:true,debtListUnchanged:true,initialProfileRun:37111247979,initialActualCapturesPassed:4,initialProfiles:20,engineOrTimingHarnessChanged:false,mergeAttempted:false});
console.log('Retained both complete original failed-step logs, registration-only correction and unchanged diagnostic implementation.');
