#!/usr/bin/env node
// Media-neutral reduction of the stopped, source-pinned Windows timing trial.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const BOARD='a0ac741d9f17bbf4b0528927280e13b4921e2936';
const PROTOCOL='7ffbeecaa85c51c97c5e1f02a2e1d9821c86c53d';
const PROTOCOL_SHA='56d4e4539b53cc84cbc765242b72a4837212e037de9f157530e11fdfee08c083';
const ORDER=[['baseline','shortcut'],['shortcut','baseline']];
const PLANNED_ORDER=[...ORDER,ORDER[0]];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const readJson=file=>JSON.parse(fs.readFileSync(file));
const reportName=(pair,arm)=>`pair${pair}-${arm}-private.json`;
const timingName=(pair,arm)=>`pair${pair}-${arm}-time.txt`;
const timePattern=/^wall=([0-9.]+) user=([0-9.]+) system=([0-9.]+) maxrss=(\d+)\n?$/;

export function reducePlainRamReadWindowsResult(host,reports,timings,hashes,
  sourceBlobs){
  if(host.schema!=='private.i80386-plain-ram-read-windows-pair.v1'||
      host.pins?.boardRevision!==BOARD||
      host.pins?.privateProtocolRevision!==PROTOCOL||
      host.pins?.protocolScriptSha256!==PROTOCOL_SHA||
      host.pins?.steps!==60_000_000||
      host.gate!=='stop-first-unfavorable-pair'||
      !equal(host.pins.order,PLANNED_ORDER)||
      host.runs?.length!==4||host.pairResults?.length!==2)
    throw new Error('wrong pinned trial or stop gate');
  const first=reports[reportName(1,'baseline')];
  const sourceMap=first?.sourceSha256;
  if(!sourceMap||Array.isArray(sourceMap)||Object.keys(sourceMap).length!==42||
      !Object.hasOwn(sourceMap,'../src/experimental/i80386-at-machine.js')||
      !Object.hasOwn(sourceMap,'./run-i80386-at-console.mjs')||
      !equal(Object.keys(sourceBlobs).sort(),Object.keys(sourceMap).sort()))
    throw new Error('incomplete executable source map');
  for(const [file,expected] of Object.entries(sourceMap))
    if(!/^[0-9a-f]{64}$/.test(expected)||sha(sourceBlobs[file])!==expected)
      throw new Error(`committed executable source differs: ${file}`);
  const reference=structuredClone(first);
  delete reference.inputs.plainRamReadShortcut;
  const pairs=[];
  let index=0;
  for(const [pairIndex,order] of ORDER.entries()){
    const pair=pairIndex+1;
    const seconds={};
    for(const arm of order){
      const name=reportName(pair,arm),time=timingName(pair,arm);
      const run=host.runs[index++],report=reports[name],timing=timings[time];
      const match=timePattern.exec(timing??'');
      if(!report||!match||run?.pair!==pair||run.arm!==arm||
          run.reportSha256!==hashes[name]||
          run.timing!==timing.trim()||
          run.userCpuSeconds!==Number(match[2])||
          report.schema!=='bw.i80386-at-console.v1'||
          report.executionRevision!==BOARD||
          report.steps!==60_000_000||report.stop!=='budget'||
          report.inputs?.plainRamReadShortcut!==(arm==='shortcut')||
          !/^[0-9a-f]{64}$/.test(report.ramSha256)||
          !/^[0-9a-f]{64}$/.test(report.diskSha256)||
          !equal(report.sourceSha256,sourceMap))
        throw new Error(`report, timing, or source mismatch: ${name}`);
      const normalized=structuredClone(report);
      delete normalized.inputs.plainRamReadShortcut;
      if(!equal(normalized,reference))
        throw new Error(`whole guest/device/RAM/disk report mismatch: ${name}`);
      seconds[arm]=run.userCpuSeconds;
    }
    const favorable=seconds.shortcut<seconds.baseline;
    if(!equal(host.pairResults[pairIndex],{pair,
      baselineUserCpuSeconds:seconds.baseline,
      shortcutUserCpuSeconds:seconds.shortcut,
      shortcutFavorable:favorable}))
      throw new Error(`pair ${pair} host result mismatch`);
    pairs.push({pair,order,baselineUserCpuSeconds:seconds.baseline,
      shortcutUserCpuSeconds:seconds.shortcut,shortcutFavorable:favorable});
  }
  if(!pairs[0].shortcutFavorable||pairs[1].shortcutFavorable)
    throw new Error('host stop disagrees with first unfavorable pair');
  return {schema:'bw.i80386-plain-ram-read-windows-result.v1',
    boardRevision:BOARD,privateProtocolRevision:PROTOCOL,
    privateArchiveCommit:'77eabfc',
    sourceSha256:{
      machine:sourceMap['../src/experimental/i80386-at-machine.js'],
      runner:sourceMap['./run-i80386-at-console.mjs'],
      protocol:host.pins.protocolScriptSha256,
    },
    completedStepsPerArm:60_000_000,completedArms:4,
    sourceHashesVerified:true,wholeReportParityExceptOptIn:true,
    ramAndDiskHashesEqual:true,
    privateEvidenceSha256:hashes,
    pairs,
    predeclaredGate:{minimumMeanUserCpuReduction:0.05,
      everyPairMustFavorShortcut:true,
      stopReason:'first-unfavorable-pair',windowsPassed:false,
      thirdPairRun:false,xv6PairRun:false},
    interpretation:'The Windows retention gate failed; no xv6 timing pair was run. No speed benefit is established.'};
}

export function summarizePlainRamReadWindowsFiles(directory){
  const hostFile=path.join(directory,'host-private.json');
  const hostBytes=fs.readFileSync(hostFile),host=JSON.parse(hostBytes);
  const reports={},timings={},hashes={hostManifest:sha(hostBytes)};
  for(const [pairIndex,order] of ORDER.entries())
    for(const arm of order){
      const name=reportName(pairIndex+1,arm);
      const time=timingName(pairIndex+1,arm);
      const reportBytes=fs.readFileSync(path.join(directory,name));
      const timeBytes=fs.readFileSync(path.join(directory,time));
      reports[name]=JSON.parse(reportBytes);
      timings[time]=timeBytes.toString();
      hashes[name]=sha(reportBytes);
      hashes[time]=sha(timeBytes);
    }
  const sourceBlobs={};
  const sourceMap=reports[reportName(1,'baseline')].sourceSha256??{};
  for(const file of Object.keys(sourceMap)){
    const repositoryPath=file.startsWith('../')?file.slice(3):file.startsWith('./')?
      `scripts/${file.slice(2)}`:file;
    sourceBlobs[file]=execFileSync('git',['show',`${BOARD}:${repositoryPath}`],
      {cwd:new URL('..',import.meta.url)});
  }
  return reducePlainRamReadWindowsResult(host,reports,timings,hashes,sourceBlobs);
}

export function serializePlainRamReadWindowsResult(result){
  const output=JSON.stringify(result,null,2)+'\n';
  assert.ok(Buffer.byteLength(output)<8*1024,'compact result exceeds 8 KiB');
  return output;
}

if(process.argv[1]&&new URL(import.meta.url).pathname===process.argv[1]){
  if(process.argv.length!==3)
    throw new Error('usage: summarize-i80386-plain-ram-read-windows-result.mjs private-output-directory');
  process.stdout.write(serializePlainRamReadWindowsResult(
    summarizePlainRamReadWindowsFiles(process.argv[2])));
}
