import assert from 'node:assert/strict';
import {constants} from 'node:perf_hooks';
import {admittedRuntime,minorStageAdmitted,sampleIncludesCollected,supportsBothCases} from './support.mjs';

const node=(id,functionName,children=[])=>({id,callFrame:{functionName},children});
const profile={head:node(1,'(root)',[node(2,'allocateShortLived')]),
 samples:[{nodeId:2,size:32768,ordinal:1}]};
assert.equal(sampleIncludesCollected(profile,1024),true);
assert.equal(sampleIncludesCollected({head:node(1,'(root)',[
 node(2,'allocateShortLived',[node(3,'Array')])]),
 samples:[{nodeId:3,size:32768}]},1024),true);
assert.equal(sampleIncludesCollected({...profile,samples:[]},1024),false);
assert.equal(sampleIncludesCollected({...profile,samples:[{nodeId:1,size:32768}]},1024),false);
assert.equal(sampleIncludesCollected({...profile,samples:[{nodeId:2,size:0}]},1024),false);
assert.throws(()=>sampleIncludesCollected(profile,0),/collected test objects/);
function caseData(name,requested,kind,present){
 const minor=kind==='minor';
 const stages=minor?[{cohort:0,targets:64,pumpBlocks:2,releaseAt:12,
  firstMinorAt:13,deadAfterMinor:64},
  {cohort:1,targets:64,pumpBlocks:2,releaseAt:16,
   firstMinorAt:17,deadAfterMinor:64}]:[];
 const events=minor?[{at:13,kind:constants.NODE_PERFORMANCE_GC_MINOR},
  {at:17,kind:constants.NODE_PERFORMANCE_GC_MINOR}]:
  [{at:16,kind:constants.NODE_PERFORMANCE_GC_MAJOR}];
 return {name,requested,allocatedObjects:128,collectedObjects:128,
  begin:10,end:20,releaseAt:minor?null:15,
  events,minorStages:stages,
  observedGcEventCount:events.length,eventsTruncated:false,
  minorGcEvents:minor?2:0,majorGcEvents:minor?0:1,
  minorAfterReleaseBeforeMajor:minor?null:0,
  rawProfileName:'gc-'+name+'.heap.json',rawProfileBytes:512,
  rawProfileSha256:'a'.repeat(64),collectedCallsiteSamplePresent:present};
}
const cases=[
 caseData('minor-baseline',{samplingInterval:131072},'minor',false),
 caseData('minor-enabled',{samplingInterval:131072,
  includeObjectsCollectedByMinorGC:true},'minor',true),
 caseData('major-baseline',{samplingInterval:131072},'major',false),
 caseData('major-enabled',{samplingInterval:131072,
  includeObjectsCollectedByMajorGC:true},'major',true)];
assert.equal(supportsBothCases(cases),true);
assert.equal(minorStageAdmitted(cases[0].minorStages,cases[0].events,10,20),true);
for(const [patch,reason] of [
 [{...cases[0].minorStages[0],deadAfterMinor:63},/died/],
 [{...cases[0].minorStages[0],firstMinorAt:11},/minor after/],
 [{...cases[0].minorStages[0],pumpBlocks:9},/pressure/],
])assert.throws(()=>minorStageAdmitted(
 [patch,cases[0].minorStages[1]],cases[0].events,10,20),reason);
assert.throws(()=>minorStageAdmitted(cases[0].minorStages,
 [...cases[0].events,{at:18,kind:constants.NODE_PERFORMANCE_GC_MAJOR}],10,20),
 /major GC/);
const runtime=admittedRuntime('v20.20.2',['--no-turbo-inlining'],
 '  --turbo-inlining (enable inlining in TurboFan)');
assert.equal(runtime.antiInliningFlag,'--no-turbo-inlining');
assert.throws(()=>admittedRuntime('v20.20.2',[],
 '  --turbo-inlining (enable inlining in TurboFan)'),/anti-inlining/);
assert.throws(()=>admittedRuntime('v20.20.2',['--no-turbo-inlining'],'no flag'),
 /does not expose/);
for(const [index,patch] of [
 [0,{collectedCallsiteSamplePresent:true}],
 [1,{collectedCallsiteSamplePresent:false}],
 [1,{majorGcEvents:1}],
 [2,{collectedCallsiteSamplePresent:true}],
 [3,{collectedCallsiteSamplePresent:false}],
 [3,{majorGcEvents:0}],
 [3,{minorAfterReleaseBeforeMajor:1}],
 [3,{collectedObjects:1023}],
 [3,{requested:{samplingInterval:131072}}],
 [3,{rawProfileSha256:'b'}],
 [3,{majorGcEvents:2}],
 [3,{events:[{at:14,kind:constants.NODE_PERFORMANCE_GC_MAJOR}]}],
 [1,{events:[{at:21,kind:constants.NODE_PERFORMANCE_GC_MINOR}]}],
 [1,{eventsTruncated:true}],
 [1,{observedGcEventCount:3}],
]){
 const other=cases.map((item,at)=>at===index?{...item,...patch}:item);
 assert.throws(()=>supportsBothCases(other));
}
console.log('rollback GC support-shape controls PASS (hosted runtime verification pending)');
