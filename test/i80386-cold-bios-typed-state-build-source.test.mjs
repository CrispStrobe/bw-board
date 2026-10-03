import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const helper=fileURLToPath(new URL('../scripts/ci-build-i80386-native-cold-bios-typed-state.py',import.meta.url));
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
 const s=readFileSync(new URL('../.github/workflows/i80386-native-cold-bios-typed-state-build.yml',import.meta.url),'utf8');
 assert.ok(s.includes('  workflow_dispatch:'));assert.ok(!s.includes('  pull_request:'));assert.ok(!s.includes('  push:'));assert.ok(s.includes('default: false'));assert.ok(s.includes('if: ${{ inputs.enable_build == true }}'));assert.ok(s.includes('ref: ${{ github.sha }}'));
 assert.ok(s.includes('if: always()'));assert.ok(s.includes('cancel-in-progress: false'));assert.ok(s.includes('node-version: 22.23.3'));assert.ok(s.includes('libnode-dev'));
 const code=readFileSync(helper,'utf8');assert.ok(!code.includes('scripts/run-i80386'));assert.ok(!code.includes('ldd'));assert.ok(code.includes("run('nm'"));assert.ok(code.includes("run('readelf'"));assert.ok(code.includes("'addonLoaded':False"));
});
