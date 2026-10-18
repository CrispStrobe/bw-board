import {gradePfOutcome} from '../i80386-cwsdpmi-0501-pf-connected/grade.mjs';
const int=(v,lo,hi)=>Number.isSafeInteger(v)&&v>=lo&&v<=hi;
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const keys=(v,names)=>v&&Object.getPrototypeOf(v)===Object.prototype&&
  Object.keys(v).length===names.length&&names.every(k=>Object.hasOwn(v,k));
const bounded=(value,depth=0)=>{
  if(depth>24)return false;
  if(value===null||typeof value==='boolean')return true;
  if(typeof value==='number')return Number.isSafeInteger(value);
  if(typeof value==='string')return value.length<=400;
  if(Array.isArray(value))return value.length<=128&&value.every(v=>bounded(v,depth+1));
  return value&&Object.getPrototypeOf(value)===Object.prototype&&
    Object.keys(value).length<=64&&Object.values(value).every(v=>bounded(v,depth+1));
};
const contextKeys=['cs','eip','ss','esp','cr3','trSelector','trType','trBase','trLimit',
  'trPresent','vm86','cpl','nt','protectedMode'];
const context=(v,saved=false)=>keys(v,[...contextKeys,...(saved?['savedEip']:[])])&&
  ['cs','ss','trSelector'].every(k=>int(v[k],0,65535))&&
  ['eip','esp','cr3','trBase','trLimit',...(saved?['savedEip']:[])].every(k=>int(v[k],0,0xffffffff))&&
  int(v.trType,0,15)&&int(v.cpl,0,3)&&
  ['trPresent','vm86','nt','protectedMode'].every(k=>typeof v[k]==='boolean');
const cacheKeys=['base','limit','default32','present','code','readable','writable','dpl',
  'conforming','access','address','expandDown','null'];
const cache=v=>keys(v,cacheKeys)&&cacheKeys.every(k=>v[k]===null||
  (['base','limit','address'].includes(k)?int(v[k],0,0xffffffff):
   k==='access'?int(v[k],0,255):k==='dpl'?int(v[k],0,3):typeof v[k]==='boolean'))&&
  ['base','limit','default32','present','code'].every(k=>v[k]!==null);
const mode=v=>keys(v,[...contextKeys,'rawCr0','rawFlags','retainedRealCs','codeCache','stackCache','mode'])&&
  context(Object.fromEntries(contextKeys.map(k=>[k,v[k]])))&&
  int(v.rawCr0,0,0xffffffff)&&int(v.rawFlags,0,0xffffffff)&&typeof v.retainedRealCs==='boolean'&&
  cache(v.codeCache)&&cache(v.stackCache)&&
  v.protectedMode===!!(v.rawCr0&1)&&v.vm86===!!((v.rawCr0&1)&&(v.rawFlags&0x20000))&&
  v.nt===!!(v.rawFlags&0x4000)&&
  v.cpl===(v.vm86?3:(!v.protectedMode||v.retainedRealCs?0:v.cs&3))&&
  v.mode===(!v.protectedMode?'pe-clear':v.vm86?'vm86':'protected');
const fault=v=>keys(v,['available'])?v.available===false:
  keys(v,['available','vector','errorCodePresent'])&&v.available===true&&
  int(v.vector,0,255)&&typeof v.errorCodePresent==='boolean';
const operation=v=>v===null||
  (keys(v,['kind'])&&v.kind==='task-core-return')||
  (keys(v,['kind','source','instructionStart','beforeCr0','afterCr0'])&&
   v.kind==='decoded-mov-cr0'&&v.source==='0f-22-cr0'&&
   ['instructionStart','beforeCr0','afterCr0'].every(k=>int(v[k],0,0xffffffff)))||
  (keys(v,['kind','source','instructionStart','operandWidth','selector','target','afterCs','after'])&&
   v.kind==='decoded-direct-far-cs-reload'&&['ea-immediate','ff-far-indirect'].includes(v.source)&&
   [16,32].includes(v.operandWidth)&&int(v.selector,0,65535)&&int(v.afterCs,0,65535)&&
   int(v.target,0,0xffffffff)&&int(v.instructionStart,0,0xffffffff)&&mode(v.after));
