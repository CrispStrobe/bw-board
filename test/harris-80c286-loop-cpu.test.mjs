import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assembleRaw} from '../src/i8086-asm.js';
import {I8086} from '../src/i8086.js';
import {registerBusMemory} from '../src/devices/bus-memory.js';
import {createHarrisMemoryBoard} from '../src/experimental/harris-80c286-memory-board.js';
import {HarrisBootCPU, bootSub16} from '../src/experimental/harris-80c286-boot-cpu.js';
import {createHarrisBootROM, createHarrisLoopROM} from '../src/experimental/harris-boot-rom.js';

registerBusMemory();
const fault = code => e => e.code === code;
const word = (b, a) => b.inspectMemory('ram0').bytes[a >> 1] | (b.inspectMemory('ram1').bytes[a >> 1] << 8);
function sourceROM(source) {
    const rom = createHarrisBootROM(); rom.fill(255, 0x100, 0xfff0);
    rom.set(assembleRaw(source, 0x100), 0x100); return rom;
}
function fixture(rom = createHarrisLoopROM(), options = {}) {
    const board = createHarrisMemoryBoard({enabled: true, rom, romLowAlias: true});
    const cpu = new HarrisBootCPU({enabled: true, board, ...options}); cpu.initialize();
    return {cpu, board};
}
function reference(rom) {
    const memory = new Uint8Array(1 << 20); memory.set(rom, 0xf0000);
    const cpu = new I8086({read: a => memory[a], write: (a, v) => { memory[a] = v; }});
    let retired = 0;
    while (!cpu.halted && retired < 1000) { cpu.step(); retired++; }
    assert.ok(cpu.halted);
    return {cpu, memory, retired};
}

test('owned loop assembly reproduces the ROM bytes exactly', () => {
    const bytes = assembleRaw(readFileSync(new URL('./fixtures/harris-boot/loop.asm', import.meta.url), 'utf8'), 0x100);
    assert.deepEqual([...createHarrisLoopROM().slice(0x100, 0x100 + bytes.length)], [...bytes]);
});

test('guest loop fills RAM, sums it, verifies it and retires the same work as the independent decoder', () => {
    const {cpu, board} = fixture();
    assert.equal(cpu.run().status, 'halted');
    assert.deepEqual([0, 2, 4, 6].map(d => word(board, 0x500 + d)), [1, 2, 3, 4]);
    assert.equal(word(board, 0x510), 10); assert.equal(cpu.retired, 47);
    const r = reference(createHarrisLoopROM());
    assert.equal(cpu.retired, r.retired);
    for (const reg of ['ax', 'bx', 'cx']) assert.equal(cpu.regs[reg], r.cpu[reg]);
    assert.equal(cpu.flags & 0x8d5, r.cpu.flags & 0x8d5);
    for (let a = 0x500; a <= 0x510; a += 2) assert.equal(word(board, a), r.memory[a] | (r.memory[a + 1] << 8));
});

test('guest mismatch branch executes the failure path rather than host-forcing a success', () => {
    const rom = createHarrisLoopROM(); rom[0x120] = 11; // compare expected sum to 11 instead of 10
    const {cpu, board} = fixture(rom); cpu.run();
    assert.equal(word(board, 0x510), 0xdead);
    assert.equal(cpu.retired, 48);
    assert.equal(cpu.regs.ax, reference(rom).cpu.ax);
});

