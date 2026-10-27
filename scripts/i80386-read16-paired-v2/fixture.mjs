// MIT. Authored ordinary AT workload for the paired-v2 plan; no media,
// native backend or profiler. The child entry runs only when run.py starts it
// (BW_READ16_V2_CHILD=1); run.py itself refuses without a committed request.json.
import {createHash} from 'node:crypto';
import {readFileSync,lstatSync} from 'node:fs';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {make,execute,observe} from '../i80386-at-profile/fixture.mjs';

export const MEASURED_STEPS=10000000;
export const WARMUP_STEPS=25000;
export const LOOP=5;
export const ORDER=Object.freeze(['A','B','A','B','A','B','B','A','A','B','B','A','B','A','A','B','B','A']);
export const GATE=Object.freeze({cpuMedianMin:1.03,cpuEveryGreaterThan:1,wallMedianMax:1.02});

// Independent architectural golden for the five-op loop
// (INC AX; MOV [0x2000],AX; MOV BX,[0x2000]; ADD AX,BX; JMP 0), derived from
// the recurrence AX' = 2*(AX+1) mod 2^16, not from candidate output.
// Closed form after n full loops: AX = 2^n*(AX0+2)-2 mod 2^16, so for n>=16
// AX=0xfffe for every AX0. BX and the memory word hold AX_prev+1.
export function architecturalGolden(steps,ax0){
  if(!Number.isSafeInteger(steps)||steps<0||!Number.isInteger(ax0)||ax0<0||ax0>65535)throw Error('golden domain');
  let ax=ax0,bx=null,word=null,ip=0;
  const offsets=[1,5,9,11,0];
  const loops=Math.floor(steps/LOOP),rest=steps%LOOP;
  const full=n=>{
    if(n>=16)return {ax:0xfffe,prev:0xfffe};
    let a=ax0,p=null;for(let i=0;i<n;i++){p=a;a=((a+1)*2)&0xffff;}return {ax:a,prev:p};
  };
  const f=full(loops);ax=f.ax;
  if(loops>0){bx=(f.prev+1)&0xffff;word=bx;}
  if(rest>=1)ax=(ax+1)&0xffff;
  if(rest>=2)word=ax;
  if(rest>=3)bx=ax;
  if(rest>=4)ax=(ax+bx)&0xffff;
  ip=rest===0?0:offsets[rest-1];
  return {ax,bx,word,ip,retired:steps,fullLoops:loops};
}

export function measured(CPU,Machine,config,steps=MEASURED_STEPS,warmSteps=WARMUP_STEPS){
  if(steps!==MEASURED_STEPS||warmSteps!==WARMUP_STEPS)throw Error('fixed work bounds');
  const warm=make('at',CPU,Machine,config);
  execute(warm,warmSteps);
  const setupBegin=process.hrtime.bigint(),state=make('at',CPU,Machine,config);
  const setupNanoseconds=String(process.hrtime.bigint()-setupBegin);
  // Fresh measured state before any step: the reader's no-I/O device invariants
  // compare against this, never against another child's output.
  const setup=observe(state,0,0);
  const begin=process.hrtime.bigint(),semantic=execute(state,steps);
  return {semantic,setup,setupNanoseconds,executionLoopNanoseconds:String(process.hrtime.bigint()-begin),warmupSteps:warmSteps,warmupDoesNotContributeToMeasuredState:true,physical386TimingCalibrated:false};
}

async function child(){
  if(process.env.BW_READ16_V2_CHILD!=='1'||process.argv.length!==3||!['A','B'].includes(process.argv[2]))throw Error('fixed paired-v2 child');
  const arm=process.argv[2],root=new URL(arm==='A'?'../../../source-a/':'../../../source-b/',import.meta.url);
  const body=readFileSync(new URL('./source-rows.json',import.meta.url));
  const rows=JSON.parse(body).arms[arm].files;
  for(const [name,row] of Object.entries(rows)){
    const path=fileURLToPath(new URL(name,root)),first=lstatSync(path);
    if(!first.isFile()||first.isSymbolicLink()||first.size!==row.bytes)throw Error('source shape '+name);
    const raw=readFileSync(path),last=lstatSync(path);
    if(raw.length!==row.bytes||createHash('sha256').update(raw).digest('hex')!==row.sha256||first.ino!==last.ino||first.mtimeMs!==last.mtimeMs)throw Error('source drift '+name);
  }
  const {default:CPU}=await import(new URL('src/experimental/i80386.js',root));
  const {default:Machine,PCAT80386_EXPERIMENTAL:config}=await import(new URL('src/experimental/i80386-at-machine.js',root));
  console.log(JSON.stringify({schema:'bw.read16-paired-v2-child.v1',arm,sourceRowsSha256:createHash('sha256').update(body).digest('hex'),...measured(CPU,Machine,config)}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await child();
