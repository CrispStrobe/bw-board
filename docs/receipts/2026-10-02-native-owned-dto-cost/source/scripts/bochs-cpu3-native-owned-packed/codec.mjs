/** Private owned encoder / copied MessageChannel receiver ONLY; no generic object admission. */
import {types} from 'node:util';
import {validateReceivedNative} from '../bochs-cpu3-native-owned-dto/ipc-response.mjs';
const groups={clockTransfers:['transfers','commits','words'],callbacks:['physicalReads','physicalWrites','executePages','nativeTickCallbacks','quantumCallbacks'],fallback:['bochsRamReads','bochsRamWrites','bochsDirectPointers','bochsPio','bochsTimer'],execution:['attempts','completed','repIterations','repPartial','faults','portCommits','irqDeliveries','haltIdleCuts']};
const arrays={state:20,extra:20,segments:90,system:30,debug:6},magic=0x42575350;
const ta=Object.getPrototypeOf(Uint32Array.prototype),get=Object.fromEntries(['buffer','byteOffset','length'].map(k=>[k,Object.getOwnPropertyDescriptor(ta,k).get])),ablen=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'byteLength').get,resize=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'resizable').get;
export const layout=Object.freeze({header:5,cpuWords:Object.values(arrays).reduce((a,b)=>a+b,0),counterWords:Object.values(groups).reduce((a,b)=>a+b.length,0)});
const baseLength=layout.header+layout.cpuWords+4+layout.counterWords,resumeLength=baseLength+4+40;
const check=(v,s)=>{if(!v)throw Error('packed snapshot: '+s);};
export function encodeOwned(v,resume=true){
 const uint=(x,max=0xffffffff)=>check(Number.isSafeInteger(x)&&x>=0&&x<=max,'encoder unsigned');const big=(x,max)=>check(typeof x==='bigint'&&x>=0n&&x<=max,'encoder BigInt');
 for(const [k,n]of Object.entries(arrays)){check(Array.isArray(v[k])&&v[k].length===n,'encoder dimensions');for(let j=0;j<n;j++){check(Object.hasOwn(v[k],j),'encoder density');uint(v[k][j]);}}
 big(v.nativeTicks,160000n);big(v.successfulQuanta,150000n);uint(v.mappingEpoch);uint(v.boardA20,1);for(const [g,names]of Object.entries(groups))for(const k of names)big(v[g][k],500000n);
 if(resume){check([1,2,3,4,6,7].includes(v.reason),'encoder reason');uint(v.activityState,3);uint(v.chargedNativeTicks,600);uint(v.chargedQuanta,300);check(types.isUint8Array(v.sliceBytes)&&v.sliceBytes.length===160,'encoder slice');}
 const w=new Uint32Array(resume?resumeLength:baseLength);w.set([magic,1,resume?1:0,w.length,0]);let i=5;
 for(const [k,n]of Object.entries(arrays))for(let j=0;j<n;j++)w[i++]=v[k][j];
 w[i++]=Number(v.nativeTicks);w[i++]=Number(v.successfulQuanta);w[i++]=v.mappingEpoch;w[i++]=v.boardA20;
 for(const [g,names]of Object.entries(groups))for(const k of names)w[i++]=Number(v[g][k]);
 if(resume){for(const k of ['reason','activityState','chargedNativeTicks','chargedQuanta'])w[i++]=v[k];for(let j=0;j<160;j+=4)w[i++]=(v.sliceBytes[j]|v.sliceBytes[j+1]<<8|v.sliceBytes[j+2]<<16|v.sliceBytes[j+3]<<24)>>>0;}
 check(i===w.length,'encoder length');return w;
}
export function decodeReceived(w,resume=true){
 check(!types.isProxy(w)&&types.isUint32Array(w)&&Object.getPrototypeOf(w)===Uint32Array.prototype,'typed view');
 const b=Reflect.apply(get.buffer,w,[]),n=resume?resumeLength:baseLength;
 check(types.isArrayBuffer(b)&&Object.getPrototypeOf(b)===ArrayBuffer.prototype&&!Reflect.apply(resize,b,[])&&Reflect.apply(get.byteOffset,w,[])===0&&Reflect.apply(get.length,w,[])===n&&Reflect.apply(ablen,b,[])===n*4,'fixed backing');
 check(Reflect.ownKeys(w).length===n&&Reflect.ownKeys(b).length===0,'unshadowed view');check(w[0]===magic&&w[1]===1&&w[2]===(resume?1:0)&&w[3]===n&&w[4]===0,'header');
 let i=5;const v={};for(const [k,n]of Object.entries(arrays))v[k]=Array.from(w.subarray(i,i+=n));
 v.nativeTicks=BigInt(w[i++]);v.successfulQuanta=BigInt(w[i++]);v.mappingEpoch=w[i++];v.boardA20=w[i++];
 for(const [g,names]of Object.entries(groups)){v[g]={};for(const k of names)v[g][k]=BigInt(w[i++]);}
 if(resume){for(const k of ['reason','activityState','chargedNativeTicks','chargedQuanta'])v[k]=w[i++];v.sliceBytes=new Uint8Array(160);for(let j=0;j<160;j+=4){const x=w[i++];for(let z=0;z<4;z++)v.sliceBytes[j+z]=(x>>>(8*z))&255;}}
 check(i===n,'decode length');return validateReceivedNative(v,resume);
}
