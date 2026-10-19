import {test} from 'node:test';
import assert from 'node:assert/strict';
import {I8086} from '../src/i8086.js';

test('specialized MOVS/STOS preserve callback, trace, overlap, wrap and interrupt behavior', () => {
    for (const opcode of [0xa4, 0xa5, 0xaa, 0xab])
    for (const prefix of [[], [0xf2], [0xf3], [0x2e, 0xf3], [0xf3, 0x2e]])
    for (const count of [0, 1, 2, 31]) for (const direction of [0, 0x400])
    for (const stop of [0, 1, 3]) {
        const receipts = [false, true].map(specialized => {
            const mem = new Uint8Array(1 << 20);
            for (let i = 0; i < mem.length; i++) mem[i] = i & 255;
            const accesses = [];
            let writes = 0;
            const cpu = new I8086({read: a => {accesses.push(['r', a]); return mem[a];},
                write: (a, v) => {accesses.push(['w', a, v]); mem[a] = v; writes++;},
                intPending: () => stop > 0 && writes >= stop});
            cpu.cs = 0x1000; cpu.ip = 0x100; cpu.ds = 0xffff; cpu.es = 0xffff;
            cpu.si = 0xffff; cpu.di = 0; cpu.cx = count; cpu.ax = 0x1234;
            cpu.flags = 0x202 | direction; cpu.busTrace = [];
            mem.set([...prefix, opcode], 0x10100);
            if (!specialized) {
                cpu._repeatMovs = w => cpu._repeat(() => cpu._movs(w), false);
                cpu._repeatStos = w => cpu._repeat(() => cpu._stos(w), false);
            }
            const cycles = cpu.step();
            return {cycles, mem, accesses, trace: cpu.busTrace,
                regs: ['ax','cx','si','di','ip','flags','repInterrupted'].map(k => cpu[k])};
        });
        assert.deepEqual(receipts[0], receipts[1]);
    }
});
