/** Private owned bus binding: no caller-supplied instance and no fast address map. */
import {CircuitFault} from '../digital-circuit.js';
import {PHASE_INPUTS,LATCH_INPUTS} from './phase-components.js';
const INPUTS=['reset','hold','pereq','intr','nmi','busy_n','error_n','ready_n',...Array.from({length:16},(_,i)=>`d${i}`)];
const OUTPUTS=[...Array.from({length:24},(_,i)=>`a${i}`),...Array.from({length:16},(_,i)=>`d${i}`),
    'bhe_n','s1_n','s0_n','cod_inta_n','m_io','lock_n','hlda','peack_n'];
const KINDS=['memory-read','code-read','memory-write'];
const BUS_STATES=['RESET_REQUIRED','RESET','INIT','TI','TS','TC'];
const BUS_IDLE=BUS_STATES.indexOf('TI');
const BUS_ERRORS=['','CLOCK_ORDER','OVERFLOW','FLOATING','UNKNOWN','BUS_FAULTED','RESET_REQUIRED',
    'SHORT_RESET','UNSUPPORTED_HOLD','UNSUPPORTED_INPUT','WAIT_LIMIT','BUS_UNAVAILABLE','UNSUPPORTED_TRANSACTION','CONTENTION'];
const transactionFields=new Set(['kind','address','width','value','locked']);
export function assertDistinctBusDrivers({busOutputIds,busExternalIds}) {
    const all=[...busOutputIds,...busExternalIds];
    if(new Set(all).size!==all.length)throw new TypeError('bus driver mappings must be distinct');
}
export function assertBusCircuitABI(exports) {
    if(exports.bus_circuit_version?.()!==3||exports.bus_sequencer_version?.()!==1||
        typeof exports.bus_output_change_word!=='function'||exports.bus_admission_version?.()!==1||
        exports.bus_admission_counters_version?.()!==1||typeof exports.admit_owned_bus_context!=='function'||
        typeof exports.bus_admission_counters_ptr!=='function'||typeof exports.reset_bus_admission_counters!=='function')
        throw new TypeError('rebuild native bus bridge: ABI mismatch');
}
export function prepareBusCircuit({circuit,image,bus,phase,banks}) {
    if(bus?.kind!=='owned-286-memory-bus-v1'||Object.keys(bus).some(k=>!['kind','cpu','inputPart','maxWaitStates'].includes(k)))
        throw new TypeError('explicit owned memory-bus descriptor required');
    if(!phase||phase.ioEnabled||phase.intrEnabled||phase.schedule)throw new TypeError('bus bridge requires memory-only phase without schedule');
    const {cpu,inputPart,maxWaitStates=1024}=bus;
    if(typeof cpu!=='string'||typeof inputPart!=='string'||cpu===inputPart||
        !Number.isSafeInteger(maxWaitStates)||maxWaitStates<1)throw new TypeError('bus descriptor');
    const part=circuit.parts.get(cpu),pins=[...INPUTS.slice(0,8),...OUTPUTS],external=circuit.parts.get(inputPart);
    if(!part||part.evaluate||part.pins.length!==pins.length||!pins.every(p=>part.pins.includes(p))||
        part.outputs.length!==OUTPUTS.length||!OUTPUTS.every(p=>part.outputs.includes(p)))throw new TypeError('exact owned 286 bus pins required');
    if(!external||external.evaluate||external.pins.length<1||external.pins.length>128||
        external.outputs.length!==external.pins.length||!external.pins.every(p=>external.outputs.includes(p)))throw new TypeError('explicit ideal input driver part required');
    const owned=new Set([cpu,inputPart,phase.controller,phase.latch,...banks.map(b=>b.id)]);
    if(owned.size!==banks.length+4)throw new TypeError('bus component IDs must be distinct');
    for(const other of circuit.parts.values())if(!owned.has(other.id)&&!other.evaluate)
        throw new TypeError('bus bridge refuses undeclared stateful or external parts');
    // Evaluators have already passed captureKernelEvaluatorImage admission.
    const terminals=new Map(image.terminals.map(t=>[t.name,t]));
    const map=(id,pins,field)=>Uint32Array.from(pins,p=>terminals.get(`${id}.${p}`)?.[field]??0xffffffff);
    const externalPins=[...external.pins];
    const maps={busInputNets:map(cpu,INPUTS,'net'),busOutputIds:map(cpu,OUTPUTS,'driver'),
        busExternalIds:map(inputPart,externalPins,'driver')};
    // Sparse publication preserves ordered writer semantics only when each
    // admitted terminal owns a distinct driver, as normal circuit images do.
    assertDistinctBusDrivers(maps);
    return {
        reserve(reserve){for(const [name,array]of Object.entries(maps))reserve(name,array.byteLength);
            reserve('busExternalValues',externalPins.length);reserve('busLifecycle',8);reserve('busRun',12);
            reserve('busResults',72);reserve('busContext',44);},
        initialize({e,p,put,inspect,inspectMemory,phaseMethods,memoryFault,admittedGraph}) {
            assertBusCircuitABI(e);
            for(const [name,array]of Object.entries(maps))put(name,array);
            e.bus_initialize(maxWaitStates);
            const view=new DataView(e.memory.buffer),word=(name,i=0)=>view.getUint32(p[name]+4*i,true);
            const externalValues=new Uint8Array(e.memory.buffer,p.busExternalValues,externalPins.length);
            externalValues.set(maps.busExternalIds.map(id=>image.driverLevels[id]));
            put('busContext',[p.context,p.phaseContext,p.busInputNets,p.busOutputIds,p.busExternalIds,p.busExternalValues,
                externalPins.length,p.busLifecycle,p.busRun,p.busResults,Number(admittedGraph)]);
            if(admittedGraph&&(e.admit_owned_bus_context(p.busContext,p.fault)>>>0)!==0)
                throw new CircuitFault('INVALID_KERNEL_ADMISSION','private bus-map admission failed');
            const lifecycle=()=>({periodOpen:!!word('busLifecycle'),faulted:!!word('busLifecycle',1)});
            const guard=(open=false)=>{
                if(word('busLifecycle',1))throw new CircuitFault('BOARD_FAULTED','reconstruct owned bus fixture');
                if(!!word('busLifecycle')!==open)throw new CircuitFault('CLOCK_ORDER','owned bus fixture period order');
            };
            const fault=result=>{
                if(!result)return;
                if(result<5)return memoryFault(result);
                const code=word('fault',1),slot=word('fault',2),pin=word('fault',3);
                if(result===6)throw new CircuitFault(code===1?'BOARD_FAULTED':'CLOCK_ORDER','owned bus fixture');
                if(result===7) {
                    if(code===2)throw new RangeError('clock overflow');
                    throw new CircuitFault(BUS_ERRORS[code]??'NATIVE_BUS_ERROR',`${cpu}.${INPUTS[slot]??'bus'}`);
                }
                if(result===8)throw new CircuitFault(code===1?'READY_MISMATCH':code===2?'INVALID_BUS_MAPPING':'BUS_UNAVAILABLE','owned bus fixture');
                const names=['','FLOATING','UNKNOWN','CONTENTION','INVALID_DRIVER_LEVEL','INVALID_PHASE_STATE','CLOCK_ORDER',
                    'UNSUPPORTED_COMMAND','STATUS_SEQUENCE','PHASE_COUNTER_OVERFLOW'];
                throw new CircuitFault(names[code]??'NATIVE_PHASE_ERROR',`${slot===0?phase.controller:phase.latch}.${(slot===0?PHASE_INPUTS:LATCH_INPUTS)[pin]??'phase'}`);
            };
            const update=values=>{
                if(!values||typeof values!=='object'||Array.isArray(values))throw new TypeError('external pin update');
                const updates=Object.entries(values).map(([pin,value])=>{
                    const index=externalPins.indexOf(pin);
                    if(index<0||![0,1,'X','Z'].includes(value))throw new CircuitFault('INVALID_DRIVER_LEVEL',`${inputPart}.${pin}`);
                    return [index,value==='X'?2:value==='Z'?3:value];
                });
                for(const [index,value]of updates)externalValues[index]=value;
            };
            const inspectBus=()=>{
                const get=i=>e.bus_inspect(i);
                return {state:BUS_STATES[get(0)],phase:get(1),open:!!get(2),faulted:!!get(3),
                    clock:get(4),resetClocks:get(5),initClocks:get(6),writeHold:get(7),address:get(8),
                    pending:get(9)?{index:get(10),waits:get(11),bytes:Array.from({length:get(12)},(_,i)=>get(13+i)),transferCount:get(15)}:null};
            };
            const inspectBusAdmission=()=>{
                const names=['attempts','admissions','failures','inputMapVisits','outputMapVisits','externalMapVisits'];
                const values=new Uint32Array(e.memory.buffer,e.bus_admission_counters_ptr(),names.length);
                return Object.freeze(Object.fromEntries(names.map((name,i)=>[name,values[i]])));
            };
            const resetBusAdmissionCounters=()=>e.reset_bus_admission_counters();
            const completion=pointer=>{
                const a=new Uint32Array(e.memory.buffer,pointer,9);if(!a[0])return null;
                return Object.freeze({kind:KINDS[a[1]],address:a[2],width:a[3],data:a[4],waits:a[5]+a[6]*4294967296,
                    last:!!a[7],...(a[7]?{operand:a[8]}:{})});
            };
            const beginClock=(values={})=>{guard();update(values);fault(e.begin_bus_memory_clock(p.busContext,p.fault));return inspect();};
            const endClock=()=>{guard(true);fault(e.end_bus_memory_clock(p.busContext,p.fault));return completion(e.bus_completion_ptr());};
            const submit=transaction=>{
                if(word('busLifecycle',1)||word('busLifecycle'))throw new CircuitFault('BOARD_FAULTED','board unavailable');
                // Admission needs four scalar flags, not a diagnostic snapshot
                // (including pending-byte copies and many extra Wasm calls).
                if(e.bus_inspect(3)||e.bus_inspect(2)||e.bus_inspect(9)||e.bus_inspect(0)!==BUS_IDLE)
                    throw new CircuitFault('BUS_UNAVAILABLE','reset/init/pending');
                if(!transaction||typeof transaction!=='object'||Object.keys(transaction).some(k=>!transactionFields.has(k)))
                    throw new CircuitFault('UNSUPPORTED_TRANSACTION','memory subset');
                const {kind,address,width=1,value=0,locked=false}=transaction;
                if(!KINDS.includes(kind)||locked!==false||!Number.isSafeInteger(address)||![1,2].includes(width)||!Number.isInteger(value))
                    throw new CircuitFault('UNSUPPORTED_TRANSACTION','memory subset');
                const code=e.bus_submit(KINDS.indexOf(kind),address,width,value,0);
                if(code)throw new CircuitFault(BUS_ERRORS[code],'memory subset');
            };
            const runUntilCompletion=({maxPeriods=1024,inputs={}}={})=>{
                guard();if(!Number.isInteger(maxPeriods)||maxPeriods<1||maxPeriods>8192)throw new RangeError('maxPeriods 1..8192');
                if(!e.bus_inspect(9))throw new CircuitFault('BUS_UNAVAILABLE','submit a transaction first');
                update(inputs);const result=e.run_bus_memory_until_completion(p.busContext,maxPeriods,p.fault);
                const completions=Object.freeze(Array.from({length:word('busRun',1)},(_,i)=>completion(p.busResults+i*36)));
                try{fault(result);}catch(error){
                    // Only fully successful period boundaries are counted here;
                    // the faulting period may already have advanced CPU clock.
                    error.progress=Object.freeze({stopReason:'fault',periods:word('busRun'),completions,busClock:e.bus_inspect(4)});
                    throw error;
                }
                const completed=!!word('busRun',2);
                return Object.freeze({completed,stopReason:completed?'completed':'budget',periods:word('busRun'),completions});
            };
            return {beginClock,endClock,submit,runUntilCompletion,inspectBus,inspectBusAdmission,resetBusAdmissionCounters,inspectLifecycle:lifecycle,
                inspectPhase:()=>({...phaseMethods.inspectPhase(),...lifecycle()}),inspect,inspectMemory};
        }
    };
}