function sourceRecords(o){
 const event=v=>{
  if(!v||typeof v.enclosingStepCommitted!=='boolean')return false;
  if(v.kind==='source-interrupt')return keys(v,['kind','step','vector','nmi','before','after',
    'sourceOperationReturned','enclosingStepCommitted'])&&int(v.step,0,o.attemptedSteps)&&
    mode(v.before)&&mode(v.after)&&int(v.vector,0,255)&&typeof v.nmi==='boolean'&&
    typeof v.sourceOperationReturned==='boolean'&&v.enclosingStepCommitted===false;
  const extra=v.kind==='decoded-iret-intent'?['instructionStart','width']:
    v.kind==='decoded-far-cs-transfer'?['selector','target','operandWidth']:null;
  if(extra===null||!int(v.step,1,o.attemptedSteps)||!mode(v.source))return false;
  const operationFields=v.kind==='decoded-iret-intent'?
    int(v.instructionStart,0,0xffffffff)&&[16,32].includes(v.width):
    int(v.selector,0,65535)&&int(v.target,0,0xffffffff)&&[16,32].includes(v.operandWidth);
  const settled=Object.hasOwn(v,'before')||Object.hasOwn(v,'after');
  return operationFields&&keys(v,['kind','step','source',...extra,
    ...(settled?['before','after']:[]),'enclosingStepCommitted'])&&
    (settled?mode(v.before)&&mode(v.after)&&same(v.source,v.before):v.enclosingStepCommitted===false);
 };
 const transition=(v,committed)=>keys(v,['step','kind','selector','source','outcome',
    ...(committed?['post']:Object.hasOwn(v??{},'fault')?['fault']:[]),'enclosingStepCommitted'])&&
    int(v.step,1,committed?o.committedSteps:o.committedSteps+1)&&
    ['call','jmp','iret'].includes(v.kind)&&int(v.selector,0,65535)&&context(v.source,true)&&
    v.enclosingStepCommitted===committed&&
    (committed?v.outcome==='core-return'&&context(v.post):
     ['not-observed','core-return','marker-accessor-refused','fault-with-taskCommitted','fault-without-taskCommitted','unclassified-throw','outcome-observer-failure'].includes(v.outcome)&&(!Object.hasOwn(v,'fault')||fault(v.fault)));
 const delivery=v=>{
  if(!v||typeof v.enclosingStepCommitted!=='boolean'||
     !int(v.step,1,o.committedSteps+(v.enclosingStepCommitted?0:1)))return false;
  if(Object.hasOwn(v,'kind'))return ['cpu-fault','unsupported-cpu','unclassified-throw'].includes(v.kind)&&
   keys(v,['kind','step','enclosingStepCommitted',...(Object.hasOwn(v,'fault')?['fault']:[])])&&
   v.enclosingStepCommitted===false&&(!Object.hasOwn(v,'fault')||fault(v.fault));
  return keys(v,['step','vector','returnEip','software','external','errorCodePresent','enclosingStepCommitted',
    ...(Object.hasOwn(v,'sourceOperationReturned')?['sourceOperationReturned']:[])])&&
    int(v.vector,0,255)&&int(v.returnEip,0,0xffffffff)&&
    ['software','external','errorCodePresent'].every(k=>typeof v[k]==='boolean')&&
    (!Object.hasOwn(v,'sourceOperationReturned')||typeof v.sourceOperationReturned==='boolean'&&v.enclosingStepCommitted===false);
 };
 const modeRecord=(v,committed,refusal=false)=>keys(v,['step','before','after','operation','enclosingStepCommitted'])&&
   int(v.step,refusal?0:1,refusal?o.attemptedSteps:o.committedSteps+(committed?0:1))&&mode(v.before)&&mode(v.after)&&
   operation(v.operation)&&typeof v.enclosingStepCommitted==='boolean'&&
   (refusal?v.operation===null:v.enclosingStepCommitted===committed);
 return o.events.every(event)&&o.transitions.every(v=>transition(v,true))&&
  o.uncommittedTransitions.every(v=>transition(v,false))&&o.deliveries.every(delivery)&&
  o.modeChanges.every(v=>modeRecord(v,true)&&v.operation!==null)&&
  o.uncommittedModes.every(v=>modeRecord(v,false))&&
  (o.modeRefusal===null||modeRecord(o.modeRefusal,false,true));
}
const fail=reason=>Object.freeze({schema:'bw.cwsdpmi-0501-post-pf-connected.grade.v1',
  observationConsistent:false,firstFailure:reason,frameReturnQualified:false});

