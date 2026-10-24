// MIT. Authored ordinary AT workload; no media, native backend or profiler.
import {createHash} from 'node:crypto';
import {readFileSync,lstatSync} from 'node:fs';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {make,execute} from '../i80386-at-profile/fixture.mjs';

export function measured(CPU,Machine,config,steps=1000000,warmSteps=25000){
  if(!Number.isSafeInteger(steps)||steps<5||steps>1000000||!Number.isSafeInteger(warmSteps)||warmSteps<5||warmSteps>25000)throw Error('fixed work bounds');
  const warm=make('at',CPU,Machine,config);
  execute(warm,warmSteps);
  const setupBegin=process.hrtime.bigint(),state=make('at',CPU,Machine,config);
  const setupNanoseconds=String(process.hrtime.bigint()-setupBegin);
  const begin=process.hrtime.bigint(),semantic=execute(state,steps);
  return {semantic,setupNanoseconds,executionLoopNanoseconds:String(process.hrtime.bigint()-begin),warmupSteps:warmSteps,warmupDoesNotContributeToMeasuredState:true,physical386TimingCalibrated:false};
}
async function main(){
  if(process.argv.length!==3||!['A','B'].includes(process.argv[2])||process.version!=='v22.23.3')throw Error('fixed paired child');
  const arm=process.argv[2],root=new URL(arm==='A'?'../../../source-a/':'../../../source-b/',import.meta.url);
  const body=readFileSync(new URL('./source-rows.json',import.meta.url));
  if(createHash('sha256').update(body).digest('hex')!=='0b0c856983519a32e04f1c61d1317bb72184fb6f558780019d9bc0fa44bc4b2f')throw Error('source manifest pin');
  const rows=JSON.parse(body)[arm];
  for(const [name,row] of Object.entries(rows)){
    const path=fileURLToPath(new URL(name,root)),first=lstatSync(path);
    if(!first.isFile()||first.isSymbolicLink()||first.nlink!==1||first.size!==row.bytes)throw Error('source shape');
    const raw=readFileSync(path),last=lstatSync(path);
    if(raw.length!==row.bytes||createHash('sha256').update(raw).digest('hex')!==row.sha256||first.ino!==last.ino||first.dev!==last.dev||first.mtimeMs!==last.mtimeMs||first.size!==last.size)throw Error('source drift');
  }
  const {default:CPU}=await import(new URL('src/experimental/i80386.js',root));
  const {default:Machine,PCAT80386_EXPERIMENTAL:config}=await import(new URL('src/experimental/i80386-at-machine.js',root));
  console.log(JSON.stringify({schema:'bw.read16-paired-child.v1',arm,sourceFiles:rows,...measured(CPU,Machine,config)}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
