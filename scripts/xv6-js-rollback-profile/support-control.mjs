import assert from 'node:assert/strict';
import {constants} from 'node:perf_hooks';
import {sampleIncludesCollected,supportsBothCases} from './support.mjs';

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
 return {name,requested,allocatedObjects:1024,collectedObjects:1024,
  begin:10,end:20,releaseAt:minor?null:15,
  events:minor?[{at:16,kind:constants.NODE_PERFORMANCE_GC_MINOR}]:
   [{at:16,kind:constants.NODE_PERFORMANCE_GC_MAJOR}],
  minorGcEvents:minor?1:0,majorGcEvents:minor?0:1,
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
]){
 const other=cases.map((item,at)=>at===index?{...item,...patch}:item);
 assert.throws(()=>supportsBothCases(other));
}
console.log('rollback GC support-shape controls PASS (hosted runtime verification pending)');
