/** Cooperative host boundary around the existing clock stepper, not a new CPU. */
export async function runHarrisChunks({cpu,maxClocks,finished=()=>cpu.status!=='running',stopped=()=>false,
    beforeClock=()=>{},chunkClocks=65536,wallBudgetMS=8,checkEvery=32,
    now=()=>performance.now(),yieldTask=()=>new Promise(resolve=>setTimeout(resolve,0))}) {
    for(const [name,value] of Object.entries({maxClocks,chunkClocks,checkEvery}))
        if(!Number.isSafeInteger(value)||value<1)throw new RangeError(name);
    if(!Number.isFinite(wallBudgetMS)||wallBudgetMS<=0)throw new RangeError('wallBudgetMS');
    let clocks=0,chunks=0,maxChunkMS=0;
    while(clocks<maxClocks&&!finished(clocks)) {
        if(stopped(clocks))return {status:'stopped',clocks,chunks,maxChunkMS};
        const start=now();let count=0;
        while(clocks<maxClocks&&count<chunkClocks&&!finished(clocks)&&!stopped(clocks)) {
            beforeClock(clocks);cpu.stepClock();clocks++;count++;
            if(count%checkEvery===0&&now()-start>=wallBudgetMS)break;
        }
        chunks++;maxChunkMS=Math.max(maxChunkMS,now()-start);
        if(stopped(clocks))return {status:'stopped',clocks,chunks,maxChunkMS};
        if(!finished(clocks)&&clocks<maxClocks)await yieldTask();
    }
    return {status:finished(clocks)?'completed':'budget-exhausted',clocks,chunks,maxChunkMS};
}
