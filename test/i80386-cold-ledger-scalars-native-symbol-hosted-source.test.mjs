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
 const s=readFileSync(new URL('.github/workflows/i80386-cold-ledger-scalars-native-symbol.yml',repo),'utf8');assert.match(s,/default: false/);assert.match(s,/inputs.enable_profile == true/);assert.ok(s.indexOf('emit-roles.py')<s.indexOf('steps.roles.outputs.diagnostic'));assert.ok(s.includes('node-version: 22.23.3'));assert.ok(!s.includes('apt-get')&&!s.includes('sysctl'));const c=JSON.parse(readFileSync(new URL('contract.json',own)));assert.equal(c.enabledByDefault,false);assert.equal(c.roles.diagnostic.revision,'88645607220941b2ffadb2dc4e81085c4e3ff6dc');assert.equal(Object.keys(c.roles.diagnostic.files).length,92);
});
