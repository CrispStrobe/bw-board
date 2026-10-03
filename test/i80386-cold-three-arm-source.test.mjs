/** Pure source/terminal fixtures only. Never restore or execute a worker. */
import test from 'node:test';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
test('cold three-arm qualification pure source controls; no guest',()=>{
 const env={...process.env,PYTHONDONTWRITEBYTECODE:'1'};
 for(const k of ['NODE_OPTIONS','NODE_PATH','LD_PRELOAD','LD_AUDIT','BW_HOT_NAPI_PROFILE','NODE_V8_COVERAGE','PYTHONPATH','PYTHONSTARTUP','PYTHONHOME','PYTHONINSPECT','PYTHONBREAKPOINT'])env[k]='';
 delete env.GH_TOKEN;delete env.BW_COLD_REFERENCE_OUTPUT;
 execFileSync('python3',['-B','scripts/cold-three-arm-qualification/test_qualification.py'],{cwd:fileURLToPath(new URL('../',import.meta.url)),env,timeout:30000,maxBuffer:1<<20});
});
