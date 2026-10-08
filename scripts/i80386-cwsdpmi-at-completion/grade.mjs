// Pure grading policy. The driver, not these caller-supplied values, must
// authenticate synchronous guest observations and retained FAT bytes.
import {SUCCESS,EXIT_OK,RETURN,FIRST,SECOND} from '../i80386-cwsdpmi-qemu-owned/media.mjs';
import {encode} from '../i80386-dos32a-owned/keyboard.mjs';

const names=['output','ok','fail','returned'];
const exact=(value,text)=>Buffer.isBuffer(value)&&
  value.equals(Buffer.from(text+'\r\n','ascii'));
const rowsOk=rows=>Array.isArray(rows)&&rows.length===25&&
  rows.every(row=>typeof row==='string'&&row.length<=80);
const last=rows=>rowsOk(rows)?[...rows].reverse().find(row=>row.trim())?.trim()??'':'';
export const currentPrompt=rows=>/^[A-Z]:\\>$/.test(last(rows));
const scans=text=>encode(text+'\r').map(event=>event.scan);
export const FIRST_SCANS=Object.freeze(scans(FIRST));
export const SECOND_SCANS=Object.freeze(scans(SECOND));

function acceptedAt(events,needle,after=-1){
  if(!Array.isArray(events)||!Array.isArray(needle)||!needle.length)return null;
  const included=events.filter(event=>event&&event.accepted===true&&
    Number.isSafeInteger(event.step)&&Number.isInteger(event.scan)&&
    event.scan>=0&&event.scan<=255&&event.step>after);
  for(let at=0;at<=included.length-needle.length;at++){
    if(needle.every((scan,index)=>included[at+index].scan===scan&&
       (index===0||included[at+index].step>included[at+index-1].step)))
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
export function gradeBatch({initial,files,rows,accepted,boundStep,step,pendingKeys}){
  const firstEnd=acceptedAt(accepted,FIRST_SCANS);
  const checks={
    initialAbsent:!!initial&&names.every(name=>Object.hasOwn(initial,name)&&initial[name]===null),
    loadedCut:Number.isSafeInteger(boundStep)&&boundStep>=0,
    firstInput:firstEnd!==null&&firstEnd<=boundStep,
    order:Number.isSafeInteger(step)&&step>boundStep,
    exactFiles:exactFiles(files,false),
    batchVisible:rowsOk(rows)&&rows.some(row=>row.trim()==='BW-DPMI-BATCH-DONE'),
    currentPrompt:currentPrompt(rows),
    noPending:pendingKeys===0,
  };
  return {checks,passed:Object.values(checks).every(Boolean),step,firstEnd};
}
export function gradeReturn({batch,files,accepted,secondQueuedStep,
  firstRows,firstStep,secondRows,secondStep,pendingKeys}){
  const secondEnd=acceptedAt(accepted,SECOND_SCANS,batch?.step??Number.MAX_SAFE_INTEGER);
  const checks={
    batch:batch?.passed===true,
    commandQueued:Number.isSafeInteger(secondQueuedStep)&&
      secondQueuedStep>batch?.step,
    secondInput:secondEnd!==null&&secondEnd>=secondQueuedStep,
    exactFiles:exactFiles(files,true),
    stablePrompt:currentPrompt(firstRows)&&currentPrompt(secondRows)&&
      Number.isSafeInteger(firstStep)&&Number.isSafeInteger(secondStep)&&
      firstStep>=secondEnd&&secondStep-firstStep>=100000,
    noPending:pendingKeys===0,
  };
  return {checks,passed:Object.values(checks).every(Boolean),secondEnd};
}
