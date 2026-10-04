import test from 'node:test';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
test('Protected stack hosted wrapper manufactured source controls only',()=>{
 execFileSync('python3',['-B',fileURLToPath(new URL('../scripts/protected-stack-hosted/test_source.py',import.meta.url))],{timeout:30000,stdio:'inherit',env:{...process.env,PYTHONPATH:'',PYTHONHOME:'',PYTHONSTARTUP:'',PYTHONINSPECT:''}});
});
