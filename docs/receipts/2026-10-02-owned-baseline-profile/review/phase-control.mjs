import inspector from 'node:inspector';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
const session=new inspector.Session();session.connect();
const post=(method,params={})=>new Promise((resolve,reject)=>session.post(method,params,(e,r)=>e?reject(e):resolve(r)));
await post('Profiler.enable');await post('Profiler.setSamplingInterval',{interval:1000});
const startBefore=Number(process.hrtime.bigint()/1000n);await post('Profiler.start');const executionStart=Number(process.hrtime.bigint()/1000n);
function boundedSourceOnlyWork(){let v=0;const deadline=process.hrtime.bigint()+30000000n;while(process.hrtime.bigint()<deadline){for(let i=0;i<10000;i++)v=(v+i)|0;}return v;}
const result=boundedSourceOnlyWork();const executionEnd=Number(process.hrtime.bigint()/1000n);const {profile}=await post('Profiler.stop');const stopAfter=Number(process.hrtime.bigint()/1000n);session.disconnect();
assert.ok(profile.startTime>=startBefore-10000&&profile.startTime<=executionStart+10000);assert.ok(profile.endTime>=executionEnd-10000&&profile.endTime<=stopAfter+10000);
let elapsed=profile.startTime;const timestamps=profile.timeDeltas.map(delta=>elapsed+=delta);assert.equal(timestamps.length,profile.samples.length);const inWindow=timestamps.filter(t=>t>=executionStart&&t<=executionEnd).length;
assert.ok(inWindow>0);const receipt={status:'PASS_NONGUEST_INSPECTOR_PHASE_ALIGNMENT_CONTROL',startBefore,executionStart,executionEnd,stopAfter,profileStart:profile.startTime,profileEnd:profile.endTime,samples:profile.samples.length,inWindow,result,scope:'Only boundedJSloop; proves localNode22 monotonicmicrosecond phase alignment, not native visibility, guest behavior or profiler CPU attribution.'};writeFileSync(new URL('./phase-control.json',import.meta.url),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
