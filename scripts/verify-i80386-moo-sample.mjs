import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
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
  shifts:{
    files:['C1.4','C1.5','C1.7','66C1.4','66C1.5','66C1.7','67C1.4','67C1.5','67C1.7','6766C1.4','6766C1.5','6766C1.7'],
    scope:'36 fixed deterministic non-exception immediate SHL/SHR/SAR samples across operand/address-size forms',
  },
  'segment-mov':{
    files:['8C','668C'],
    scope:'6 fixed deterministic MOV from segment-register samples covering 16-bit and zero-extended 32-bit register destinations',
  },
  xchg:{
    files:['86','87','6687'],
    scope:'9 fixed deterministic byte, word, and dword XCHG samples',
    excludedPrefixes:[0xf0],
  },
  'group5-basic':{
    files:['FE.0','FE.1','FF.0','FF.1','FF.2','FF.4','FF.6'],
    scope:'21 fixed deterministic FE/FF INC, DEC, near CALL/JMP, and PUSH samples',
    excludedPrefixes:[0xf0],
  },
  'far-pointer':{
    files:['C4','C5','0FB2','0FB4','0FB5','66C4','66C5','660FB2','660FB4','660FB5'],
    scope:'30 fixed deterministic LES/LDS/LSS/LFS/LGS samples covering 16-bit and 32-bit pointer offsets',
  },
  'alu-complete':{
    files:['08','09','10','11','18','19','20','21','80.2','81.3','0C','15','1D','25'],
    scope:'42 fixed deterministic OR/ADC/SBB/AND samples spanning ModRM, group-1, accumulator, byte, and word forms',
  },
  'pusha-popa':{
    files:['60','61','6660','6661'],
    scope:'12 fixed deterministic PUSHA/POPA samples covering word and dword operand sizes',
  },
  'moffs':{
    files:['A0','A1','A2','A3','66A1','66A3','67A1','67A3'],
    scope:'24 fixed deterministic MOV moffs samples covering loads, stores, and operand/address-size forms',
  },
  rotates:{
    files:['D0.0','D0.1','D0.2','D0.3','D1.0','D1.1','D1.2','D1.3','66D1.0','66D1.1','66D1.2','66D1.3'],
    scope:'36 fixed deterministic count-one ROL/ROR/RCL/RCR samples spanning byte, word, and dword forms',
  },
  'rotate-full-circle':{
    files:['C0.0','C0.1'],
    samples:{'C0.0':[66],'C0.1':[67]},
    scope:'two exact physical ROL/ROR byte count-eight cases grading defined CF while the published mask excludes undefined OF',
  },
  lea:{
    files:['8D','668D','678D','67668D'],
    scope:'12 fixed deterministic LEA samples spanning operand/address-size forms',
  },
  'segment-stack':{
    files:['06','07','0E','16','17','1E','1F','0FA0','0FA1','0FA8','0FA9','6606','6607','660E','6616','6617','661E','661F','660FA0','660FA1','660FA8','660FA9'],
    scope:'66 fixed deterministic PUSH/POP segment-register samples spanning word and dword operand sizes',
  },
  'pop-rm':{
    files:['8F','668F','678F','67668F'],
    scope:'12 fixed deterministic POP r/m samples spanning operand/address-size forms',
  },
  'push-imm8':{
    files:['6A','666A'],
    scope:'6 fixed deterministic PUSH imm8 samples spanning word and dword sign extension',
  },
  'imul-immediate':{
    // 6669 is excluded because its published BYTS chunks fail the strict v1
    // framing contract; the verifier does not weaken parsing for one file.
    files:['69','6B','666B'],
    scope:'9 fixed deterministic signed immediate IMUL samples spanning word and dword operands; malformed 6669 source excluded',
  },
  setcc:{
    files:['0F90','0F91','0F92','0F93','0F94','0F95','0F96','0F97','0F98','0F99','0F9A','0F9B','0F9C','0F9D','0F9E','0F9F'],
    scope:'48 fixed deterministic SETcc samples covering all original 386 conditions',
  },
  'double-shift':{
    files:['0FA4','0FA5','0FAC','0FAD','660FA4','660FA5','660FAC','660FAD'],
    samples:{
      '0FA4':[25,2138,2432], '0FA5':[40,1375,2487],
      '0FAC':[4,2170,2496], '0FAD':[16,1433,2489],
      '660FA4':[25,2138,2432], '660FA5':[40,1375,2487],
      '660FAC':[4,2170,2496], '660FAD':[16,1433,2489],
    },
    undefinedEflagsMask:0xffffffef,
    scope:'24 fixed count-one SHLD/SHRD samples spanning immediate and CL forms with word and dword operands; wider counts have undefined flags and are not graded',
  },
  'enter-ret':{
    files:['C2','66C2','C8','66C8','C9','66C9'],
    scope:'18 fixed deterministic RET imm16, ENTER, and LEAVE samples spanning word and dword operand sizes',
  },
  'bit-test':{
    files:['0FA3','0FAB','0FB3','0FBB','0FBA.4','0FBA.5','0FBA.6','0FBA.7'],
    scope:'24 fixed deterministic BT/BTS/BTR/BTC register and immediate samples spanning read-only and modifying forms',
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
const repositoryRoot=resolve(fileURLToPath(new URL('..',import.meta.url)));
const localSources=['./verify-i80386-moo-sample.mjs','./lib/moo386-v1.mjs','../src/experimental/i80386.js'];
const localPathspecs=['scripts/verify-i80386-moo-sample.mjs','scripts/lib/moo386-v1.mjs','src/experimental/i80386.js'];
const localGit=(...args)=>execFileSync('git',args,{cwd:repositoryRoot,encoding:'utf8'}).trim();
const verifyLocal=()=>{
  execFileSync('git',['diff','--quiet','HEAD','--',...localPathspecs],{cwd:repositoryRoot});
};
verifyLocal();
const executionRevision=localGit('rev-parse','HEAD');
const localSourceHashes=Object.fromEntries(localSources.map(path=>[path,sha256(readFileSync(new URL(path,import.meta.url)))]));
const revocationBytes=readFileSync(resolve(root,'revocation_list.txt'));
const revoked=new Set(revocationBytes.toString('utf8').split(/\s+/).filter(Boolean));
const mutation=process.env.I386_MOO_MUTATION??null;
if(mutation!==null&&mutation!=='ram'&&mutation!=='stray-write'&&mutation!=='carry')throw new Error(`unknown I386_MOO_MUTATION ${mutation}`);
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
  if(mutate==='carry')cpu.eflags^=1;
  if(mutate==='stray-write')cpu.write(0x00f00000,0x5a);
  const actual={cr0:cpu.cr0,eax:cpu.eax,ebx:cpu.ebx,ecx:cpu.ecx,edx:cpu.edx,esi:cpu.esi,edi:cpu.edi,ebp:cpu.ebp,esp:cpu.esp,cs:cpu.cs,ds:cpu.ds,es:cpu.es,fs:cpu.fs,gs:cpu.gs,ss:cpu.ss,eip:cpu.eip,eflags:cpu.eflags};
  const differences=[],masks={...globalMasks,...test.final.masks};
  if(profile.undefinedEflagsMask!==undefined)
    masks.eflags=(masks.eflags??0xffffffff)&profile.undefinedEflagsMask;
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

const results=[];let admitted=0,unsupported=0,revokedCount=0,exceptionExcluded=0,profileExcluded=0;
for(const name of FILES){
  const path=resolve(root,`v1_ex_real_mode/${name}.MOO.gz`),moo=readMoo386(path);
  const eligible=moo.tests.filter(test=>{if(revoked.has(test.hash)){revokedCount++;return false;}if(test.exception){exceptionExcluded++;return false;}if(profile.excludedPrefixes?.includes(test.bytes[0])){profileExcluded++;return false;}return true;});
  const selected=profile.samples?.[name]
    ? profile.samples[name].map(index=>eligible.find(test=>test.index===index))
    : [eligible[0],eligible[Math.floor(eligible.length/2)],eligible.at(-1)];
  if(selected.some(test=>!test))throw new Error(`profile selects unavailable ${name} case`);
  const cases=[];
  for(const test of selected){let differences;try{differences=execute(test,moo.masks,admitted===0?mutation:null);}catch(error){unsupported++;differences=[{field:'execution',actual:error.message}];}admitted++;cases.push({index:test.index,hash:test.hash,status:differences.length?'fail':'pass',differences});}
  results.push({file:`${name}.MOO.gz`,sha256:sha256(moo.compressed),publishedTests:moo.tests.length,sampled:cases});
}
verifyPin();
verifyLocal();
if(localGit('rev-parse','HEAD')!==executionRevision||localSources.some(path=>sha256(readFileSync(new URL(path,import.meta.url)))!==localSourceHashes[path]))
  throw new Error('local execution sources changed during verification');
const failures=results.flatMap(result=>result.sampled.filter(sample=>sample.status==='fail').map(sample=>({file:result.file,...sample})));
console.log(JSON.stringify({source:'SingleStepTests/80386 physical 386EX captures',revision:PIN,formatRevision:FORMAT_PIN,node:process.version,
  profile:profileName,scope:`${profile.scope}; architectural registers, final RAM, and write-footprint checks under published masks; no cycle/timing or protected-mode claim`,
  executionRevision,sourceHashes:localSourceHashes,revocationSha256:sha256(revocationBytes),mutation,
  undefinedEflagsMask:profile.undefinedEflagsMask,
  accounting:{files:FILES.length,admitted,unsupported,revoked:revokedCount,exceptionExcluded,profileExcluded,failures:failures.length},results,failures},null,2));
process.exitCode=failures.length?1:0;
