import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assembleRaw} from '../src/i8086-asm.js';
import {registerBusMemory} from '../src/devices/bus-memory.js';
import {I8086} from '../src/i8086.js';
import {createHarrisMemoryBoard} from '../src/experimental/harris-80c286-memory-board.js';
import {HarrisBootCPU, bootAdd16} from '../src/experimental/harris-80c286-boot-cpu.js';
import {createHarrisBootROM} from '../src/experimental/harris-boot-rom.js';

registerBusMemory();
const fault = code => e => e.code === code;
function fixture(options = {}) {
    const board = createHarrisMemoryBoard({enabled: true, rom: createHarrisBootROM(), romLowAlias: true, ...options});
    const cpu = new HarrisBootCPU({enabled: true, board});
    cpu.initialize();
    return {cpu, board};
}
const ramWord = (board, at) => board.inspectMemory('ram0').bytes[at >> 1] |
    (board.inspectMemory('ram1').bytes[at >> 1] << 8);
function programROM(bytes) {
    const rom = createHarrisBootROM(); rom.fill(255, 0x100, 0xfff0); rom.set(bytes, 0x100); return rom;
}

test('owned assembly sources reproduce the embedded reset and program bytes exactly', () => {
    const rom = createHarrisBootROM();
    for (const [file, offset] of [['reset.asm', 0xfff0], ['program.asm', 0x100]]) {
        const source = readFileSync(new URL(`./fixtures/harris-boot/${file}`, import.meta.url), 'utf8');
        const bytes = assembleRaw(source, offset);
        assert.deepEqual([...rom.slice(offset, offset + bytes.length)], [...bytes]);
    }
});

test('boot executor is gated and advertises its limited instruction scope', () => {
    assert.throws(() => new HarrisBootCPU(), fault('EXPERIMENT_DISABLED'));
    const {cpu} = fixture();
    assert.equal(cpu.capabilities.instructionExecution, true);
    for (const key of ['general80286', 'protectedMode', 'snapshots', 'instructionTiming', 'prefetch', 'busHaltSignalling']) assert.equal(cpu.capabilities[key], false);
});

test('owned ROM actually executes reset jump, operand stores, load, add, result store and HLT', () => {
    const {cpu, board} = fixture();
    assert.equal(cpu.inspect().cs, 0xf000);
    assert.equal(cpu.inspect().csBase, 0xff0000);
    assert.equal(cpu.inspect().ip, 0xfff0);
    const result = cpu.run();
    assert.equal(result.status, 'halted'); assert.equal(result.retired, 10);
    assert.equal(ramWord(board, 0x500), 0x1234);
    assert.equal(ramWord(board, 0x502), 0x5678);
    assert.equal(ramWord(board, 0x504), 0x68ac);
    const state = cpu.inspect();
    assert.equal(state.registers.ax, 0x68ac); assert.equal(state.flags, 6);
    assert.equal(state.csBase, 0xf0000); assert.equal(state.ip, 0x118);
    assert.deepEqual(state.history.map(e => e.opcode), [0xea, 0xfa, 0xb8, 0xa3, 0xb8, 0xa3, 0xa1, 0x03, 0xa3, 0xf4]);
    assert.equal(state.history[0].physical, 0xfffff0);
    assert.equal(state.history[1].physical, 0xf0100);
    assert.equal(board.inspectMemory('ram0').writes, 3);
    assert.equal(board.inspectMemory('ram1').writes, 3);
    assert.throws(() => cpu.stepClock(), fault('CPU_NOT_RUNNING'));
});

test('existing independent 8086 decoder agrees on defined common-subset results', () => {
    const rom = createHarrisBootROM();
    const mem = new Uint8Array(1 << 20); mem.set(rom, 0xf0000);
    const reference = new I8086({read: a => mem[a], write: (a, v) => { mem[a] = v; }});
    let retired = 0;
    while (!reference.halted && retired < 20) { reference.step(); retired++; }
    assert.equal(reference.halted, true);
    const {cpu, board} = fixture(); cpu.run();
    assert.equal(cpu.retired, retired);
    assert.equal(cpu.regs.ax, reference.ax);
    assert.equal(cpu.flags & 0x8d5, reference.flags & 0x8d5, 'compare arithmetic flags, not 8086 reserved bits');
    for (const a of [0x500, 0x502, 0x504]) assert.equal(ramWord(board, a), mem[a] | (mem[a + 1] << 8));
});

test('READY delays instruction bytes without advancing IP or retiring an instruction', () => {
    const {cpu} = fixture();
    for (let i = 0; i < 8; i++) cpu.stepClock(1);
    assert.equal(cpu.ip, 0xfff0); assert.equal(cpu.retired, 0);
    assert.equal(cpu.run().status, 'halted');
    assert.equal(cpu.retired, 10);
});

test('a delayed guest store retires only after memory write edge and commits once', () => {
    const {cpu, board} = fixture();
    let clocks = 0;
    while (board.bus.pending?.kind !== 'memory-write' && clocks++ < 200) cpu.stepClock();
    assert.equal(board.bus.pending.kind, 'memory-write');
    const retired = cpu.retired;
    for (let i = 0; i < 8; i++) cpu.stepClock(1);
    assert.equal(cpu.retired, retired);
    assert.equal(ramWord(board, 0x500), 0);
    assert.equal(board.inspectMemory('ram0').writes, 0);
    for (let i = 0; cpu.retired === retired && i < 8; i++) cpu.stepClock();
    assert.equal(cpu.retired, retired + 1);
    assert.equal(ramWord(board, 0x500), 0x1234);
    assert.equal(board.inspectMemory('ram0').writes, 1);
    assert.equal(cpu.run().status, 'halted');
    assert.equal(board.inspectMemory('ram0').writes, 3);
});

