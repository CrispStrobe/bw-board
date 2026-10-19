/** Optional external instrumentation. Never changes guest or compiled semantics. */
const clock=()=>process.hrtime.bigint();
export function installDirectProfile(board,native,{now=clock}={}) {
 const buckets=new Map(),restores=[];let nesting=0;
 function measure(name,fn,receiver,args){
  const start=now(),depth=nesting++;try{return Reflect.apply(fn,receiver,args);}finally{
   const elapsed=now()-start;nesting--;
   const b=buckets.get(name)??{calls:0,nanoseconds:0n,maxNanoseconds:0n,nestedCalls:0};
   b.calls++;b.nanoseconds+=elapsed;if(elapsed>b.maxNanoseconds)b.maxNanoseconds=elapsed;if(depth)b.nestedCalls++;buckets.set(name,b);
  }
 }
 function wrap(object,name,label){
  const own=Object.getOwnPropertyDescriptor(object,name),original=object[name];
  if(typeof original!=='function')throw Error('profile seam missing: '+label);
  Object.defineProperty(object,name,{configurable:true,writable:true,value:function(...args){return measure(label,original,this,args);}});
  restores.push(()=>own?Object.defineProperty(object,name,own):delete object[name]);
 }
 // This owns timing only: callback arguments/results remain the original values.
 const ownCall=Object.getOwnPropertyDescriptor(board,'_call'),call=board._call;
 Object.defineProperty(board,'_call',{configurable:true,writable:true,value:function(operation,...args){return measure('callback.'+operation,call,this,[operation,...args]);}});
 restores.push(()=>ownCall?Object.defineProperty(board,'_call',ownCall):delete board._call);
 for(const method of ['stageLine','beginRun','endRun','inspect','mappingState','settleTerminal'])wrap(board,method,'board.'+method);
 for(const method of ['_flushChips','_catchUpChips'])wrap(board.machine,method,'machine.'+method);
 // Native exports may be read-only. A separate facade avoids mutating the addon.
 const api={};for(const method of ['create','resume','setIRQ','inspect','close']){
  if(typeof native[method]!=='function')throw Error('profile native seam missing: '+method);
  api[method]=(...args)=>measure('native.'+method,native[method],native,args);
 }
 api.abiVersion=native.abiVersion;let restored=false;
 return {native:api,summary(){return {scope:'inclusive wall time with two hrtime reads and bookkeeping per timed call; nested buckets overlap, never sum them as exclusive CPU time',buckets:Object.fromEntries([...buckets].map(([k,v])=>[k,{...v,nanoseconds:v.nanoseconds.toString(),maxNanoseconds:v.maxNanoseconds.toString()}]))};},restore(){if(restored)throw Error('profile already restored');for(const restore of restores.reverse())restore();restored=true;}};
}
/** Timer pair baseline only; it does not estimate callback allocation/JIT cost. */
export function measureClockPairOverhead(samples=1000,{now=clock}={}){
 if(!Number.isInteger(samples)||samples<1||samples>10000)throw Error('bounded timer samples required');
 const values=[];for(let i=0;i<samples;i++){const a=now(),b=now();values.push(Number(b-a));}values.sort((a,b)=>a-b);
 return {samples,unit:'nanoseconds',min:values[0],median:values[Math.floor(samples/2)],max:values.at(-1),scope:'back-to-back clock reads only; do not subtract from profiled calls or claim total wrapper overhead'};
}
