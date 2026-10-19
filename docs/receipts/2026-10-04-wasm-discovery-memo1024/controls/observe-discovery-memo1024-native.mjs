import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const root='/mnt/storage/code/labwired-evidence/labwired-same-host-20261003.R0T0cC/discovery-memo1024-20261004';
const ci=JSON.parse(readFileSync(root+'/source-ci.json'));
assert.equal(ci.headSha,'30131a9068e7c4aff6540092bce0a019f3b5c021');
assert.equal(ci.conclusion,'success');assert.equal(ci.status,'completed');
const raw=readFileSync(root+'/native-log.utf8.json'),log=JSON.parse(raw).data;
const counts=[...log.matchAll(/test result: ok\. (\d+) passed; 0 failed; (\d+) ignored;/g)].map(m=>[+m[1],+m[2]]);
assert.deepEqual(counts,[[13,0],[13,0],[4235,3],[8,0],[4,0],[2,0],[2,0]]);
assert.equal(log.split('cached_discovery_memo_capacity_matches_policy_and_exact_keys ... ok').length,4);
const hash=b=>createHash('sha256').update(b).digest('hex');
const data=JSON.stringify({source:ci.headSha,nativeRun:37196887603,wrapperSha256:hash(raw),
 originalLogSha256:hash(Buffer.from(log)),counts,ignoredCasesUnchanged:3,hostedOnly:true,noTimingConclusion:true},null,2)+'\n';
const out=root+'/native-results-observation.json';assert(!existsSync(out));
execFileSync('apply_patch',[],{input:'*** Begin Patch\n*** Add File: '+out+'\n'+data.trimEnd().split('\n').map(l=>'+'+l).join('\n')+'\n*** End Patch\n'});
console.log('Original native log bound: 13+13 focused, 4235 library/3 existing ignored,16 GPIO pass. Not WASM timing evidence.');
