// Fixed process/session handoff. This is source issuance, not host authentication.
import {spawn} from 'node:child_process';
import {readFileSync,openSync,fstatSync,closeSync,readSync,constants} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {join,dirname,resolve} from 'node:path';

const commit='c3ada315e9dfc51cd70ac6403d9e1ab18a0faf5c';
const pins=Object.freeze({'context-table.json':'bc25ea1cbc780719c43cc5efc1be8ba361262b15b2b8f93ef7b1796e6c2b4e97','original-proofs.json':'b850c7f709bf07044b4c6b74d8b9a673f460045620ab816eab18be64ccb482cd'});
const groups=Object.freeze({
 'i80386-native-cold-reset-report.test.mjs':'native-cold-reset-report',
 'i80386-native-combined-paging-ram-board-gate.test.mjs':'native-combined-paging-ram-board-gate',
 'i80386-native-owned-pic-imr-profile.test.mjs':'native-owned-pic-imr-profile',
 'i80386-native-ram-coherence-report.test.mjs':'native-ram-coherence-report',
 'i80386-native-rep-pf-pit-board-gate.test.mjs':'native-rep-pf-pit-board-gate',
 'i80386-nonidentity-paging-source.test.mjs':'nonidentity-paging-source',
 'i80386-paged-int-iret-source.test.mjs':'paged-int-iret-source',
 'i80386-paged-pagefault-source.test.mjs':'paged-pagefault-source',
 'i80386-protected-ram-source.test.mjs':'protected-ram-source',
 'i80386-protected-stack-source.test.mjs':'protected-stack-source'});
