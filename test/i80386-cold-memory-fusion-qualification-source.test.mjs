import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
test('five pure fusion qualification admission controls; no guest',()=>{
 const output=execFileSync('python3',['-B','-m','unittest','test_qualification.py'],{cwd:new URL('../scripts/cold-memory-fusion-qualification/',import.meta.url),encoding:'utf8',timeout:10000,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});assert.equal(output,'');
});
