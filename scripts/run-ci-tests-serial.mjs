/** CI scheduling only: retain npm's exact test selection and environment. */
import {readFileSync,readdirSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {freemem,totalmem,availableParallelism} from 'node:os';
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
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const script=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8')).scripts.test,command=serialTestCommand(script);
 if(process.argv[2]==='--print-command'&&process.argv.length===3)console.log(command);
 else{
  if(process.argv.length!==2)throw Error('CI serial runner: unexpected arguments');
  console.log('# CI test resource policy',JSON.stringify({node:process.version,fileConcurrency:1,oldSpaceMiB:1024,totalMemoryBytes:totalmem(),freeMemoryBytes:freemem(),availableParallelism:availableParallelism()}));
  // Same Linux npm shell expansion; GNU time observes the child tree. Async
  // spawn keeps telemetry alive while a test file produces no parent TAP.
  const outcome=await runObservedProcess('/usr/bin/time',['-v','/bin/sh','-c',`exec ${command}`]);
  console.log('# CI test process exit',JSON.stringify(outcome));
  const signal=outcome.forwarded??outcome.signal;
  if(signal)process.kill(process.pid,signal);else process.exitCode=outcome.code??1;
 }
}
