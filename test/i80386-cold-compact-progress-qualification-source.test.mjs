import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
test('seven pure compact qualification controls; no guest',()=>{
 const r=spawnSync('python3',['-B','-m','unittest','test_qualification.py'],{cwd:new URL('../scripts/cold-compact-progress-qualification/',import.meta.url),encoding:'utf8',timeout:10000,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
 process.stdout.write(r.stdout??'');process.stderr.write(r.stderr??'');assert.equal(r.status,0);assert.match(r.stderr,/Ran 7 tests/);
});
