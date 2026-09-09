/** Private admission certificates for owned, pure evaluator implementations. */
import {bitPins,readBits} from '../digital-circuit.js';
const admitted=new WeakSet();
function certifyKernelEvaluator(part,operation) {
    if(typeof part.evaluate!=='function')throw new TypeError('owned evaluator required');
    const certificate=Object.freeze({evaluate:part.evaluate,compileEvaluate:part.compileEvaluate,operation:Object.freeze({...operation})});
    admitted.add(certificate);return {...part,kernelCertificate:certificate};
}
export function kernelEvaluatorOperation(part) {
    const certificate=part.kernelCertificate;
    if(!certificate||!admitted.has(certificate)||certificate.evaluate!==part.evaluate||certificate.compileEvaluate!==part.compileEvaluate)return null;
    return certificate.operation;
}
const A=bitPins('a',24);
const HIGH=Object.freeze({ce_n:1}),LOW=Object.freeze({ce_n:0}),UNKNOWN=Object.freeze({ce_n:'X'});
export function createHarrisMemoryDecoder({id,lane,start,end,romLowAlias=false}) {
    if(![0,1].includes(lane)||!Number.isInteger(start)||!Number.isInteger(end)||start<0||end>0x1000000||start>=end)
        throw new RangeError('memory decoder window/lane');
    const selected=address=>address>=start&&address<end||romLowAlias&&address>=0xf0000&&address<0x100000;
    return certifyKernelEvaluator({id,pins:[...A,'bhe_n','m_io','ce_n'],outputs:['ce_n'],
        evaluate(read) {
            if(read('m_io')===0||(lane===0?read('a0')===1:read('bhe_n')===1))return HIGH;
            const address=readBits(A,read);
            if(address===null||read('m_io')!==1||lane===1&&read('bhe_n')!==0)return UNKNOWN;
            return selected(address)?LOW:HIGH;
        },
        compileEvaluate(bind) {
            const address=bind.vector(A),mio=bind.pin('m_io'),enable=bind.pin(lane===0?'a0':'bhe_n');
            return ()=>{
                if(mio()===0||enable()===1)return HIGH;
                const value=address();
                if(value===null||mio()!==1||lane===1&&enable()!==0)return UNKNOWN;
                return selected(value)?LOW:HIGH;
            };
        }
    },{kind:'memory-decoder',lane,start,end,romLowAlias:!!romLowAlias});
}
export function createHarrisReadyLogic({id='irq_ready'}={}) {
    return certifyKernelEvaluator({id,pins:['external_n','wait','ready_n'],outputs:['ready_n'],evaluate(read) {
        const a=read('external_n'),b=read('wait');return {ready_n:[a,b].every(v=>v===0||v===1)?a|b:'X'};
    }},{kind:'ready-or'});
}
export function createHarrisBusOwner({id='bus_owner',dmaTransfer=false}={}) {
    if(typeof dmaTransfer!=='boolean')throw new TypeError('dmaTransfer');
    const status=['s1_n','s0_n','cod_inta_n','m_io'];
    return certifyKernelEvaluator({id,pins:['hlda',...status,...status.map(p=>`q_${p}`),...(dmaTransfer?status.map(p=>`dma_${p}`):[])],outputs:status.map(p=>`q_${p}`),evaluate(read){
        const held=read('hlda'),passive=!dmaTransfer||read('dma_s0_n')===1&&read('dma_s1_n')===1;
        return Object.fromEntries(status.map(p=>[`q_${p}`,held===0?read(p):held===1?(passive?Number(p==='s1_n'||p==='s0_n'):read(`dma_${p}`)):'X']));
    }},{kind:'bus-owner',dmaTransfer});
}