// Historical PF/task objects join diagnostic facts only. They never mint the
// private post-PF token or authorize frame return, repair, retry or service.
export function gradePostPfConnected({finiteClient,strict,taskMode,pfOutcome,pfGrade,postPf}){
  try{
    const recomputed=gradePfOutcome({finiteClient,strict,taskMode,pfOutcome});
    if(!same(recomputed,pfGrade))return fail('historical PF grade differs from raw facts');
    if(finiteClient?.passed!==false||strict?.strict?.phase!=='invalid'||
       strict.strict.failure!=='task-switch-during-owned-frame'||strict.strict.returned!==null||
       pfGrade?.pfCallConsistent!==true||pfGrade.outcome!=='returned'||pfGrade.postShutdown!==false||
       pfGrade.frameReturnQualified!==false||pfOutcome?.frameReturnQualified!==false)
      return fail('held strict/PF premise refused');
    if(!keys(postPf,['arm','receipt','status','lastStatus','observation','exceptions','firstFailure','frameReturnQualified'])||
       postPf.frameReturnQualified!==false||postPf.firstFailure!==null||
       !Array.isArray(postPf.exceptions)||postPf.exceptions.length!==0)
      return fail('post-PF adapter boundary incomplete');
    const {arm,receipt,status,observation:o}=postPf;
    if(!keys(arm,['attempted','admitted','initial','prePostBoardCalls','preContinuationMachineSteps','frameReturnQualified'])||
       arm.attempted!==true||arm.admitted!==true||arm.frameReturnQualified!==false||
       arm.initial?.phase!=='observing'||arm.initial.firstFailure!==null||
       arm.initial.attemptedSteps!==0||arm.initial.committedSteps!==0||
       arm.prePostBoardCalls!==pfOutcome.continuationAttemptedMachineSteps||
       arm.preContinuationMachineSteps!==pfOutcome.arm.preContinuationMachineSteps)
      return fail('private handoff receipt refused');
    if(!keys(receipt,['boardCalls','cpuAttempts','committedSteps','zeroAttemptCalls','maxBoardCalls','wallMs','elapsedMs','pendingStep','firstFailure'])||
       receipt.firstFailure!==null||receipt.pendingStep!==null||!int(receipt.maxBoardCalls,1,100_000)||
       !int(receipt.wallMs,1,120_000)||!int(receipt.elapsedMs,0,receipt.wallMs)||
       !int(receipt.boardCalls,1,receipt.maxBoardCalls)||
       !int(receipt.cpuAttempts,0,100_000)||!int(receipt.committedSteps,0,receipt.cpuAttempts)||
       !int(receipt.zeroAttemptCalls,0,receipt.boardCalls)||
       receipt.boardCalls!==receipt.cpuAttempts+receipt.zeroAttemptCalls)
      return fail('post-PF bounded counter receipt refused');
    if(!keys(o,['schema','phase','firstFailure','attemptedSteps','committedSteps','cookie',
       'originalOutgoing','initialFault','transitions','uncommittedTransitions','deliveries','events',
       'modeChanges','uncommittedModes','modeRefusal','resumeCandidate','truncated','frameReturnQualified'])||
       o.schema!=='bw.i80386-owned-0501.post-pf-continuation.v1'||
       !['candidate','invalid'].includes(o.phase)||o.frameReturnQualified!==false||o.truncated!==false||
       !bounded(o)||o.attemptedSteps!==receipt.cpuAttempts||o.committedSteps!==receipt.committedSteps||
       !same(o.initialFault,pfOutcome.observation.fault)||
       !same(o.originalOutgoing,taskMode.observation.transitions[0])||
       !same(o.cookie,taskMode.observation.cookie)||
       !keys(status,['phase','firstFailure','attemptedSteps','committedSteps'])||
       status.phase!==o.phase||status.firstFailure!==o.firstFailure||
       status.attemptedSteps!==o.attemptedSteps||status.committedSteps!==o.committedSteps||
       !same(postPf.lastStatus,status))return fail('same-session source post-PF observation refused');
    if((o.phase==='candidate'&&(o.firstFailure!==null||!o.resumeCandidate))||
       (o.phase==='invalid'&&(typeof o.firstFailure!=='string'||!o.firstFailure)))
      return fail('source terminal refusal/candidate absent');
    for(const [name,cap] of [['transitions',16],['uncommittedTransitions',16],['deliveries',32],
        ['events',64],['modeChanges',32],['uncommittedModes',32]])
      if(!Array.isArray(o[name])||o[name].length>cap)return fail('source post-PF record cap');
    if(!sourceRecords(o))return fail('closed source post-PF record shape refused');
    if(o.phase==='candidate'){
      const candidate=o.resumeCandidate,last=o.transitions.at(-1),saved=o.originalOutgoing.source;
      if(!keys(candidate,['step','transition','originalTr','savedContinuation','handlerContext','taskContext'])||
         !['originalTr','savedContinuation','handlerContext','taskContext'].every(k=>candidate[k]===true)||
         !int(candidate.step,1,o.committedSteps)||candidate.transition!==o.transitions.length||
         last?.step!==candidate.step||last.enclosingStepCommitted!==true||last.outcome!=='core-return'||
         last.post?.trSelector!==o.cookie.trSelector||last.post.trType!==o.cookie.trType||
         last.post.trBase!==o.cookie.trBase||last.post.trLimit!==o.cookie.trLimit||last.post.trPresent!==true||
         last.post.cs!==saved.cs||last.post.eip!==saved.savedEip||last.post.ss!==saved.ss||
         last.post.esp!==saved.esp||last.post.cr3!==saved.cr3||last.post.cs!==o.cookie.entry.handlerCs||
         last.post.ss!==o.cookie.entry.handlerSs||last.post.cpl!==3||last.post.protectedMode!==true||last.post.vm86!==false)
        return fail('source resumption candidate join refused');
    }
    return Object.freeze({schema:'bw.cwsdpmi-0501-post-pf-connected.grade.v1',
      observationConsistent:true,firstFailure:null,sourcePhase:o.phase,
      sourceFirstFailure:o.firstFailure,boardCalls:receipt.boardCalls,
      attemptedSteps:o.attemptedSteps,committedSteps:o.committedSteps,
      zeroAttemptCalls:receipt.zeroAttemptCalls,irqBoundaryEvents:o.events.filter(e=>e.kind==='source-interrupt').length,
      decodedIretIntents:o.events.filter(e=>e.kind==='decoded-iret-intent').length,
      resumptionCandidate:o.phase==='candidate',frameReturnQualified:false});
  }catch{return fail('post-PF grade source shape unavailable');}
}
