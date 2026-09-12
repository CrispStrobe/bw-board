import assert from 'node:assert/strict';
import {registerBusMemory} from '../src/devices/bus-memory.js';
import {createHarrisMemoryBoard} from '../src/experimental/harris-80c286-memory-board.js';

if (!process.argv.includes('--experimental')) {
    console.error('Refused: pass --experimental; this phase board does not execute CPU instructions.');
    process.exitCode = 1;
} else {
    registerBusMemory();
    const rom = new Uint8Array(65536);
    rom.set([0x34, 0x12, 0x78, 0x56], 0x500);
    const b = createHarrisMemoryBoard({enabled: true, rom});
    b.initialize();
    const read = address => {
        b.submit({kind: 'memory-read', address, width: 2});
        for (let i = 0; i < 8; i++) {
            const result = b.clock();
            if (result?.last) return result.operand;
        }
        throw new Error('read did not complete');
    };
    // Host arithmetic is deliberate until the resumable instruction core exists.
    const sum = (read(0xff0500) + read(0xff0502)) & 0xffff;
    b.submit({kind: 'memory-write', address: 0x500, width: 2, value: sum});
    for (let i = 0; i < 4; i++) b.clock({ready_n: 1});
    assert.equal(b.inspectMemory('ram0').writes, 0);
    b.clock({ready_n: 0});
    b.beginClock();
    const writesBeforeEdge = b.inspectMemory('ram0').writes;
    assert.equal(writesBeforeEdge, 0);
    b.endClock();
    const writesAfterEdge = b.inspectMemory('ram0').writes;
    assert.equal(writesAfterEdge, 1);
    assert.equal(read(0x500), 0x68ac);
    console.log(JSON.stringify({kind: 'latched-memory-phase-bridge', cpuExecuted: false,
        result: sum, writesBeforeEdge, writesAfterEdge, capabilities: b.capabilities}, null, 2));
}
