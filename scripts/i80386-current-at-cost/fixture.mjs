// MIT. Authored media-free ordinary JS 386 diagnostic, with no guest image.
import {pathToFileURL} from 'node:url';
import CPU from '../../src/experimental/i80386.js';
import Machine,{PCAT80386_EXPERIMENTAL as config} from '../../src/experimental/i80386-at-machine.js';
import {make,execute,CODE} from '../i80386-at-profile/fixture.mjs';
export {CODE};

export function measured(kind,mode,steps=1000000){
  if(!['core','at'].includes(kind)||!['timing','profile'].includes(mode)||
     !Number.isSafeInteger(steps)||steps<5||steps>1000000)throw Error('fixed diagnostic selection');
  const startupNanoseconds=String(Math.round(process.uptime()*1e9));
  const warm=make(kind,CPU,Machine,config);
  const warmBegin=process.hrtime.bigint();execute(warm,Math.min(25000,steps));
  const warmupNanoseconds=String(process.hrtime.bigint()-warmBegin);
  const setupBegin=process.hrtime.bigint();const current=make(kind,CPU,Machine,config);
  const setupNanoseconds=String(process.hrtime.bigint()-setupBegin);
  const loopBegin=process.hrtime.bigint();const result=execute(current,steps);
  const executionLoopNanoseconds=String(process.hrtime.bigint()-loopBegin);
  return {...result,schema:'bw.current-at-cost-child.v1',mode,requestedSteps:steps,
    startupNanoseconds,warmupNanoseconds,setupNanoseconds,executionLoopNanoseconds,
    warmupDoesNotContributeToMeasuredState:true,physical386TimingCalibrated:false};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  if(process.argv.length!==4||!['core','at'].includes(process.argv[2])||
     !['timing','profile'].includes(process.argv[3]))throw Error('fixed hosted arguments');
  console.log(JSON.stringify(measured(process.argv[2],process.argv[3])));
}
