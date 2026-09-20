/** Compare an owned paged 386 TSS CALL/IRET roundtrip with pinned PCjs. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import I80386 from "../src/experimental/i80386.js";

const PIN="c7f21b4fa2bdedac3d5c73094a6402fdc8b24c70",root=process.env.PCJS_ROOT;
if(!root)throw new Error("Set PCJS_ROOT to the pinned, clean PCjs checkout");
const git=(...a)=>execFileSync("git",a,{cwd:root,encoding:"utf8"}).trim();
const verifyPin=()=>{if(git("rev-parse","HEAD")!==PIN||git("status","--porcelain"))throw new Error("PCjs must match the exact clean oracle pin");};
verifyPin();
const repo=resolve(fileURLToPath(new URL("..",import.meta.url)));
const paths=["scripts/compare-pcjs-i80386-tasks.mjs","src/experimental/i80386.js"];
const verifyLocal=()=>execFileSync("git",["diff","--quiet","HEAD","--",...paths],{cwd:repo});
verifyLocal();
const revision=execFileSync("git",["rev-parse","HEAD"],{cwd:repo,encoding:"utf8"}).trim();
const hash=d=>createHash("sha256").update(d).digest("hex");
const sources=["./compare-pcjs-i80386-tasks.mjs","../src/experimental/i80386.js"];
const sourceHashes=Object.fromEntries(sources.map(p=>[p,hash(readFileSync(new URL(p,import.meta.url)))]));
const moduleURL=n=>pathToFileURL(resolve(root,`machines/pcx86/modules/v2/${n}.js`)).href;
for(const n of ["x86func","x86help","x86mods","x86op0f","x86ops"])await import(moduleURL(n));
const {default:CPU}=await import(moduleURL("cpux86"));
const {default:Bus}=await import(moduleURL("bus"));
const {default:Memory}=await import(moduleURL("memory"));
const {default:X86}=await import(moduleURL("x86"));
class QuietBus extends Bus{printf(){return 0;}}
const mutation=process.env.I386_TASK_ORACLE_MUTATION??null;
if(![null,"result","budget"].includes(mutation))throw new Error(`unknown mutation ${mutation}`);
const limit=mutation==="budget"?8:40;
const put=(w,a,b)=>b.forEach((v,i)=>w(a+i,v&255));
const dw=(w,a,v)=>put(w,a,[v,v>>>8,v>>>16,v>>>24]);
const word=(w,a,v)=>put(w,a,[v,v>>>8]);
const desc=(w,a,b,l,x,f=0x40)=>put(w,a,[l,l>>>8,b,b>>>8,b>>>16,x,((l>>>16)&15)|f,b>>>24]);
function install(w){
  put(w,0,[0x0f,0x01,0x16,0,1,0xb8,1,0,0x0f,0x01,0xf0,0xea,0,0,8,0]);
  put(w,0x100,[0x27,0,0,2,0,0]);
  desc(w,0x208,0x1000,0xffff,0x9a,0);desc(w,0x210,0,0xffff,0x92,0);
  desc(w,0x218,0x400,0x67,0x89,0);desc(w,0x220,0x500,0x67,0x89,0);
  const code=[0xb8,0x18,0,0x0f,0,0xd8,0x66,0xb8,0,0x70,0,0,0x0f,0x22,0xd8,
    0x66,0xb8,1,0,0,0x80,0x0f,0x22,0xc0,0x9a,0,0,0x20,0,0xf4];
  put(w,0x1000,code);put(w,0x6000,code);
  put(w,0x6100,[0x66,0x67,0xa1,0,0x80,0,0,0x66,0x67,0xa3,0,6,0,0,0xf4]);
  dw(w,0x400+0x1c,0x7000);
  dw(w,0x500+0x1c,0x8000);dw(w,0x500+0x20,0x100);dw(w,0x500+0x24,2);dw(w,0x500+0x38,0x900);
  for(const [o,s]of[[0x48,0x10],[0x4c,8],[0x50,0x10],[0x54,0x10],[0x58,0],[0x5c,0],[0x60,0]])word(w,0x500+o,s);
  dw(w,0x7000,0xb003);dw(w,0x8000,0xc003);
  for(let p=0;p<16;p++){dw(w,0xb000+p*4,(p<<12)|3);dw(w,0xc000+p*4,(p<<12)|3);}
  dw(w,0xb000+4,0x6003);dw(w,0xc000+4,0x6003);
  dw(w,0xb000+32,0xe003);dw(w,0xc000+32,0xf003);dw(w,0xe000,0x11111111);dw(w,0xf000,0x22222222);
}
const result=(cpu,mem,local)=>({halted:local?cpu.halted:!!(cpu.intFlags&X86.INTFLAG.HALT),
  cs:local?cpu.cs:cpu.getCS(),eip:local?cpu.eip:cpu.getIP(),tr:local?cpu.tr.selector:cpu.segTSS.sel,
  cr3:local?cpu.cr3:cpu.regCR3>>>0,result:mem(0x600)|mem(0x601)<<8|mem(0x602)<<16|mem(0x603)*0x1000000,
  oldBusy:mem(0x21d)&15,newBusy:mem(0x225)&15,backlink:mem(0x500)|mem(0x501)<<8});
function runLocal(){const m=new Uint8Array(0x10000),c=new I80386({read:a=>m[a],fetch:a=>m[a],write:(a,v)=>m[a]=v});install((a,v)=>m[a]=v);for(let i=0;i<limit&&!c.halted;i++)c.step();return result(c,a=>m[a],true);}
function runPCjs(){const c=new CPU({id:"task386.cpu",model:80386}),b=new QuietBus({id:"task386.bus",busWidth:32},c),trail=[];if(!b.addMemory(0,0x10000,Memory.TYPE.RAM))throw new Error("PCjs memory allocation failed");c.bus=b;install((a,v)=>b.setByteDirect(a,v));c.setCS(0);c.setIP(0);c.setDS(0);c.setES(0);c.setSS(0);c.setSP(0x800);c.setPS(2);for(let i=0;i<limit&&!(c.intFlags&X86.INTFLAG.HALT);i++){trail.push(`${c.getCS().toString(16)}:${c.getIP().toString(16)}`);try{c.stepCPU(0);}catch(error){throw new Error(`PCjs abort at step ${i} ${c.getCS().toString(16)}:${c.getIP().toString(16)} CR0=${(c.regCR0>>>0).toString(16)} CR3=${(c.regCR3>>>0).toString(16)} raw=${String(error)} trail=${trail.join(",")}`);}}return result(c,a=>b.getByteDirect(a),false);}
const reference=runPCjs(),actual=runLocal();if(mutation==="result")actual.result^=1;
const expected={halted:true,cs:8,eip:0x10f,tr:0x20,cr3:0x8000,result:0x22222222,oldBusy:11,newBusy:11,backlink:0x18};
const differences=[];for(const k of Object.keys(expected)){for(const [side,v]of[["reference",reference[k]],["actual",actual[k]]])if(v!==expected[k])differences.push({field:`${side}.${k}`,expected:expected[k],actual:v});}
verifyPin();verifyLocal();if(execFileSync("git",["rev-parse","HEAD"],{cwd:repo,encoding:"utf8"}).trim()!==revision||sources.some(p=>hash(readFileSync(new URL(p,import.meta.url)))!==sourceHashes[p]))throw new Error("execution sources changed");
console.log(JSON.stringify({oracle:"PCjs",revision,pcjsRevision:PIN,scope:"owned ring-0 386 TSS CALL entry, incoming CR3 data mapping, busy/backlink and exact HLT completion; nested IRET is proved by owned tests because this PCjs pin resets on the corresponding return fixture",sourceHashes,mutation,status:differences.length?"fail":"pass",expected,reference,actual,differences},null,2));process.exitCode=differences.length?1:0;
