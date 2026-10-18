// CPU-free identity snapshot for the source-owned synchronous AT observation.
// This reads own data descriptors only: it does not iterate the CPU's plain
// segment-cache object or invoke an array's overridable iterator/getters.
const own=(object,key)=>{
  if((typeof object!=='object'&&typeof object!=='function')||object===null)
    throw new Error('reference owner shape');
  const descriptor=Object.getOwnPropertyDescriptor(object,key);
  if(!descriptor||!Object.hasOwn(descriptor,'value'))
    throw new Error('reference own-data slot: '+String(key));
  return descriptor.value;
};
const optional=(object,key)=>{
  const descriptor=Object.getOwnPropertyDescriptor(object,key);
  if(!descriptor)return undefined;
  if(!Object.hasOwn(descriptor,'value'))
    throw new Error('reference accessor slot: '+String(key));
  return descriptor.value;
};
const slots=(object,length,required)=>{
  if(!Array.isArray(object)||object.length!==length)
    throw new Error('reference array shape');
  return Array.from({length},(_,index)=>required?own(object,index):optional(object,index));
};
const typedPrototype=Object.getPrototypeOf(Uint8Array.prototype);
const typedLength=Object.getOwnPropertyDescriptor(typedPrototype,'length').get;
const typedBuffer=Object.getOwnPropertyDescriptor(typedPrototype,'buffer').get;
const typed=(value,constructor,length)=>{
  if(!ArrayBuffer.isView(value)||Object.getPrototypeOf(value)!==constructor.prototype||
     typedLength.call(value)!==length)
    throw new Error('reference byte-view shape');
  return value;
};

export function captureReferences(machine){
  const cpu=own(machine,'cpu');
  const mem=typed(own(machine,'mem'),Uint8Array,16<<20);
  const page=typed(own(machine,'_page'),Uint8Array,4096);
  const caches=own(cpu,'segmentCaches');
  if(Object.getPrototypeOf(caches)!==Object.prototype)
    throw new Error('segment cache is not the source plain object');
  const cacheValues=Array.from({length:6},(_,index)=>own(caches,index));
  const translations=own(cpu,'_translations');
  const translationValues=slots(translations,512,false);
  const tablePages=own(cpu,'_translationTablePages');
  if(Object.getPrototypeOf(tablePages)!==Set.prototype)
    throw new Error('translation-page set shape');
  const vga=own(machine,'vgaMemory');
  const planes=vga===null?null:own(vga,'planes');
  const planeValues=planes===null?null:slots(planes,4,true);
  if(planeValues!==null)
    for(const plane of planeValues)typed(plane,Uint8Array,65536);
  const latches=vga===null?null:typed(own(vga,'latches'),Uint8Array,4);
  const debug=typed(own(cpu,'_debugRegisters'),Uint32Array,8);
  return Object.freeze({cpu,mem,memBuffer:typedBuffer.call(mem),page,pageBuffer:typedBuffer.call(page),
    config:own(machine,'config'),chips:own(machine,'chips'),
    caches,cacheValues:Object.freeze(cacheValues),
    translations,translationValues:Object.freeze(translationValues),
    tablePages,vga,registerSource:vga===null?null:own(vga,'registerSource'),
    planes,planeValues:planeValues===null?null:Object.freeze(planeValues),
    planeBuffers:planeValues===null?null:Object.freeze(planeValues.map(plane=>typedBuffer.call(plane))),
    latches,latchBuffer:latches===null?null:typedBuffer.call(latches),
    debug,debugBuffer:typedBuffer.call(debug)});
}

export function sameReferences(before,after){
  for(const key of ['cpu','mem','memBuffer','page','pageBuffer','config','chips',
    'caches','translations','tablePages','vga','registerSource','planes',
    'latches','latchBuffer','debug','debugBuffer'])
    if(before[key]!==after[key])return false;
  for(const key of ['cacheValues','translationValues','planeValues','planeBuffers']){
    const a=before[key],b=after[key];
    if(a===null||b===null){if(a!==b)return false;continue;}
    if(a.length!==b.length||a.some((value,index)=>value!==b[index]))return false;
  }
  return true;
}
