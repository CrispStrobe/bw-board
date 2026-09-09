/** Portable test-only native oracle at actual JS board settle boundaries. */
import {createOwnedWorkload} from './harris-owned-workloads.mjs';
import {captureWiredNetImage} from '../../src/experimental/wired-net-image.js';
import {createNativeOwnedKernel} from '../../src/experimental/wired-kernel/owned-kernel.js';
const same=(a,b)=>a.length===b.length&&a.every((value,i)=>value===b[i]);
export async function runNativeSettleOracle({wasmBytes,yieldTask=()=>Promise.resolve(),stopped=()=>false}) {
    const {board}=createOwnedWorkload('memory',{netBackend:'compiled',memoryScheduling:true,deviceScheduling:true,packedBus:true,driveLayouts:true});
    board.initialize();const circuit=board.circuit,kernel=await createNativeOwnedKernel({enabled:true,circuit,wasmBytes});
    const capture=()=>captureWiredNetImage({enabled:true,circuit}),original=circuit.settle.bind(circuit);let comparisons=0,periods=0;
    circuit.settle=()=>{
        const actual=kernel.settle(capture().driverLevels),delta=original(),after=capture();comparisons++;
        if(actual.delta!==delta||!same(actual.levels,after.resolvedLevels)||!same(actual.conflicts,after.resolvedConflicts)||!same(actual.driverLevels,after.driverLevels))
            throw new Error(`native settle oracle mismatch at period ${periods}, boundary ${comparisons}`);
        return delta;
    };
    const transactions=[{kind:'memory-write',address:0x501,width:2,value:0xbeef},{kind:'memory-read',address:0x501,width:2},
        ...[[0x20,0x13],[0x21,8],[0x21,1],[0x21,255],[0x43,0x34],[0x40,17],[0x40,0],[0x3f2,0]].map(([address,value])=>({kind:'io-write',address,value,width:1})),
        {kind:'io-read',address:0x40,width:1}];
    for(const transaction of transactions) {
        if(stopped())throw new Error('native oracle cancelled');
        board.submit(transaction);let complete=false;
        for(let clock=0;clock<64;clock++) {
            const result=board.clock({ready_n:Number(clock<8)});periods++;
            if(result?.last){complete=true;break;}
        }
        if(!complete)throw new Error('native oracle transaction budget exhausted');
        await yieldTask();
    }
    if(comparisons<=200)throw new Error('native oracle did not exercise the expected settle boundaries');
    return {accepted:true,periods,comparisons,transactions:transactions.length,capacityClaim:false,
        scope:'test-only owned combinational oracle; stateful board and CPU not ported'};
}
