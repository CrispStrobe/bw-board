/** One exact source transform: bracket the existing guest loop with V8 sampling. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {lstatSync,readFileSync,realpathSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';

export const qualifiedHead='22ca742ed60e1350ed96110986a09b2ce84620ac';
export const heldSha256='0f283611891e0afbee5359e51b246a2572637257c297815f7ae2c6917ddfc93a';
export const generatedName='probe-xv6-stock-profile.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const importBefore="import crypto from 'node:crypto';";
const importAfter="import crypto from 'node:crypto';\nimport inspector from 'node:inspector';";
const loopBefore='for (; steps < stepsLimit; steps++) {';
const loopAfter=`const profileOutput=process.env.XV6_PROFILE_OUT;
if (!profileOutput || !path.isAbsolute(profileOutput) || path.resolve(profileOutput)!==profileOutput)
  throw new Error('exact profile output path required');
const profileSession=new inspector.Session();profileSession.connect();
const profileCommand=(method,params={})=>new Promise((accept,reject)=>profileSession.post(method,params,
  (error,result)=>error?reject(error):accept(result)));
let profileStarted=false,guestError=null,terminalError=null;
try {
  await profileCommand('Profiler.enable');
  await profileCommand('Profiler.setSamplingInterval',{interval:1000});
  await profileCommand('Profiler.start');profileStarted=true;
} catch(error) {profileSession.disconnect();throw error;}
try {
for (; steps < stepsLimit; steps++) {`;
const endBefore='}\nrestoreCode16Interrupts?.();';
const endAfter=`}
} catch(error) {guestError=error;terminalError=error;throw error;}
finally {
  try {
    if(profileStarted){
      const {profile}=await profileCommand('Profiler.stop');
      const bytes=Buffer.from(JSON.stringify(profile));
      if(bytes.length===0||bytes.length>8*1024*1024)throw Error('bounded raw CPU profile');
      fs.writeFileSync(profileOutput,bytes,{flag:'wx'});
    }
  } catch(error) {
    if(!guestError){terminalError=error;throw error;}
    try{fs.writeFileSync(profileOutput+'.failure.json',JSON.stringify({profileError:String(error).slice(0,4096)})+'\\n',
      {flag:'wx'});}catch{}
  } finally {
    try{profileSession.disconnect();}catch(error){if(!terminalError)throw error;}
  }
}
restoreCode16Interrupts?.();`;
function exact(s,before,after){assert.equal(s.split(before).length,2,'exact xv6 profiler seam');return s.replace(before,after);}

export function derive(sourceRoot){
 const file=resolve(sourceRoot,'scripts/probe-xv6-stock.mjs');
 const st=lstatSync(file);assert.ok(st.isFile()&&!st.isSymbolicLink(),'ordinary held probe');
 assert.equal(realpathSync(file),file,'canonical held probe');
 const held=readFileSync(file);assert.equal(hash(held),heldSha256,'exact accepted xv6 probe');
 let modified=held.toString();
 modified=exact(modified,importBefore,importAfter);
 modified=exact(modified,loopBefore,loopAfter);
 modified=exact(modified,endBefore,endAfter);
 let inverse=modified;
 for(const [after,before] of [[endAfter,endBefore],[loopAfter,loopBefore],[importAfter,importBefore]])
  inverse=exact(inverse,after,before);
 assert.equal(hash(Buffer.from(inverse)),heldSha256,'exact inverse to accepted probe');
 return Object.freeze({heldSha256,generatedSha256:hash(Buffer.from(modified)),bytes:Buffer.from(modified)});
}
export function materialize(sourceRoot,output){
 const expected=resolve(sourceRoot,'scripts',generatedName);
 assert.equal(resolve(output),output,'absolute generated path');assert.equal(output,expected,'one sibling role');
 const result=derive(sourceRoot);
 writeFileSync(output,result.bytes,{flag:'wx',mode:0o644});
 assert.equal(hash(readFileSync(output)),result.generatedSha256,'materialized derivative bytes');
 return {schema:'bw.xv6-js-sampling-derivative.v1',heldSha256:result.heldSha256,
  generatedSha256:result.generatedSha256,relativePath:'scripts/'+generatedName};
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(fileURLToPath(import.meta.url))){
 assert.equal(process.argv.length,4,'source root and exact output path');
 console.log(JSON.stringify(materialize(process.argv[2],process.argv[3])));
}
