/** Connectivity/driver image only, NOT a resumable CPU or complete circuit. */
import {DigitalCircuit,CircuitFault} from './digital-circuit.js';
import {CompiledDigitalCircuit} from './compiled-digital-circuit.js';
const encode=value=>value===0?0:value===1?1:value==='X'?2:value==='Z'?3:-1;
export function captureWiredNetImage({enabled=false,circuit}={}) {
    if(enabled!==true)throw new CircuitFault('EXPERIMENT_DISABLED','enabled:true required');
    if(!(circuit instanceof DigitalCircuit)&&!(circuit instanceof CompiledDigitalCircuit))throw new TypeError('validated digital circuit required');
    const snapshot=circuit.snapshot,netNames=[...snapshot.keys()],netIds=new Map(netNames.map((name,i)=>[name,i]));
    const driverNames=[...circuit.outputs],driverIds=new Map(driverNames.map((name,i)=>[name,i]));
    const groups=netNames.map(()=>[]),driverNets=new Uint32Array(driverNames.length),driverLevels=new Uint8Array(driverNames.length);
    const drives=circuit.drives;
    for(let d=0;d<driverNames.length;d++) {
        const name=driverNames[d],net=netIds.get(circuit.root(name));
        if(net===undefined)throw new Error(`driver without net: ${name}`);
        const level=encode(drives.has(name)?drives.get(name):'Z');if(level<0)throw new Error(`invalid driver: ${name}`);
        driverNets[d]=net;driverLevels[d]=level;groups[net].push(d);
    }
    const netOffsets=new Uint32Array(netNames.length+1),netDriverIds=new Uint32Array(driverNames.length);
    let cursor=0;
    for(let n=0;n<groups.length;n++) {
        netOffsets[n]=cursor;
        groups[n].sort((a,b)=>driverNames[a].localeCompare(driverNames[b]));
        for(const d of groups[n])netDriverIds[cursor++]=d;
    }
    netOffsets[netNames.length]=cursor;
    const terminals=[...circuit.parent.keys()].map(name=>({name,net:netIds.get(circuit.root(name)),driver:driverIds.get(name)??null}));
    return {schema:'bw-wired-net-image-v1',capabilities:{connectivity:true,fourState:true,
        combinationalEvaluation:false,statefulDevices:false,cpu:false,resumableSnapshot:false},
        netNames,driverNames,terminals,driverNets,driverLevels,netOffsets,netDriverIds,
        resolvedLevels:Uint8Array.from(netNames,name=>encode(snapshot.get(name).value)),
        resolvedConflicts:Uint8Array.from(netNames,name=>Number(snapshot.get(name).conflict))};
}
