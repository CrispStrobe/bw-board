// The 8086 debug target. The interesting cases are all consequences of the
// 8086 having no program counter: a breakpoint has to be linear because two
// seg:off pairs name one byte, a watchpoint has to be twenty bits wide, and
// step-over has to find the opcode behind any prefixes before it can decide
// whether it is looking at a call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { I8086Machine } from '../src/i8086-machine.js';
import { createI8086DebugTarget } from '../src/i8086-debug.js';
import { createDebugTarget } from '../src/debug-target-factory.js';

/** A ROM image with `code` at F800:0000 and the reset jump in its last page. */
function rom(code) {
    const img = new Uint8Array(0x8000);
    img.set(code, 0);
    img.set([0xea, 0x00, 0x00, 0x00, 0xf8], 0x7ff0);   // jmp F800:0000
    return img;
}

function machineWith(code, config) {
    const m = config ? new I8086Machine(config) : new I8086Machine();
    m.loadRom(rom(code));
    m.reset();
    m.step();                        // take the far jump; now at F800:0000
    return { m, t: createI8086DebugTarget({ machine: m }) };
}

//   0000  B8 34 12   mov ax, 1234h
//   0003  E8 05 00   call 000Bh
//   0006  90         nop
//   0007  90         nop
//   0008  EB FE      jmp 0008h      (park)
//   000A  90         nop
//   000B  40         inc ax
//   000C  C3         ret
const CALL_PROGRAM = [
    0xb8, 0x34, 0x12,
    0xe8, 0x05, 0x00,
    0x90, 0x90,
    0xeb, 0xfe,
    0x90,
    0x40,
    0xc3,
];

test('regs report the pair AND the flat address it names', () => {
    const { t } = machineWith(CALL_PROGRAM);
    const r = t.regs();
    assert.equal(r.cs, 0xf800);
    assert.equal(r.ip, 0x0000);
    assert.equal(r.pc, 0xf8000, 'pc is (cs << 4) + ip, not half of it');
    for (const k of ['ax', 'bx', 'cx', 'dx', 'sp', 'bp', 'si', 'di', 'ds', 'es', 'ss', 'flags']) {
        assert.ok(k in r, `regs() reports ${k}`);
    }
});

test('a code breakpoint set through a DIFFERENT seg:off pair still fires', () => {
    const { t } = machineWith(CALL_PROGRAM);
    // F800:0006 and F7FF:0016 are the same byte. The program only ever uses
    // the first; the breakpoint is set with the second. A target holding
    // offsets would never fire — this is the whole reason it holds linear.
    const id = t.setBreakpoint({ kind: 'code', seg: 0xf7ff, addr: 0x0016 });
    let halted = null;
    t.onHalt((info) => { halted = info; });
    t.run();
    assert.equal(t.runFor(1e6), 'halted');
    assert.deepEqual(halted, { cause: 'breakpoint', bp: id });
    assert.equal(t.regs().pc, 0xf8006);
    assert.equal(t.regs().ip, 0x0006);
});

test('step-over runs the call to completion; step-insn goes into it', () => {
    const into = machineWith(CALL_PROGRAM);
    into.t.step('insn');                       // mov ax,1234
    into.t.runFor(1e6);
    into.t.step('insn');                       // the CALL itself
    into.t.runFor(1e6);
    assert.equal(into.t.regs().ip, 0x000b, 'a plain step lands inside the subroutine');

    const over = machineWith(CALL_PROGRAM);
    over.t.step('insn');
    over.t.runFor(1e6);
    over.t.step('over');
    over.t.runFor(1e6);
    assert.equal(over.t.regs().ip, 0x0006, 'step-over came back');
    assert.equal(over.t.regs().ax, 0x1235, 'and the subroutine really ran');
});

test('step-over does not wait on a PUSH, and does wait on a prefixed indirect call', () => {
    //   0000  50          push ax        (not a call — one step, no depth wait)
    //   0001  BB 09 00    mov bx, 0009h
    //   0004  2E FF 17    call cs:[bx]   (prefixed indirect — IS a call)
    //   0007  EB FE       jmp 0007h
    //   0009  0B 00       dw 000Bh       (the vector CS:[BX] points at)
    //   000B  C3          ret
    const prog = [0x50, 0xbb, 0x09, 0x00, 0x2e, 0xff, 0x17, 0xeb, 0xfe, 0x0b, 0x00, 0xc3];
    const { t } = machineWith(prog);

    t.step('over');                            // over a PUSH is one instruction
    t.runFor(1e6);
    assert.equal(t.regs().ip, 0x0001);

    t.step('insn'); t.runFor(1e6);             // mov bx
    t.step('over'); t.runFor(1e6);             // the prefixed indirect call
    assert.equal(t.regs().ip, 0x0007, 'the prefix did not hide the call from step-over');
});

test('step-out leaves the frame it is in', () => {
    const { t } = machineWith(CALL_PROGRAM);
    t.step('insn'); t.runFor(1e6);             // mov
    t.step('insn'); t.runFor(1e6);             // call — now inside
    assert.equal(t.regs().ip, 0x000b);
    t.step('out'); t.runFor(1e6);
    assert.equal(t.regs().ip, 0x0006, 'back at the return address');
});

