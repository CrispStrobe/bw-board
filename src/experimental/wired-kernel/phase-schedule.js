/** Private, bounded synthetic input schedule for component cost/correctness probes. */
import {CircuitFault} from '../digital-circuit.js';
export function preparePhaseSchedule({circuit,image,phase}) {
    if(phase.schedule===undefined)return null;
    const {inputPart,readPins=Array.from({length:16},(_,i)=>`d${i}`),maxPeriods=8192,maxUpdates=163840}=phase.schedule??{};
    const part=circuit.parts.get(inputPart);
    if(typeof inputPart!=='string'||[phase.controller,phase.latch].includes(inputPart)||!part||part.evaluate||
        part.pins.length!==part.outputs.length||!part.pins.every(p=>part.outputs.includes(p)))throw new TypeError('explicit ideal input-driver part required');
    if(!Number.isInteger(maxPeriods)||maxPeriods<1||maxPeriods>8192||!Number.isInteger(maxUpdates)||maxUpdates<1||maxUpdates>262144)throw new RangeError('schedule capacities');
    if(!Array.isArray(readPins)||readPins.length!==16||new Set(readPins).size!==16||!readPins.every(p=>part.pins.includes(p)))throw new TypeError('sixteen actual read pins required');
    const terminals=new Map(image.terminals.map(t=>[t.name,t])),ids=new Map(part.outputs.map(p=>[p,terminals.get(`${inputPart}.${p}`).driver]));
    const allowed=new Uint8Array(image.driverNames.length);for(const id of ids.values())allowed[id]=1;
    const readNets=Uint32Array.from(readPins,p=>terminals.get(`${inputPart}.${p}`).net),prepared=new WeakMap();
    return {
        reserve(reserve){
            reserve('scheduleOffsets',(maxPeriods+1)*4);reserve('scheduleIds',maxUpdates*4);reserve('scheduleValues',maxUpdates);
            reserve('scheduleAllowed',allowed.length);reserve('scheduleReadFlags',maxPeriods);reserve('scheduleReadNets',64);
            reserve('scheduleExpected',maxPeriods*4);reserve('scheduleStats',8);
        },
        initialize({e,p,put,inspect,fault}) {
            if(e.phase_schedule_version?.()!==1)throw new TypeError('rebuild native schedule prototype: ABI version mismatch');
            const bytes=(name,n)=>new Uint8Array(e.memory.buffer,p[name],n),view=new DataView(e.memory.buffer);
            bytes('scheduleAllowed',allowed.length).set(allowed);put('scheduleReadNets',readNets);
            const compileSchedule=steps=>{
                if(!Array.isArray(steps)||!steps.length||steps.length>maxPeriods)throw new RangeError('schedule period capacity');
                const offsets=new Uint32Array(steps.length+1),flags=new Uint8Array(steps.length),expected=new Uint32Array(steps.length),drivers=[],values=[],lastCode=new Map();
                let submittedUpdates=0;
                steps.forEach((step,i)=>{
                    if(!step||typeof step.values!=='object'||step.values===null||Array.isArray(step.values))throw new TypeError('schedule drive object required');
                    offsets[i]=drivers.length;
                    for(const [pin,value] of Object.entries(step.values)) {
                        if(!ids.has(pin))throw new TypeError('schedule can drive only its explicit input part');
                        const code=value===0?0:value===1?1:value==='X'?2:value==='Z'?3:-1;
                        if(code<0)throw new CircuitFault('INVALID_DRIVER_LEVEL',pin);
                        if(++submittedUpdates>maxUpdates)throw new RangeError('schedule update capacity');
                        const id=ids.get(pin);
                        if(!lastCode.has(id)||lastCode.get(id)!==code){drivers.push(id);values.push(code);lastCode.set(id,code);}
                    }
                    if(step.read!=null){if(!Number.isInteger(step.read)||step.read<0||step.read>65535)throw new RangeError('expected read word');flags[i]=1;expected[i]=step.read;}
                });
                offsets[steps.length]=drivers.length;
                const handle=Object.freeze({periods:steps.length,updates:submittedUpdates,encodedUpdates:drivers.length});
                prepared.set(handle,{offsets,ids:Uint32Array.from(drivers),values:Uint8Array.from(values),flags,expected});return handle;
            };
            const runSchedule=handle=>{
                const s=prepared.get(handle);if(!s)throw new TypeError('schedule must be compiled by this native instance');
                put('scheduleOffsets',s.offsets);put('scheduleIds',s.ids);bytes('scheduleValues',s.values.length).set(s.values);
                bytes('scheduleReadFlags',s.flags.length).set(s.flags);put('scheduleExpected',s.expected);
                const result=e.run_latched_memory_schedule(p.phaseContext,handle.periods,s.ids.length,p.scheduleOffsets,p.scheduleIds,p.scheduleValues,
                    p.scheduleAllowed,p.scheduleReadFlags,p.scheduleReadNets,p.scheduleExpected,p.scheduleStats,p.fault);
                const progress={periods:view.getUint32(p.scheduleStats,true),reads:view.getUint32(p.scheduleStats+4,true)};
                if(result){
                    try{
                        if(result<7)fault(result);
                        const error=new CircuitFault(result===7?'INVALID_CLOCK_SCHEDULE':'CLOCK_SCHEDULE_READ_MISMATCH','owned synthetic schedule stopped');
                        error.detail=view.getUint32(p.fault+4,true);error.step=view.getUint32(p.fault+8,true);throw error;
                    }catch(error){Object.assign(error,progress);throw error;}
                }
                return {...progress,...inspect()};
            };
            return {compileSchedule,runSchedule,scheduleLimits:Object.freeze({maxPeriods,maxUpdates})};
        }
    };
}
