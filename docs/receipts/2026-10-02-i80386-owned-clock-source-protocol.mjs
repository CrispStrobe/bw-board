/** Serialized, bounded diagnostic replay protocol. No native ABI is implemented. */
import assert from 'node:assert/strict';
const parse=JSON.parse, stringify=JSON.stringify;
export const maxMessageBytes=256*1024;
export function parseCommand(text){assert.equal(typeof text,'string','primitive serialized protocol required');assert.ok(Buffer.byteLength(text)<=maxMessageBytes,'message byte bound');const value=parse(text);assert.ok(value!==null&&typeof value==='object'&&!Array.isArray(value),'command object');let nodes=0;function visit(v,depth){assert.ok(++nodes<=40000&&depth<=16,'bounded protocol structure');if(typeof v==='number')assert.ok(Number.isSafeInteger(v)&&v>=0,'unsigned safe protocol number');else if(typeof v==='string')assert.ok(v.length<=4096,'string bound');else if(v!==null&&typeof v==='object')for(const x of Object.values(v))visit(x,depth+1);else assert.ok(v===null||typeof v==='boolean','JSON domain');}visit(value,0);return value;}
const uint=(n,max=0xffffffff)=>assert.ok(Number.isSafeInteger(n)&&n>=0&&n<=max,'bounded unsigned argument');
export function preflightResume(command,state){
 assert.deepEqual(Object.keys(command).sort(),['entry','exit','rows'],'resume command fields');
 const {entry,exit,rows}=command;assert.ok(entry&&exit&&typeof entry==='object'&&typeof exit==='object'&&!Array.isArray(entry)&&!Array.isArray(exit),'fence objects');assert.ok(Array.isArray(rows)&&rows.length<=4096,'resume row bound');
 for(const f of [entry,exit])for(const k of ['resume','hostOrdinal','n','q','cycles','debt','deadline','epoch','a20'])uint(f[k],Number.MAX_SAFE_INTEGER);
 assert.equal(entry.phase,'entry','entry phase');assert.equal(exit.phase,'return','return phase');assert.equal(entry.resume,state.resume+1,'resume order');assert.equal(exit.resume,entry.resume,'paired exit');
 for(const f of [entry,exit]){uint(f.epoch);uint(f.a20,1);assert.equal(f.cycles,4+6*f.q,'fence successful cycles');assert.equal(f.nativeN,f.n,'fence native N');assert.equal(f.nativeQ,f.q,'fence native Q');}assert.equal(entry.epoch,state.epoch,'entry epoch');assert.equal(entry.a20,state.a20,'entry A20');
 assert.equal(entry.hostOrdinal,state.ordinal,'entry host ordinal');assert.equal(entry.n,state.n,'entry N');assert.equal(entry.q,state.q,'entry Q');uint(entry.maxNative,600);uint(entry.maxQuanta,300);assert.ok(entry.maxNative>0&&entry.maxQuanta>0,'positive independent caps');assert.ok(entry.deadline>entry.debt,'settled entry deadline');
 let n=state.n,q=state.q,ordinal=state.ordinal,debt=entry.debt,deadline=entry.deadline,epoch=entry.epoch,a20=entry.a20,due=false,pioSeen=false,clocks=[];const actions=[];
 const flush=()=>{if(clocks.length){actions.push({type:'clock-batch',rows:clocks});clocks=[];}};
 for(const row of rows){assert.ok(Array.isArray(row)&&row.length===9,'host row shape');const [ord,op,args,result,rn,rq,cycles,rowDebt,rowEpoch]=row;assert.equal(ord,++ordinal,'ordered host ordinal');for(const v of [rn,rq,cycles,rowDebt,rowEpoch])uint(v,Number.MAX_SAFE_INTEGER);assert.ok(Array.isArray(args),'operation argument array');
  if(due)assert.equal(op,'nativeTick','no work beyond successful horizon');
  if(op==='nativeTick'){assert.deepEqual(args,[],'tick argc');assert.equal(result,0,'tick result');assert.ok(n<160000,'total N cap before effect');n++;}
  else if(op==='quantum'){assert.ok(args.length===1&&(args[0]===0||args[0]===1),'quantum kind');assert.ok(result===0||result===1,'due result');assert.ok(q<150000,'total Q cap before effect');q++;debt+=6;assert.ok(Number.isSafeInteger(debt),'debt overflow');due=debt>=deadline;assert.equal(result,Number(due),'exact Q due');}
  else if(op==='read'||op==='write'){assert.equal(args.length,3,'memory argc');uint(args[0]);uint(args[1],16);assert.ok(args[1]>0,'memory width');assert.ok(args[0]<=0xffffffff-(args[1]-1)&&(args[0]%4096)+args[1]<=4096,'memory span overflow/page crossing');if(op==='read')assert.equal(args[2],null,'read payload');else{assert.ok(Array.isArray(args[2])&&args[2].length===args[1],'write payload');for(const b of args[2])uint(b,255);}}
  else if(op==='page'){assert.equal(args.length,1,'PAGE argc');uint(args[0]);assert.equal(args[0]%4096,0,'PAGE alignment');}
  else if(op==='outPort'){assert.equal(args.length,3,'PIO argc');assert.ok([0x20,0x21,0xa0,0xa1,0x40,0x43,0x60,0x64,0xe9].includes(args[0])&&args[1]===1,'PIO admission');uint(args[2],255);assert.ok(!pioSeen,'one admitted PIO cut per resume');pioSeen=true;assert.ok(result&&typeof result==='object'&&!Array.isArray(result),'PIO metadata');assert.equal(result.value,0,'PIO result');uint(result.mappingEpoch);uint(result.boardA20,1);if(result.boardA20!==a20){assert.equal(args[0],0x60,'A20 admitted port');assert.ok(epoch<0xffffffff,'epoch overflow');epoch++;a20=result.boardA20;}assert.equal(result.mappingEpoch,epoch,'PIO mapping epoch');debt=0;deadline=exit.deadline;assert.ok(deadline>0,'post PIO horizon');}
  else if(op==='ack'){assert.deepEqual(args,[],'ACK argc');assert.equal(result,0x20,'actual PIC vector');}
  else assert.fail('unknown operation');
  assert.equal(rn,n,'ordered N ledger');assert.equal(rq,q,'ordered Q ledger');assert.equal(cycles,4+6*q,'Q functional clock');assert.equal(rowDebt,debt,'exact callback debt');assert.equal(rowEpoch,epoch,'exact callback epoch');assert.ok(n-state.n<=entry.maxNative&&q-state.q<=entry.maxQuanta,'independent resume caps');
  if(op==='nativeTick'||op==='quantum')clocks.push(row);else{flush();actions.push({type:'observer',row});}
 }
 flush();assert.equal(exit.debt,debt,'exit debt');assert.equal(exit.deadline,deadline,'exit deadline');assert.equal(exit.epoch,epoch,'exit epoch');assert.equal(exit.a20,a20,'exit A20');assert.equal(exit.hostOrdinal,ordinal,'final flush ordinal');assert.equal(exit.n,n,'final N');assert.equal(exit.q,q,'final Q');assert.equal(exit.chargedNativeTicks,n-state.n,'charged N');assert.equal(exit.chargedQuanta,q-state.q,'charged Q');assert.ok([1,2,3,4,6,7].includes(exit.reason),'return reason');
 return {actions,n,q,ordinal,resume:entry.resume,entry,exit};
}
export const serialize=stringify;