test('a write watchpoint is twenty bits wide, not sixteen', () => {
    //   0000  B8 00 1F    mov ax, 1F00h
    //   0003  8E D8       mov ds, ax
    //   0005  C6 06 00 00 55   mov byte [0000], 55h   -> physical 1F000h
    //   000A  EB FE       jmp 000Ah
    const prog = [0xb8, 0x00, 0x1f, 0x8e, 0xd8, 0xc6, 0x06, 0x00, 0x00, 0x55, 0xeb, 0xfe];
    const { t } = machineWith(prog, {
        clockHz: 5_000_000,
        regions: [
            { kind: 'ram', start: 0x00000, end: 0x1ffff },   // 128K, so the target is above 64K
            { kind: 'rom', start: 0xf8000, end: 0xfffff },
        ],
        chips: [],
    });
    const id = t.setBreakpoint({ kind: 'write', addr: 0x1f000 });
    let halted = null;
    t.onHalt((info) => { halted = info; });
    t.run();
    assert.equal(t.runFor(1e6), 'halted');
    assert.equal(halted.cause, 'watchpoint');
    assert.equal(halted.bp, id);
    assert.equal(halted.addr, 0x1f000, 'a 16-bit mask would have watched the wrong byte');
    assert.equal(halted.value, 0x55);
});

test('memory reads and writes reach the whole megabyte, ROM included', () => {
    const { t, m } = machineWith(CALL_PROGRAM);
    const got = t.readMem('mem', 0xf8000, 3);
    assert.deepEqual([...got], [0xb8, 0x34, 0x12]);
    // A debugger patches what the CPU sees. ROM is not an exception — that
    // is the point of a poke.
    t.writeMem('mem', 0xf8000, new Uint8Array([0x90]));
    assert.equal(m._read(0xf8000), 0x90);
});

test('the port space refuses to be dumped, and says why', () => {
    const { t } = machineWith(CALL_PROGRAM);
    const r = t.readMem('io', 0, 4);
    assert.ok(r.unsupported, 'refused');
    assert.match(r.unsupported, /destructive/);
    assert.match(t.readMem('flash', 0, 4).unsupported, /no space 'flash'/);
});

test('disassembly follows the current segment', () => {
    const { t } = machineWith(CALL_PROGRAM);
    assert.equal(t.disasm(0xf8000).text, 'mov ax, 1234h');
    assert.equal(t.disasm(0xf8003).text, 'call 000Bh',
        'the target is an offset in CS, which a linear address alone could not give');
});

test('a cycle step is refused with the reason, not silently relabelled', () => {
    const { t } = machineWith(CALL_PROGRAM);
    const r = t.step('cycle');
    assert.match(r.unsupported, /no cycle step/);
    assert.match(t.step('warp').unsupported, /not supported/);
});

test('the factory builds one by kind', async () => {
    const { target, adapter } = await createDebugTarget('i8086', { rom: rom(CALL_PROGRAM) });
    assert.ok(target && adapter);
    assert.deepEqual(target.capabilities().steps, ['insn', 'over', 'out']);
    assert.equal(target.state(), 'halted');
    target.run();
    target.runFor(1e5);
    assert.ok(target.regs().cycles > 0, 'it ran');
});

test('video() renders straight out of memory, with the mode log deciding how', async () => {
    const { createDos8086, DOSBOX8086 } = await import('../src/i8086-dos.js');
    const { I8086Machine: M } = await import('../src/i8086-machine.js');

    // A program that selects mode 13h and plots one pixel, then parks.
    const m = new M(DOSBOX8086);
    const prog = Uint8Array.from([
        0xb4, 0x00, 0xb0, 0x13, 0xcd, 0x10,          // mode 13h
        0xb4, 0x0c, 0xb0, 0x2a,                      // ah=0Ch al=2Ah
        0xb9, 0x0a, 0x00, 0xba, 0x05, 0x00,          // cx=10 dx=5
        0xcd, 0x10,
        0xeb, 0xfe,
    ]);
    const dos = createDos8086(m).install().loadCom(prog);
    for (let i = 0; i < 200; i++) dos.step();

    // The target is where the renderer and the service layer meet: neither
    // imports the other, and this is the consumer that holds both.
    const t = createI8086DebugTarget({ machine: m }, { videoModeLog: () => dos.videoModeLog() });
    const f = t.video();
    assert.equal(f.mode, 0x13, 'the log said mode 13h');
    assert.equal(f.width, 320);
    assert.equal(f.height, 200);
    const i = (5 * 320 + 10) * 4;
    assert.notDeepEqual([f.rgba[i], f.rgba[i + 1], f.rgba[i + 2]], [0, 0, 0],
        'the pixel the program plotted is in the frame the debugger would show');

    // With no log at all, the power-on text mode is the right assumption.
    const bare = createI8086DebugTarget({ machine: m });
    assert.equal(bare.video().mode, 0x03);
});

test('video() explains an unsupported mode instead of throwing', async () => {
    const { createDos8086, DOSBOX8086 } = await import('../src/i8086-dos.js');
    const { I8086Machine: M } = await import('../src/i8086-machine.js');
    const m = new M(DOSBOX8086);
    createDos8086(m).install();
    // Mode 12h is EGA/VGA planar: four bit planes behind a sequencer, a
    // different machine entirely. A pane that crashed the session over it
    // would be worse than one that says why it is empty.
    const t = createI8086DebugTarget({ machine: m }, { videoModeLog: () => [0x12] });
    const r = t.video();
    assert.ok(r.unsupported, 'refused');
    assert.match(r.unsupported, /12h/);
});
