import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
test('typed paired pure policy and bounded lifecycle controls; no guest',()=>{
 const stdout=execFileSync('python3',['-B','-m','unittest','test_policy.py'],{cwd:new URL('../scripts/cold-typed-state-paired/',import.meta.url),encoding:'utf8',timeout:15000,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});assert.equal(stdout,'');
});
