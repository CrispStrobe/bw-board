import assert from 'node:assert/strict';
import {sampleIncludesCollected,supportsBothCases} from './support.mjs';

const node=(id,functionName,children=[])=>({id,callFrame:{functionName},children});
const profile={head:node(1,'(root)',[node(2,'allocateShortLived')]),
 samples:[{nodeId:2,size:32768,ordinal:1}]};
assert.equal(sampleIncludesCollected(profile,1024),true);
assert.equal(sampleIncludesCollected({...profile,samples:[]},1024),false);
assert.equal(sampleIncludesCollected({...profile,samples:[{nodeId:1,size:32768}]},1024),false);
assert.equal(sampleIncludesCollected({...profile,samples:[{nodeId:2,size:0}]},1024),false);
assert.throws(()=>sampleIncludesCollected(profile,0),/collected test objects/);
const cases=[
 {name:'minor-baseline',requested:{samplingInterval:131072},
  allocatedObjects:1024,collectedObjects:1024,
  minorGcEvents:2,majorGcEvents:0,collectedCallsiteSamplePresent:false},
 {name:'minor-enabled',requested:{samplingInterval:131072,
    includeObjectsCollectedByMinorGC:true},allocatedObjects:1024,collectedObjects:1024,
  minorGcEvents:2,majorGcEvents:0,collectedCallsiteSamplePresent:true},
 {name:'major-baseline',requested:{samplingInterval:131072},
  allocatedObjects:1024,collectedObjects:1024,
  minorGcEvents:0,majorGcEvents:1,collectedCallsiteSamplePresent:false},
 {name:'major-enabled',requested:{samplingInterval:131072,
    includeObjectsCollectedByMajorGC:true},allocatedObjects:1024,collectedObjects:1024,
  minorGcEvents:0,majorGcEvents:1,collectedCallsiteSamplePresent:true}];
assert.equal(supportsBothCases(cases),true);
for(const [index,patch] of [
 [0,{collectedCallsiteSamplePresent:true}],
 [1,{collectedCallsiteSamplePresent:false}],
 [1,{majorGcEvents:1}],
 [2,{collectedCallsiteSamplePresent:true}],
 [3,{collectedCallsiteSamplePresent:false}],
 [3,{majorGcEvents:0}],
 [3,{collectedObjects:1023}],
 [3,{requested:{samplingInterval:131072}}],
]){
 const other=cases.map((item,at)=>at===index?{...item,...patch}:item);
 assert.throws(()=>supportsBothCases(other));
}
console.log('rollback GC support-shape controls PASS (hosted runtime verification pending)');
