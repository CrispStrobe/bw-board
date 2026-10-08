/** Exact reversible heap-sampling derivative of the held stock xv6 probe. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {lstatSync,readFileSync,realpathSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const heldSha256='0f283611891e0afbee5359e51b246a2572637257c297815f7ae2c6917ddfc93a';
export const generatedName='probe-xv6-stock-rollback-profile.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const importBefore="import crypto from 'node:crypto';";
const importAfter="import crypto from 'node:crypto';\nimport inspector from 'node:inspector';";
const loopBefore='for (; steps < stepsLimit; steps++) {';
const loopAfter=`const heapProfileOutput=process.env.XV6_ROLLBACK_HEAP_PROFILE_OUT;
if (!heapProfileOutput || !path.isAbsolute(heapProfileOutput) ||
    path.resolve(heapProfileOutput)!==heapProfileOutput)
  throw new Error('exact heap profile output path required');
const heapSession=new inspector.Session();heapSession.connect();
const heapCommand=(method,params={})=>new Promise((accept,reject)=>heapSession.post(method,params,
  (error,result)=>error?reject(error):accept(result)));
let heapStarted=false,heapGuestError=null,heapTerminalError=null;
try {
  await heapCommand('HeapProfiler.enable');
  await heapCommand('HeapProfiler.startSampling',{samplingInterval:131072,
    includeObjectsCollectedByMinorGC:true,includeObjectsCollectedByMajorGC:true});
  heapStarted=true;
} catch(error) {heapSession.disconnect();throw error;}
try {
for (; steps < stepsLimit; steps++) {`;
const endBefore='}\nrestoreCode16Interrupts?.();';
const endAfter=`}
} catch(error) {heapGuestError=error;heapTerminalError=error;throw error;}
finally {
  try {
    if(heapStarted){
      const {profile}=await heapCommand('HeapProfiler.stopSampling');
      const bytes=Buffer.from(JSON.stringify(profile));
      if(bytes.length===0||bytes.length>8*1024*1024)throw Error('bounded raw heap profile');
      fs.writeFileSync(heapProfileOutput,bytes,{flag:'wx'});
    }
  } catch(error) {
    if(!heapGuestError){heapTerminalError=error;throw error;}
    try{fs.writeFileSync(heapProfileOutput+'.failure.json',
      JSON.stringify({profileError:String(error).slice(0,4096)})+'\\n',{flag:'wx'});}catch{}
  } finally {
    try{heapSession.disconnect();}catch(error){if(!heapTerminalError)throw error;}
  }
}
restoreCode16Interrupts?.();`;
function exact(source,before,after){
 assert.equal(source.split(before).length,2,'unique held probe seam');
 return source.replace(before,after);
}
export function derive(sourceRoot){
 const file=resolve(sourceRoot,'scripts/probe-xv6-stock.mjs');
 const st=lstatSync(file);assert.ok(st.isFile()&&!st.isSymbolicLink(),'ordinary held probe');
 assert.equal(realpathSync(file),file,'canonical held probe');
 const held=readFileSync(file);assert.equal(hash(held),heldSha256,'exact held probe bytes');
 let modified=held.toString();
 modified=exact(modified,importBefore,importAfter);
 modified=exact(modified,loopBefore,loopAfter);
 modified=exact(modified,endBefore,endAfter);
 let inverse=modified;
 for(const [after,before] of [[endAfter,endBefore],[loopAfter,loopBefore],[importAfter,importBefore]])
  inverse=exact(inverse,after,before);
 assert.equal(hash(Buffer.from(inverse)),heldSha256,'exact inverse to held probe');
 return Object.freeze({heldSha256,generatedSha256:hash(Buffer.from(modified)),
  bytes:Buffer.from(modified)});
}
export function materialize(sourceRoot,output){
 const expected=resolve(sourceRoot,'scripts',generatedName);
 assert.equal(resolve(output),output,'absolute generated path');
 assert.equal(output,expected,'one sibling role');
 const result=derive(sourceRoot);
 writeFileSync(output,result.bytes,{flag:'wx',mode:0o644});
 assert.equal(hash(readFileSync(output)),result.generatedSha256,'materialized derivative bytes');
 return {schema:'bw.xv6-js-rollback-derivative.v1',heldSha256:result.heldSha256,
  generatedSha256:result.generatedSha256,relativePath:'scripts/'+generatedName};
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(fileURLToPath(import.meta.url))){
 assert.equal(process.argv.length,4,'source root and exact output path');
 console.log(JSON.stringify(materialize(process.argv[2],process.argv[3])));
}
