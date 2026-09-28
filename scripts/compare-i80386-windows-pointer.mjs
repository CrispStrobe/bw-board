#!/usr/bin/env node
/** Media-neutral comparator. Reports, checkpoint frames and plan stay in private storage. */
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {renderObservedWindowsVga480} from './lib/i80386-windows-vga-480-frame.mjs';
import {comparePointerApplicationFrames,readPointerPpm,validatePointerPair,
  validatePointerClickDifference,validatePointerGuestDelivery,
  verifyPointerParking,pointerCropSha256} from
  './lib/i80386-windows-pointer-feedback.mjs';

const [controlPath,candidatePath,planPath]=process.argv.slice(2);
if(!controlPath||!candidatePath||!planPath||process.argv.length!==5)
  throw new Error('usage: compare-i80386-windows-pointer.mjs CONTROL.json CANDIDATE.json PLAN.json');
const readJson=file=>JSON.parse(readFileSync(file,'utf8'));
const control=readJson(controlPath),candidate=readJson(candidatePath),plan=readJson(planPath);
const errors=[...validatePointerPair(control,candidate),
  ...validatePointerClickDifference(control,candidate),
  ...validatePointerGuestDelivery(control).map(error=>`control: ${error}`),
  ...validatePointerGuestDelivery(candidate).map(error=>`candidate: ${error}`)];
for(const [name,report] of [['control',control],['candidate',candidate]]){
  if(report.schema!=='bw.i80386-windows-enhanced-probe.v1'||
      !/^[0-9a-f]{40}$/.test(report.executionRevision)||
      !report.sourceSha256||!Object.keys(report.sourceSha256).length)
    errors.push(`${name} lacks a source-bound probe report`);
  if(report.outcome!=='budget'||!Number.isInteger(report.steps)||report.steps<1||
      report.steps!==report.stepLimit||report.refusal)
    errors.push(`${name} did not complete the shared instruction budget`);
  if(report.sourceUnchanged!==true||!report.vga?.snapshot)
    errors.push(`${name} lacks source integrity or a final VGA snapshot`);
}
if(errors.length)throw new Error(`pointer pair refused: ${errors.join('; ')}`);
if(plan?.schema!=='bw.i80386-windows-pointer-plan.v1'||
    !plan.application?.name||!plan.application?.rect||!plan.parking||
    !Number.isInteger(plan.parkingBeforeSeq)||!Number.isInteger(plan.parkingAfterSeq)||
    plan.parkingAfterSeq!==plan.parkingBeforeSeq+1||
    !plan.control?.directory||!plan.candidate?.directory||
    !plan.control?.cursorTip||!plan.candidate?.cursorTip||
    !plan.control?.cursorCrop||!plan.candidate?.cursorCrop||
    !plan.control?.reviewedCropSha256||!plan.candidate?.reviewedCropSha256)
  throw new Error('invalid pointer comparison plan');
const decode=report=>renderObservedWindowsVga480(report.vga.snapshot);
const finalFrames={control:decode(control),candidate:decode(candidate)};
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const parkingProof={};
const checkpointHashes={};
for(const [name,report] of [['control',control],['candidate',candidate]]){
  const arm=plan[name],events=report.pointerFeedback;
  const before=events?.[plan.parkingBeforeSeq],after=events?.[plan.parkingAfterSeq];
  if(before?.seq!==plan.parkingBeforeSeq||after?.seq!==plan.parkingAfterSeq||
      !before?.mouse||(before.mouse.dx===0&&before.mouse.dy===0)||
      after.mouse!==null||after.nextStep!==null||events.at(-1)!==after)
    throw new Error(`${name} does not have a final park move and final parked checkpoint`);
  const readCheckpoint=event=>{
    const file=path.join(arm.directory,`frame-${event.seq}.ppm`);
    const bytes=readFileSync(file),frame=readPointerPpm(bytes);
    const actual=sha256(frame.rgb);
    if(actual!==event.frameRgbSha256)
      throw new Error(`${name} checkpoint frame does not match its run report`);
    return {frame,ppmSha256:sha256(bytes)};
  };
  const beforeFrame=readCheckpoint(before),afterFrame=readCheckpoint(after);
  const proof=verifyPointerParking(beforeFrame.frame,afterFrame.frame,
    {application:plan.application.rect,parking:plan.parking,cursorTip:arm.cursorTip,
      cursorCrop:arm.cursorCrop,reviewedCropSha256:arm.reviewedCropSha256});
  if(!proof.parked||pointerCropSha256(finalFrames[name],arm.cursorCrop)!==
      proof.afterCropSha256)
    throw new Error(`${name} lacks stable reviewed cursor parking through final comparison`);
  parkingProof[name]=proof;
  checkpointHashes[name]={beforePpmSha256:beforeFrame.ppmSha256,
    afterPpmSha256:afterFrame.ppmSha256};
}
const result=comparePointerApplicationFrames(finalFrames.control,finalFrames.candidate,
  {application:plan.application.rect,parking:plan.parking,
    minChangedPixels:plan.minChangedPixels??500,
    controlParking:parkingProof.control,candidateParking:parkingProof.candidate});
process.stdout.write(`${JSON.stringify({schema:'bw.i80386-windows-pointer-comparison.v1',
  sourceRevision:control.executionRevision,steps:control.steps,
  application:plan.application,parking:plan.parking,
  finalFrameRgbSha256:{control:finalFrames.control.rgbSha256,
    candidate:finalFrames.candidate.rgbSha256},checkpointHashes,parkingProof,
  pointerDelivery:{control:control.pointerDelivery,candidate:candidate.pointerDelivery},
  ...result},null,2)}\n`);
if(!result.accepted)process.exitCode=1;
