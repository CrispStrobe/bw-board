import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {ownedAssets,regularBytes} from '../scripts/bochs-cpu3-native-paged-pagefault/build-identity.mjs';
import {sha256} from '../scripts/bochs-cpu3-native-owned-clock/derive.mjs';
function uniqueInventoryJson(text){
 assert.equal(typeof text,'string');assert.ok(Buffer.byteLength(text)<=131072);
 let position=0,nodes=0;
 const space=()=>{while(/\s/.test(text[position]??'')&&position<text.length)position++;};
 function string(){
  const start=position;assert.equal(text[position++],'"');let escaped=false;
  while(position<text.length){const c=text[position++];if(escaped){escaped=false;continue;}if(c==='\\'){escaped=true;continue;}if(c==='"'){const value=JSON.parse(text.slice(start,position));assert.ok(value.length<=512);return value;}}
  assert.fail('unterminated inventory string');
 }
 function value(depth){
  assert.ok(depth<=10&&++nodes<=6000,'inventory JSON budget');space();
  if(text[position]==='{'){
   position++;space();const names=new Set();if(text[position]==='}'){position++;return;}
   for(;;){space();const key=string();assert.ok(!names.has(key),'duplicate inventory key');names.add(key);space();assert.equal(text[position++],':');value(depth+1);space();if(text[position]==='}'){position++;return;}assert.equal(text[position++],',');}
  }
  if(text[position]==='['){position++;space();if(text[position]===']'){position++;return;}for(;;){value(depth+1);space();if(text[position]===']'){position++;return;}assert.equal(text[position++],',');}}
  if(text[position]==='"'){string();return;}
  const token=/^(?:0|[1-9][0-9]*|true|false|null)/.exec(text.slice(position));assert.ok(token,'inventory primitive');position+=token[0].length;
 }
 value(0);space();assert.equal(position,text.length,'inventory trailing bytes');
 return JSON.parse(text);
}
const metadataPath='scripts/bochs-cpu3-native-paged-pagefault/current-source-inventory.json';
const metadataBytes=44149;
const metadataSha256='9ae1a88eb3e0df91f8393f034af15d2d6202a25ee87250ad4af38667af7a32c7';
test('six paged PF recovery/retry build/admission source controls run in an exact clean owned fixture',{timeout:45000},()=>{
 const root=fileURLToPath(new URL('../',import.meta.url)),revision=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),paths=new Set();
 function visit(p){if(paths.has(p))return;assert.ok(!p.startsWith('../')&&!p.startsWith('/'));paths.add(p);const b=readFileSync(resolve(root,p)),g=execFileSync('git',['show',revision+':'+p],{cwd:root,maxBuffer:16<<20});assert.equal(sha256(b),sha256(g),'caller current/Git '+p);if(/\.(mjs|js)$/.test(p)){const pattern=(p.startsWith('scripts/bochs-cpu3-native-paged-pagefault/')||p.startsWith('scripts/bochs-cpu3-native-paged-int-iret/')||p==='scripts/prepare-bochs-cpu3-native-paged-int-iret.mjs'||p==='test/i80386-paged-int-iret-native-source.test.mjs'||p.startsWith('scripts/bochs-cpu3-native-nonidentity-paging/')||p==='scripts/prepare-bochs-cpu3-native-nonidentity-paging.mjs'||p==='test/i80386-nonidentity-paging-native-source.test.mjs'||p==='scripts/prepare-bochs-cpu3-native-paged-pagefault.mjs'||p==='test/i80386-paged-pagefault-native-runtime-driver.test.mjs'||p.startsWith('scripts/bochs-cpu3-native-protected-stack/')||p==='scripts/prepare-bochs-cpu3-native-protected-stack.mjs'||p==='test/i80386-protected-stack-native-source.test.mjs'||p.startsWith('scripts/bochs-cpu3-native-protected-ram/')||p.startsWith('scripts/bochs-cpu3-native-ram-bootstrap/')||p==='scripts/prepare-bochs-cpu3-native-protected-ram.mjs'||p==='test/i80386-protected-ram-native-source.test.mjs')?/^\s*(?:import|export)\s+(?:(?:[\w$]+\s*,\s*)?\{[^}]*\}|\*(?:\s+as\s+[\w$]+)?|[\w$]+)\s*from\s*['"](\.[^'"]+)['"]/gm:/(?:from\s+|import\s*)['"](\.[^'"]+)['"]/g;for(const m of b.toString().matchAll(pattern)){const q=resolve(root,dirname(p),m[1]);assert.ok(q.startsWith(root));visit(q.slice(root.length));}}}
 for(const p of ownedAssets)visit(p);
 const metadata=regularBytes(resolve(root,metadataPath),metadataBytes);assert.equal(metadata.length,metadataBytes);assert.equal(sha256(metadata),metadataSha256,'raw separate inventory seal');
 assert.equal(sha256(execFileSync('git',['show',revision+':'+metadataPath],{cwd:root,maxBuffer:metadataBytes+1})),metadataSha256,'current/Git separate metadata');
 const declaration=uniqueInventoryJson(new TextDecoder('utf-8',{fatal:true}).decode(metadata));
 assert.deepEqual([...paths].sort(),declaration.currentStaticPaths,'static244 exact path census before sidecar');
 assert.equal(paths.size,244);assert.ok(!paths.has(metadataPath));paths.add(metadataPath);assert.equal(paths.size,245,'static244 plus one explicit metadata role');
 const d=mkdtempSync(join(tmpdir(),'paged-pagefault-build-clean-')),clean=join(d,'source');
 try{mkdirSync(clean);execFileSync('git',['init','--quiet',clean],{timeout:10000});const objects=execFileSync('git',['rev-parse','--path-format=absolute','--git-path','objects'],{cwd:root,encoding:'utf8'}).trim();writeFileSync(join(clean,'.git/objects/info/alternates'),objects+'\n');const shallow=execFileSync('git',['rev-parse','--path-format=absolute','--git-path','shallow'],{cwd:root,encoding:'utf8'}).trim();try{writeFileSync(join(clean,'.git/shallow'),readFileSync(shallow));}catch(e){if(e.code!=='ENOENT')throw e;}execFileSync('git',['update-ref','HEAD',revision],{cwd:clean,timeout:10000});execFileSync('git',['sparse-checkout','init','--no-cone'],{cwd:clean,timeout:10000});execFileSync('git',['sparse-checkout','set','--no-cone','--stdin'],{cwd:clean,input:[...paths].sort().map(p=>'/'+p).join('\n')+'\n',timeout:10000});execFileSync('git',['checkout','--quiet','--detach',revision],{cwd:clean,timeout:10000});assert.equal(execFileSync('git',['status','--porcelain'],{cwd:clean,encoding:'utf8'}).trim(),'');for(const p of paths)assert.equal(sha256(readFileSync(join(clean,p))),sha256(readFileSync(resolve(root,p))));
  const env={...process.env};delete env.NODE_TEST_CONTEXT;let tap;try{tap=execFileSync(process.execPath,['--max-old-space-size=128','--test','scripts/bochs-cpu3-native-paged-pagefault/build-controls.mjs'],{cwd:clean,env,timeout:30000,encoding:'utf8',maxBuffer:2<<20});}catch(e){if(e.stdout)process.stdout.write(e.stdout);if(e.stderr)process.stderr.write(e.stderr);throw e;}process.stdout.write(tap);for(const line of ['# tests 6','# pass 6','# fail 0','# skipped 0'])assert.ok(tap.split('\n').includes(line),'actual nested TAP '+line);
 }finally{rmSync(d,{recursive:true,force:true});}
});
