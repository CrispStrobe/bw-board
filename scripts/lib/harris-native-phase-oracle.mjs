/** Portable test-only oracle for the owned ideal controller/latch components. */
import {MemoryPhaseController,IdealAddressLatch} from '../../src/experimental/latched-memory-components.js';
import {HARRIS_80C286_STATUS} from '../../src/experimental/harris-80c286-contract.js';
import {createNativePhaseComponents,PHASE_INPUTS,LATCH_INPUTS} from '../../src/experimental/wired-kernel/phase-components.js';
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export async function runNativePhaseOracle({wasmBytes,yieldTask=()=>Promise.resolve(),stopped=()=>false}={}) {
    const kernel=await createNativePhaseComponents({enabled:true,ioEnabled:true,intrEnabled:true,wasmBytes});
    const controller=new MemoryPhaseController({enabled:true,ioEnabled:true,intrEnabled:true}),latch=new IdealAddressLatch({enabled:true});
    const passive={reset:0,ready_n:0,s1_n:1,s0_n:1,cod_inta_n:0,m_io:0};let periods=0,latchComparisons=0;
    const state=()=>({state:controller.state,phase:controller.phase,open:controller.open,tcCount:controller.tcCount,kind:controller.kind});
    const check=(ok,detail)=>{if(!ok)throw new Error(`native phase oracle ${detail} at period ${periods}`);};
    const period=inputs=>{
        if(stopped())throw new Error('native phase oracle cancelled');
        const levels=Uint8Array.from(PHASE_INPUTS,p=>inputs[p]),read=p=>inputs[p];
        check(same(kernel.beginClock(levels),controller.beginClock(read)),'begin commands');check(same(kernel.inspect(),state()),'begin state');
        const expected=controller.previewEnd(read),actual=kernel.previewEnd(levels);
        check(actual.ready===expected.ready,'READY');check(same(kernel.inspect(),state()),'preview mutation');
        check(same(actual.finish(),expected.finish()),'end commands');check(same(kernel.inspect(),state()),'end state');
        check(same(kernel.commands(),controller.commands()),'current commands');periods++;
    };
    for(const kind of ['memory-read','memory-write','code-read','io-read','io-write','interrupt-acknowledge'])for(const waits of [0,1,4,17]) {
        const active={...passive,...HARRIS_80C286_STATUS[kind]};period(active);period(active);
        for(let i=0;i<2*(waits+1);i++)period({...passive,ready_n:Number(i<2*waits)});
        check(controller.state==='TI'&&controller.tcCount===waits+1,'completion count');await yieldTask();
    }
    for(let sample=0;sample<128;sample++) {
        const levels=Uint8Array.from(LATCH_INPUTS,(_,i)=>i===0?Number(sample%3!==0):(sample>>>(i%7))&1);
        const actual=kernel.updateLatch(levels),expected=latch.update(p=>levels[LATCH_INPUTS.indexOf(p)]);
        check(actual.every((v,i)=>v===(expected[`q_${LATCH_INPUTS[i+1]}`]==='X'?2:expected[`q_${LATCH_INPUTS[i+1]}`])),'latch');latchComparisons++;
    }
    return {accepted:true,periods,latchComparisons,capacityClaim:false,
        scope:'isolated owned ideal phase controller/latch; no native CPU or complete board clock'};
}
