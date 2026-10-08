/** CI scheduling only: retain npm's exact test selection and environment. */
import {readFileSync,readdirSync,mkdtempSync,symlinkSync,rmSync,existsSync} from 'node:fs';
import {spawn,execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve,join} from 'node:path';
import {freemem,totalmem,availableParallelism} from 'node:os';
import assert from 'node:assert/strict';
import {admitFixtureRoster,admitHistoricalBytes,admitHistoricalClosure,admitLiveInputs,admitWorkingTestCensus,historicalDependencyClosure,historicalRevision,historicalTests,splitHistoricalCohorts} from './i80386-historical-cohorts.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const optional=path=>{try{return readFileSync(path,'utf8').trim();}catch(error){return {unavailable:error.code};}};
export function resourceTelemetry(pid){
 const entries=[];
 try{for(const directory of readdirSync('/proc')){
  if(!/^\d+$/.test(directory))continue;
  try{const stat=readFileSync(`/proc/${directory}/stat`,'utf8'),end=stat.lastIndexOf(')'),fields=stat.slice(end+2).split(' ');
   entries.push({pid:Number(directory),ppid:Number(fields[1]),name:stat.slice(stat.indexOf('(')+1,end),state:fields[0],rssPages:Number(fields[21]),cpuTicks:Number(fields[11])+Number(fields[12]),command:readFileSync(`/proc/${directory}/cmdline`,'utf8').split('\0').filter((arg,index)=>index===0||/\.test\.(?:mjs|js)$/.test(arg)||/^--(?:test|test-concurrency=|max-old-space-size=)/.test(arg)).slice(0,8)});
  }catch{/* Processes may exit between directory enumeration and stat. */}
 }}catch{/* /proc is Linux telemetry, never required to score a test. */}
 const descendants=new Set([pid]);let changed=true;
 while(changed){changed=false;for(const entry of entries)if(descendants.has(entry.ppid)&&!descendants.has(entry.pid)){descendants.add(entry.pid);changed=true;}}
 const unified=optional('/proc/self/cgroup');const group=typeof unified==='string'?unified.split('\n').find(line=>line.startsWith('0::'))?.slice(3):null;
 const candidates=[...new Set(['/sys/fs/cgroup',...(group?['/sys/fs/cgroup'+group]:[])])];
 const cgroups=candidates.map(path=>({path,...Object.fromEntries(['memory.current','memory.max','memory.peak','memory.events','memory.events.local'].map(name=>[name,optional(path+'/'+name)]))}));
 return {timestamp:new Date().toISOString(),freeMemoryBytes:freemem(),processes:entries.filter(entry=>descendants.has(entry.pid)),cgroups,legacyCgroup:{limit:optional('/sys/fs/cgroup/memory/memory.limit_in_bytes'),usage:optional('/sys/fs/cgroup/memory/memory.usage_in_bytes'),failCount:optional('/sys/fs/cgroup/memory/memory.failcnt')}};
}
export async function runObservedProcess(file,args,{cwd=root,intervalMs=30000,log=console.log}={}){
 const child=spawn(file,args,{cwd,env:process.env,stdio:'inherit',detached:true});let forwarded=null;
 const heartbeat=()=>log('# CI test resource heartbeat',JSON.stringify(resourceTelemetry(child.pid)));
 const forward=signal=>{forwarded=signal;log('# CI test coordinator received signal',signal);heartbeat();try{process.kill(-child.pid,signal);}catch(error){if(error.code!=='ESRCH')log('# CI signal forwarding error',error.message);}};
 const term=()=>forward('SIGTERM'),interrupt=()=>forward('SIGINT');process.on('SIGTERM',term);process.on('SIGINT',interrupt);
 const timer=setInterval(heartbeat,intervalMs);heartbeat();
 try{return await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>{heartbeat();resolve({code,signal,forwarded});});});}
 finally{clearInterval(timer);process.off('SIGTERM',term);process.off('SIGINT',interrupt);}
}
export function serialTestCommand(script){
 if(typeof script!=='string'||!/^node --test(?: test\/[A-Za-z0-9_.*?/-]+)+$/.test(script))throw Error('CI serial runner: package test command needs an explicit scheduling audit');
 return script.replace(/^node --test /,'node --max-old-space-size=1024 --test --test-concurrency=1 ');
}
const git=(args,{cwd=root}={})=>execFileSync('git',args,{cwd,env:{...process.env,GIT_NO_REPLACE_OBJECTS:'1'},timeout:30000,maxBuffer:16<<20});
function historicalPlan(selection){
 const names=git(['ls-tree','-r','--name-only','HEAD','test']).toString().trim().split('\n');
 // Shell globs also see symlinks and special entries; any matching extra name
 // must be refused rather than silently omitted by a regular-file filter.
 const workingNames=readdirSync(resolve(root,'test'),{withFileTypes:true}).map(entry=>'test/'+entry.name);
 const testCensus=admitWorkingTestCensus(names,workingNames);
 const plan=splitHistoricalCohorts(selection,names);
 const historicalNames=git(['ls-tree','-r','--name-only',historicalRevision,'test']).toString().trim().split('\n');
 const fixtures=admitFixtureRoster(names,historicalNames),fixturePaths=fixtures.frozen;
 const readCurrent=path=>git(['show','HEAD:'+path]);
 const readHistorical=path=>git(['show',historicalRevision+':'+path]);
 const live=admitLiveInputs(plan.selected,path=>readFileSync(resolve(root,path)),readCurrent);
 const roles=historicalDependencyClosure(readHistorical,fixturePaths);
 const closure=admitHistoricalClosure({roles,fixturePaths,readCurrent,readHistorical});
 const currentTests=new Map(),originalTests=new Map();
 for(const path of historicalTests){
  const bytes=readCurrent(path);
  assert.deepEqual(readFileSync(resolve(root,path)),bytes,'current fixed test matches HEAD '+path);
  currentTests.set(path,bytes);originalTests.set(path,readHistorical(path));
 }
 const currentLock=readCurrent('package-lock.json');
 assert.deepEqual(readFileSync(resolve(root,'package-lock.json')),currentLock,'current package lock matches HEAD');
 const admission=admitHistoricalBytes({currentTests,historicalTests:originalTests,currentLock,
  historicalLock:readHistorical('package-lock.json'),historicalCpu:readHistorical('src/experimental/i80386.js')});
 return {plan,admission,closure,live,testCensus,newCurrentFixtures:fixtures.added,currentRevision:git(['rev-parse','HEAD']).toString().trim()};
}
function createHistoricalWorktree(){
 const temporary=process.env.RUNNER_TEMP;
 assert.ok(typeof temporary==='string'&&temporary.startsWith('/')&&existsSync(temporary),'RUNNER_TEMP for owned historical worktree');
 assert.ok(existsSync(resolve(root,'node_modules')),'installed current dependencies');
 const directory=mkdtempSync(join(temporary,'bw-i80386-historical-'));
 const checkout=join(directory,'checkout');let added=false;
 try{
  git(['worktree','add','--detach',checkout,historicalRevision]);added=true;
  assert.equal(git(['rev-parse','HEAD'],{cwd:checkout}).toString().trim(),historicalRevision);
  symlinkSync(resolve(root,'node_modules'),join(checkout,'node_modules'),'dir');
  assert.equal(git(['status','--porcelain'],{cwd:checkout}).toString().trim(),'','clean historical source');
  return {checkout,cleanup(){let error=null;try{git(['worktree','remove','--force',checkout]);}catch(e){error=e;}
   try{rmSync(directory,{recursive:true,force:true});}catch(e){error??=e;}if(error)throw error;}};
 }catch(error){if(added){try{git(['worktree','remove','--force',checkout]);}catch{/* preserve original setup failure */}}
  rmSync(directory,{recursive:true,force:true});throw error;}
}
async function runCohort(name,files,cwd){
 console.log('# CI test cohort',JSON.stringify({name,files:files.length,cwdKind:name==='historical'?'frozen':'current'}));
 const outcome=await runObservedProcess('/usr/bin/time',['-v',process.execPath,'--max-old-space-size=1024','--test','--test-concurrency=1',...files],{cwd});
 console.log('# CI test cohort exit',JSON.stringify({name,...outcome}));return outcome;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 process.env.GIT_NO_REPLACE_OBJECTS='1';
 const script=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8')).scripts.test,command=serialTestCommand(script);
 if(process.argv[2]==='--print-command'&&process.argv.length===3)console.log(command);
 else{
  if(process.argv.length!==2&&!(process.argv.length===3&&process.argv[2]==='--i80386-only'))throw Error('CI serial runner: unexpected arguments');
  const mode=process.argv[2]==='--i80386-only'?'i80386':'full';
  const {plan,admission,closure,live,testCensus,newCurrentFixtures,currentRevision}=historicalPlan(mode==='full'?script:mode);
  console.log('# CI test resource policy',JSON.stringify({node:process.version,fileConcurrency:1,oldSpaceMiB:1024,totalMemoryBytes:totalmem(),freeMemoryBytes:freemem(),availableParallelism:availableParallelism()}));
  console.log('# CI test source cohorts',JSON.stringify({mode,currentRevision,historical:admission,closure,live,testCensus,newCurrentFixtures,currentFiles:plan.current.length,historicalFiles:plan.historical.length,selectedFiles:plan.selected.length,expandedArguments:plan.expandedArgumentCount}));
  // Run every selected test once. Historical source-bound proofs use the exact
  // 41db CPU and unchanged literal/named-fixture inputs; live regressions use HEAD.
  const frozen=createHistoricalWorktree();let currentOutcome,historicalOutcome,cleanupError;
  try{
   currentOutcome=await runCohort('current',plan.current,root);
   if(!(currentOutcome.forwarded??currentOutcome.signal))historicalOutcome=await runCohort('historical',plan.historical,frozen.checkout);
  }finally{try{frozen.cleanup();}catch(error){cleanupError=error;}}
  console.log('# CI test process exit',JSON.stringify({current:currentOutcome,historical:historicalOutcome,cleanupError:cleanupError?.message??null}));
  if(cleanupError)process.exitCode=1;
  const signal=currentOutcome?.forwarded??currentOutcome?.signal??historicalOutcome?.forwarded??historicalOutcome?.signal;
  if(signal)process.kill(process.pid,signal);
  else if(currentOutcome?.code!==0||historicalOutcome?.code!==0)process.exitCode=1;
 }
}
