/** Owned ideal byte-bank decoder. Both implementations read actual bound nets. */
import {bitPins,readBits} from './digital-circuit.js';
const A=bitPins('a',24);
const HIGH=Object.freeze({ce_n:1}),LOW=Object.freeze({ce_n:0}),UNKNOWN=Object.freeze({ce_n:'X'});
export function createHarrisMemoryDecoder({id,lane,start,end,romLowAlias=false}) {
    if(![0,1].includes(lane)||!Number.isInteger(start)||!Number.isInteger(end)||start<0||end>0x1000000||start>=end)
        throw new RangeError('memory decoder window/lane');
    const selected=address=>address>=start&&address<end||romLowAlias&&address>=0xf0000&&address<0x100000;
    return {id,pins:[...A,'bhe_n','m_io','ce_n'],outputs:['ce_n'],
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
    };
}
