/** One bounded ordinary Python pure suite; no Inspector/guest/probe. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const dir=fileURLToPath(new URL('../scripts/cold-memory-fusion-execution-profile-hosted/',import.meta.url));
test('five pure pending/lifecycle/finalization controls',()=>{const r=spawnSync('/usr/bin/python3',['-B','test_hosted.py'],{cwd:dir,encoding:'utf8',timeout:15000,maxBuffer:1<<20,env:{PATH:'/usr/bin:/bin',PYTHONDONTWRITEBYTECODE:'1',NODE_OPTIONS:'',NODE_PATH:'',LD_PRELOAD:'',LD_AUDIT:'',BW_HOT_NAPI_PROFILE:'',NODE_V8_COVERAGE:''}});assert.equal(r.status,0,r.stderr);assert.match(r.stderr,/Ran 5 tests/);});
test('manual default-disabled exact checkout roles and child CLI',()=>{const yaml=readFileSync(new URL('../.github/workflows/i80386-cold-memory-fusion-execution-profile.yml',import.meta.url),'utf8');assert.match(yaml,/workflow_dispatch:/);assert.match(yaml,/default: false/);assert.ok(!yaml.includes('pull_request:')&&!yaml.includes('push:'));for(const name of ['qualifier','compiled','driver','heldWorker','diagnostic'])assert.ok(yaml.includes('steps.roles.outputs.'+name+' }}'));const code=readFileSync(dir+'hosted.py','utf8');assert.ok(code.includes("[str(node),'--max-old-space-size=128',str(N/c['diagnosticWorker']['entry']),str(out/'input.json')]"));assert.ok(code.includes('DIAGNOSTIC_OBSERVER_ACTIVE_NOT_SPEED_QUALIFICATION'));});
