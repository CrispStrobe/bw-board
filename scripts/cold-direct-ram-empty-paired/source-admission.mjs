/** Immutable source inventory and derivative identities, before any timed child. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {lstatSync,readFileSync,realpathSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {derive} from './provider.mjs';
import {deriveNativeChild} from './native-child.mjs';

const sha=b=>createHash('sha256').update(b).digest('hex');
export const qualifiedHead='acdb5dcef438c0ac7bc3c7794d43af4371d6e0d1';
const harnessPaths=['scripts/cold-direct-ram-empty-paired/','scripts/cold-direct-ram-paired/',
 '.github/workflows/i80386-cold-direct-ram-empty-paired.yml'];
const qualifiedPaths=['scripts/bochs-cpu3-native-cold-direct-ram/',
 'scripts/bochs-cpu3-native-cold-bios/','scripts/bochs-cpu3-native-cold-memory-fusion/',
 'scripts/bochs-cpu3-native-combined-paging-ram/','scripts/bochs-cpu3-native-owned-8042-interface/',
 'src/experimental/','roms/free-at-bios/'];
const git=(root,args,encoding='utf8')=>execFileSync('git',['-C',root,...args],{encoding,maxBuffer:8*1024*1024,timeout:20000});
function ordinary(path){
 const st=lstatSync(path);assert.ok(st.isFile()&&!st.isSymbolicLink()&&st.size<=8*1024*1024,'bounded ordinary source');
 assert.equal(realpathSync(path),path,'canonical source file');return readFileSync(path);
}
export function inventory(root,head,paths){
 assert.equal(git(root,['rev-parse','HEAD']).trim(),head,'exact source head');
 assert.equal(git(root,['status','--porcelain']).trim(),'','clean source checkout');
 const names=git(root,['ls-tree','-r','--name-only','HEAD','--',...paths]).trim().split('\n').filter(Boolean);
 assert.ok(names.length>0&&names.length<=400,'bounded source closure');
 const result={};let total=0;
 for(const name of names){
  assert.ok(!name.startsWith('/')&&!name.split('/').includes('..'),'source role');
  const bytes=ordinary(join(root,name));total+=bytes.length;assert.ok(total<=64*1024*1024,'source closure bytes');
  const blob=git(root,['show',`HEAD:${name}`],null);
  assert.equal(sha(bytes),sha(blob),'live source equals exact Git object: '+name);
  result[name]=sha(bytes);
 }
 return result;
}
export function admit(harnessRoot,harnessHead,qualifiedRoot){
 for(const path of [harnessRoot,qualifiedRoot])assert.equal(resolve(path),path,'absolute canonical checkout');
 const harness=inventory(harnessRoot,harnessHead,harnessPaths);
 const qualified=inventory(qualifiedRoot,qualifiedHead,qualifiedPaths);
 for(const required of ['scripts/cold-direct-ram-empty-paired/provider.mjs',
  'scripts/cold-direct-ram-empty-paired/native-child.mjs',
  'scripts/cold-direct-ram-empty-paired/parent.py',
  'scripts/cold-direct-ram-paired/native.mjs',
  'scripts/cold-direct-ram-paired/plain-child.mjs',
  '.github/workflows/i80386-cold-direct-ram-empty-paired.yml'])assert.ok(harness[required],'required harness role');
 for(const required of ['scripts/bochs-cpu3-native-cold-direct-ram/provider.mjs',
  'scripts/bochs-cpu3-native-cold-bios/board-provider.mjs',
  'scripts/bochs-cpu3-native-cold-bios/board-profile.mjs',
  'roms/free-at-bios/BIOS-bochs-legacy'])assert.ok(qualified[required],'required qualified role');
 const providers={};for(const mode of ['baseline','candidate']){
  const {moduleUrl,...identity}=derive(qualifiedRoot,mode);providers[mode]=identity;
 }
 const {moduleUrl,...child}=deriveNativeChild();
 return {schema:'bw.cold-direct-ram.empty-paired-source.v1',harnessHead,
  qualifiedHead,harness,qualified,providers,nativeChild:child};
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(fileURLToPath(import.meta.url))){
 assert.ok(process.argv.length===6||process.argv.length===7,'harness root/head, qualified root, output, optional --verify');
 const result=admit(process.argv[2],process.argv[3],process.argv[4]);
 if(process.argv.length===7){assert.equal(process.argv[6],'--verify');
  assert.deepEqual(JSON.parse(ordinary(process.argv[5])),result,'exact recomputed source inventory');}
 else writeFileSync(process.argv[5],JSON.stringify(result,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({schema:result.schema,harnessRoles:Object.keys(result.harness).length,
  qualifiedRoles:Object.keys(result.qualified).length,providers:Object.keys(result.providers)}));
}
