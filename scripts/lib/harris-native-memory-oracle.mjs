/** Portable, test-only comparison with the registered digital memory bridge. */
import {registerBusMemory} from '../../src/devices/bus-memory.js';
import {getDevice} from '../../src/devices.js';
import {CircuitFault} from '../../src/experimental/digital-circuit.js';
import {DigitalBusMemoryAdapter} from '../../src/experimental/latched-memory-components.js';
import {createNativeMemoryBanks,MEMORY_BANK_PINS} from '../../src/experimental/wired-kernel/memory-banks.js';
const same=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
export async function runNativeMemoryOracle({wasmBytes,yieldTask=()=>Promise.resolve(),stopped=()=>false}) {
    registerBusMemory();
    const banks=[{kind:'62256'},{kind:'28c256'},{kind:'28c256',readOnly:true},{kind:'62256',readOnly:true}].map((b,i)=>({id:`bank${i}`,...b}));
    const refs=banks.map(b=>new DigitalBusMemoryAdapter({enabled:true,...b,model:getDevice(b.kind),writeJournal:true}));
    const kernel=await createNativeMemoryBanks({enabled:true,banks,wasmBytes}),pins=new Uint8Array(banks.length*28);
    for(let b=0;b<banks.length;b++)pins.set([1,0,1,1,1],b*28);
    let comparisons=0,faults=0;
    const check=(ok,detail)=>{if(!ok)throw new Error(`native memory oracle ${detail} at pass ${comparisons}`);};
    const pass=()=>{
        let actual,actualError,previews,error;
        try{actual=kernel.preview(pins);}catch(e){actualError=e;}
        try{
            previews=refs.map((ref,b)=>ref.preview(pin=>{
                const slot=MEMORY_BANK_PINS.indexOf(['csb','ceb'].includes(pin)?'select':pin),value=pins[b*28+slot];
                if(value>1)throw new CircuitFault(value===3?'FLOATING':'UNKNOWN',`${ref.id}.${pin}`);
                return value;
            }));
            previews.forEach(p=>p.commit());
        }catch(e){error=e;}
        comparisons++;check(actualError?.code===error?.code,'fault mismatch');if(error)faults++;
        refs.forEach((ref,b)=>{
            const a=kernel.inspect(b),s=ref.state;
            check(same(a.bytes,s.mem),'storage mismatch');
            check(a.cycle===s._cycle&&a.addr===s.addr&&a.out===s._out&&a.armed===s._armed&&a.writes===ref.writes&&
                JSON.stringify(a.pending)===JSON.stringify(s._pending),'state mismatch');
            if(!error){
                check(actual[b].changed===previews[b].changed,'changed mismatch');
                const expected=previews[b].drives;
                check(expected===null?actual[b].drives===null:actual[b].drives!==null&&actual[b].drives.every((v,i)=>v===(expected[`d${i}`]==='Z'?3:expected[`d${i}`])),'drive mismatch');
            }
        });
    };
    pass();pass();
    for(let byte=0;byte<256;byte++) {
        if(stopped())throw new Error('native memory oracle cancelled');
        for(let b=0;b<banks.length;b++) {
            const base=b*28,address=(byte*127+b)&32767;pins.set([1,0,1,0,0],base);
            for(let i=0;i<15;i++)pins[base+5+i]=(address>>>i)&1;
            for(let i=0;i<8;i++)pins[base+20+i]=(byte>>>i)&1;
        }
        pass();pass();
        for(let b=0;b<banks.length;b++)for(let i=0;i<8;i++)pins[b*28+20+i]^=1;
        pass(); // Latest stable byte is the one committed at the trailing edge.
        for(let b=0;b<banks.length;b++)pins.set([1,0,1,1,1],b*28);
        if(byte===127){pins[3*28]=3;pass();pins[3*28]=1;}
        pass();
        for(let b=0;b<banks.length;b++)pins.set([1,0,0,1,0],b*28);
        pass();pass();
        for(let b=0;b<banks.length;b++)pins.set([1,0,1,1,1],b*28);
        pass();if(byte%8===0)await yieldTask();
    }
    check(faults===1,'expected late-peer fault absent');
    return {accepted:true,comparisons,faults,banks:banks.length,byteValues:256,capacityClaim:false,
        scope:'isolated owned digital memory component oracle; no native board or CPU execution'};
}
