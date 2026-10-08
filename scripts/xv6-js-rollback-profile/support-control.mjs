import assert from 'node:assert/strict';
import {sampleIncludesCollected} from './support.mjs';

const node=(id,functionName,children=[])=>({id,callFrame:{functionName},children});
const profile={head:node(1,'(root)',[node(2,'allocateShortLived')]),
 samples:[{nodeId:2,size:32768,ordinal:1}]};
assert.equal(sampleIncludesCollected(profile,1024),true);
assert.equal(sampleIncludesCollected({...profile,samples:[]},1024),false);
assert.equal(sampleIncludesCollected({...profile,samples:[{nodeId:1,size:32768}]},1024),false);
assert.equal(sampleIncludesCollected({...profile,samples:[{nodeId:2,size:0}]},1024),false);
assert.throws(()=>sampleIncludesCollected(profile,0),/collected test objects/);
console.log('rollback GC support-shape controls PASS (hosted runtime verification pending)');
