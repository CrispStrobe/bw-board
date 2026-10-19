/** Compare 386-software opcode 82h compatibility semantics with pinned PCjs. */
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import I80386 from '../src/experimental/i80386.js';

const PIN='c7f21b4fa2bdedac3d5c73094a6402fdc8b24c70';
const pcjsRoot=process.env.PCJS_ROOT;
if(!pcjsRoot)throw new Error('Set PCJS_ROOT to the pinned, clean PCjs checkout');
const pcjsGit=(...args)=>execFileSync('git',args,{cwd:pcjsRoot,encoding:'utf8'}).trim();
const verifyPcjs=()=>{
  if(pcjsGit('rev-parse','HEAD')!==PIN||pcjsGit('status','--porcelain'))
    throw new Error('PCjs must match the exact clean oracle pin');
};
verifyPcjs();
const repositoryRoot=resolve(fileURLToPath(new URL('..',import.meta.url)));
const localPaths=['scripts/compare-pcjs-i80386-group1-alias.mjs','src/experimental/i80386.js'];
execFileSync('git',['diff','--quiet','HEAD','--',...localPaths],{cwd:repositoryRoot});
const executionRevision=execFileSync('git',['rev-parse','HEAD'],
  {cwd:repositoryRoot,encoding:'utf8'}).trim();
const hash=data=>createHash('sha256').update(data).digest('hex');
const sources=['./compare-pcjs-i80386-group1-alias.mjs','../src/experimental/i80386.js'];
const sourceHashes=Object.fromEntries(sources.map(path=>
  [path,hash(readFileSync(new URL(path,import.meta.url)))]));
const moduleURL=name=>pathToFileURL(resolve(pcjsRoot,`machines/pcx86/modules/v2/${name}.js`)).href;
for(const name of ['x86func','x86help','x86mods','x86op0f','x86ops'])await import(moduleURL(name));
const {default:CPU}=await import(moduleURL('cpux86'));
const {default:Bus}=await import(moduleURL('bus'));
const {default:Memory}=await import(moduleURL('memory'));
class QuietBus extends Bus { printf(){return 0;} }

const mutation=process.env.I386_GROUP1_ALIAS_ORACLE_MUTATION??null;
if(mutation!==null&&mutation!=='result'&&mutation!=='budget')
  throw new Error(`unknown mutation ${mutation}`);
const stepLimit=mutation==='budget'?0:2;
const cases=[
  {name:'cmp-memory',bytes:[0x82,0x3e,0x00,0x02,0x7f],eax:0x89abcdef,data:0x80,flags:2},
  {name:'adc-carry-prefix66',bytes:[0x66,0x82,0xd0,0x01],eax:0x89abcdff,data:0x5a,flags:3},
];
const FLAG_MASK=0x8d5;
const initialRegisters={ebx:0x10203040,ecx:0x50607080,edx:0x90a0b0c0,
  esi:0x11223344,edi:0x55667788,ebp:0x99aabbcc,esp:0x700};
const observe=(cpu,flags,memory,ip,bytes)=>({
  completed:ip===bytes.length,eip:ip,eax:cpu.eax>>>0,ebx:cpu.ebx>>>0,
  ecx:cpu.ecx>>>0,edx:cpu.edx>>>0,esi:cpu.esi>>>0,edi:cpu.edi>>>0,
  ebp:cpu.ebp>>>0,esp:cpu.esp>>>0,flags:flags&FLAG_MASK,memory0200:memory(0x200),
});
function runLocal(spec){
  const memory=new Uint8Array(0x1000);memory.set(spec.bytes);memory[0x200]=spec.data;
  const cpu=new I80386({read:a=>memory[a],fetch:a=>memory[a],write:(a,v)=>{memory[a]=v;}});
  Object.assign(cpu,initialRegisters,{eax:spec.eax,eflags:spec.flags});
  for(let step=0;step<stepLimit&&cpu.eip<spec.bytes.length;step++)cpu.step();
  return observe(cpu,cpu.eflags,a=>memory[a],cpu.eip,spec.bytes);
}
function runPCjs(spec){
  const cpu=new CPU({id:`group1alias.${spec.name}`,model:80386});
  const bus=new QuietBus({id:`group1alias.bus.${spec.name}`,busWidth:32},cpu);
  if(!bus.addMemory(0,0x1000,Memory.TYPE.RAM))throw new Error('PCjs memory allocation failed');
  cpu.bus=bus;spec.bytes.forEach((value,address)=>bus.setByteDirect(address,value));
  bus.setByteDirect(0x200,spec.data);cpu.setCS(0);cpu.setIP(0);cpu.setDS(0);cpu.setES(0);
  cpu.setSS(0);cpu.setPS(spec.flags);cpu.regEAX=spec.eax|0;cpu.regEBX=initialRegisters.ebx|0;
  cpu.regECX=initialRegisters.ecx|0;cpu.regEDX=initialRegisters.edx|0;
  cpu.regESI=initialRegisters.esi|0;cpu.regEDI=initialRegisters.edi|0;
  cpu.regEBP=initialRegisters.ebp|0;cpu.regESP=initialRegisters.esp|0;
  for(let step=0;step<stepLimit&&cpu.getIP()<spec.bytes.length;step++)cpu.stepCPU(0);
  return observe({eax:cpu.regEAX,ebx:cpu.regEBX,ecx:cpu.regECX,edx:cpu.regEDX,
    esi:cpu.regESI,edi:cpu.regEDI,ebp:cpu.regEBP,esp:cpu.regESP},cpu.getPS(),
    a=>bus.getByteDirect(a),cpu.getIP(),spec.bytes);
}
const observations=Object.fromEntries(cases.map(spec=>[spec.name,
  {reference:runPCjs(spec),actual:runLocal(spec)}]));
if(mutation==='result')observations['adc-carry-prefix66'].actual.eax=
  (observations['adc-carry-prefix66'].actual.eax^1)>>>0;
const differences=Object.entries(observations).filter(([,value])=>
  JSON.stringify(value.reference)!==JSON.stringify(value.actual)||!value.actual.completed)
  .map(([name,value])=>({case:name,...value}));
verifyPcjs();
execFileSync('git',['diff','--quiet','HEAD','--',...localPaths],{cwd:repositoryRoot});
if(execFileSync('git',['rev-parse','HEAD'],{cwd:repositoryRoot,encoding:'utf8'}).trim()!==executionRevision)
  throw new Error('local execution revision changed during comparison');
for(const path of sources)if(hash(readFileSync(new URL(path,import.meta.url)))!==sourceHashes[path])
  throw new Error(`local source changed during comparison: ${path}`);
console.log(JSON.stringify({oracle:'PCjs',revision:PIN,executionRevision,
  scope:'software compatibility evidence for opcode 82h byte CMP memory and operand-size-prefixed ADC with carry; full registers, defined flags, and memory are graded',
  stepLimit,mutation,status:differences.length?'fail':'pass',observations,differences,
  sourceHashes},null,2));
process.exitCode=differences.length?1:0;
