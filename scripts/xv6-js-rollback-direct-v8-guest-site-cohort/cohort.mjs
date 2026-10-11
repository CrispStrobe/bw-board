// Diagnostic source seam only. Outer source and live-instance admission required.
import {types} from 'node:util';
const NAME='_snapshotInstruction', LIMIT=64, DEPTH=16;
const issuedInstances=new WeakSet();
const plainObject=value=>value!==null&&typeof value==='object'&&!types.isProxy(value);
const descriptorEqual=(a,b)=>a===undefined?b===undefined:b!==undefined&&
  ['value','get','set','writable','enumerable','configurable'].every(k=>
    Object.hasOwn(a,k)===Object.hasOwn(b,k)&&a[k]===b[k]);
export function createGuestSnapshotCohort(cpu) {
  if(!plainObject(cpu))throw Error('ordinary CPU object required');
  if(issuedInstances.has(cpu))throw Error('instance cohort already issued');
  const chain=[];let current=cpu,found;
  for(let depth=0;current!==null;depth++){
    if(depth>=DEPTH||!plainObject(current))throw Error('ordinary bounded prototype chain required');
    const descriptor=Object.getOwnPropertyDescriptor(current,NAME);
    chain.push({object:current,prototype:Object.getPrototypeOf(current),descriptor});
    if(descriptor!==undefined){found=descriptor;break;}
    current=Object.getPrototypeOf(current);
  }
  if(!found||!Object.hasOwn(found,'value')||typeof found.value!=='function'||types.isProxy(found.value))
    throw Error('ordinary data callable required');
  const original=found.value,prior=chain[0].descriptor;
  if(prior&&!(prior.configurable||prior.writable))throw Error('snapshot method not replaceable');
  if(!prior&&!Object.isExtensible(cpu))throw Error('CPU cannot own diagnostic seam');
  let phase='observing',firstFailure=null,busy=false,count=0,roots=[],issued=false;
  const refuse=reason=>{firstFailure??=reason;phase='invalid';roots=[];};
  let installed;
  const intact=(wrapperExpected=true)=>{
    const expected=wrapperExpected?installed:prior;
    if(!descriptorEqual(Object.getOwnPropertyDescriptor(cpu,NAME),expected))return false;
    for(let i=0;i<chain.length;i++){
      const item=chain[i];
      if(Object.getPrototypeOf(item.object)!==item.prototype)return false;
      if(i&& !descriptorEqual(Object.getOwnPropertyDescriptor(item.object,NAME),item.descriptor))return false;
    }
    return true;
  };
  const restore=()=>{
    // Never delete or overwrite another owner's replacement.
    if(!intact(true)){refuse('cleanup-descriptor-changed');return false;}
    try{
      if(prior)Object.defineProperty(cpu,NAME,prior);
      else if(!Reflect.deleteProperty(cpu,NAME))throw Error('delete refused');
      if(!intact(false))throw Error('restoration differs');
      return true;
    }catch{refuse('cleanup-refused');return false;}
  };
  function wrapper(...args){
    const active=phase==='observing';
    if(!active)refuse('stale-wrapper');
    if(busy)refuse('observer-reentry');
    if(active&&!intact(true))refuse('descriptor-changed');
    const outer=!busy; if(outer)busy=true;
    let result,returned=false;
    try{
      // Exact receiver, arguments, return object and thrown value are preserved.
      result=Reflect.apply(original,this,args);returned=true;return result;
    }catch(error){refuse('snapshot-threw');throw error;}
    finally{
      if(outer)busy=false;
      if(returned&&active&&firstFailure===null){
        if(this!==cpu)refuse('receiver-changed');
        else if(!intact(true))refuse('descriptor-changed');
        else if(!plainObject(result))refuse('snapshot-root-not-ordinary');
        else if(roots.includes(result))refuse('duplicate-root');
        else {
          roots.push(result);count++;
          if(count===LIMIT){
            if(restore())phase='captured';
          }
        }
      }
    }
  }
  installed=prior?{...prior,value:wrapper}:{value:wrapper,writable:true,enumerable:false,configurable:true};
  Object.defineProperty(cpu,NAME,installed);
  if(!intact(true)){restore();throw Error('seam installation refused');}
  issuedInstances.add(cpu);
  const status=()=>{
    if(busy)refuse('observer-reentry');
    if(phase==='observing'&&!intact(true))refuse('descriptor-changed');
    if(phase==='captured'&&!intact(false))refuse('descriptor-changed');
    return Object.freeze({schema:'bw.xv6-guest-snapshot-cohort.status.v1',phase,
      firstFailure,capturedRoots:count,maxRoots:LIMIT,extracted:issued,
      sourceInstanceQualified:false,guestConnected:false});
  };
  const extract=(...args)=>{
    if(args.length){refuse('extraction-arguments');throw Error(firstFailure);}
    if(busy){refuse('observer-reentry');throw Error(firstFailure);}
    status();
    if(phase!=='captured'||firstFailure!==null||issued){
      if(!issued)refuse('cohort-not-available');
      throw Error(firstFailure??'cohort already extracted');
    }
    const result=Object.freeze(roots);roots=[];issued=true;phase='closed';return result;
  };
  const dispose=()=>{
    if(busy){refuse('observer-reentry');return status();}
    if(phase==='observing'||Object.getOwnPropertyDescriptor(cpu,NAME)?.value===wrapper)restore();
    roots=[];
    if(firstFailure===null&&phase!=='closed')phase='disposed';
    return status();
  };
  return Object.freeze({status,extract,dispose});
}
