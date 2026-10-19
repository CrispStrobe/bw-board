import {test} from 'node:test';
import assert from 'node:assert/strict';
import {I8086} from '../src/i8086.js';
import {registerBusMemory} from '../src/devices/bus-memory.js';
import {createHarrisMemoryBoard} from '../src/experimental/harris-80c286-memory-board.js';
import {HarrisBootCPU} from '../src/experimental/harris-80c286-boot-cpu.js';
import {createHarrisBootROM} from '../src/experimental/harris-boot-rom.js';
import {fat12Program, fat12Routines, patersonSource} from '../scripts/lib/paterson-routines.mjs';

registerBusMemory();
function execute(model, bytes, setup) {
        const memory = new Uint8Array(1 << 20); memory.set(bytes, 0x10100);
        const cpu = new I8086({read: a => memory[a], write: (a,v) => {memory[a] = v;}}, {variant: model});
        cpu.cs = 0x1000; cpu.ip = 0x100;
        setup((a,v) => {memory[a] = v;});
        let steps = 0; while (!cpu.halted && steps++ < 1000) cpu.step();
        assert.ok(cpu.halted, `${model} instruction budget exhausted`);
        return {di: cpu.di, si: cpu.si, sp: cpu.sp, flags: cpu.flags, read: a => memory[a]};
}

function wired(bytes, initial) {
    const rom = createHarrisBootROM();
    // Seed bytes in guest instructions so even test setup uses external writes.
    // Program offsets are fixed at 0100h, so use a separate reset-entry stub.
    const prelude = [];
    for (const [a,v] of initial) prelude.push(0xb0,v,0xa2,a & 255,a >> 8);
    const displacement = 0x100 - (0x800 + prelude.length + 3);
    prelude.push(0xe9, displacement & 255, (displacement >> 8) & 255);
    rom.set(bytes,0x100); rom.set(prelude,0x800); rom[0xfff1] = 0; rom[0xfff2] = 8;
    const board = createHarrisMemoryBoard({enabled:true, rom, romLowAlias:true});
    const cpu = new HarrisBootCPU({enabled:true, board}); cpu.initialize();
    assert.equal(cpu.run(20000).status, 'halted', JSON.stringify(cpu.inspect()));
    const even = board.inspectMemory('ram0').bytes, odd = board.inspectMemory('ram1').bytes;
    return {di:cpu.regs.di, si:cpu.regs.si, sp:cpu.regs.sp, flags:cpu.flags,
        read:a => (a & 1 ? odd : even)[a >> 1]};
}

test('Paterson source and MIT notice are pinned; SCP jump/size/prefix semantics are explicit', () => {
    assert.equal(patersonSource().manifest.commit, 'acbfced8a2d9828c6cd2c8ca8f12b35d0572d60b');
    const text = fat12Routines();
    assert.match(text, /JMP SHORT PACKIN/); assert.match(text, /MOV BYTE PTR \[CHGCLS\],1/);
    assert.match(text, /MOV DI,ES:\[DI\+BX\]/); assert.match(text, /SHR DI,1/);
    assert.throws(() => fat12Routines('no source'), /boundaries/);
});

for (const model of ['8086','80186','80286-wired-subset']) {
    for (const cluster of [2,3]) for (const value of [0,1,0xabc,0xfff]) {
        test(`${model}: actual Paterson PACK/UNPACK cluster ${cluster}, value ${value.toString(16)}`, () => {
            const a = 0x1600 + Math.floor(cluster * 3 / 2);
            const initial = [[a-1,0x69],[a,0x5a],[a+1,0xc3],[a+2,0x96]];
            const program = fat12Program({pack:true,cluster,value});
            const r = model === '80286-wired-subset' ? wired(program,initial)
                : execute(model,program,write => initial.forEach(([a,v]) => write(a,v)));
            assert.equal(r.di,value); assert.equal(r.si,cluster); assert.equal(r.sp,0xf000);
            assert.equal(r.read(0x500),1,'original CHGCLS byte was written');
            assert.equal(r.read(a-1),0x69); assert.equal(r.read(a+2),0x96);
            const original = 0xc35a;
            const expected = cluster & 1 ? (original & 15) | (value << 4) : (original & 0xf000) | value;
            assert.equal(r.read(a) | (r.read(a+1) << 8),expected,'independent FAT12 bit-packing oracle');
            assert.equal(!!(r.flags & 64),value === 0);
        });
    }
}