test('all 256 word ModR/M encodings decode register/address/segment fields (decoder unit, not circuit test)', () => {
    const cpu = new HarrisBootCPU({enabled: true, board: {initialize() {}, submit() {}, clock() {}}});
    cpu.initialize();
    const names = ['ax', 'cx', 'dx', 'bx', 'sp', 'bp', 'si', 'di'];
    Object.assign(cpu.regs, {bx: 0x100, bp: 0x300, si: 0x10, di: 0x20});
    cpu.ds = 0x10; cpu.ss = 0x20;
    const bases = [0x110, 0x120, 0x310, 0x320, 0x10, 0x20, 0x300, 0x100];
    for (let code = 0; code < 256; code++) {
        cpu.ip = 0x100; cpu.instructionBytes = 0;
        const it = cpu._operand(); const bytes = [code, 0xf0, 0xff];
        let next = it.next(); let reads = 0;
        while (!next.done && reads < bytes.length) next = it.next(bytes[reads++]);
        assert.ok(next.done);
        assert.equal(next.value.reg, names[(code >> 3) & 7]);
        const mod = code >> 6, rm = code & 7;
        if (mod === 3) { assert.deepEqual(next.value.operand, {register: names[rm]}); continue; }
        const direct = mod === 0 && rm === 6;
        assert.equal(next.value.operand.offset, direct ? 0xfff0 : (bases[rm] + (mod ? -16 : 0)) & 65535);
        assert.equal(next.value.operand.segment, !direct && [2, 3, 6].includes(rm) ? 0x20 : 0x10);
    }
});

test('MOV register/direct/indexed words and signed displacement accesses use wired RAM', () => {
    const rom = sourceROM(`MOV BX,0502h
MOV SI,2
MOV DX,1234h
MOV [BX+SI-4],DX
MOV CX,[0500h]
MOV AX,CX
ADD AX,DX
MOV [BX+SI+0100h],AX
HLT`);
    const {cpu, board} = fixture(rom); cpu.run();
    assert.equal(word(board, 0x500), 0x1234); assert.equal(word(board, 0x604), 0x2468);
    const r = reference(rom);
    for (const reg of ['ax', 'cx', 'dx']) assert.equal(cpu.regs[reg], r.cpu[reg]);
});

test('BP addressing selects SS while direct disp16 selects DS on the actual board', () => {
    const {cpu, board} = fixture(sourceROM(`MOV BP,0500h
MOV AX,1234h
MOV [BP],AX
MOV AX,5678h
MOV [0500h],AX
MOV DX,[BP]
HLT`));
    // Test initial-state injection, NOT an implemented MOV SS instruction.
    cpu.ss = 0x100;
    cpu.run();
    assert.equal(word(board, 0x1500), 0x1234);
    assert.equal(word(board, 0x500), 0x5678);
    assert.equal(cpu.regs.dx, 0x1234);
});

test('CMP does not write its operands; JE/JNE use the comparison and INC/DEC preserve carry', () => {
    const {cpu} = fixture(sourceROM(`MOV AX,0
INC AX
DEC AX
MOV CX,0
CMP AX,CX
JE equal
MOV AX,0DEADh
equal:
MOV DX,2
HLT`));
    cpu.flags = 3;
    while (cpu.retired < 4) cpu.stepClock(); // reset JMP, MOV, INC, DEC
    assert.equal(cpu.flags & 1, 1); assert.equal(cpu.regs.ax, 0);
    cpu.run(); assert.equal(cpu.regs.ax, 0); assert.equal(cpu.regs.dx, 2); assert.equal(cpu.regs.cx, 0);
});

test('LOOP leaves flags unchanged and zero count wraps to FFFF, not immediate termination', () => {
    const {cpu} = fixture(sourceROM(`MOV CX,0
again: LOOP again
HLT`));
    cpu.flags = 0x843;
    let clocks = 0;
    while (cpu.retired < 3 && clocks++ < 80) cpu.stepClock();
    assert.equal(cpu.retired, 3); assert.equal(cpu.regs.cx, 0xffff);
    assert.equal(cpu.flags, 0x843);
    assert.equal(cpu.run(16).status, 'budget-exhausted'); cpu.cancel();
});

