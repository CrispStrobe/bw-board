import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import I80386,{SEG_ES,SEG_CS,SEG_SS,SEG_DS,SEG_FS,SEG_GS} from '../src/experimental/i80386.js';
import {readMoo386} from './lib/moo386-v1.mjs';

const PIN='459d49fbe6280e9ed46fee887b58dacd9cb880ab';
const FORMAT_PIN='c438962d2b30856817d8e59bd5f0f4c628596ca8';
const PROFILES={
  'add-sizes':{
    files:['01','6601','6701','676601'],
    scope:'12 fixed deterministic ADD r/m,r samples spanning 16/32-bit operand and address sizes',
  },
  'byte-movx':{
    files:['30','6730','88','6788','0FB6','660FB6','670FB6','67660FB6','0FBE','660FBE','670FBE','67660FBE'],
    scope:'36 fixed deterministic byte XOR/MOV and MOVZX/MOVSX samples across their published address/operand-size forms',
  },
};
const profileName=process.env.I386_MOO_PROFILE??'add-sizes',profile=PROFILES[profileName];
if(!profile)throw new Error(`unknown I386_MOO_PROFILE ${profileName}`);
const FILES=profile.files;
const root=process.env.SST386_ROOT;
if(!root)throw new Error('Set SST386_ROOT to the pinned, clean SingleStepTests/80386 checkout');
const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
const verifyPin=()=>{if(git('rev-parse','HEAD')!==PIN||git('status','--porcelain'))throw new Error('SST386_ROOT must match the exact clean pin');};
verifyPin();
const sha256=data=>createHash('sha256').update(data).digest('hex');
const revocationBytes=readFileSync(resolve(root,'revocation_list.txt'));
const revoked=new Set(revocationBytes.toString('utf8').split(/\s+/).filter(Boolean));
const mutation=process.env.I386_MOO_MUTATION??null;
if(mutation!==null&&mutation!=='ram'&&mutation!=='stray-write')throw new Error(`unknown I386_MOO_MUTATION ${mutation}`);
const segmentFields=[[SEG_CS,'cs'],[SEG_DS,'ds'],[SEG_ES,'es'],[SEG_FS,'fs'],[SEG_GS,'gs'],[SEG_SS,'ss']];
const modeledFinal=new Set(['cr0','eax','ebx','ecx','edx','esi','edi','ebp','esp','cs','ds','es','fs','gs','ss','eip','eflags']);

function execute(test,globalMasks,mutate) {
  if(test.exception)throw new Error('sample requires exception delivery');
  if(test.bytes.at(-1)!==0xf4)throw new Error('published BYTS lacks trailing HLT');
  const initialMemory=new Map(test.initial.ram),memory=new Map(initialMemory),writes=[];
  const cpu=new I80386({read:a=>memory.get(a)??0,fetch:a=>memory.get(a)??0,write:(a,v)=>{writes.push([a>>>0,v&255]);memory.set(a>>>0,v&255);}});
  const initial=test.initial.regs;
  if(initial.cr0&0x80000001)throw new Error('sample requires paging or protected mode');
  const codeBase=((initial.cs&0xffff)<<4)>>>0;
  for(let index=0;index<test.bytes.length;index++)if(memory.get((codeBase+initial.eip+index)>>>0)!==test.bytes[index])
    throw new Error('BYTS does not match initial code RAM');
  for(const name of ['eax','ebx','ecx','edx','esi','edi','ebp','esp'])cpu[name]=initial[name]>>>0;
  cpu.eip=initial.eip>>>0;cpu.eflags=initial.eflags>>>0;cpu.cr0=initial.cr0>>>0;
  for(const[id,name]of segmentFields){cpu[name]=initial[name]&0xffff;cpu.segmentCaches[id]={base:(cpu[name]<<4)>>>0,limit:0xffff,default32:false,present:true,code:id===SEG_CS,writable:id!==SEG_CS};}
  cpu.step();cpu.step();if(!cpu.halted)throw new Error('published trailing HLT did not complete');
  if(mutate==='stray-write')cpu.write(0x00f00000,0x5a);
  const actual={cr0:cpu.cr0,eax:cpu.eax,ebx:cpu.ebx,ecx:cpu.ecx,edx:cpu.edx,esi:cpu.esi,edi:cpu.edi,ebp:cpu.ebp,esp:cpu.esp,cs:cpu.cs,ds:cpu.ds,es:cpu.es,fs:cpu.fs,gs:cpu.gs,ss:cpu.ss,eip:cpu.eip,eflags:cpu.eflags};
  const differences=[],masks={...globalMasks,...test.final.masks};
  for(const[name,want]of Object.entries(test.final.regs)){
    if(!modeledFinal.has(name))throw new Error(`final state requires unsupported ${name}`);
    let mask=masks[name]??0xffffffff;if(['cs','ds','es','fs','gs','ss'].includes(name))mask&=0xffff;
    const got=actual[name]>>>0;if(((got&mask)>>>0)!==((want&mask)>>>0))differences.push({field:name,expected:want>>>0,actual:got,mask:mask>>>0});
  }
  const expectedWrites=new Map(test.final.ram);let changed=false;
  for(const[address,want]of test.final.ram){let got=memory.get(address)??0;if(mutate==='ram'&&!changed){got^=1;changed=true;}if(got!==want)differences.push({field:`ram:${address.toString(16)}`,expected:want,actual:got});}
  for(const[address]of writes)if(!expectedWrites.has(address)&&memory.get(address)!==initialMemory.get(address))
    differences.push({field:`unexpected-write:${address.toString(16)}`,actual:memory.get(address)});
  return differences;
}

const results=[];let admitted=0,unsupported=0,revokedCount=0;
for(const name of FILES){
  const path=resolve(root,`v1_ex_real_mode/${name}.MOO.gz`),moo=readMoo386(path);
  const eligible=moo.tests.filter(test=>{if(revoked.has(test.hash)){revokedCount++;return false;}return true;});
  const selected=[eligible[0],eligible[Math.floor(eligible.length/2)],eligible.at(-1)],cases=[];
  for(const test of selected){let differences;try{differences=execute(test,moo.masks,admitted===0?mutation:null);}catch(error){unsupported++;differences=[{field:'execution',actual:error.message}];}admitted++;cases.push({index:test.index,hash:test.hash,status:differences.length?'fail':'pass',differences});}
  results.push({file:`${name}.MOO.gz`,sha256:sha256(moo.compressed),publishedTests:moo.tests.length,sampled:cases});
}
verifyPin();
const failures=results.flatMap(result=>result.sampled.filter(sample=>sample.status==='fail').map(sample=>({file:result.file,...sample})));
const localSources=['./verify-i80386-moo-sample.mjs','./lib/moo386-v1.mjs','../src/experimental/i80386.js'];
console.log(JSON.stringify({source:'SingleStepTests/80386 physical 386EX captures',revision:PIN,formatRevision:FORMAT_PIN,node:process.version,
  profile:profileName,scope:`${profile.scope}; architectural registers, final RAM, and write-footprint checks under published masks; no cycle/timing or protected-mode claim`,
  sourceHashes:Object.fromEntries(localSources.map(path=>[path,sha256(readFileSync(new URL(path,import.meta.url)))])),revocationSha256:sha256(revocationBytes),mutation,
  accounting:{files:FILES.length,admitted,unsupported,revoked:revokedCount,failures:failures.length},results,failures},null,2));
process.exitCode=failures.length?1:0;
