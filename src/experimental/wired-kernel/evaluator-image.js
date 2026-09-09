import {CircuitFault} from '../digital-circuit.js';
import {captureWiredNetImage} from '../wired-net-image.js';
import {kernelEvaluatorOperation} from './evaluator-contract.js';
export const EVALUATOR_STRIDE=32;
export function captureKernelEvaluatorImage({enabled=false,circuit}={}) {
    const image=captureWiredNetImage({enabled,circuit}),terminals=new Map(image.terminals.map(t=>[t.name,t])),operations=[],evaluatorNames=[],dependencies=[],dependencyOffsets=[0];
    for(const [id,part] of circuit.parts)if(part.evaluate) {
        const op=kernelEvaluatorOperation(part);
        if(!op)throw new CircuitFault('UNSUPPORTED_KERNEL_EVALUATOR',id);
        const row=new Uint32Array(EVALUATOR_STRIDE);
        const terminal=pin=>{const t=terminals.get(`${id}.${pin}`);if(!t)throw new CircuitFault('UNSUPPORTED_KERNEL_EVALUATOR',`${id}.${pin}`);return t;};
        const net=pin=>terminal(pin).net,driver=pin=>{const d=terminal(pin).driver;if(d===null)throw new CircuitFault('UNSUPPORTED_KERNEL_EVALUATOR',`${id}.${pin} not an output`);return d;};
        let expected;
        if(op.kind==='memory-decoder') {
            row.set([1,op.lane,op.start,op.end,Number(op.romLowAlias),net('m_io'),net('bhe_n'),driver('ce_n')]);
            for(let i=0;i<24;i++)row[8+i]=net(`a${i}`);expected=['ce_n'];
        }else if(op.kind==='ready-or') {
            row.set([2,net('external_n'),net('wait'),driver('ready_n')]);expected=['ready_n'];
        }else if(op.kind==='bus-owner') {
            const status=['s1_n','s0_n','cod_inta_n','m_io'];row.set([3,net('hlda'),Number(op.dmaTransfer)]);
            for(let i=0;i<4;i++){row[3+i]=net(status[i]);if(op.dmaTransfer)row[7+i]=net(`dma_${status[i]}`);row[11+i]=driver(`q_${status[i]}`);}
            expected=status.map(p=>`q_${p}`);
        }else throw new CircuitFault('UNSUPPORTED_KERNEL_EVALUATOR',`${id}: ${op.kind}`);
        if(part.outputs.length!==expected.length||part.outputs.some((p,i)=>p!==expected[i]))throw new CircuitFault('UNSUPPORTED_KERNEL_EVALUATOR',`${id}: changed output contract`);
        operations.push(...row);evaluatorNames.push(id);
        dependencies.push(...new Set(part.pins.map(net)));dependencyOffsets.push(dependencies.length);
    }
    return {...image,capabilities:{...image.capabilities,combinationalEvaluation:true},
        evaluatorSchema:'bw-owned-evaluators-v1',evaluatorStride:EVALUATOR_STRIDE,
        evaluatorNames,operations:new Uint32Array(operations),dependencies:new Uint32Array(dependencies),
        dependencyOffsets:new Uint32Array(dependencyOffsets),maxDeltas:circuit.maxDeltas};
}
