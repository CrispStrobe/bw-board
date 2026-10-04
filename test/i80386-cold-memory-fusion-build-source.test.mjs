import {createHash} from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync,existsSync} from 'node:fs';
import {join,dirname} from 'node:path';import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const helper=fileURLToPath(new URL('../scripts/ci-build-i80386-native-cold-memory-fusion.py',import.meta.url));
test('build helper imports without work and validates fresh disjoint ordinary roles',()=>{
 const code=`import sys
sys.dont_write_bytecode=True
import importlib.util,pathlib,tempfile,json,ast
p=${JSON.stringify(helper)}
spec=importlib.util.spec_from_file_location('cold_build',p);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
with tempfile.TemporaryDirectory() as d:
 root=pathlib.Path(d);w=root/'source';u=root/'upstream';w.mkdir();u.mkdir();r=root/'evidence';t=root/'prepared'
 assert m.validate_paths(list(map(str,[w,r,t,u])))==(w,r,t,u)
 denied=0
 for paths in [[w,r,t,w],[w,w/'nested',t,u],[w,r,t,'relative'],[w,r,t]]:
  try:m.validate_paths(list(map(str,paths)))
  except AssertionError:denied+=1
  else:raise AssertionError('bad role accepted')
 r.symlink_to(root/'absent')
 try:m.validate_paths(list(map(str,[w,r,t,u])))
 except AssertionError:denied+=1
 else:raise AssertionError('dangling target accepted')
 r.unlink();r.mkdir()
 try:m.validate_paths(list(map(str,[w,r,t,u])))
 except AssertionError:denied+=1
 else:raise AssertionError('existing evidence accepted')
 record=root/'record';record.write_bytes(b'exact');assert m.regular(record)==b'exact';link=root/'link';link.symlink_to(record)
 try:m.regular(link)
 except AssertionError:denied+=1
 else:raise AssertionError('symlink role accepted')
 try:m.regular(record,1)
 except AssertionError:denied+=1
 else:raise AssertionError('oversize accepted')
 assert denied==8
 print(json.dumps({'denials':denied,'built':False,'addonLoaded':False,'guestExecuted':False}))
`;
 const out=JSON.parse(execFileSync('python3',['-c',code],{encoding:'utf8',timeout:10000}));assert.deepEqual(out,{denials:8,built:false,addonLoaded:false,guestExecuted:false});
});
test('closed workflow requires an explicit disabled-by-default manual build and retains failures without guests',()=>{
 const s=readFileSync(new URL('../.github/workflows/i80386-native-cold-memory-fusion-build.yml',import.meta.url),'utf8');
 assert.ok(s.includes('  workflow_dispatch:'));assert.ok(!s.includes('  pull_request:'));assert.ok(!s.includes('  push:'));assert.ok(s.includes('default: false'));assert.ok(s.includes('if: ${{ inputs.enable_build == true }}'));assert.ok(s.includes('ref: ${{ github.sha }}'));
 assert.ok(s.includes('if: always()'));assert.ok(s.includes('cancel-in-progress: false'));assert.ok(s.includes('node-version: 22.23.3'));assert.ok(s.includes('libnode-dev'));
 const code=readFileSync(helper,'utf8');assert.ok(!code.includes('scripts/run-i80386'));assert.ok(!code.includes('ldd'));assert.ok(code.includes("run('nm'"));assert.ok(code.includes("run('readelf'"));assert.ok(code.includes("'addonLoaded':False"));
});

// Authenticate all reviewed build/preparation derivatives against their held Git bytes.
test('build and admission source are exact authenticated held derivatives',()=>{
 const d=JSON.parse(readFileSync(new URL('../scripts/bochs-cpu3-native-cold-memory-fusion/build-derivation.json',import.meta.url)));
 const root=fileURLToPath(new URL('../',import.meta.url));
 const verify=base=>{for(const f of d.files){const original=readFileSync(join(base,f.heldPath));assert.equal(createHash('sha256').update(original).digest('hex'),f.heldSha256);let s=original.toString();for(const e of f.edits){assert.equal(s.split(e.old).length-1,e.count);s=s.replaceAll(e.old,e.next);}assert.equal(s,readFileSync(join(base,f.candidatePath),'utf8'));}};
 verify(root);
 // Normal CI is shallow: authenticate held bytes without requiring historic Git objects.
 const noHistory=mkdtempSync(join(tmpdir(),'fusion-derivation-no-history-'));
 try{for(const f of d.files)for(const p of [f.heldPath,f.candidatePath]){const target=join(noHistory,p);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,readFileSync(join(root,p)));}assert.equal(existsSync(join(noHistory,'.git')),false);verify(noHistory);
  writeFileSync(join(noHistory,d.files[0].heldPath),'altered held source');assert.throws(()=>verify(noHistory));
 }finally{rmSync(noHistory,{recursive:true,force:true});}
});