test('near and short jumps skip bytes and backward infinite branches remain budgeted', () => {
    const rom = createHarrisBootROM();
    rom.set([0xe9, 0x03, 0x00, 0xb8, 0xad, 0xde, 0xeb, 0x01, 0xff, 0xf4], 0x100);
    const {cpu} = fixture(rom); assert.equal(cpu.run().status, 'halted'); assert.equal(cpu.regs.ax, 0);
    const loop = fixture(sourceROM('again: JMP SHORT again'));
    assert.equal(loop.cpu.run(64).status, 'budget-exhausted');
    assert.equal(loop.cpu.status, 'running'); loop.cpu.cancel();
});

test('ModR/M stores do not retire or advance loop registers during READY waits', () => {
    const {cpu, board} = fixture(); let clocks = 0;
    while (board.bus.pending?.kind !== 'memory-write' && clocks++ < 150) cpu.stepClock();
    assert.equal(board.bus.pending.kind, 'memory-write');
    const before = cpu.inspect();
    for (let i = 0; i < 8; i++) cpu.stepClock(1);
    assert.equal(cpu.retired, before.retired); assert.deepEqual(cpu.regs, before.registers);
    assert.equal(word(board, 0x500), 0);
    assert.equal(cpu.run().status, 'halted'); assert.equal(word(board, 0x510), 10);
    assert.equal(board.inspectMemory('ram0').writes, 5);
});

test('CMP/subtraction flags match independent arithmetic expectations', () => {
    for (let i = 0; i < 256; i++) {
        const a = (i * 257) & 65535, b = (i * 997 + 12345) & 65535;
        const {result, flags} = bootSub16(a, b, 0x602);
        const signed = v => v < 32768 ? v : v - 65536;
        const s = signed(a) - signed(b);
        const bits = (result & 255).toString(2).replaceAll('0', '').length;
        const expected = Number(a < b) | (bits % 2 === 0 ? 4 : 0) | (a % 16 < b % 16 ? 16 : 0) |
            (result === 0 ? 64 : 0) | (result >= 32768 ? 128 : 0) | (s < -32768 || s > 32767 ? 2048 : 0);
        assert.equal(flags & 0x8d5, expected); assert.equal(flags & 0x602, 0x602);
    }
});

test('memory-destination ADD delays its flags and retirement until the RMW write edge', () => {
    const rom = sourceROM(`MOV AX,0FFFFh
MOV [0500h],AX
MOV AX,1
MOV BX,0500h
ADD [BX],AX
CMP [BX],AX
HLT`);
    const {cpu, board} = fixture(rom);
    let clocks = 0;
    while (!(cpu.retired === 5 && board.bus.pending?.kind === 'memory-write') && clocks++ < 250) cpu.stepClock();
    assert.equal(cpu.retired, 5);
    const before = cpu.flags;
    for (let i = 0; i < 8; i++) cpu.stepClock(1);
    assert.equal(cpu.flags, before); assert.equal(cpu.retired, 5);
    assert.equal(word(board, 0x500), 0xffff);
    while (cpu.retired === 5 && clocks++ < 270) cpu.stepClock();
    assert.equal(cpu.flags, 0x57); assert.equal(word(board, 0x500), 0);
    assert.equal(cpu.run().status, 'halted');
    const r = reference(rom); assert.equal(cpu.flags & 0x8d5, r.cpu.flags & 0x8d5);
    assert.equal(board.inspectMemory('ram0').writes, 2);
});

test('near branch wraps within its 16-bit segment and history stays bounded', () => {
    const rom = createHarrisBootROM(); rom.set([0xe9, 0x00, 0xfe], 0x100); // 0103h - 0200h
    rom[0xff03] = 0xf4;
    const {cpu} = fixture(rom); assert.equal(cpu.run().status,'halted'); assert.equal(cpu.ip,0xff04);
    const good = fixture(createHarrisLoopROM(), {historyLimit: 3}); good.cpu.run();
    assert.equal(good.cpu.inspect().history.length, 3); assert.equal(good.cpu.inspect().dropped, 44);
});
