/** Execution-only diagnostic wall time; nested buckets overlap and timers distort costs. */
const clock=process.hrtime.bigint,stats=Object.create(null);let active=false;
export const now=()=>active?clock():null;
export function add(name,start){if(start===null)return;const x=stats[name]??(stats[name]={calls:0,ns:0});x.calls++;x.ns+=Number(clock()-start);if(!Number.isSafeInteger(x.ns))throw Error('bounded timing duration');}
export function measure(name,fn){const start=now();try{return fn();}finally{add(name,start);}}
export function begin(){for(const k of Object.keys(stats))delete stats[k];active=true;}
export function end(){active=false;}
export function snapshot(){return structuredClone(stats);}
