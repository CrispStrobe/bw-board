import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {derivePropertyKeyNapi,HELD_NAPI_SHA} from '../scripts/bochs-cpu3-native-property-key-cache/napi.mjs';
const own=new URL('../scripts/bochs-cpu3-native-property-key-cache/',import.meta.url);
const hash=b=>createHash('sha256').update(b).digest('hex');
test('exact complete counted inverse and fixed indexed key callsites',()=>{
 const d=derivePropertyKeyNapi();let s=d.bytes.toString();
 for(const e of [...d.edits].reverse()){assert.equal(s.split(e.next).length-1,e.count);s=s.split(e.next).join(e.old);}
 assert.equal(hash(s),HELD_NAPI_SHA);assert.equal(s,readFileSync(new URL('held-napi.cc',own),'utf8'));
 assert.match(d.bytes.toString(),/get\(r,Key::clock/);assert.match(d.bytes.toString(),/field\(r,Key::decoded/);
 assert.doesNotMatch(d.bytes.toString(),/key_value\(const char/);
});
test('actual generated key helper mock: values, errors, domains and lifecycle',()=>{
 const s=derivePropertyKeyNapi().bytes.toString(),start=s.indexOf('// Private keys only:'),end=s.indexOf('\nbool u32(',start);
 assert.ok(start>=0&&end>start);const dir=mkdtempSync(join(tmpdir(),'bw-key-mock-'));
 try{writeFileSync(join(dir,'generated-helper.inc'),s.slice(start,end));writeFileSync(join(dir,'mock.cc'),readFileSync(new URL('mock.cc',own)));
  const c=spawnSync('/usr/bin/c++',['-std=c++17','-O0','-Wall','-Wextra','mock.cc','-o','mock'],{cwd:dir,encoding:'utf8',timeout:10000});process.stdout.write(c.stdout);process.stderr.write(c.stderr);assert.equal(c.status,0);
  const r=spawnSync(join(dir,'mock'),[],{encoding:'utf8',timeout:3000});process.stdout.write(r.stdout);process.stderr.write(r.stderr);assert.equal(r.status,0);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('generated lifecycle and held callbacks/core-state wiring stay explicit',()=>{
 const s=derivePropertyKeyNapi().bytes.toString();
 assert.ok(s.indexOf('prepare_keys(e)')<s.indexOf('capture_cached(argv[2])'));
 assert.match(s,/if\(\(key_env&&e!=key_env\)\|\|!lock.owns_lock\(\)/);
 assert.match(s,/closed=true;release_cached\(\);release_keys\(\);/);
 assert.match(s,/napi_get_named_property\(env,self,cached_names\[i\],&fn\)/);
 assert.match(s,/ok\(napi_get_reference_value\(env,cached\[i\],&fn\)\)/);
 for(const [name,len] of [['state',20],['extra',20],['segments',90],['system',30],['debug',6]])assert.match(s,new RegExp('copied_state\\(out,Key::'+name+',[^;]*?,'+len+'\\)'));
});
