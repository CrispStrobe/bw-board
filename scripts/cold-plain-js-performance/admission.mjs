/** Source and prerequisite authentication; no machine construction or execution. */
import assert from 'node:assert/strict';
import {readFileSync,lstatSync,realpathSync} from 'node:fs';
import {resolve,dirname,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
export const sourceRoot=resolve(fileURLToPath(new URL('../../',import.meta.url)));
export const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const authorized=new WeakSet();
const digest=value=>assert.match(value,/^[a-f0-9]{64}$/);
export function ordinaryBytes(path,max=8<<20){
 assert.equal(typeof path,'string');assert.ok(isAbsolute(path)&&resolve(path)===path&&path.length<=4096&&!/[\0\r\n]/.test(path));
 let component='/';for(const part of path.split('/').filter(Boolean)){component=resolve(component,part);assert.ok(!lstatSync(component).isSymbolicLink(),'no symlink '+component);}
 const st=lstatSync(path);assert.ok(st.isFile()&&st.size<=max,'bounded ordinary file');assert.equal(realpathSync(path),path);const bytes=readFileSync(path);assert.equal(bytes.length,st.size);assert.equal(lstatSync(path).size,st.size);return bytes;
}
export function validateReadyBinding(b){
 assert.deepEqual(Object.keys(b).sort(),['schema','status','compiledRevision','driverRevision','driverSourceSha256','captureSha256','independentAuditSha256','independentAuditApproved','targetQ'].sort());
 assert.equal(b.schema,'bw.cold-plain-js.capture-binding.v1');assert.equal(b.status,'INDEPENDENTLY_AUDITED_CAPTURE_READY','successful capture not yet bound');
 assert.equal(b.compiledRevision,'a6fae61a549d595c88a324f50589d92497040c07');assert.equal(b.driverRevision,'64514be6e45418910c5f952873382a2581810e1f');assert.equal(b.driverSourceSha256,'ec9a89ec22aa6332fd64f6058c88706ed493fbefd33d8576a9d88e747dfd7ea9');
 digest(b.captureSha256);digest(b.independentAuditSha256);assert.equal(b.independentAuditApproved,true);assert.ok(Number.isSafeInteger(b.targetQ)&&b.targetQ>0&&b.targetQ<=400000);return b;
}
export function validateSuccessfulCapture(c,b){
 validateReadyBinding(b);assert.equal(c.schema,'bw.native-cold-bios.external-diagnostic.v1');assert.equal(c.status,'CLOSED_COLD_BIOS_BOCHS_RESET_MODEL_JS_DIAGNOSTIC_PASS');
 assert.equal(c.input.compiledRevision,b.compiledRevision);assert.equal(c.input.driverRevision,b.driverRevision);assert.equal(c.input.driverSourceSha256,b.driverSourceSha256);assert.equal(c.input.nativeTrace,false);
 assert.deepEqual(c.closed,{native:true,provider:true,javascript:true});assert.equal(c.driverBefore.revision,b.driverRevision);assert.deepEqual(c.driverAfter,c.driverBefore);assert.equal(sha(Buffer.from(JSON.stringify(c.driverBefore))),b.driverSourceSha256);
 assert.equal(c.compiledBefore.revision,b.compiledRevision);assert.deepEqual(c.compiledAfter,c.compiledBefore);assert.equal(c.progress.q,b.targetQ);assert.ok(Number.isSafeInteger(c.progress.n)&&c.progress.n>0&&c.progress.n<=400000);
 assert.equal(c.javascriptFinal.q,b.targetQ);assert.equal(c.javascriptFinal.cpu.cycles,b.targetQ);assert.equal(c.javascriptFinal.cpu.cs,0xf000);assert.equal(c.javascriptFinal.cpu.eip,0xe16);assert.equal(c.javascriptFinal.cpu.cr0,0x7ffffff0);assert.equal(c.javascriptFinal.cpu.halted,false);assert.equal(c.javascriptFinal.cpu.shutdown,false);assert.equal(c.javascriptFinal.cpu.eflags&0x200,0);
 assert.equal(c.javascriptFinal.board.cycles,4+6*b.targetQ);assert.equal(c.javascriptFinal.board.debt,0);assert.equal(c.javascriptFinal.board.a20Enabled,true);digest(c.javascriptFinal.ramSha256);assert.equal(c.nativeFinal.ramSha256,c.javascriptFinal.ramSha256);
 assert.ok(Array.isArray(c.javascriptPorts)&&c.javascriptPorts.length<=20000);let previousQ=0;
 c.javascriptPorts.forEach((e,i)=>{assert.equal(e.ordinal,i+1);assert.ok(Number.isSafeInteger(e.q)&&e.q>=previousQ&&e.q>0&&e.q<=b.targetQ);previousQ=e.q;assert.equal(e.cycles,4+6*(e.q-1));assert.equal(e.width,8);assert.ok(e.dir==='in'||e.dir==='out');assert.ok(Number.isInteger(e.port)&&e.port>=0&&e.port<=65535);assert.ok(Number.isInteger(e.value)&&e.value>=0&&e.value<=255);});
 return c;
}
function git(args){return execFileSync('git',args,{cwd:sourceRoot,maxBuffer:32<<20,timeout:10000});}
export function plainSourceIdentity(){
 assert.equal(git(['status','--porcelain']).toString().trim(),'','clean plain worker checkout');const revision=git(['rev-parse','HEAD']).toString().trim(),paths=new Set();
 function visit(p){assert.ok(!isAbsolute(p)&&!p.startsWith('../'));if(paths.has(p))return;paths.add(p);const bytes=ordinaryBytes(resolve(sourceRoot,p));assert.equal(sha(bytes),sha(git(['show',revision+':'+p])),'current/Git '+p);if(/\.(mjs|js)$/.test(p))for(const m of bytes.toString().matchAll(/(?:from\s+|import\s*\(?\s*)['"](\.[^'"]+)['"]/g)){const file=resolve(sourceRoot,dirname(p),m[1]);assert.ok(file.startsWith(sourceRoot+'/'));visit(file.slice(sourceRoot.length+1));}}
 for(const p of ['scripts/cold-plain-js-performance/worker.mjs','scripts/cold-plain-js-performance/README.md','scripts/cold-plain-js-performance/capture-binding.json','test/i80386-cold-plain-js-source.test.mjs','package.json','roms/free-at-bios/BIOS-bochs-legacy','roms/free-at-bios/LICENSE'])visit(p);
 return {revision,hashes:Object.fromEntries([...paths].sort().map(p=>[p,sha(ordinaryBytes(resolve(sourceRoot,p)))]))};
}
export function authenticatePrerequisite(input){
 const bindingBytes=ordinaryBytes(resolve(sourceRoot,'scripts/cold-plain-js-performance/capture-binding.json'),16384),binding=validateReadyBinding(JSON.parse(bindingBytes));
 const captureBytes=ordinaryBytes(input.capture),auditBytes=ordinaryBytes(input.independentAudit);assert.equal(sha(captureBytes),binding.captureSha256);assert.equal(sha(auditBytes),binding.independentAuditSha256);
 const capture=validateSuccessfulCapture(JSON.parse(captureBytes),binding);assert.ok(JSON.parse(auditBytes)&&typeof JSON.parse(auditBytes)==='object','pinned independent audit JSON');
 const token=Object.freeze({targetQ:binding.targetQ});authorized.add(token);return {token,capture,binding,bindingSha256:sha(bindingBytes),captureSha256:sha(captureBytes),independentAuditSha256:sha(auditBytes)};
}
export function authorizedTarget(token){assert.ok(token&&authorized.has(token),'only authenticated frozen successful capture may authorize execution');return token.targetQ;}
