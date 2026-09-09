import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createOwnedWorkload,ownedWorkloads} from '../scripts/lib/harris-owned-workloads.mjs';
for(const name of ownedWorkloads)test(`event-scheduled full board matches reference owned ${name} workload`,()=>{
    const fixtures=[{}, {netBackend:'compiled',memoryScheduling:true,deviceScheduling:true}].map(options=>createOwnedWorkload(name,options));
    const counts=[];
    for(const f of fixtures) {
        f.cpu.initialize();let clocks=0;
        while(!f.finished(clocks)&&clocks<100000){f.cpu.stepClock();clocks++;}
        assert.ok(f.finished(clocks));f.verify();counts.push(clocks);
    }
    const [ref,fast]=fixtures;assert.equal(counts[0],counts[1]);assert.deepEqual(fast.cpu.inspect(),ref.cpu.inspect());
    for(const name of Object.keys(ref.devices))assert.deepEqual(fast.devices[name].inspect(),ref.devices[name].inspect());
    for(const region of ref.board.memoryMap)for(const id of region.chips)assert.deepEqual(fast.board.inspectMemory(id),ref.board.inspectMemory(id));
});
