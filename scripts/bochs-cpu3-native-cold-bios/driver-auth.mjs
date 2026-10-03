/** External driver provenance is independent of the frozen compiled inventory. */
import assert from 'node:assert/strict';
import {readFileSync,lstatSync,realpathSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {resolve,dirname,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
export const compiledRevision='a6fae61a549d595c88a324f50589d92497040c07';
export const resetSource=Object.freeze({path:'bochs/cpu/init.cc',sha256:'4bdf4a39a2a3ceecafdd070836a055b5dec8696acf59652e2150a12fdfa7a9f3',lines:'705–874',meaning:'Pinned Bochs CPU3 model reset; not an Intel hardware correction'});
const root=resolve(fileURLToPath(new URL('../../',import.meta.url)));
export const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export function regularBytes(path,max=8<<20){
 assert.equal(typeof path,'string');assert.ok(isAbsolute(path)&&resolve(path)===path&&path.length<=4096&&!/[\0\r\n]/.test(path));
 let component='/';for(const part of path.split('/').filter(Boolean)){component=resolve(component,part);assert.ok(!lstatSync(component).isSymbolicLink(),'no symlink '+component);}
 const st=lstatSync(path);assert.ok(st.isFile()&&st.size<=max,'bounded ordinary file');assert.equal(realpathSync(path),path);const bytes=readFileSync(path);assert.equal(bytes.length,st.size);assert.equal(lstatSync(path).size,st.size);return bytes;
}
function git(cwd,args){return execFileSync('git',args,{cwd,maxBuffer:32<<20,timeout:10000});}
export function driverSourceIdentity(){
 assert.equal(git(root,['status','--porcelain']).toString().trim(),'','clean external driver');const revision=git(root,['rev-parse','HEAD']).toString().trim(),paths=new Set();
 function visit(p){assert.ok(!isAbsolute(p)&&!p.startsWith('../'));if(paths.has(p))return;paths.add(p);const bytes=regularBytes(resolve(root,p));assert.equal(sha(bytes),sha(git(root,['show',revision+':'+p])),'current/Git '+p);if(/\.(mjs|js)$/.test(p))for(const m of bytes.toString().matchAll(/(?:from\s+|import\s*\(?\s*)['"](\.[^'"]+)['"]/g)){const file=resolve(root,dirname(p),m[1]);assert.ok(file.startsWith(root+'/'));visit(file.slice(root.length+1));}}
 for(const p of ['scripts/bochs-cpu3-native-cold-bios/external-runner.mjs','scripts/bochs-cpu3-native-cold-bios/DRIVER-SOURCE.md','test/i80386-cold-bios-parity-source.test.mjs','package.json','roms/free-at-bios/BIOS-bochs-legacy','roms/free-at-bios/LICENSE'])visit(p);
 return {revision,hashes:Object.fromEntries([...paths].sort().map(p=>[p,sha(regularBytes(resolve(root,p)))]))};
}
export function authenticateCompiledCheckout(compiledRoot,manifest){
 assert.ok(isAbsolute(compiledRoot)&&resolve(compiledRoot)===compiledRoot&&realpathSync(compiledRoot)===compiledRoot);
 assert.equal(git(compiledRoot,['status','--porcelain']).toString().trim(),'','clean compiled checkout');assert.equal(git(compiledRoot,['rev-parse','HEAD']).toString().trim(),compiledRevision);
 assert.equal(manifest.boardRevision,compiledRevision);assert.ok(manifest.sourceHashes&&Object.keys(manifest.sourceHashes).length>0);
 for(const [p,h]of Object.entries(manifest.sourceHashes)){assert.ok(!isAbsolute(p)&&!p.startsWith('../')&&resolve(compiledRoot,p).startsWith(compiledRoot+'/'));assert.match(h,/^[a-f0-9]{64}$/);assert.equal(sha(regularBytes(resolve(compiledRoot,p))),h,'compiled current '+p);assert.equal(sha(git(compiledRoot,['show',compiledRevision+':'+p])),h,'compiled Git '+p);}
 return {revision:compiledRevision,hashes:manifest.sourceHashes};
}