test('bounded runs preserve progress rather than reporting a false halt', () => {
    const {cpu} = fixture();
    assert.equal(cpu.run(3).status, 'budget-exhausted');
    assert.equal(cpu.status, 'running');
    assert.equal(cpu.run().status, 'halted');
    assert.throws(() => cpu.run(0), RangeError);
});

test('disabling the board ROM alias breaks execution after the far jump', () => {
    const {cpu, board} = fixture({romLowAlias: false});
    assert.throws(() => cpu.run(), fault('FLOATING'));
    assert.equal(cpu.retired, 1);
    assert.equal(cpu.status, 'faulted');
    assert.equal(ramWord(board, 0x504), 0);
});

test('a disconnected RAM data wire stops guest execution rather than using hidden storage', () => {
    const {cpu, board} = fixture({editWires: wires => wires.filter(w => !(w.to === 'ram1' && w.toTerminal === 'd0'))});
    assert.throws(() => cpu.run(), fault('FLOATING'));
    assert.equal(cpu.status, 'faulted');
    assert.equal(board.inspectMemory('ram0').writes, 0);
    assert.equal(ramWord(board, 0x504), 0);
    assert.throws(() => cpu.initialize(), fault('CPU_FAULTED'));
});

test('unsupported system opcode and unwired LOCK/coprocessor protocols stop explicitly', () => {
    for (const [bytes, code] of [[[0x0f], 'UNSUPPORTED_OPCODE'], [[0xf0, 0x90], 'UNSUPPORTED_LOCK_BUS'], [[0x9b], 'UNSUPPORTED_COPROCESSOR']]) {
        const {cpu} = fixture({rom: programROM(bytes)});
        assert.throws(() => cpu.run(), fault(code));
        assert.equal(cpu.retired, 1, 'only reset far jump retired');
    }
});

test('MOV immediate registers, NOP, ADD immediate and odd-word memory forms execute', () => {
    const {cpu, board} = fixture({rom: programROM([
        0xb9, 0x34, 0x12, // CX
        0xbf, 0xcd, 0xab, // DI
        0x90,
        0xb8, 0xff, 0xff, 0x05, 0x01, 0x00,
        0xa3, 0x01, 0x05, 0xa1, 0x01, 0x05, 0xf4
    ])});
    assert.equal(cpu.run().status, 'halted');
    assert.equal(cpu.regs.cx, 0x1234); assert.equal(cpu.regs.di, 0xabcd);
    assert.equal(cpu.regs.ax, 0); assert.equal(cpu.flags, 0x57);
    assert.equal(board.inspectMemory('ram1').writes, 1);
    assert.equal(board.inspectMemory('ram0').writes, 1);
});

test('ADD flags match an arithmetic oracle over boundary and deterministic generated inputs', () => {
    const pairs = [[0xffff, 1], [0x7fff, 1], [0x8000, 0x8000], [0x8000, 0x7fff], [0, 0], [15, 1]];
    for (let i = 0; i < 256; i++) pairs.push([(i * 257) & 65535, (i * 997 + 12345) & 65535]);
    for (const [a, b] of pairs) {
        const {result, flags} = bootAdd16(a, b, 0x602);
        const signed = v => v < 32768 ? v : v - 65536;
        const s = signed(a) + signed(b);
        const pop = (result & 255).toString(2).replaceAll('0', '').length;
        assert.equal(result, (a + b) % 65536);
        const expected = Number(a + b >= 65536) | (pop % 2 === 0 ? 4 : 0) |
            ((a % 16 + b % 16 >= 16) ? 16 : 0) | (result === 0 ? 64 : 0) |
            (result >= 32768 ? 128 : 0) | (s < -32768 || s > 32767 ? 2048 : 0);
        assert.equal(flags & 0x8d5, expected);
        assert.equal(flags & 0x602, 0x602, 'unrelated flags preserved');
    }
});

test('segment-crossing operands deliver wired INT 13 without reading the invalid operand', () => {
    const bytes = assembleRaw('MOV SP,0800h\nMOV AX,0300h\nMOV [52],AX\nMOV AX,0F000h\nMOV [54],AX\nMOV DI,OFFSET faulting\nfaulting: MOV AX,[0FFFFh]\nHLT',0x100);
    const rom = programROM(bytes); rom[0x300] = 0xf4;
    const {cpu,board} = fixture({rom});
    assert.equal(cpu.run(2000).status,'halted');
    assert.equal(cpu.regs.sp,0x7fa); assert.equal(ramWord(board,0x7fa),cpu.regs.di);
    assert.equal(ramWord(board,0x7fc),0xf000); assert.equal(cpu.ip,0x301);
    assert.ok(!board.bus.getTrace().entries.some(e=>e.completion?.kind==='memory-read' && e.completion.address===0xffff));
});

test('cancellation stops clock execution and state inspection is a defensive copy', () => {
    const {cpu} = fixture(); cpu.run(3); cpu.cancel();
    assert.equal(cpu.run().status, 'cancelled');
    assert.throws(() => cpu.stepClock(), fault('CPU_NOT_RUNNING'));
    const state = cpu.inspect(); state.registers.ax = 12;
    assert.equal(cpu.regs.ax, 0);
});

test('initialization wiring failures also latch CPU fault status', () => {
    const b = createHarrisMemoryBoard({enabled: true, editWires: wires => wires.filter(w => !(w.to === 'rom0' && w.toTerminal === 'vcc'))});
    const cpu = new HarrisBootCPU({enabled: true, board: b});
    assert.throws(() => cpu.initialize(), fault('FLOATING'));
    assert.equal(cpu.inspect().status, 'faulted');
    assert.throws(() => cpu.initialize(), fault('CPU_FAULTED'));
});
