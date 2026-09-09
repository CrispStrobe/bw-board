import {createOwnedWorkload} from '../scripts/lib/harris-owned-workloads.mjs';
import {runHarrisChunks} from '../src/experimental/harris-run-chunks.js';
const channel=new MessageChannel(),wakeups=[];
channel.port1.onmessage=()=>wakeups.shift()?.();
const yieldTask=()=>new Promise(resolve=>{wakeups.push(resolve);channel.port2.postMessage(0);});
const hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
let active=null;
self.onmessage=async({data})=>{
    if(data.kind==='cancel'){if(active?.id===data.id)active.cancelled=true;return;}
    if(!['run','kernel-oracle'].includes(data.kind)||active){self.postMessage({id:data.id,error:'worker busy or unsupported command'});return;}
    active={id:data.id,cancelled:false};
    try {
        if(data.kind==='kernel-oracle') {
            const wasmBytes=new Uint8Array(await (await fetch('/kernel.wasm')).arrayBuffer()),moduleSHA256=await hash(wasmBytes);
            if(moduleSHA256!==data.sha256)throw new Error('native oracle module hash mismatch');
            const {runNativeSettleOracle}=await import('../scripts/lib/harris-native-settle-oracle.mjs');
            const nativeOracle=await runNativeSettleOracle({wasmBytes,yieldTask,stopped:()=>active.cancelled});
            if(data.memory) {
                const {runNativeMemoryOracle}=await import('../scripts/lib/harris-native-memory-oracle.mjs');
                nativeOracle.memory=await runNativeMemoryOracle({wasmBytes,yieldTask,stopped:()=>active.cancelled});
            }
            if(data.memoryCircuit) {
                const {runNativeMemoryCircuitOracle}=await import('../scripts/lib/harris-native-memory-circuit-oracle.mjs');
                nativeOracle.memoryCircuit=await runNativeMemoryCircuitOracle({wasmBytes,yieldTask,stopped:()=>active.cancelled});
            }
            if(data.phase) {
                const {runNativePhaseOracle}=await import('../scripts/lib/harris-native-phase-oracle.mjs');
                nativeOracle.phase=await runNativePhaseOracle({wasmBytes,yieldTask,stopped:()=>active.cancelled});
            }
            if(data.phaseCircuit) {
                const {runNativePhaseCircuitOracle}=await import('../scripts/lib/harris-native-phase-circuit-oracle.mjs');
                nativeOracle.phaseCircuit=await runNativePhaseCircuitOracle({wasmBytes,yieldTask,stopped:()=>active.cancelled});
            }
            if(data.schedule) {
                const {runNativePhaseScheduleOracle}=await import('../scripts/lib/harris-native-phase-schedule-oracle.mjs');
                nativeOracle.schedule=await runNativePhaseScheduleOracle({wasmBytes,yieldTask,stopped:()=>active.cancelled});
            }
            if(data.admittedGraph) {
                const {runNativeMemoryCircuitOracle}=await import('../scripts/lib/harris-native-memory-circuit-oracle.mjs');
                const {runNativePhaseCircuitOracle}=await import('../scripts/lib/harris-native-phase-circuit-oracle.mjs');
                const {runNativePhaseScheduleOracle}=await import('../scripts/lib/harris-native-phase-schedule-oracle.mjs');
                const options={wasmBytes,yieldTask,stopped:()=>active.cancelled,admittedGraph:true};
                nativeOracle.admittedGraph={accepted:true,capacityClaim:false,
                    memory:await runNativeMemoryCircuitOracle({...options,swapAddress:true}),
                    phase:await runNativePhaseCircuitOracle(options),schedule:await runNativePhaseScheduleOracle(options)};
            }
            self.postMessage({id:data.id,nativeOracle:{...nativeOracle,moduleSHA256}});return;
        }
        const f=createOwnedWorkload(data.name,{...data.options,busTraceEnabled:false});
        const start=performance.now();f.cpu.initialize();
        const run=await runHarrisChunks({cpu:f.cpu,maxClocks:100000,finished:f.finished,stopped:()=>active.cancelled,yieldTask});
        const elapsedMS=performance.now()-start;
        if(run.status==='completed')f.verify();
        const memory={};
        for(const region of f.board.memoryMap)for(const id of region.chips) {
            const {bytes,...state}=f.board.inspectMemory(id);memory[id]={...state,sha256:await hash(bytes)};
        }
        const state={clocks:run.clocks,cpu:f.cpu.inspect(),devices:Object.fromEntries(Object.entries(f.devices).map(([name,device])=>[name,device.inspect()])),memory};
        self.postMessage({id:data.id,name:data.name,run,elapsedMS,periodClosed:!f.board.bus.open,state,stateSHA256:await hash(new TextEncoder().encode(JSON.stringify(state)))});
    }catch(error){self.postMessage({id:data.id,error:error.message,code:error.code??error.name});}
    finally {active=null;}
};
