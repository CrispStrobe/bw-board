/** Offline audit: authenticated files only. Never executes a guest or loads an addon. */
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {authenticatedLines,nativeClock,compareClocks,validateFences} from './bochs-cpu3-native-clock-batch-witness/capture.mjs';
export function auditCapture(inputs){
 const lines=(key,maxBytes)=>authenticatedLines(inputs[key].path,inputs[key].sha256,{maxBytes,...(key==='capture'?{maxLineBytes:maxBytes,allowFinalLine:true}:{})});
 const capture=JSON.parse([...lines('capture',1024*1024)].join('\n'));
 assert.equal(capture.rom.sha256,'0c020faecb76160cfc748ca909d498a69ae47dd19a365891ccb20b3b5186b631','fixed free ROM');
 assert.equal(capture.final.fallback.bochsTimer,'0','no timer fallback');assert.ok(Object.values(capture.final.fallback).every(v=>v==='0'),'zero fallback');
 const hostRows=[],hostClocks=[],counts={};let hostOrdinal=0,run=0,maxRun=0,clockRuns=0;
 for(const line of lines('journal',32*1024*1024)){
  const r=JSON.parse(line);assert.ok(Array.isArray(r)&&r.length===9,'host record shape');for(const k of [0,4,5,6,7,8])assert.ok(Number.isSafeInteger(r[k])&&r[k]>=0,'safe host field');assert.equal(r[6],4+6*r[5],'host successful board clocks');assert.equal(r[0],++hostOrdinal,'host ordinal order');counts[r[1]]=(counts[r[1]]??0)+1;hostRows.push(r);
  if(r[1]==='quantum'||r[1]==='nativeTick'){assert.ok(Array.isArray(r[2]),'clock arguments');if(r[1]==='quantum'){assert.ok(r[2].length===1&&(r[2][0]===0||r[2][0]===1),'Q arguments');assert.ok(r[3]===0||r[3]===1,'Q due result');}else{assert.equal(r[2].length,0,'N arguments');assert.equal(r[3],0,'N result');}run++;hostClocks.push({type:r[1]==='quantum'?'Q':'N',kind:r[2][0],n:r[4],q:r[5]});}
  else if(run){maxRun=Math.max(maxRun,run);clockRuns++;run=0;}
 }
 if(run){maxRun=Math.max(maxRun,run);clockRuns++;}
 assert.equal(hostOrdinal,capture.journal.rows,'host row census');assert.deepEqual(counts,capture.callbackCounts,'host callback census');assert.equal(inputs.journal.sha256,capture.journal.sha256,'capture journal binding');
 const native=[],tags={};let canonicalRows=0;
 for(const line of lines('trace',256*1024*1024)){
  const clock=nativeClock(line);if(clock)native.push(clock);
  if(line.startsWith('BWSD1\t')){canonicalRows++;const tag=line.split('\t',3)[1];tags[tag]=(tags[tag]??0)+1;}
 }
 const clocks=compareClocks(native,hostClocks);assert.equal(clocks.nativeTicks,Number(capture.final.nativeTicks),'final N');assert.equal(clocks.successfulQuanta,Number(capture.final.successfulQuanta),'final Q');
 let fences={status:'UNQUALIFIED_MISSING_RESUME_AND_OBSERVER_FENCES',resumesDeclared:capture.resumes,missing:['start','stage-irq','entry','return','inspect','settle','close']};
 if(inputs.fences){assert.equal(inputs.fences.sha256,capture.fenceCapture.sha256,'capture fence binding');const rows=[...lines('fences',2*1024*1024)].map(l=>JSON.parse(l));assert.equal(rows.length,capture.fenceCapture.rows,'fence row count');fences=validateFences(rows,hostRows,{resumes:capture.resumes,checkpointQuanta:capture.checkpoints.map(c=>c.q)});}
 return {status:'AUTHENTICATED_OFFLINE_CLOCK_CHRONOLOGY_PASS_NOT_BATCH_ADMISSION',clocks,canonicalRows,counts,tags,unfencedClockRuns:clockRuns,unfencedMaxClockRun:maxRun,fences,scope:'Clock runs omit resume boundaries unless separately authenticated fences are present. No legal batch count, bridge ownership, speed or guest qualification is inferred.',inputs};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [manifest,manifestSha]=process.argv.slice(2);assert.ok(manifest&&manifestSha,'usage: node audit-i80386-native-clock-batch-witness.mjs inputs.json inputs.sha256');const inputs=JSON.parse([...authenticatedLines(manifest,manifestSha,{maxBytes:65536})].join('\n'));console.log(JSON.stringify(auditCapture(inputs),null,2));
}
