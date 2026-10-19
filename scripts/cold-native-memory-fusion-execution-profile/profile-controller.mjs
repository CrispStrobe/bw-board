/** Pure controller; constructing it never imports or connects a live Inspector. */
import assert from 'node:assert/strict';
export const samplingIntervalMicroseconds=1000;
export const diagnosticProfile='bw.cold-native.memory-fusion.execution-window-inspector.v1';
const bounded=(n,max=Number.MAX_SAFE_INTEGER)=>assert.ok(Number.isSafeInteger(n)&&n>=0&&n<=max);
export function validateCpuProfile(profile){
 assert.ok(profile&&typeof profile==='object'&&!Array.isArray(profile));
 assert.ok(Number.isFinite(profile.startTime)&&Number.isFinite(profile.endTime)&&profile.startTime>=0&&profile.endTime>profile.startTime);
 assert.ok(profile.endTime-profile.startTime<=125e6,'bounded diagnostic profile duration');
 assert.ok(Array.isArray(profile.nodes)&&profile.nodes.length>0&&profile.nodes.length<=100000);
 assert.ok(Array.isArray(profile.samples)&&profile.samples.length>0&&profile.samples.length<=200000);
 assert.ok(Array.isArray(profile.timeDeltas)&&profile.timeDeltas.length===profile.samples.length);
 const nodes=new Map(),parents=new Map();
 for(const n of profile.nodes){
  bounded(n.id,1000000);assert.ok(n.id>0&&!nodes.has(n.id),'unique positive node id');
  const f=n.callFrame;assert.ok(f&&typeof f==='object');
  for(const key of ['functionName','url','scriptId'])assert.ok(typeof f[key]==='string'&&f[key].length<=8192);
  for(const key of ['lineNumber','columnNumber'])assert.ok(Number.isSafeInteger(f[key])&&f[key]>=-1&&f[key]<=0x7fffffff);
  assert.ok(n.children===undefined||Array.isArray(n.children));if(n.children)assert.ok(n.children.length<=100000);
  nodes.set(n.id,n);
 }
 for(const n of nodes.values())for(const id of n.children??[]){assert.ok(nodes.has(id)&&!parents.has(id),'known child with one parent');parents.set(id,n.id);}
 const root=profile.nodes[0].id;assert.ok(!parents.has(root),'root has no parent');
 const seen=new Set(),active=new Set();
 function visit(id){assert.ok(!active.has(id),'acyclic call tree');if(seen.has(id))return;active.add(id);for(const child of nodes.get(id).children??[])visit(child);active.delete(id);seen.add(id);}
 visit(root);assert.equal(seen.size,nodes.size,'all nodes reachable from actual root');
 let deltaSum=0;const counts=new Map();
 profile.samples.forEach((id,i)=>{assert.ok(nodes.has(id),'sample refers to retained node');bounded(profile.timeDeltas[i],125e6);deltaSum+=profile.timeDeltas[i];bounded(deltaSum);counts.set(id,(counts.get(id)??0)+1);});
 assert.ok(deltaSum<=profile.endTime-profile.startTime,'sample time tape within its own Inspector clock domain');
 return {nodes:nodes.size,samples:profile.samples.length,profileDurationMicroseconds:profile.endTime-profile.startTime,sampleDeltaMicroseconds:deltaSum,unsampledTailMicroseconds:profile.endTime-profile.startTime-deltaSum,
  exclusiveLeaves:[...counts].map(([id,samples])=>({id,samples,callFrame:{...nodes.get(id).callFrame},attribution:nodes.get(id).callFrame.url?'source-callsite':'opaque-or-special-frame'})),
  scope:'Main-isolate sampled caller frames only. Inclusive ancestry and opaque native boundaries are not all-process CPU shares or removable cost.'};
}
export function createExecutionSampler(session,clock,retain){
 for(const key of ['connect','post','disconnect'])assert.equal(typeof session[key],'function');
 assert.equal(typeof clock.monotonic,'function');assert.equal(typeof clock.cpu,'function');assert.equal(typeof retain,'function');
 const record={schema:diagnosticProfile,status:'NOT_STARTED',samplingIntervalMicroseconds,markers:[],errors:[],
  markerClock:'process.hrtime nanoseconds; process.cpuUsage user/system microseconds',profileClock:'V8 Inspector microseconds; not silently aligned with marker clock',
  scope:'Execution loop plus explicitly retained adjacent sampler/timer boundaries. Main-isolate diagnostic, not speed qualification.'};
 let connected=false,started=false,stopped=false;
 const error=(phase,e)=>{record.errors.push({phase,error:String(e)});record.status='FAIL';};
 function mark(name){
  try{
   assert.ok(!record.markers.some(m=>m.name===name),'unique boundary marker');
   const monotonicNanoseconds=clock.monotonic(),cpu=clock.cpu();assert.match(monotonicNanoseconds,/^(0|[1-9][0-9]{0,23})$/);assert.deepEqual(Object.keys(cpu).sort(),['system','user']);bounded(cpu.user);bounded(cpu.system);
   record.markers.push({name,monotonicNanoseconds,cpuMicroseconds:{user:cpu.user,system:cpu.system}});
  }catch(e){error('marker:'+name,e);return false;}return true;
 }
 async function stop(){
  if(stopped)return record;stopped=true;mark('stop-call-before');
  try{
   if(started){
    const response=await session.post('Profiler.stop');assert.ok(response&&response.profile,'actual Profiler.stop profile');
    // Persist raw output even when the later shape/coverage check refuses it.
    const pin=await retain(response.profile);assert.ok(pin&&typeof pin==='object');bounded(pin.bytes,8<<20);assert.ok(pin.bytes>0);assert.match(pin.sha256,/^[a-f0-9]{64}$/);assert.equal(pin.file,'execution.cpuprofile');record.rawProfile={...pin};
    record.sampleEvidence=validateCpuProfile(response.profile);
   }
  }catch(e){error('stop-or-retain-or-validate',e);}
  finally{
   if(connected)try{await session.post('Profiler.disable');}catch(e){error('disable',e);}
   try{session.disconnect();}catch(e){error('disconnect',e);}connected=false;mark('stop-call-after');
  }
  record.status=started&&record.rawProfile&&record.sampleEvidence&&record.errors.length===0?'PROFILE_CAPTURE_COMPLETE':'FAIL';return record;
 }
 async function start(){
  assert.equal(record.status,'NOT_STARTED','one owned sampler start');record.status='STARTING';
  try{
   assert.ok(mark('start-call-before'),'start marker required');session.connect();connected=true;
   await session.post('Profiler.enable');await session.post('Profiler.setSamplingInterval',{interval:samplingIntervalMicroseconds});await session.post('Profiler.start');started=true;
   assert.ok(mark('start-call-after'),'started marker required');record.status='ACTIVE';
  }catch(e){error('start',e);await stop();throw e;}
 }
 function assertComplete(){assert.equal(record.status,'PROFILE_CAPTURE_COMPLETE','diagnostic sampler failed; terminal evidence is separate');assert.equal(record.errors.length,0);assert.ok(record.markers.some(m=>m.name==='execution-timer-before')&&record.markers.some(m=>m.name==='execution-timer-after'),'real execution boundaries retained');}
 return Object.freeze({record,start,stop,mark,assertComplete});
}
