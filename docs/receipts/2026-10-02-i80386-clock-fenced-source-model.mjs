/** Offline successful-work ledger model. This implements no native or board ABI. */
import assert from 'node:assert/strict';
export const barriers = new Set(['memory','page','pio','ack','fault','irq','hlt','inspect','snapshot','stage-irq','settle','return','close']);
const integer=(n,name,max=Number.MAX_SAFE_INTEGER)=>assert.ok(Number.isSafeInteger(n)&&n>=0&&n<=max,name+' unsigned bounded integer');
export function quantumHorizon(debt,deadline){integer(debt,'debt');integer(deadline,'deadline');assert.ok(deadline>debt,'due debt requires chip settlement before resume');return Math.ceil((deadline-debt)/6);}
export function successfulCharge(cycle,debt){integer(cycle,'cycles');integer(debt,'debt');assert.ok(cycle<=Number.MAX_SAFE_INTEGER-6&&debt<=Number.MAX_SAFE_INTEGER-6,'charge overflow');return {cycle:cycle+6,debt:debt+6};}
export function validateTape(tape,{maxNative=600,maxQuanta=300,totalNative=160000,totalQuanta=150000}={}){
 for(const [k,v] of Object.entries({maxNative,maxQuanta,totalNative,totalQuanta}))integer(v,k);
 assert.ok(maxNative>0&&maxQuanta>0&&maxNative<=600&&maxQuanta<=300,'resume caps');
 let n=0,q=0,debt=0,deadline=1,cycle=4,sliceN=0,sliceQ=0,horizon=0,pending=[],running=false,due=false,ordinal=0,attempt=null,rep=false,fault=false,ordinaryCharged=false,stopped=false,closed=false,settled=false,rearmRequired=false,repReady=false;const attempts=new Set();
 const flushed=[];
 for(const e of tape){
  assert.equal(e.ordinal,++ordinal,'event ordinal order');assert.ok(!closed,'event after close');
  if(e.type==='resume'){
   assert.ok(!running&&!pending.length,'resume requires previous return and flush');assert.ok(n<totalNative&&q<totalQuanta,'N/Q total cap before resume');
   integer(e.debt,'debt');integer(e.deadline,'deadline');assert.equal(e.debt,debt,'resume debt');deadline=e.deadline;horizon=quantumHorizon(debt,deadline);sliceN=0;sliceQ=0;due=false;stopped=false;settled=false;running=true;continue;
  }
  if(e.type==='settle'){
   assert.ok(!running&&!pending.length,'settlement outside resume after flush');assert.equal(e.debt,0,'settlement clears debt');debt=0;due=false;settled=true;continue;
  }
  if(!running&&['stage-irq','snapshot','inspect','close'].includes(e.type)){assert.equal(pending.length,0,'observer requires flush: '+e.type);if(e.type==='close'){assert.ok(settled&&debt===0,'close requires terminal settlement');closed=true;}continue;}
  assert.ok(running,'event outside resume');
  if(e.type==='rearm'){assert.ok(rearmRequired,'rearm after PIO only');assert.equal(pending.length,0,'PIO rearm requires flush');assert.equal(e.debt,0,'PIO clears preceding debt');debt=0;deadline=e.deadline;horizon=quantumHorizon(debt,deadline);due=false;rearmRequired=false;continue;}
  if(e.type==='attempt'){assert.ok(!due&&!stopped&&sliceN<maxNative&&sliceQ<maxQuanta,'work beyond chip horizon or budget');integer(e.id,'attempt id');assert.ok(!attempts.has(e.id),'attempt identity reused');attempts.add(e.id);assert.equal(attempt,null,'previous attempt incomplete');attempt=e.id;rep=false;fault=false;ordinaryCharged=false;continue;}
  if(e.type==='rep'){assert.ok(attempt!==null&&!fault&&!due&&!stopped,'REP eligibility');rep=true;repReady=true;continue;}
  if(e.type==='fault'){fault=true;}
  if(e.type==='Q'){assert.ok(!rearmRequired,'PIO requires debt settlement/rearm before current Q');
   assert.ok(attempt!==null&&!fault&&!due&&!stopped,'fault or due earns no successful quantum');
   assert.ok(e.kind===0||e.kind===1,'quantum kind');assert.ok(e.kind!==0||(!rep&&!ordinaryCharged),'final REP must not double charge');assert.ok(e.kind!==1||(rep&&repReady),'REP quantum requires successful element');if(e.kind===1)repReady=false;if(e.kind===0)ordinaryCharged=true;
   assert.ok(q<totalQuanta&&sliceQ<maxQuanta,'Q cap before charge');const charge=successfulCharge(cycle,debt);
   q++;sliceQ++;debt=charge.debt;cycle=charge.cycle;horizon--;due=horizon===0;pending.push({type:'Q',kind:e.kind,n,q,cycle,debt,due});
  }else if(e.type==='N'){
   assert.ok(attempt!==null,'tick requires attempt');integer(e.count,'native count');assert.equal(e.count,1,'current profile logical tick count');assert.ok(e.count>0&&n<=totalNative-e.count&&sliceN<=maxNative-e.count,'N cap before charge');n+=e.count;sliceN+=e.count;pending.push({type:'N',count:e.count,n,q,cycle,debt,due});if(rep){assert.equal(typeof e.completesAttempt,'boolean','REP tick requires completion classification');if(e.completesAttempt)attempt=null;}else attempt=null;
  }else if(e.type==='flush'){
   assert.deepEqual(e.events,pending,'ordered complete event tape');flushed.push(...pending);pending=[];
  }else if(barriers.has(e.type)){
   assert.equal(pending.length,0,'observer requires flush: '+e.type);
   assert.ok(e.type!=='stage-irq','stage IRQ only outside resume');if(e.type==='return'){assert.ok(!rearmRequired,'PIO must rearm before return');assert.ok(attempt===null||(rep&&!fault),'incomplete ordinary/fault attempt at return');}if(e.type==='pio')rearmRequired=true;if(['hlt','irq'].includes(e.type))stopped=true;if(e.type==='return'){running=false;attempt=null;}
  }else if(!['attempt','rep'].includes(e.type))assert.fail('unknown event type '+e.type);
 }
 assert.ok(!running&&!pending.length&&closed,'missing final flush/return/settle/close');
 return {nativeTicks:n,successfulQuanta:q,boardCycles:cycle,debt,logicalEvents:flushed};
}
