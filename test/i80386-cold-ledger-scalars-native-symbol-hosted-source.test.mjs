import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const repo=new URL('../',import.meta.url),own=new URL('scripts/cold-ledger-scalars-native-symbol-hosted/',repo);
test('six hosted PURE/MOCK methods retain raw nested streams without real children',()=>{
 const r=spawnSync('python3',['-I','-B','-c',"import sys,unittest;sys.dont_write_bytecode=True;sys.path.insert(0,sys.argv[1]);import test_hosted;unittest.main(module=test_hosted,argv=['control'],exit=True)",fileURLToPath(own)],{encoding:'utf8',timeout:20000,maxBuffer:2<<20,env:{PATH:'/usr/bin:/bin',LC_ALL:'C',PYTHONDONTWRITEBYTECODE:'1'}});
 if(r.stdout)process.stdout.write(r.stdout);if(r.stderr)process.stderr.write(r.stderr);assert.equal(r.status,0);assert.match(r.stderr,/Ran 6 tests/);assert.match(r.stderr,/OK/);
});
test('manual source is default disabled and admits roles before downstream checkout',()=>{
 const s=readFileSync(new URL('.github/workflows/i80386-cold-ledger-scalars-native-symbol.yml',repo),'utf8');assert.match(s,/default: false/);assert.match(s,/inputs.enable_profile == true/);assert.ok(s.indexOf('emit-roles.py')<s.indexOf('steps.roles.outputs.diagnostic'));assert.ok(s.includes('node-version: 22.23.3'));assert.ok(!s.includes('apt-get')&&!s.includes('sysctl'));const c=JSON.parse(readFileSync(new URL('contract.json',own)));assert.equal(c.enabledByDefault,false);assert.equal(c.roles.diagnostic.revision,'1391d63e745231fb4921e2d1dd6ec18677987b50');assert.equal(Object.keys(c.roles.diagnostic.files).length,92);
});

test('six evidence-export filesystem and failure controls plus owned root cleanup mock',()=>{
 const code="import sys,unittest;sys.dont_write_bytecode=True;sys.path.insert(0,sys.argv[1]);import test_export,test_hosted;s=unittest.defaultTestLoader.loadTestsFromModule(test_export);s.addTest(test_hosted.Controls('test_root_failure_keeps_original_and_watchdog_cleanup'));r=unittest.TextTestRunner().run(s);sys.exit(not r.wasSuccessful())";
 const r=spawnSync('python3',['-I','-B','-c',code,fileURLToPath(own)],{encoding:'utf8',timeout:20000,maxBuffer:2<<20,env:{PATH:'/usr/bin:/bin',LC_ALL:'C',PYTHONDONTWRITEBYTECODE:'1'}});
 if(r.stdout)process.stdout.write(r.stdout);if(r.stderr)process.stderr.write(r.stderr);assert.equal(r.status,0);assert.match(r.stderr,/Ran 7 tests/);assert.match(r.stderr,/OK/);
 const workflow=readFileSync(new URL('.github/workflows/i80386-cold-ledger-scalars-native-symbol.yml',repo),'utf8');assert.ok(workflow.indexOf('Export first evidence after hosted finalization')>workflow.indexOf('hosted.py enabled'));assert.ok(workflow.indexOf('export-evidence.py')<workflow.indexOf('actions/upload-artifact'));assert.ok(workflow.includes('path: ${{ runner.temp }}/cold-ledger-scalars-native-symbol-export'));
});
