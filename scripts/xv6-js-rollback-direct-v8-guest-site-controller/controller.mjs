// Synthetic lifecycle controller only; supplied ports grant no live authority.
import {types} from 'node:util';
import {makeAdmission} from '../xv6-js-rollback-direct-v8-target-site-nursery/admission.mjs';
import {createGuestSnapshotCohort} from '../xv6-js-rollback-direct-v8-guest-site-cohort/cohort.mjs';
const KINDS=Object.freeze({'minor-baseline':0,'minor-enabled':4,'major-baseline':0,'major-enabled':2});
const PORTS=['cpu','addon','fullGC','boardStep','tick','minorPressure','pause','resume','saveSnapshot'];
const ADDON=['begin','facts','adopt','snapshot','stop'];
const ordinary=x=>x!==null&&typeof x==='object'&&!types.isProxy(x);
const fail=code=>{throw Error(code);};
function retain(object,keys,objectKeys=[]){
 if(!ordinary(object))fail('ports-shape');
 const own=Reflect.ownKeys(object);
 if(own.length!==keys.length||own.some(k=>typeof k!=='string'||!keys.includes(k)))fail('ports-shape');
 const descriptors=new Map();
 for(const key of keys){
  const d=Object.getOwnPropertyDescriptor(object,key);
  if(!d||!Object.hasOwn(d,'value')||(!objectKeys.includes(key)&&
    (typeof d.value!=='function'||types.isProxy(d.value))))fail('ports-descriptor');
  descriptors.set(key,d);
 }
 return descriptors;
}
const same=(object,descriptors)=>{
 const keys=Reflect.ownKeys(object);
 return keys.length===descriptors.size&&keys.every(k=>typeof k==='string'&&descriptors.has(k))&&[...descriptors].every(([key,d])=>{
 const now=Object.getOwnPropertyDescriptor(object,key);
 return now&&['value','writable','enumerable','configurable'].every(k=>now[k]===d[k])&&Object.hasOwn(now,'value');
});
};
export function createGuestSiteController(ports,kind){
 if(typeof kind!=='string'||!Object.hasOwn(KINDS,kind))fail('case-kind');
 const pd=retain(ports,PORTS,['cpu','addon']);
 const cpu=pd.get('cpu').value,addon=pd.get('addon').value;
 if(!ordinary(cpu))fail('cpu-shape');
 const ad=retain(addon,ADDON);
 const cpuPrototype=Object.getPrototypeOf(cpu),priorSnapshot=Object.getOwnPropertyDescriptor(cpu,"_snapshotInstruction");
 const descriptorSame=(a,b)=>a===undefined?b===undefined:b!==undefined&&["value","get","set","writable","enumerable","configurable"].every(k=>Object.hasOwn(a,k)===Object.hasOwn(b,k)&&a[k]===b[k]);
 let phase='created',firstFailure=null,busy=false,boardCalls=0,roots=null,seam=null;
 let pauseCompleted=false,stopAttempted=false,resumeCompleted=false,gcCount=null;
 const admission=makeAdmission();
 let premise=null;
 const cuts={afterInstallation:null,afterSnapshot:null,beforeRelease:null,afterRelease:null,finalGC:null};
 const refuse=code=>{firstFailure??=code;phase='invalid';};
 const enter=()=>{if(busy){refuse('controller-reentry');fail('controller-reentry');}busy=true;};
 const fence=()=>{
  if(firstFailure)fail(firstFailure);
  if(!same(ports,pd)||!same(addon,ad)){refuse('ports-changed');fail('ports-changed');}
  if(Object.getPrototypeOf(cpu)!==cpuPrototype){refuse('cpu-boundary-changed');fail('cpu-boundary-changed');}
  if(seam){const s=seam.status();if(s.firstFailure){refuse('cohort-refused');fail('cohort-refused');}
   if(s.phase==='closed'&&!descriptorSame(priorSnapshot,Object.getOwnPropertyDescriptor(cpu,'_snapshotInstruction'))){refuse('cpu-boundary-changed');fail('cpu-boundary-changed');}}
 };
 const call=(object,descriptors,key,args=[])=>{
  fence();
  if(object===addon&&key==='stop')stopAttempted=true;
  if(object===ports&&key==='boardStep')boardCalls++;
  const result=Reflect.apply(descriptors.get(key).value,object,args);
  fence();
  return result;
 };
 const count=()=>{
  const facts=call(addon,ad,'facts');
  if(!ordinary(facts))fail('facts-shape');
  const d=Object.getOwnPropertyDescriptor(facts,'gc');
  if(!d||!Object.hasOwn(d,'value')||!Array.isArray(d.value)||types.isProxy(d.value)||d.value.length>64)fail('facts-shape');
  gcCount=d.value.length;return gcCount;
 };
 const zero=cut=>{const n=count();if(cut)cuts[cut]=n;if(n!==0)fail('prior-gc');};
 const cleanup=()=>{
  roots=null;
  // The private seam owns its cleanup even when external port owners change.
  if(seam){const s=seam.dispose();if(s.firstFailure)refuse('cleanup-cohort-refused');}
  // Refuse changed owners rather than operating their historical methods.
  if(!same(ports,pd)||!same(addon,ad)){refuse('cleanup-owner-changed');return;}
  if(!stopAttempted){stopAttempted=true;try{Reflect.apply(ad.get('stop').value,addon,[]);}catch{refuse('cleanup-stop-threw');}}
 };
 const status=()=>{
  if(busy){refuse('controller-reentry');fail('controller-reentry');}
  return Object.freeze({schema:'bw.guest-site-controller.synthetic.v1',kind,phase,firstFailure,
   boardCalls,pauseCompleted,stopAttempted,resumeCompleted,gcCount,
   admissionStatus:admission.status(),premise,cuts:Object.freeze({...cuts}),sourceInstanceQualified:false,guestConnected:false});
 };
 const start=()=>{
  enter();
  try{
   if(phase!=='created')fail('start-order');phase='starting';
   const guarded={begin:flags=>call(addon,ad,'begin',[flags]),facts:()=>({gc:Array(count()).fill(null)})};
   premise=admission({node:'v20.20.2',execArgv:['--expose-gc']},()=>call(ports,pd,'fullGC'),guarded,KINDS[kind]);
   fence();seam=createGuestSnapshotCohort(cpu);fence();zero('afterInstallation');phase='observing';
  }catch(error){refuse('start-refused');cleanup();throw error;}finally{busy=false;}
  return status();
 };
 const advance=()=>{
  enter();
  try{
   if(phase!=='observing')fail('advance-order');
   if(boardCalls>=100000)fail('synthetic-board-call-cap');
   const result=call(ports,pd,'boardStep');
   // The complete board tail has returned before any sampling pause.
   const s=seam.status();fence();
   if(s.firstFailure)fail('cohort-refused');
   if(s.phase==='captured'){call(ports,pd,'pause');pauseCompleted=true;phase='paused';}
   return result;
  }catch(error){refuse('advance-refused');cleanup();throw error;}finally{busy=false;}
 };
 const finish=async()=>{
  enter();
  try{
   if(phase!=='paused')fail('finish-order');phase='sampling';fence();
   roots=seam.extract();fence();
   if(roots.length!==64)fail('cohort-count');
   call(addon,ad,'adopt',[roots]);
   call(ports,pd,'saveSnapshot',['pre',call(addon,ad,'snapshot')]);zero('afterSnapshot');
   premise=Object.freeze({...premise,afterSnapshot:cuts.afterSnapshot});
   const turn=call(ports,pd,'tick');await turn;fence();zero('beforeRelease');
   roots=null;zero('afterRelease');
   if(kind.startsWith('major-'))call(ports,pd,'fullGC');
   else for(let i=0;i<512;i++){call(ports,pd,'minorPressure',[i]);if(count()>0)break;}
   if(count()!==1)fail('designated-gc-count');
   call(ports,pd,'saveSnapshot',['post',call(addon,ad,'snapshot')]);
   call(addon,ad,'stop');cuts.finalGC=count();if(cuts.finalGC!==1)fail('final-gc-count');
   call(ports,pd,'resume');resumeCompleted=true;phase='complete';
  }catch(error){refuse('finish-refused');cleanup();throw error;}finally{busy=false;}
  return status();
 };
 const dispose=()=>{enter();try{cleanup();if(!firstFailure)phase='disposed';}finally{busy=false;}return status();};
 return Object.freeze({start,advance,finish,status,dispose});
}
