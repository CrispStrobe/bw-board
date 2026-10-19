/** Receiver-only value schema for genuine private Worker messages.
 * Never use on generic caller objects: transport enforces absence of proxies/
 * accessors/functions and ordinary copied values. Shape/domain/density remains
 * checked here. No brand or caller opt-in can establish that precondition. */
import {readFileSync} from 'node:fs';
import {types} from 'node:util';
const boardSchema=JSON.parse(readFileSync(new URL('./board-schema.json',import.meta.url))).schema;
const isUint8Array=types.isUint8Array,isArrayBuffer=types.isArrayBuffer,apply=Reflect.apply;
const ta=Object.getPrototypeOf(Uint8Array.prototype),taGet=Object.fromEntries(['buffer','byteOffset','length'].map(k=>[k,Object.getOwnPropertyDescriptor(ta,k).get])),abLength=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'byteLength').get,abResizable=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'resizable')?.get;
const isProxy=types.isProxy,proto=Object.getPrototypeOf,descriptors=Object.getOwnPropertyDescriptors,keys=Reflect.ownKeys;
const check=(ok,m)=>{if(!ok)throw Error('owned DTO response: '+m);};
const uint=(v,max=0xffffffff)=>check(Number.isSafeInteger(v)&&v>=0&&v<=max,'unsigned domain');
function dataObject(v,expected){check(v!==null&&typeof v==='object'&&proto(v)===Object.prototype,'ordinary copied object');const k=Object.keys(v);check(k.length===expected.length&&expected.every(x=>Object.hasOwn(v,x)),'exact fields');}
function array(v,length,item){check(Array.isArray(v)&&proto(v)===Array.prototype&&v.length===length&&Object.keys(v).length===length,'dense dimensions');for(let i=0;i<length;i++){check(Object.hasOwn(v,i),'dense index');item(v[i],i);}}
const bigint=(v,max=500000n)=>check(typeof v==='bigint'&&v>=0n&&v<=max,'BigInt domain');
const counters={clockTransfers:['transfers','commits','words'],callbacks:['physicalReads','physicalWrites','executePages','nativeTickCallbacks','quantumCallbacks'],fallback:['bochsRamReads','bochsRamWrites','bochsDirectPointers','bochsPio','bochsTimer'],execution:['attempts','completed','repIterations','repPartial','faults','portCommits','irqDeliveries','haltIdleCuts']};
const base=['state','extra','segments','system','debug','nativeTicks','successfulQuanta','mappingEpoch','boardA20',...Object.keys(counters)];
export function validateReceivedNative(v,resume=false){
 dataObject(v,resume?[...base,'sliceBytes','reason','activityState','chargedNativeTicks','chargedQuanta']:base);
 for(const [k,n] of Object.entries({state:20,extra:20,segments:90,system:30,debug:6}))array(v[k],n,x=>uint(x));
 bigint(v.nativeTicks,160000n);bigint(v.successfulQuanta,150000n);uint(v.mappingEpoch);uint(v.boardA20,1);
 for(const [k,names] of Object.entries(counters)){dataObject(v[k],names);for(const name of names)bigint(v[k][name]);}
 check(v.callbacks.nativeTickCallbacks===v.nativeTicks&&v.callbacks.quantumCallbacks===v.successfulQuanta,'logical counters');check(v.clockTransfers.words===v.nativeTicks+v.successfulQuanta,'flushed tape words');check(v.clockTransfers.transfers>=v.clockTransfers.commits+1n&&v.clockTransfers.commits<=v.clockTransfers.words,'crossing counters');
 if(resume){const b=v.sliceBytes;check(isUint8Array(b)&&proto(b)===Uint8Array.prototype,'copied Uint8Array');const backing=apply(taGet.buffer,b,[]);check(isArrayBuffer(backing)&&proto(backing)===ArrayBuffer.prototype,'ordinary backing');check(apply(taGet.byteOffset,b,[])===0&&apply(taGet.length,b,[])===160&&apply(abLength,backing,[])===160&&(!abResizable||!apply(abResizable,backing,[])),'fixed attached slice160');check([1,2,3,4,6,7].includes(v.reason),'reason');uint(v.activityState,3);uint(v.chargedNativeTicks,600);uint(v.chargedQuanta,300);check(BigInt(v.chargedNativeTicks)<=v.nativeTicks&&BigInt(v.chargedQuanta)<=v.successfulQuanta,'charged totals');}
 return v;
}
function shape(v,s,budget){check(++budget.nodes<=8192&&++budget.depth<=20,'board bound');try{
 if(s.type==='object'){const names=Object.keys(s.fields);dataObject(v,names);for(const k of names)shape(v[k],s.fields[k],budget);}
 else if(s.type==='array')array(v,s.length,(x,i)=>shape(x,s.items[i],budget));
 else if(s.type==='uint')uint(v);else if(s.type==='fraction')check(typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<1,'fraction');
 else if(s.type==='boolean')check(typeof v==='boolean','boolean');else if(s.type==='null')check(v===null,'null');else if(s.type==='enum')check(s.values.includes(v),'closed enum');else check(false,'schema type');
 }finally{budget.depth--;}}
