/** Standalone gated component, not a registered board/backend or CPU.
 * Images contain pin levels, not callbacks; no getter/callback ordering contract.
 * Only C decides which unknown/floating pins to sample and in what order. */
import {CircuitFault} from '../digital-circuit.js';
const INPUTS = ['reset','hold','pereq','intr','nmi','busy_n','error_n','ready_n',
    ...Array.from({length:16},(_,i)=>`d${i}`)];
const OUTPUTS = [...Array.from({length:24},(_,i)=>`a${i}`),
    ...Array.from({length:16},(_,i)=>`d${i}`),
    'bhe_n','s1_n','s0_n','cod_inta_n','m_io','lock_n','hlda','peack_n'];
const STATES = ['RESET_REQUIRED','RESET','INIT','TI','TS','TC'];
const KINDS = ['memory-read','code-read','memory-write'];
const ERRORS = ['', 'CLOCK_ORDER','OVERFLOW','FLOATING','UNKNOWN','BUS_FAULTED',
    'RESET_REQUIRED','SHORT_RESET','UNSUPPORTED_HOLD','UNSUPPORTED_INPUT','WAIT_LIMIT',
    'BUS_UNAVAILABLE','UNSUPPORTED_TRANSACTION'];
const decode = value => value < 2 ? value : value === 3 ? 'Z' : 'X';
const encode = value => value === 0 || value === 1 ? value : value === 'Z' ? 3 : 2;

export async function createNative286MemoryBus({enabled=false,module,maxWaitStates=1024,...unsupported}={}) {
    if(enabled!==true)throw new CircuitFault('EXPERIMENT_DISABLED','enabled:true required');
    if(Object.keys(unsupported).length)throw new CircuitFault('UNSUPPORTED_FEATURE',Object.keys(unsupported).join(', '));
    if(!Number.isSafeInteger(maxWaitStates)||maxWaitStates<1)throw new RangeError('limits');
    const compiled=module instanceof WebAssembly.Module?module:await WebAssembly.compile(module);
    if(WebAssembly.Module.imports(compiled).length)throw new TypeError('standalone module must have no imports');
    const {exports:e}=await WebAssembly.instantiate(compiled);
    if(e.bus_sequencer_version?.()!==1)throw new TypeError('bus sequencer ABI');
    e.bus_initialize(maxWaitStates);
    const inputs=new Uint32Array(e.memory.buffer,e.bus_input_ptr(),24);
    const outputs=new Uint32Array(e.memory.buffer,e.bus_output_ptr(),48);
    const completion=new Uint32Array(e.memory.buffer,e.bus_completion_ptr(),9);
    const check=code=>{
        if(!code)return;
        if(code===2)throw new RangeError('clock overflow');
        throw new CircuitFault(ERRORS[code]??'NATIVE_BUS_ERROR',
            [3,4,9].includes(code)?INPUTS[e.bus_error_pin()]:ERRORS[code]);
    };
    const image=levels=>{
        if(!levels||typeof levels!=='object'||Array.isArray(levels))throw new TypeError('pin-level image');
        for(let i=0;i<INPUTS.length;i++)inputs[i]=encode(levels[INPUTS[i]]);
    };
    const inspect=()=>{
        const get=i=>e.bus_inspect(i);
        return {state:STATES[get(0)],phase:get(1),open:!!get(2),faulted:!!get(3),
            clock:get(4),resetClocks:get(5),initClocks:get(6),writeHold:get(7),address:get(8),
            pending:get(9)?{index:get(10),waits:get(11),bytes:Array.from({length:get(12)},(_,i)=>get(13+i)),
                transferCount:get(15)}:null};
    };
    return Object.freeze({
        capabilities:Object.freeze({experimental:true,cpu:false,systemClockStepping:true,
            fidelity:'non-pipelined-system-clock-phases',memoryTransactions:true,
            interrupts:false,hold:false,lock:false,io:false,snapshots:false}),
        submit(transaction) {
            // Availability wins over transaction validation, as in the reference.
            const s=inspect();
            if(s.faulted||s.open||s.pending||s.state!=='TI')check(11);
            if(!transaction||typeof transaction!=='object')check(12);
            if(Object.keys(transaction).some(key=>!['kind','address','width','value','locked'].includes(key)))check(12);
            const {kind,address,width=1,value=0,locked=false}=transaction;
            if(!KINDS.includes(kind)||locked!==false||!Number.isSafeInteger(address)||
                ![1,2].includes(width)||!Number.isInteger(value))check(12);
            check(e.bus_submit(KINDS.indexOf(kind),address,width,value,0));
        },
        beginClock(levels) {
            // Clock-order errors precede sampling and do not latch faulted.
            if(inspect().open)check(1);
            image(levels);check(e.bus_begin());
            return Object.fromEntries(OUTPUTS.map((pin,i)=>[pin,decode(outputs[i])]));
        },
        endClock(levels) {
            if(!inspect().open)check(1);
            image(levels);check(e.bus_end());
            if(!completion[0])return null;
            return Object.freeze({kind:KINDS[completion[1]],address:completion[2],width:completion[3],
                data:completion[4],waits:completion[5]+completion[6]*4294967296,last:!!completion[7],
                ...(completion[7]?{operand:completion[8]}:{})});
        },
        inspect
    });
}
