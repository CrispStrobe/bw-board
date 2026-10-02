import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const helper=fileURLToPath(new URL('../scripts/run-i80386-native-hot-regular-file.py',import.meta.url));
// Child I/O controls only, not CPU or guest execution evidence.
for(const overflow of [false,true])test(overflow?'regular file resource limit preserves failed evidence':'regular file child preserves complete stderr and refuses overwrite',()=>{
 const dir=mkdtempSync(join(tmpdir(),'bw-hot-regularfile-test-'));try{
  const entry=join(dir,'child.mjs'),stem=join(dir,'actual'),input=join(dir,'input.json');writeFileSync(input,'{}');writeFileSync(entry,overflow?"import {writeSync} from 'node:fs';writeSync(2,Buffer.alloc(2*1024*1024,65));":"process.stderr.write('exact λ\\n');");
  const args=[helper,'--node',process.execPath,'--entry',entry,'--input',input,'--stem',stem,'--max-file-mib','1'];const child=spawnSync('python3',args,{encoding:'utf8'}),receipt=JSON.parse(readFileSync(stem+'.exit.json'));
  if(overflow){assert.notEqual(child.status,0);assert.equal(receipt.status,'ACTUAL_CHILD_FAILURE_PRESERVED');assert.ok(receipt.stderrBytes<=1024*1024);}else{assert.equal(child.status,0);assert.equal(readFileSync(stem+'.stderr','utf8'),'exact λ\n');assert.equal(receipt.returncode,0);assert.notEqual(spawnSync('python3',args).status,0);}
 }finally{rmSync(dir,{recursive:true,force:true});}
});
