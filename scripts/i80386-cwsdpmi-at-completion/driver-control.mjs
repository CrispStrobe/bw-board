import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {SUCCESS,EXIT_OK,RETURN} from '../i80386-cwsdpmi-qemu-owned/media.mjs';
import {FIRST_SCANS,SECOND_SCANS} from './grade.mjs';
import {runScenario} from './driver.mjs';

const bytes=text=>Buffer.from(text+'\r\n','ascii');
const sha=buffer=>createHash('sha256').update(buffer).digest('hex');
const absent={output:null,ok:null,fail:null,returned:null};
const cut={...absent,output:Buffer.alloc(0)};
const batch={output:bytes(SUCCESS),ok:bytes(EXIT_OK),fail:null,returned:null};
const returned={...batch,returned:bytes(RETURN)};
const screen=(last,marker='')=>[...Array(23).fill(''),marker,last];
const options={steps:100300,wallMs:200000,screenEvery:10,diskEvery:10,
  progressEvery:20000,stableSteps:100000,partialFatSteps:100,
  partialFatAttempts:2,keyAttempts:200};

function fixture({initialFiles=absent,cutFiles=cut,bindFailure=false,transient=false,
  lateTransient=false,permanent=false,staleReturnPrompt=false,
  wrongBatch=false,unstableBatch=false,partialOutput=false,
  noBatchMarker=false,alwaysTransient=false,fastVerify=false,
  returnRebusy=false,interruptSnapshot=false,markerAt=60,
  finalAccountingFailure=false}={}){
  let step=0,reads=0,bound=false,offered=0,verified=false,
    bindCalls=0,firstAccepted=0,secondAccepted=0;
  const reports=[];
  const machine={cpu:{eip:0x7c00,cycles:0,shutdown:false},cycles:0};
  const ports={
    machine,
    now:()=>step,cpuUsage:prior=>{
      if(prior&&finalAccountingFailure)throw new Error('accounting failed');
      return prior?{user:200,system:20}:{user:0,system:0};
    },
    state:()=>({eip:machine.cpu.eip,cycles:machine.cpu.cycles,
      machineCycles:machine.cycles,shutdown:machine.cpu.shutdown}),
    progress:report=>reports.push({stage:report.stage,step:report.steps}),
    readFiles:()=>{
      reads++;
      if(reads===1)return {files:initialFiles,imageSha256:'0'.repeat(64)};
      if(!bound)return {files:cutFiles,imageSha256:'1'.repeat(64)};
      if(permanent&&reads===3)throw new Error('FAT image geometry mismatch');
      if(alwaysTransient)throw new Error('FAT chain truncated');
      if(transient&&reads===3)throw new Error('FAT chain truncated');
      if(lateTransient&&reads===4)throw new Error('FAT chain truncated');
      if(interruptSnapshot&&reads===4)
        return {files:cut,imageSha256:String(reads).padStart(64,'0')};
      return {files:verified?returned:(partialOutput?{...cut,output:Buffer.from('partial')}:
        wrongBatch||unstableBatch&&reads===4?{...batch,ok:bytes('WRONG')}:batch),
        imageSha256:String(reads).padStart(64,'0')};
    },
    screen:()=>{
      if(step<10)return screen('Do you want to proceed?');
      if(!bound)return screen('A:\\>');
      if(!verified&&secondAccepted>0&&!staleReturnPrompt)return screen('VERIFY TYPING');
      if(!verified)return step<markerAt||noBatchMarker?
        screen('RUNNING'):screen('C:\\>','BW-DPMI-BATCH-DONE');
      if(returnRebusy&&step>=130&&step<140)return screen('VERIFY RUNNING AGAIN');
      if(fastVerify)return screen('C:\\>');
      return staleReturnPrompt?screen('C:\\>'):
        (step<120?screen('VERIFY RUNNING'):screen('C:\\>'));
    },
    candidate:()=>step>=40,
    bind:()=>{bindCalls++;if(bindFailure){const error=new Error('loaded text differs at byte 23472');
      error.textMismatch={changedBytes:1};throw error;}
      bound=true;machine.cpu.eip=0x125a0;
      return {schema:'bw.cwsdpmi-owned.code-at-entry.v1',
        strictWholeText:'FAIL',ownedCodeAtEntry:'PASS',binding:null,
        textMismatch:{changedBytes:1},before:{},after:{}};},
    ready:()=>true,
    offer:scan=>{offered++;
      if(offered>4&&firstAccepted<FIRST_SCANS.length)firstAccepted++;
      else if(bound&&firstAccepted===FIRST_SCANS.length){
        secondAccepted++;if(secondAccepted===SECOND_SCANS.length)verified=true;
      }
      return true;
    },
    step:()=>{step++;machine.cpu.cycles+=6;machine.cycles+=6;},
  };
  const result=runScenario(ports,options);
  return {result,bindCalls,reports,firstAccepted,secondAccepted,reads};
}