const namespace=dirname(fileURLToPath(import.meta.url));
function need(value,reason){if(!value)throw new Error('historical context '+reason);}
function sealedTable(){
 const fd=openSync(join(namespace,'context-table.json'),constants.O_RDONLY|constants.O_NOFOLLOW);
 let raw;let first;
 try{first=fstatSync(fd);need(first.isFile()&&first.nlink===1&&first.size===48488,'table file');const parts=[];let count=0;for(;;){const chunk=Buffer.alloc(Math.min(65536,first.size+1-count));const n=readSync(fd,chunk,0,chunk.length,null);count+=n;need(count<=first.size,'table cap');if(n===0)break;parts.push(chunk.subarray(0,n));}raw=Buffer.concat(parts);need(raw.length===first.size,'table extent');const end=fstatSync(fd);need(end.dev===first.dev&&end.ino===first.ino&&end.size===first.size&&end.mtimeMs===first.mtimeMs,'table changed');}
 finally{closeSync(fd);}
 need(createHash('sha256').update(raw).digest('hex')===pins['context-table.json'],'table digest');
 return JSON.parse(raw);
}
function exact(value,keys){need(value&&Object.getPrototypeOf(value)===Object.prototype&&Object.keys(value).sort().join('\0')===[...keys].sort().join('\0'),'message keys');}
export function validateReady(value,table){
 exact(value,['schema','repository','head','root','rowCount','pins','selectors','runtimeQualified','currentCpuQualified']);
 need(value.schema==='bw.historical-owner-ready.v1'&&value.repository==='CrispStrobe/bw-board'&&value.head===commit&&value.rowCount===186,'ready identity');
 need(typeof value.root==='string'&&/^\/tmp\/bw-held-[A-Za-z0-9_-]+\/source$/.test(value.root)&&value.root.length<=120,'issued root');
 need(JSON.stringify(value.pins)===JSON.stringify(pins),'metadata pins');
 need(JSON.stringify(value.selectors)===JSON.stringify(table.selectors),'fixed selectors');
 need(value.runtimeQualified===false&&value.currentCpuQualified===false,'authority');
 return value.root;
}
export function validateClosed(value){
 exact(value,['schema','readyIssued','releaseObserved','observations','firstFailure','historicalRuntimeQualified','currentCpuQualified']);
 need(value.schema==='bw.historical-owner-closed.v1'&&value.readyIssued===true&&value.releaseObserved===true&&value.firstFailure===null,'release');
 const o=value.observations;
 exact(o,['schema','materialized','readbackComplete','finalReadbackComplete','releaseAttempted','releaseComplete','cleanupUncertain','hostedQualified','continuousOwnershipQualified','hardDeadlineQualified','historicalRuntimeQualified','currentCpuQualified']);
 need(o.schema==='bw.historical-materializer-observations.v1'&&o.materialized===true&&o.readbackComplete===true&&o.releaseAttempted===true,'release history');
 need(o&&o.releaseComplete===true&&o.finalReadbackComplete===true&&o.cleanupUncertain===false,'release observations');
 need(value.historicalRuntimeQualified===false&&value.currentCpuQualified===false&&o.hostedQualified===false&&o.continuousOwnershipQualified===false&&o.hardDeadlineQualified===false&&o.historicalRuntimeQualified===false&&o.currentCpuQualified===false,'release authority');
}
export async function historicalContext(harnessURL){
 const harness=fileURLToPath(harnessURL);
 const repository=resolve(namespace,'../..');
 need(dirname(harness)===join(repository,'test')&&Object.hasOwn(groups,harness.split('/').at(-1)),'fixed harness');
 const group=groups[harness.split('/').at(-1)];const table=sealedTable();
 const child=spawn('/usr/bin/python3',['-I','-B',join(namespace,'owner.py')],{
  cwd:repository,env:{PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C',PYTHONDONTWRITEBYTECODE:'1'},stdio:['pipe','pipe','pipe'],shell:false});
 let buffer=Buffer.alloc(0),rawStdout=Buffer.alloc(0),stderr=Buffer.alloc(0),messageCount=0,ended=false,exitResolve,exitReject;
 const messages=[];const waiters=[];let failure=null;
 const exited=new Promise((resolve,reject)=>{exitResolve=resolve;exitReject=reject;});exited.catch(()=>{});
 function refuse(error){error.ownerStdout=Buffer.from(rawStdout);error.ownerStderr=Buffer.from(stderr);failure??=error;while(waiters.length)waiters.shift().reject(failure);}
 child.on('error',error=>{refuse(error);exitReject(error);});
 child.stdin.on?.('error',refuse);child.stdout.on('error',refuse);child.stderr.on('error',refuse);
 child.on('close',(code,signal)=>{ended=true;exitResolve({code,signal});if(waiters.length)refuse(new Error('historical owner early exit; cleanup unobserved'));});
 child.stderr.on('data',chunk=>{if(stderr.length+chunk.length>16384){stderr=Buffer.concat([stderr,chunk.subarray(0,16384-stderr.length)]);refuse(new Error('historical owner stderr cap'));}else stderr=Buffer.concat([stderr,chunk]);});
 child.stdout.on('data',chunk=>{
  const available=32768-rawStdout.length;rawStdout=Buffer.concat([rawStdout,chunk.subarray(0,available)]);if(chunk.length>available){refuse(new Error('historical owner original stdout cap'));return;}
  buffer=Buffer.concat([buffer,chunk]);if(buffer.length>32768){refuse(new Error('historical owner stdout cap'));return;}
  let at;while((at=buffer.indexOf(10))!==-1){const line=buffer.subarray(0,at);buffer=buffer.subarray(at+1);try{messageCount++;need(messageCount<=2,'message count');need(line.length<=16384,'message cap');const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(line));if(waiters.length)waiters.shift().resolve(value);else messages.push(value);need(messages.length<=2,'message count');}catch(error){refuse(error);}}
 });
 function next(milliseconds){if(failure)return Promise.reject(failure);if(messages.length)return Promise.resolve(messages.shift());if(ended)return Promise.reject(new Error('historical owner ended'));return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{refuse(new Error('historical owner deadline; cleanup unobserved'));},milliseconds);waiters.push({resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}});});}
 async function settle(){let timer;try{return await Promise.race([exited,new Promise((_,reject)=>{timer=setTimeout(()=>{if(!ended)child.kill('SIGKILL');reject(new Error('historical owner reap/cleanup unobserved'));},125000);})]);}finally{clearTimeout(timer);}}
 let root;try{root=validateReady(await next(125000),table);}catch(error){child.stdin.end();await settle().catch(()=>{});error.ownerStdout=Buffer.from(rawStdout);error.ownerStderr=Buffer.from(stderr);throw error;}
 let closed=false;
 function live(){need(!closed,'closed session');if(failure)throw failure;need(!ended,'owner session ended');}
 const paths=Object.freeze([...table.selectors[group]]);
 return Object.freeze({root,commit,
  async module(relative){live();need(paths.includes(relative),'selector');const value=await import(pathToFileURL(join(root,relative)).href);live();return value;},
  file(relative){live();need(typeof relative==='string'&&Object.hasOwn(table.rows,relative),'fixture row');return pathToFileURL(join(root,relative));},
  async close(){need(!closed,'close once');closed=true;child.stdin.end('CLOSE\n');let primary=null;try{const message=await next(125000);const outcome=await settle();validateClosed(message);need(outcome.code===0&&outcome.signal===null&&buffer.length===0&&messages.length===0&&stderr.length===0,'owner exit/streams');}catch(error){primary=error;}if(primary){await settle().catch(()=>{});primary.ownerStdout=Buffer.from(rawStdout);primary.ownerStderr=Buffer.from(stderr);throw primary;}}
 });
}
