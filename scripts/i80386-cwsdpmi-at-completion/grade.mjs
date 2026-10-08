// Pure grading policy. The driver, not these caller-supplied values, must
// authenticate synchronous guest observations and retained FAT bytes.
import {SUCCESS,EXIT_OK,RETURN,FIRST,SECOND} from '../i80386-cwsdpmi-qemu-owned/media.mjs';
import {encode} from '../i80386-dos32a-owned/keyboard.mjs';

const names=['output','ok','fail','returned'];
const issuedBatches=new WeakMap();
// DOS command redirection may create/truncate DPOUT before CLIENT reaches main.
const cutReady=files=>!!files&&typeof files==='object'&&
  Object.hasOwn(files,'output')&&
  (files.output===null||(Buffer.isBuffer(files.output)&&files.output.length===0))&&
  ['ok','fail','returned'].every(name=>Object.hasOwn(files,name)&&files[name]===null);
const exact=(value,text)=>Buffer.isBuffer(value)&&
  value.equals(Buffer.from(text+'\r\n','ascii'));
const rowsOk=rows=>Array.isArray(rows)&&rows.length===25&&
  rows.every(row=>typeof row==='string'&&row.length<=80);
const last=rows=>rowsOk(rows)?[...rows].reverse().find(row=>row.trim())?.trim()??'':'';
export const currentPrompt=rows=>/^[A-Z]:\\>$/.test(last(rows));
const scans=text=>encode(text+'\r').map(event=>event.scan);
export const FIRST_SCANS=Object.freeze(scans(FIRST));
export const SECOND_SCANS=Object.freeze(scans(SECOND));

function offeredTape(events){
  if(!Array.isArray(events)||events.length>8192)return null;
  const offered=[];
  let prior=-1;
  for(let i=0;i<events.length;i++){
    const entry=Object.getOwnPropertyDescriptor(events,String(i));
    if(!entry||!Object.hasOwn(entry,'value')||!entry.value||
       typeof entry.value!=='object')return null;
    const fields=Object.getOwnPropertyDescriptors(entry.value);
    const value=key=>Object.hasOwn(fields[key]??{},'value')?fields[key].value:undefined;
    const step=value('step'),scan=value('scan'),accepted=value('accepted');
    if(!Number.isSafeInteger(step)||step<=prior||!Number.isInteger(scan)||
       scan<0||scan>255||typeof accepted!=='boolean')return null;
    offered.push({step,scan,accepted});
    prior=step;
  }
  return offered;
}
function acceptedAt(offered,needle,after=-1){
  if(!offered||!Array.isArray(needle)||!needle.length)return null;
  const included=offered.filter(event=>event.accepted&&event.step>after);
  for(let at=0;at<=included.length-needle.length;at++){
    if(needle.every((scan,index)=>included[at+index].scan===scan))
      return included[at+needle.length-1].step;
  }
  return null;
}
function exactFiles(files,returned){
  if(!files||typeof files!=='object'||!names.every(name=>
    Object.hasOwn(files,name)))return false;
  return exact(files.output,SUCCESS)&&exact(files.ok,EXIT_OK)&&
    files.fail===null&&(returned?exact(files.returned,RETURN):files.returned===null);
}
export function gradeBatch({session,initial,cutFiles,files,rows,accepted,boundStep,step,pendingKeys}){
  const tape=offeredTape(accepted),firstEnd=acceptedAt(tape,FIRST_SCANS);
  const checks={
    session:!!session&&typeof session==='object',
    acceptedTape:tape!==null,
    tapeBeforeBatch:tape!==null&&Number.isSafeInteger(step)&&
      tape.every(event=>event.step<=step),
    initialAbsent:!!initial&&names.every(name=>Object.hasOwn(initial,name)&&initial[name]===null),
    cutUnwritten:cutReady(cutFiles),
    loadedCut:Number.isSafeInteger(boundStep)&&boundStep>=0,
    firstInput:firstEnd!==null&&firstEnd<=boundStep,
    order:Number.isSafeInteger(step)&&step>boundStep,
    exactFiles:exactFiles(files,false),
    batchVisible:rowsOk(rows)&&rows.some(row=>row.trim()==='BW-DPMI-BATCH-DONE'),
    currentPrompt:currentPrompt(rows),
    noPending:pendingKeys===0,
  };
  const result=Object.freeze({checks:Object.freeze(checks),
    passed:Object.values(checks).every(Boolean),step,firstEnd});
  issuedBatches.set(result,{session,passed:result.passed,step,tape});
  return result;
}
export function gradeReturn({session,batch,files,accepted,secondQueuedStep,
  firstRows,firstStep,secondRows,secondStep,pendingKeys}){
  const held=issuedBatches.get(batch),tape=offeredTape(accepted);
  const queued=Number.isSafeInteger(secondQueuedStep)&&secondQueuedStep>held?.step;
  const secondEnd=acceptedAt(tape,SECOND_SCANS,queued?secondQueuedStep-1:Number.MAX_SAFE_INTEGER);
  const prefix=!!held?.tape&&!!tape&&tape.length>=held.tape.length&&
    held.tape.every((event,index)=>event.step===tape[index].step&&
      event.scan===tape[index].scan&&event.accepted===tape[index].accepted);
  const checks={
    batch:!!held&&held.session===session&&held.passed===true,
    acceptedTape:tape!==null,
    tapePrefix:prefix,
    newEventsAfterBatch:prefix&&tape.slice(held.tape.length).every(event=>event.step>held.step),
    commandQueued:queued,
    secondInput:secondEnd!==null&&secondEnd>=secondQueuedStep,
    exactFiles:exactFiles(files,true),
    stablePrompt:currentPrompt(firstRows)&&currentPrompt(secondRows)&&
      Number.isSafeInteger(firstStep)&&Number.isSafeInteger(secondStep)&&
      firstStep>=secondEnd&&secondStep-firstStep>=100000,
    noPending:pendingKeys===0,
  };
  return {checks,passed:Object.values(checks).every(Boolean),secondEnd};
}
