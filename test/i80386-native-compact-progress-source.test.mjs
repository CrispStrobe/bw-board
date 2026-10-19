import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {deriveCompactProgressNapi,HELD_NAPI_SHA,PROGRESS_PROFILE} from '../scripts/bochs-cpu3-native-compact-progress/napi.mjs';
const own=new URL('../scripts/bochs-cpu3-native-compact-progress/',import.meta.url);
const held=()=>readFileSync(new URL('held-napi.cc',own),'utf8');
test('complete counted inverse retains held resume and snapshots',()=>{
 const d=deriveCompactProgressNapi();let s=d.bytes.toString();for(const e of [...d.edits].reverse()){assert.equal(s.split(e.next).length-1,1);s=s.replace(e.next,e.old);}assert.equal(s,held());assert.equal(createHash('sha256').update(s).digest('hex'),HELD_NAPI_SHA);
 const old=held().slice(held().indexOf('uint32_t n,q;uint64_t deadline;bool lossless;if(argc!=3'),held().indexOf('napi_value out=snapshot();'));
 const helper=readFileSync(new URL('progress.inc',own),'utf8');assert.ok(helper.includes(old));assert.doesNotMatch(helper,/copied_state|counters\(/);assert.ok(d.bytes.toString().includes(PROGRESS_PROFILE));
 assert.ok(d.bytes.toString().indexOf('if(!allowed())')<d.bytes.toString().indexOf('if(strcmp(op,"resumeProgress")'));
});
test('actual generated progress helper parser, errors and copied ownership under mock',()=>{
 const d=deriveCompactProgressNapi().bytes.toString(),helper=readFileSync(new URL('progress.inc',own),'utf8');assert.ok(d.includes(helper));const parser=held().split('\n').find(s=>s.startsWith('bool u32('));assert.ok(parser);
 const dir=mkdtempSync(join(tmpdir(),'bw-progress-mock-'));try{for(const [name,bytes] of [['progress.inc',helper],['parser.inc',parser],['mock.cc',readFileSync(new URL('mock.cc',own))]])writeFileSync(join(dir,name),bytes);
 const c=spawnSync('/usr/bin/c++',['-std=c++17','-O0','-Wall','-Wextra','mock.cc','-o','mock'],{cwd:dir,encoding:'utf8',timeout:10000});process.stdout.write(c.stdout);process.stderr.write(c.stderr);assert.equal(c.status,0);
 const r=spawnSync(join(dir,'mock'),[],{encoding:'utf8',timeout:3000});process.stdout.write(r.stdout);process.stderr.write(r.stderr);assert.equal(r.status,0);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