export function validateReceivedCheckpoint(v){
 dataObject(v,['nativeTicks','successfulQuanta','mappingEpoch','lineAsserted','generations','board','javascriptCpuCycles','marker']);uint(v.nativeTicks,160000);uint(v.successfulQuanta,150000);uint(v.mappingEpoch);check(typeof v.lineAsserted==='boolean','line');check(v.javascriptCpuCycles===0,'no JS CPU');check(typeof v.marker==='string'&&v.marker.length<=7&&'RPGH001'.startsWith(v.marker),'marker prefix');
 check(Array.isArray(v.generations)&&v.generations.length<=64,'generations bound');let last=-1;array(v.generations,v.generations.length,pair=>array(pair,2,(x,i)=>{uint(x);if(i===0){check((x&4095)===0&&x>last,'generation page order');last=x;}}));
 shape(v.board,boardSchema,{nodes:0,depth:0});check(v.board.cycles===4+6*v.successfulQuanta,'board cycle ledger');check(v.board.deadline>=1&&v.board.deadline<=6000&&v.board.debt<=v.board.deadline+5,'clock domain');return v;
}
export function validateReceivedResponse(command,v){
 if(command==='create'||command==='inspect')return validateReceivedNative(v);
 if(command==='resume')return validateReceivedNative(v,true);
 if(command==='checkpoint')return validateReceivedCheckpoint(v);
 if(command==='close'){dataObject(v,['state','ramSha256','journal']);validateReceivedCheckpoint(v.state);check(v.state.nativeTicks===100684&&v.state.successfulQuanta===100682&&v.state.marker==='RPGH001'&&v.state.board.debt===0,'terminal ledger');check(typeof v.ramSha256==='string'&&/^[a-f0-9]{64}$/.test(v.ramSha256),'RAM SHA');dataObject(v.journal,['rows','bytes','sha256']);uint(v.journal.rows,500000);uint(v.journal.bytes,32*1024*1024);check(typeof v.journal.sha256==='string'&&/^[a-f0-9]{64}$/.test(v.journal.sha256),'journal SHA');return v;}
 check(false,'command');
}
export function validateReceivedEnvelope(m,expectedId,command){
 if(expectedId===0){dataObject(m,['ready','snapshot']);check(m.ready===true,'startup ready');return validateReceivedResponse('create',m.snapshot);}
 if(m&&typeof m==='object'&&Object.hasOwn(m,'error')){dataObject(m,['id','error']);check(m.id===expectedId&&typeof m.error==='string'&&m.error.length<=4096,'error envelope');throw Error(m.error);}
 dataObject(m,['id','payload']);check(m.id===expectedId,'sequence');return validateReceivedResponse(command,m.payload);
}
/** Store primitives only: caller mutation of returned DTO cannot alter ledger. */
export function nativeLedger(v){return {n:v.nativeTicks,q:v.successfulQuanta,counters:Object.fromEntries(Object.entries(counters).flatMap(([group,names])=>names.map(name=>[group+'.'+name,v[group][name]])))};}
export function validateAdvance(v,previous,requested=null){
 const next=nativeLedger(v);check(next.n>=previous.n&&next.q>=previous.q,'monotone ledger');for(const [k,value] of Object.entries(next.counters))check(value>=previous.counters[k],'monotone counter');
 if(requested){uint(requested.n,600);uint(requested.q,300);check(requested.n>0&&requested.q>0&&v.chargedNativeTicks<=requested.n&&v.chargedQuanta<=requested.q,'requested caps');check(next.n-previous.n===BigInt(v.chargedNativeTicks)&&next.q-previous.q===BigInt(v.chargedQuanta),'charged deltas');}
 else check(next.n===previous.n&&next.q===previous.q,'paused ledger');return next;
}
