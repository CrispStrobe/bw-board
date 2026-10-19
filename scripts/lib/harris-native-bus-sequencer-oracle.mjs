/** Portable owned-input differential harness. No Node imports or guest media. */
import {Harris80C286Bus} from '../../src/experimental/harris-80c286-bus.js';
import {createNative286MemoryBus} from '../../src/experimental/wired-kernel/bus-sequencer.js';
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?
    Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const equal=(a,b,label)=>{if(JSON.stringify(canonical(a))!==JSON.stringify(canonical(b)))
    throw new Error(`${label}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);};
export const passiveBusPins=()=>({reset:0,hold:0,pereq:0,intr:0,nmi:0,busy_n:1,error_n:1,ready_n:0,
    ...Object.fromEntries(Array.from({length:16},(_,i)=>[`d${i}`,0]))});
export async function createBusSequencerOracle(module,options={}) {
    const reference=new Harris80C286Bus({enabled:true,traceEnabled:false,...options});
    const native=await createNative286MemoryBus({enabled:true,module,...options});
    let boundaries=0;
    const state=()=>{
        const {state,phase,open,faulted,clock,resetClocks,initClocks,writeHold,address,pending}=reference;
        equal(native.inspect(),{state,phase,open,faulted,clock,resetClocks,initClocks,writeHold,address,
            pending:pending?{index:pending.index,waits:pending.waits,bytes:[...pending.bytes],
                transferCount:pending.transfers.length}:null},'state');
    };
    const call=(method,pins)=>{
        let expected,actual,aerr,berr;
        try{expected=reference[method](pin=>pins[pin]);}catch(error){aerr=error;}
        try{actual=native[method](pins);}catch(error){berr=error;}
        equal(berr?.code??null,aerr?.code??null,`${method} fault`);
        if(aerr&&['UNKNOWN','FLOATING','UNSUPPORTED_INPUT'].includes(aerr.code))
            equal(berr.message,aerr.message,'sampled fault pin');
        if(!aerr)equal(actual,expected,method);
        state();boundaries++;return {value:actual,error:berr};
    };
    const period=pins=>{
        const start=call('beginClock',pins);if(start.error)return start;
        // Writes are sampled from resolved data; use their driven lanes.
        const resolved={...pins};for(let i=0;i<16;i++)if(start.value[`d${i}`]!=='Z')resolved[`d${i}`]=start.value[`d${i}`];
        return call('endClock',resolved);
    };
    const boot=()=>{
        for(let i=0;i<17;i++)period({...passiveBusPins(),reset:1});
        for(let i=0;i<50;i++)period(passiveBusPins());
        equal(native.inspect().state,'TI','init complete');
    };
    const submit=transaction=>{reference.submit(transaction);native.submit(transaction);state();};
    return {reference,native,state,call,period,boot,submit,report:()=>({boundaries})};
}

export async function runNativeBusSequencerOracle(module) {
    const h=await createBusSequencerOracle(module);h.boot();let completions=0;
    for(const kind of ['memory-read','code-read','memory-write'])
        for(const width of [1,2])for(const address of [0,1,0x123456,0x123457,0xfffffe]) {
            const value=width===1?0xa5:0xc35a;
            h.submit({kind,address,width,value});
            let waited=0;
            while(h.native.inspect().pending) {
                const s=h.native.inspect(),wait=s.state==='TC'&&s.phase===2&&waited++<2;
                const result=h.period({...passiveBusPins(),ready_n:wait?1:0,
                    ...Object.fromEntries(Array.from({length:16},(_,i)=>[`d${i}`,(0x39c6>>i)&1]))});
                if(result.error)throw result.error;if(result.value)completions++;
            }
            h.period(passiveBusPins());h.period(passiveBusPins());
        }
    return {...h.report(),transactions:30,completions};
}
