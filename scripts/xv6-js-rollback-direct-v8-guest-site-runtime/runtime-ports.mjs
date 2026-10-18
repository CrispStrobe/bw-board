// Source-owned mechanics only; exact runtime and live-driver admission remain external.
import {setImmediate as nodeSetImmediate} from 'node:timers';
import {types} from 'node:util';
const CapturedPromise=Promise, capturedArrayFrom=Array.from, capturedSetImmediate=nodeSetImmediate;
const MAX_CALLS=512, ELEMENTS=1024;
export function createGuestSiteRuntime(...args){
 if(args.length)throw Error('runtime-arguments');
 let phase='created',firstFailure=null,busy=false,turnScheduled=false,turnCompleted=false;
 let pressure=[],pressureAttempts=0,pressureCalls=0;
 const refuse=code=>{firstFailure??=code;phase='invalid';pressure=[];};
 const enter=()=>{if(busy){refuse('runtime-reentry');throw Error('runtime-reentry');}busy=true;};
 const check=()=>{if(firstFailure)throw Error(firstFailure);};
 const order=(allowed,code)=>{check();if(!allowed.includes(phase)){refuse(code);throw Error(code);}};
 const status=()=>{
  if(busy){refuse('runtime-reentry');throw Error('runtime-reentry');}
  return Object.freeze({schema:'bw.guest-site-runtime.source-only.v1',phase,firstFailure,
   turnScheduled,turnCompleted,pressureAttempts,pressureCalls,retainedArrays:pressure.length,
   maxPressureCalls:MAX_CALLS,elementsPerCall:ELEMENTS,
   runtimeQualified:false,sourceInstanceQualified:false,guestConnected:false});
 };
 const tick=(...tickArgs)=>{
  enter();
  try{
   order(['created'],'tick-order');if(tickArgs.length){refuse('tick-arguments');throw Error('tick-arguments');}
   phase='turn-pending';
   const promise=new CapturedPromise((resolve,reject)=>{
    try{
     capturedSetImmediate(()=>{
     if(firstFailure||phase!=='turn-pending'){
      if(!firstFailure)refuse('turn-disposed');reject(Error(firstFailure));return;
     }
      turnCompleted=true;phase='ready';resolve();
     });
     turnScheduled=true;
    }catch(error){refuse('tick-scheduling-threw');reject(error);}
   });
   // Once created, return the original native promise even when scheduling
   // latched a refusal. Throwing here would orphan its original rejection.
   if(!types.isPromise(promise)){refuse('native-promise-required');throw Error('native-promise-required');}
   return promise;
  }catch(error){refuse('tick-scheduling-threw');throw error;}finally{busy=false;}
 };
 const minorPressure=(...pressureArgs)=>{
  enter();
  try{
   order(['ready','pressure'],'pressure-order');
   const i=pressureArgs[0];
   if(pressureArgs.length!==1||typeof i!=='number'||!Number.isSafeInteger(i)||i!==pressureCalls||i<0||i>=MAX_CALLS){refuse('pressure-index');throw Error('pressure-index');}
   phase='pressure';pressureAttempts++;
   const array=capturedArrayFrom({length:ELEMENTS},(_,j)=>i+j);
   check();pressure.push(array);check();pressureCalls++;
   // No array, root, callback, ticket or allocation-byte claim is returned.
  }catch(error){refuse('pressure-allocation-threw');throw error;}finally{busy=false;}
 };
 const finishPressure=(...finishArgs)=>{
  enter();
  try{
   order(['ready','pressure'],'finish-order');if(finishArgs.length){refuse('finish-arguments');throw Error('finish-arguments');}
   pressure=[];phase='finished';
  }finally{busy=false;}
 };
 const dispose=(...disposeArgs)=>{
  enter();
  try{
   if(disposeArgs.length){refuse('dispose-arguments');throw Error('dispose-arguments');}
   pressure=[];if(!firstFailure)phase='disposed';
  }finally{busy=false;}
  return status();
 };
 return Object.freeze({tick,minorPressure,finishPressure,status,dispose});
}
