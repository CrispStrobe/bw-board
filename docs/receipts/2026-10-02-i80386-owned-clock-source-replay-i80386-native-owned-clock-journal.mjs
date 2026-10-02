/** Authenticated historical replay of real board callbacks; no native CPU execution. */
import assert from 'node:assert/strict';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {dirname,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {authenticatedLines} from './bochs-cpu3-native-clock-batch-witness/capture.mjs';
import {auditCapture} from './audit-i80386-native-clock-batch-witness.mjs';
import {createOwnedClockReplay} from './bochs-cpu3-native-owned-clock-replay/factory.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
function sourceIdentity(){
 const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:32*1024*1024}).trim(),sha=b=>createHash('sha256').update(b).digest('hex');assert.equal(git(['status','--porcelain']),'','formal replay requires clean frozen source');const revision=git(['rev-parse','HEAD']),paths=new Set();
 function visit(p){if(paths.has(p))return;assert.ok(resolve(root,p).startsWith(root+'/'),'source path remains in tree');paths.add(p);const raw=readFileSync(resolve(root,p));assert.equal(sha(raw),sha(execFileSync('git',['show',revision+':'+p],{cwd:root,maxBuffer:32*1024*1024})),p);if(/\.(?:mjs|js)$/.test(p))for(const m of raw.toString().matchAll(/(?:from\s+|import\s*)['"](\.[^'"]+)['"]/g))visit(resolve(root,dirname(p),m[1]).slice(root.length+1));}
 for(const p of ['package.json','test/fixtures/i80386-free-combined-hot.S','scripts/replay-i80386-native-owned-clock-journal.mjs','scripts/bochs-cpu3-native-owned-clock-replay/factory.mjs','scripts/bochs-cpu3-native-owned-clock-replay/worker.mjs','scripts/bochs-cpu3-native-owned-clock-replay/protocol.mjs','scripts/bochs-cpu3-native-owned-clock-replay/contract.md','test/i80386-native-owned-clock-replay.test.mjs'])visit(p);
 return {revision,files:paths.size,hashes:Object.fromEntries([...paths].sort().map(p=>[p,sha(readFileSync(resolve(root,p)))]))};
}
export async function replayHistorical(inputs){
 const source=sourceIdentity();
 const prior=auditCapture(inputs);assert.equal(prior.fences.status,'OFFLINE_FENCES_PRESENT_NOT_BATCH_ADMISSION','actual fences required');
 const read=(key,maxBytes)=>[...authenticatedLines(inputs[key].path,inputs[key].sha256,{maxBytes,maxLineBytes:key==='capture'?1024*1024:65536,allowFinalLine:key==='capture'})];
 const capture=JSON.parse(read('capture',1024*1024).join('\n')),rows=read('journal',32*1024*1024).map(JSON.parse),fences=read('fences',2*1024*1024).map(JSON.parse);
 const owner=await createOwnedClockReplay(),hash=createHash('sha256');let replayed=0,resumes=0,orderedClockGroups=0;const matched=[];
 try{
  for(let i=0;i<fences.length;i++)if(fences[i].phase==='entry'){
   const entry=fences[i],exit=fences[i+1];assert.equal(exit.phase,'return');const response=JSON.parse(await owner.replayResume(JSON.stringify({entry,exit,rows:rows.slice(entry.hostOrdinal,exit.hostOrdinal)})));
   const expected=rows.slice(entry.hostOrdinal,exit.hostOrdinal).map(r=>JSON.stringify(r)+'\n').join('');assert.equal(response.journal,expected,'full logical row expansion');hash.update(response.journal);replayed+=exit.hostOrdinal-entry.hostOrdinal;resumes++;orderedClockGroups+=response.orderedClockGroups;
   const checkpoint=capture.checkpoints.find(c=>c.resume===entry.resume);if(checkpoint){assert.deepEqual(response.state,checkpoint.board,'actual board checkpoint '+checkpoint.name);matched.push(checkpoint.name);}
  }
  const final=JSON.parse(await owner.close());assert.deepEqual(final.state,capture.settled,'actual settled final board');assert.equal(final.ramSha256,capture.ramSha256,'entire actual RAM');assert.equal(final.journal.sha256,inputs.journal.sha256,'worker generated bf12 journal');assert.equal(hash.digest('hex'),inputs.journal.sha256,'parent expanded bf12 journal');assert.equal(replayed,capture.journal.rows);assert.equal(resumes,capture.resumes);assert.equal(matched.length,capture.checkpoints.length);
  assert.deepEqual(sourceIdentity(),source,'before/after complete source closure');return {source,referenceNativeEvidence:{addon:capture.addon,driverSource:capture.source,scope:'prior authenticated native CPU evidence; replay loads no addon'},status:'SOURCE_ONLY_OWNED_REAL_BOARD_HISTORICAL_REPLAY_PASS',resumes,logicalRows:replayed,orderedClockGroups,checkpoints:matched,ramSha256:final.ramSha256,journalSha256:final.journal.sha256,inputs,scope:'No native addon or CPU execution. This independently replays actual host/device effects and preserves historical logical chronology; grouping is not native crossing or legal span evidence.'};
 }finally{await owner.abort();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const [path,sha]=process.argv.slice(2);assert.ok(path&&sha,'usage: node replay-i80386-native-owned-clock-journal.mjs authenticated-inputs.json inputs.sha256');const inputs=JSON.parse([...authenticatedLines(path,sha,{maxBytes:65536})].join('\n'));console.log(JSON.stringify(await replayHistorical(inputs),null,2));}
