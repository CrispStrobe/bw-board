/** Only pure manufactured policy plus one bounded Python sleeper lifecycle. */
import test from 'node:test';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
test('cold paired parent source controls; no hardware guest',()=>{
 const env={...process.env,PYTHONDONTWRITEBYTECODE:'1'};for(const k of ['NODE_OPTIONS','NODE_PATH','LD_PRELOAD','LD_AUDIT','BW_HOT_NAPI_PROFILE','NODE_V8_COVERAGE','PYTHONPATH','PYTHONSTARTUP'])env[k]='';
 execFileSync('python3',['scripts/cold-performance-paired/test_policy.py'],{cwd:fileURLToPath(new URL('../',import.meta.url)),env,timeout:10000,maxBuffer:1<<20});
});
