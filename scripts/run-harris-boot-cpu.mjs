import assert from 'node:assert/strict';
import {registerBusMemory} from '../src/devices/bus-memory.js';
import {createHarrisMemoryBoard} from '../src/experimental/harris-80c286-memory-board.js';
import {HarrisBootCPU} from '../src/experimental/harris-80c286-boot-cpu.js';
import {createHarrisBootROM} from '../src/experimental/harris-boot-rom.js';

if (!process.argv.includes('--experimental')) {
    console.error('Refused: pass --experimental; limited boot CPU, not general 80286 support.');
    process.exitCode = 1;
} else {
    registerBusMemory();
    const board = createHarrisMemoryBoard({enabled: true, rom: createHarrisBootROM(), romLowAlias: true});
    const cpu = new HarrisBootCPU({enabled: true, board});
    cpu.initialize();
    const run = cpu.run(512);
    assert.equal(run.status, 'halted');
    const result = board.inspectMemory('ram0').bytes[0x282] | (board.inspectMemory('ram1').bytes[0x282] << 8);
    assert.equal(result, 0x68ac);
    assert.equal(cpu.retired, 10);
    console.log(JSON.stringify({cpuExecuted: true, result, run, capabilities: cpu.capabilities,
        final: cpu.inspect()}, null, 2));
}
