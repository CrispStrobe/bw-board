/** Owned synthetic-master demonstration, not CPU firmware execution. */
import assert from 'node:assert/strict';
import {createWiredBusLab} from '../src/experimental/wired-bus-lab.js';

if (!process.argv.includes('--experimental')) {
    console.error('Refused: pass --experimental (synthetic bus master, NOT an 80286 emulator).');
    process.exitCode = 1;
} else {
    const rom = new Uint8Array(65536);
    rom.set([0x34, 0x12, 0x78, 0x56], 0x500);
    const lab = createWiredBusLab({enabled: true, rom});
    const run = transaction => { lab.begin(transaction); return lab.step(); };
    const a = run({address: 0xff0500, width: 2}).data;
    const b = run({address: 0xff0502, width: 2}).data;
    // Host arithmetic is deliberate: the M1 master does NOT decode instructions.
    lab.setReady(0);
    lab.begin({address: 0x500, width: 2, write: true, value: (a + b) & 0xffff});
    assert.equal(lab.step(), null);
    assert.equal(lab.inspectMemory('ram0').writes, 0);
    lab.setReady(1);
    lab.step();
    const result = run({address: 0x500, width: 2}).data;
    assert.equal(result, 0x68ac);
    console.log(JSON.stringify({kind: 'synthetic-bus-foundation', cpuExecuted: false,
        result, capabilities: lab.capabilities, trace: lab.getTrace()}, null, 2));
}
