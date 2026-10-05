import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
test('six pure compact paired policy controls; no guest',()=>{const r=spawnSync('python3',['-B','test_policy.py'],{cwd:new URL('../scripts/cold-compact-progress-paired/',import.meta.url),encoding:'utf8',timeout:10000,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});process.stdout.write(r.stdout??'');process.stderr.write(r.stderr??'');assert.equal(r.status,0);assert.match(r.stderr,/Ran 6 tests/);});
