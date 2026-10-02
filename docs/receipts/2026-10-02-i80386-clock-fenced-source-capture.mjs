/** Bounded regular-file analysis only; never loads an addon. */
import assert from 'node:assert/strict';
import {openSync,readSync,fstatSync,closeSync,constants} from 'node:fs';
import {createHash} from 'node:crypto';
export function* authenticatedLines(path,expectedSha,{maxBytes=256*1024*1024,maxLineBytes=65536,allowFinalLine=false}={}){
 assert.match(expectedSha,/^[a-f0-9]{64}$/,'input SHA required');
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);const before=fstatSync(fd);
 try{
  assert.ok(before.isFile()&&before.size<=maxBytes,'bounded regular input');
  const hash=createHash('sha256'),chunk=Buffer.alloc(65536);let carry=Buffer.alloc(0),total=0;
  for(;;){const count=readSync(fd,chunk,0,chunk.length,null);if(!count)break;total+=count;assert.ok(total<=maxBytes,'read byte bound');const bytes=chunk.subarray(0,count);hash.update(bytes);carry=Buffer.concat([carry,bytes]);let start=0,index;
   while((index=carry.indexOf(10,start))>=0){assert.ok(index-start<=maxLineBytes,'line byte bound');yield carry.subarray(start,index).toString('utf8');start=index+1;}
   carry=carry.subarray(start);assert.ok(carry.length<=maxLineBytes,'line byte bound');
  }
  if(carry.length){assert.ok(allowFinalLine,'truncated final record');yield carry.toString('utf8');}assert.equal(total,before.size,'input size changed');const after=fstatSync(fd);assert.equal(after.size,before.size,'input size changed');assert.equal(after.mtimeNs??after.mtimeMs,before.mtimeNs??before.mtimeMs,'input mtime changed');assert.equal(hash.digest('hex'),expectedSha,'input SHA mismatch');
 }finally{closeSync(fd);}
}
const uint=(text)=>{assert.match(text,/^(?:0|[1-9][0-9]*)$/,'decimal integer');const n=Number(text);assert.ok(Number.isSafeInteger(n),'safe integer');return n;};
export function nativeClock(line){
 const f=line.split('\t');if(f[0]!=='BWSD1'){assert.ok(!line.includes('BWSD1'),'malformed native marker fragment');return null;}
 if(f[1]==='NATIVE_TICK'){assert.equal(f.length,7,'tick shape');const [count,before,n,q,ordinal]=f.slice(2).map(uint);assert.equal(n,before+count,'tick delta');assert.equal(count,1,'bounded original tick');return {type:'N',n,q,ordinal,count};}
 if(f[1]==='QUANTUM'){assert.equal(f.length,12,'quantum shape');const kind=uint(f[2]),before=uint(f[8]),q=uint(f[9]),n=uint(f[10]),ordinal=uint(f[11]);assert.ok(kind<=1,'Q kind');assert.equal(q,before+1,'Q delta');return {type:'Q',kind,n,q,ordinal};}
 return null;
}
export function compareClocks(native,host){
 assert.equal(host.length,native.length,'dropped clock event');let n=0,q=0,lastOrdinal=0;
 for(let i=0;i<native.length;i++){
  const a=native[i],b=host[i];for(const e of [a,b]){assert.ok(e.type==='N'||e.type==='Q','clock type');for(const k of ['n','q'])assert.ok(Number.isSafeInteger(e[k])&&e[k]>=0,'safe clock '+k);}assert.ok(a.ordinal>lastOrdinal,'native clock order');lastOrdinal=a.ordinal;
  if(a.type==='N')n+=a.count;else q++;
  assert.equal(a.n,n,'native N chronology');assert.equal(a.q,q,'native Q chronology');
  assert.equal(b.type,a.type,'ordered N/Q interleave');assert.equal(b.n,a.n,'host N chronology');assert.equal(b.q,a.q,'host Q chronology');
  if(a.type==='Q')assert.equal(b.kind,a.kind,'REP kind chronology');
 }
 return {nativeTicks:n,successfulQuanta:q};
}
export function validateFences(fences,hostRows,{resumes,checkpointQuanta=[]}={}){
 assert.ok(Number.isSafeInteger(resumes)&&resumes>0,'expected resume count');
 assert.ok(fences.length>0&&fences[0].phase==='start'&&fences.at(-1).phase==='close','complete fence capture');
 let ordinal=0,active=null,pairs=0,last=0,previousPhase=null,staged=false,settled=false,lastReturn=null;const inspections=[];
 const phases=new Set(['start','stage-irq','entry','return','inspect','settle','close']);
 for(const f of fences){
  assert.ok(phases.has(f.phase),'unknown fence phase');assert.equal(f.ordinal,++ordinal,'fence record order');
  for(const k of ['resume','hostOrdinal','n','q','cycles','debt','deadline','epoch','a20','nativeN','nativeQ'])assert.ok(Number.isSafeInteger(f[k])&&f[k]>=0,'safe fence '+k);
  assert.ok(f.a20<=1&&f.epoch<=0xffffffff&&f.n<=160000&&f.q<=150000,'fence range');
  assert.ok(f.hostOrdinal>=last&&f.hostOrdinal<=hostRows.length,'monotone host fence ordinal');if(f.phase!=='return')assert.equal(f.hostOrdinal,last,'host effects only inside resume');last=f.hostOrdinal;
  const previous=hostRows[f.hostOrdinal-1];if(previous){assert.equal(f.n,previous[4],'fence N matches host ledger');assert.equal(f.q,previous[5],'fence Q matches host ledger');assert.equal(f.cycles,previous[6],'fence cycle matches host ledger');}else{assert.equal(f.n,0,'initial N');assert.equal(f.q,0,'initial Q');assert.equal(f.cycles,4,'initial cycles');}
  assert.equal(f.nativeN,f.n,'native/board fence N');assert.equal(f.nativeQ,f.q,'native/board fence Q');assert.equal(f.cycles,4+6*f.q,'successful board clock');
  if(f.phase==='start'){assert.equal(ordinal,1,'start once');assert.equal(f.resume,0,'start resume');assert.equal(f.hostOrdinal,0,'start host ordinal');assert.equal(f.debt,0,'initial debt');}
  else if(f.phase==='stage-irq'){assert.ok(!active&&!staged&&!settled&&['start','return','inspect'].includes(previousPhase),'stage IRQ fence order');assert.equal(f.resume,pairs,'stage current resume');staged=true;}
  else if(f.phase==='entry'){assert.ok(staged&&previousPhase==='stage-irq'&&!active,'paired staged entry');assert.equal(f.resume,++pairs,'resume sequence');active=f;staged=false;for(const k of ['maxNative','maxQuanta'])assert.ok(Number.isSafeInteger(f[k])&&f[k]>0,'safe requested '+k);assert.ok(f.maxNative<=600&&f.maxQuanta<=300,'requested caps');assert.ok(f.deadline>f.debt,'entry settled due debt');}
  else if(f.phase==='return'){assert.ok(active&&previousPhase==='entry'&&f.resume===active.resume,'paired return');const dn=f.n-active.n,dq=f.q-active.q;assert.ok(dn>=0&&dq>=0&&dn<=active.maxNative&&dq<=active.maxQuanta,'resume charges within independent caps');assert.equal(f.chargedNativeTicks,dn,'reported charged N delta');assert.equal(f.chargedQuanta,dq,'reported charged Q delta');assert.ok(Number.isInteger(f.reason)&&f.reason>=1&&f.reason<=7&&f.reason!==5,'return reason');lastReturn=f;active=null;}
  else if(f.phase==='inspect'){assert.ok(!active&&previousPhase==='return'&&!settled,'inspect follows return');assert.equal(f.resume,pairs,'inspect resume');inspections.push(f.q);}
  else if(f.phase==='settle'){assert.ok(!active&&!staged&&!settled&&['return','inspect'].includes(previousPhase),'settle after final return');assert.equal(f.resume,pairs,'settle resume');settled=true;}
  else if(f.phase==='close'){assert.ok(settled&&previousPhase==='settle'&&!active&&!staged,'close follows settlement');assert.equal(f.resume,pairs,'close resume');assert.equal(f.debt,0,'terminal debt settled');assert.ok(lastReturn&&lastReturn.reason===4&&lastReturn.chargedNativeTicks===0&&lastReturn.chargedQuanta===0,'terminal idle return');}
  previousPhase=f.phase;
 }
 assert.equal(active,null,'missing return');assert.equal(pairs,resumes,'all actual resumes fenced');assert.deepEqual(inspections,checkpointQuanta,'all actual inspections fenced');assert.equal(last,hostRows.length,'missing final host fence');return {resumes:pairs,status:'OFFLINE_FENCES_PRESENT_NOT_BATCH_ADMISSION'};
}
