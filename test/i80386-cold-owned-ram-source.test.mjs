import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

test('owned RAM session and journal adversaries execute in the C++ implementation',()=>{
 const dir=mkdtempSync(join(tmpdir(),'bw-owned-ram-'));
 try{
  const source=new URL('../scripts/bochs-cpu3-native-cold-owned-ram/mock.cc',import.meta.url).pathname;
  const binary=join(dir,'owned-ram');
  const build=spawnSync('c++',['-std=c++17','-O1','-Wall','-Wextra','-Werror',source,'-o',binary],{encoding:'utf8',timeout:15000});
  assert.equal(build.status,0,build.stderr||build.error?.message);
  const run=spawnSync(binary,[],{encoding:'utf8',timeout:5000});
  assert.equal(run.status,0,run.stderr||run.error?.message);
  assert.match(run.stdout,/PASS atomic journal reservation copied drain and exact retry/);
  assert.match(run.stdout,/PASS full initial ownership and unique shadow association/);
  assert.match(run.stdout,/PASS committed code fence invalidation and once-only effect/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
