/** Isolated native net-resolution prototype, not an admitted board backend. */
import {CircuitFault} from '../digital-circuit.js';
export async function createNativeNetResolver({enabled=false,image,wasmBytes}={}) {
    if(enabled!==true)throw new CircuitFault('EXPERIMENT_DISABLED','enabled:true required');
    if(image?.schema!=='bw-wired-net-image-v1')throw new TypeError('wired net image required');
    if(!(wasmBytes instanceof Uint8Array))throw new TypeError('owned Wasm bytes required');
    const nets=image.netNames.length,drivers=image.driverNames.length;
    for(const [array,length] of [[image.netOffsets,nets+1],[image.netDriverIds,drivers]])
        if(!(array instanceof Uint32Array)||array.length!==length)throw new TypeError('net index dimensions');
    if(!(image.driverLevels instanceof Uint8Array)||image.driverLevels.length!==drivers)throw new TypeError('driver dimensions');
    if(!(image.driverNets instanceof Uint32Array)||image.driverNets.length!==drivers)throw new TypeError('driver net dimensions');
    const invalid=()=>{throw new CircuitFault('INVALID_NET_IMAGE','inconsistent net membership');};
    if(image.netOffsets[0]!==0||image.netOffsets[nets]!==drivers)invalid();
    const seen=new Uint8Array(drivers);
    for(let n=0;n<nets;n++) {
        if(image.netOffsets[n]>image.netOffsets[n+1]||image.netOffsets[n+1]>drivers)invalid();
        for(let p=image.netOffsets[n];p<image.netOffsets[n+1];p++) {
            const d=image.netDriverIds[p];if(d>=drivers||seen[d]||image.driverNets[d]!==n)invalid();seen[d]=1;
        }
    }
    const {instance}=await WebAssembly.instantiate(wasmBytes,{}),e=instance.exports;
    const start=e.arena_ptr(),capacity=e.arena_capacity();
    const sizes=[(nets+1)*4,drivers*4,drivers,nets,nets];
    const pointers=[];let end=start;
    for(const size of sizes){pointers.push(end);end+=size;}
    if(!Number.isSafeInteger(end)||end-start>capacity||start<0||end>e.memory.buffer.byteLength)throw new RangeError('native net arena capacity');
    const view=new DataView(e.memory.buffer);
    for(let i=0;i<=nets;i++)view.setUint32(pointers[0]+i*4,image.netOffsets[i],true);
    for(let i=0;i<drivers;i++)view.setUint32(pointers[1]+i*4,image.netDriverIds[i],true);
    const initial=image.driverLevels.slice();
    const resolve=(levels=initial)=>{
        if(!(levels instanceof Uint8Array)||levels.length!==drivers)throw new TypeError('driver dimensions');
        new Uint8Array(e.memory.buffer,pointers[2],drivers).set(levels);
        const error=e.resolve_nets(nets,drivers,...pointers);
        if(error)throw new CircuitFault(error===2?'INVALID_DRIVER_LEVEL':'INVALID_NET_IMAGE','native resolver rejected input before output mutation');
        return {levels:new Uint8Array(e.memory.buffer,pointers[3],nets).slice(),
            conflicts:new Uint8Array(e.memory.buffer,pointers[4],nets).slice()};
    };
    resolve(); // Reject malformed tables before admitting this isolated resolver.
    return Object.freeze({capabilities:Object.freeze({experimental:true,netResolution:true,cpu:false,board:false,
        combinationalEvaluation:false,statefulDevices:false}),resolve});
}
