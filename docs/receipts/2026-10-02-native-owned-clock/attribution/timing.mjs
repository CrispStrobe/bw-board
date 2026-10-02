/** Diagnostic wall buckets. Inclusive/nested totals overlap; not CPU attribution. */
const clock=process.hrtime.bigint,stats=Object.create(null);
export const now=()=>clock();
export function add(name,start){const item=stats[name]??(stats[name]={calls:0,ns:0});item.calls++;item.ns+=Number(clock()-start);if(!Number.isSafeInteger(item.ns))throw Error('bounded attribution duration');}
export function measure(name,fn){const start=clock();try{return fn();}finally{add(name,start);}}
export function snapshot(){return structuredClone(stats);}
export function reset(){for(const name of Object.keys(stats))delete stats[name];}