const passed=fixture();
assert.equal(passed.result.passed,true,JSON.stringify(passed.result));
assert.equal(passed.result.firstFailure,null);
assert.equal(passed.bindCalls,1);
assert.equal(passed.result.batchGrade.passed,true);
assert.equal(passed.result.returnGrade.passed,true);
assert.equal(passed.result.loaded.strictWholeText,'FAIL');
assert.equal(passed.result.loaded.ownedCodeAtEntry,'PASS');
assert.equal(passed.result.guestFiles.output.text,SUCCESS+'\r\n');
assert.equal(passed.result.guestFiles.returned.text,RETURN+'\r\n');
assert(passed.result.batchPair.second.step-passed.result.batchPair.first.step>=options.diskEvery);
assert(passed.result.returnPair.second.step-passed.result.returnPair.first.step>=options.diskEvery);
for(const pair of [passed.result.batchPair,passed.result.returnPair]){
  assert.equal(pair.first.key,pair.second.key);
  assert.deepEqual(pair.first.files,pair.second.files);
  assert.match(pair.first.imageSha256,/^[0-9]{64}$/);
  assert.match(pair.second.imageSha256,/^[0-9]{64}$/);
}
assert.deepEqual(passed.result.diskMilestones.map(value=>value.kind),
  ['batch-first','batch-second','return-first','return-second']);
assert.deepEqual(passed.result.diskMilestones.map(value=>value.step),
  [passed.result.batchPair.first.step,passed.result.batchPair.second.step,
   passed.result.returnPair.first.step,passed.result.returnPair.second.step]);
assert.equal(passed.result.batchPair.first.files.output.sha256,sha(bytes(SUCCESS)));
assert.equal(passed.result.batchPair.first.files.ok.sha256,sha(bytes(EXIT_OK)));
assert.equal(passed.result.returnPair.second.files.returned.sha256,sha(bytes(RETURN)));
const milestones=passed.result.screenMilestones;
assert(milestones.firstQueued.step<milestones.batchPrompt.step);
assert(milestones.batchPrompt.step<=milestones.verifyQueued.step);
assert(milestones.verifyQueued.step<=milestones.firstNonPromptAfterVerifyQueue.step);
assert(milestones.firstNonPromptAfterVerifyQueue.step<milestones.verifyPrompts.first.step);
assert(milestones.verifyPrompts.first.step<milestones.verifyPrompts.second.step);
assert(passed.reports.some(value=>value.stage==='protected-main-candidate'));
assert(passed.reports.some(value=>value.stage==='waiting-batch'));
assert(passed.reports.some(value=>value.stage==='waiting-return'));

const stale=fixture({cutFiles:{...cut,output:bytes(SUCCESS)}});
assert.equal(stale.result.passed,false);
assert.match(stale.result.firstFailure,/already written at main cut/);
assert.equal(stale.bindCalls,0);
assert.deepEqual(stale.result.keyboard.requested.map(value=>value.command),
  ['c:\\rundp.bat']);
const early=fixture({initialFiles:{...absent,ok:bytes(EXIT_OK)}});
assert.equal(early.result.passed,false);
assert.match(early.result.firstFailure,/initial result files present/);
assert.equal(early.bindCalls,0);
const strict=fixture({bindFailure:true});
assert.equal(strict.result.passed,false);
assert.match(strict.result.firstFailure,/loaded text differs/);
assert.equal(strict.result.textMismatch.changedBytes,1);
assert.equal(strict.secondAccepted,0);
const secondary=fixture({bindFailure:true,finalAccountingFailure:true});
assert.match(secondary.result.firstFailure,/loaded text differs/);
assert(secondary.result.secondaryFailures.some(value=>/final accounting/.test(value)));
const malformed=fixture({permanent:true});
assert.equal(malformed.result.passed,false);
assert.match(malformed.result.firstFailure,/geometry mismatch/);
const late=fixture({lateTransient:true});
assert.equal(late.result.passed,false);
assert.match(late.result.firstFailure,/FAT chain truncated/);
const partial=fixture({transient:true});
assert.equal(partial.result.passed,true,JSON.stringify({failure:partial.result.firstFailure,
  stage:partial.result.stage,batch:partial.result.batchGrade,
  returns:partial.result.returnGrade,partial:partial.result.partialFat,
  keyboard:partial.result.keyboard&&{
    first:partial.result.keyboard.firstCommandAccepted,
    second:partial.result.keyboard.secondCommandAccepted}}));
assert.equal(partial.result.partialFat.attempts,1);
const wrong=fixture({wrongBatch:true});
assert.equal(wrong.result.passed,false);
assert.match(wrong.result.firstFailure,/settled batch has wrong/);
const unstable=fixture({unstableBatch:true});
assert.equal(unstable.result.passed,false);
assert.match(unstable.result.firstFailure,/settled batch has wrong/);
const interrupted=fixture({interruptSnapshot:true,markerAt:80});
assert.equal(interrupted.result.passed,true);
assert(interrupted.result.batchGrade.step>=80);
assert(interrupted.result.batchPair.second.step>=80);
const unfinished=fixture({partialOutput:true,noBatchMarker:true});
assert.equal(unfinished.result.passed,false);
assert.match(unfinished.result.firstFailure,/incomplete batch files exceeded bound/);
const chain=fixture({alwaysTransient:true,noBatchMarker:true});
assert.equal(chain.result.passed,false);
assert.match(chain.result.firstFailure,/FAT chain truncated/);
const oldPrompt=fixture({staleReturnPrompt:true});
assert.equal(oldPrompt.result.passed,false);
assert.equal(oldPrompt.result.returnGrade,undefined);
const quick=fixture({fastVerify:true});
assert.equal(quick.result.passed,true);
assert.equal(quick.result.promptEpoch.nonPromptSinceSecondQueue,true);
const rebound=fixture({returnRebusy:true});
assert.equal(rebound.result.passed,true);
assert(rebound.result.promptEpoch.firstStep>=140);
console.log('CWSDPMI AT completion driver ordering controls PASS');
