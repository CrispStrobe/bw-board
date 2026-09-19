import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import I80386,{SEG_ES,SEG_CS,SEG_SS,SEG_DS,SEG_FS,SEG_GS} from '../src/experimental/i80386.js';
import {readMoo386} from './lib/moo386-v1.mjs';
const PIN='459d49fbe6280e9ed46fee887b58dacd9cb880ab',root=process.env.SST386_ROOT;
if(!root)throw new Error('Set SST386_ROOT to the pinned, clean SingleStepTests/80386 checkout');
const git=(...a)=>execFileSync('git',a,{cwd:root,encoding:'utf8'}).trim();if(git('rev-parse','HEAD')!==PIN||git('status','--porcelain'))throw new Error('SST386_ROOT must match the exact clean pin');
const files=['01','6601','6701','676601'],sha=x=>createHash('sha256').update(x).digest('hex'),revocationBytes=readFileSync(resolve(root,'revocation_list.txt')),revoked=new Set(revocationBytes.toString('utf8').split(/\s+/).filter(Boolean));
const mutation=process.env.I386_MOO_MUTATION??null;if(mutation!==null&&mutation!=='ram')throw new Error(`unknown I386_MOO_MUTATION ${mutation}`);
const results=[];let admitted=0,unsupported=0,revokedCount=0;
function run(test,globalMasks){const mem=new Map(test.initial.ram),cpu=new I80386({read:a=>mem.get(a)??0,fetch:a=>mem.get(a)??0,write:(a,v)=>mem.set(a,v&255)}),r=test.initial.regs;
  for(const n of ['eax','ebx','ecx','edx','esi','edi','ebp','esp'])cpu[n]=r[n]>>>0;cpu.eip=r.eip>>>0;cpu.eflags=r.eflags>>>0;cpu.cr0=r.cr0>>>0;
  for(const[id,n]of[[SEG_CS,'cs'],[SEG_DS,'ds'],[SEG_ES,'es'],[SEG_FS,'fs'],[SEG_GS,'gs'],[SEG_SS,'ss']]){cpu[n]=r[n]&0xffff;cpu.segmentCaches[id]={base:(cpu[n]<<4)>>>0,limit:0xffff,default32:false,present:true,code:id===SEG_CS,writable:id!==SEG_CS};}
  cpu.step();cpu.step();if(!cpu.halted)throw new Error('published trailing HLT did not complete');const actual={cr0:cpu.cr0,eax:cpu.eax,ebx:cpu.ebx,ecx:cpu.ecx,edx:cpu.edx,esi:cpu.esi,edi:cpu.edi,ebp:cpu.ebp,esp:cpu.esp,cs:cpu.cs,ds:cpu.ds,es:cpu.es,fs:cpu.fs,gs:cpu.gs,ss:cpu.ss,eip:cpu.eip,eflags:cpu.eflags};const diffs=[],masks={...globalMasks,...test.final.masks};
  for(const[n,want]of Object.entries(test.final.regs)){let mask=masks[n]??0xffffffff;if(['cs','ds','es','fs','gs','ss'].includes(n))mask&=0xffff;const got=actual[n]>>>0;if(((got&mask)>>>0)!==((want&mask)>>>0))diffs.push({field:n,expected:want>>>0,actual:got,mask:mask>>>0});}
  let mutated=false;for(const[a,want]of test.final.ram){let got=mem.get(a)??0;if(mutation==='ram'&&admitted===0&&!mutated){got^=1;mutated=true;}if(got!==want)diffs.push({field:`ram:${a.toString(16)}`,expected:want,actual:got});}
  return diffs;
}
for(const name of files){const path=resolve(root,`v1_ex_real_mode/${name}.MOO.gz`),moo=readMoo386(path),eligible=moo.tests.filter(t=>{if(revoked.has(t.hash)){revokedCount++;return false;}return true;}),indices=[0,Math.floor(eligible.length/2),eligible.length-1],cases=[];for(const index of indices){const t=eligible[index];let differences;try{differences=run(t,moo.masks);}catch(e){unsupported++;differences=[{field:'execution',actual:e.message}];}admitted++;cases.push({index:t.index,hash:t.hash,status:differences.length?'fail':'pass',differences});}results.push({file:`${name}.MOO.gz`,sha256:sha(moo.compressed),publishedTests:moo.tests.length,sampled:cases});}
const failures=results.flatMap(r=>r.sampled.filter(x=>x.status==='fail').map(x=>({file:r.file,...x})));
const localSources=['./verify-i80386-moo-sample.mjs','./lib/moo386-v1.mjs','../src/experimental/i80386.js'];
console.log(JSON.stringify({source:'SingleStepTests/80386 physical 386EX captures',revision:PIN,formatRevision:'c438962d2b30856817d8e59bd5f0f4c628596ca8',node:process.version,scope:'12 deterministic ADD r/m,r samples spanning 16/32-bit operand and address-size combinations; architectural registers and RAM under published masks; no cycle/timing or protected-mode claim',sourceHashes:Object.fromEntries(localSources.map(path=>[path,sha(readFileSync(new URL(path,import.meta.url)))])),revocationSha256:sha(revocationBytes),mutation,accounting:{files:4,admitted,unsupported,revoked:revokedCount,failures:failures.length},results,failures},null,2));process.exitCode=failures.length?1:0;
