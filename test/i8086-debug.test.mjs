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
import { trapRegion } from '../src/i8086-dos.js';

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

test('a programmed CGA card outranks the INT 10h log', async () => {
    const { I8086Machine: M } = await import('../src/i8086-machine.js');
    const m = new M({
        clockHz: 5_000_000,
        regions: [{ kind: 'ram', start: 0, end: 0xbffff }, trapRegion()],
        chips: [{ kind: 'cga', name: 'cga1', at: 0x3d0 }],
    });
    // Nothing programmed yet: the card holds zero, video disabled, so the
    // log is the authority -- and with no log, the power-on text mode.
    const t = createI8086DebugTarget({ machine: m }, { videoModeLog: () => [0x03] });
    assert.equal(t.video().mode, 0x03, 'unprogrammed card defers to the log');

    // Now a game programs the card directly and never calls the BIOS:
    // 1Ah = video enable + graphics + high-res mono = mode 6.
    m._out(0x3d8, 0x1a);
    const f = t.video();
    assert.equal(f.mode, 0x06, 'the card wins, because a game writes it and skips INT 10h');
    assert.equal(f.width, 640);
    assert.match(f.why, /3D8h/);

    // 0Ah = enable + graphics, low-res: mode 4, and 3D9h picks the palette.
    m._out(0x3d8, 0x0a);
    m._out(0x3d9, 0x20 | 0x04);          // palette 1, background blue
    const g = t.video();
    assert.equal(g.mode, 0x04);
    assert.equal(g.width, 320);
});

test('a VGA card identifies mode 13h positively, and refuses planar by name', async () => {
    const { I8086Machine: M } = await import('../src/i8086-machine.js');
    const mk = () => new M({
        clockHz: 5_000_000,
        regions: [{ kind: 'ram', start: 0, end: 0xbffff }, trapRegion()],
        chips: [{ kind: 'vga', name: 'vga1', at: 0x3c0 }],
    });

    // Unprogrammed: misc is zero, so the card says nothing and the log wins.
    const idle = mk();
    const t0 = createI8086DebugTarget({ machine: idle }, { videoModeLog: () => [0x03] });
    assert.equal(t0.video().mode, 0x03);

    // Mode 13h is a CONFIGURATION, not a register value: graphics, chain-4,
    // and 8-bit colour together.
    const m = mk();
    const vga = m.chips.vga1;
    m._out(0x3c2, 0x63);                       // misc: the card has been programmed
    vga.gc[0x06] |= 0x01;                      // alpha disable -> graphics
    vga.seq[0x04] |= 0x08;                     // chain-4
    vga.attr[0x10] |= 0x40;                    // 8-bit colour
    const t = createI8086DebugTarget({ machine: m });
    const f = t.video();
    assert.equal(f.mode, 0x13);
    assert.equal(f.width, 320);
    assert.equal(f.height, 200);
    assert.match(f.why, /chain-4/);

    // Graphics WITHOUT chain-4 is planar. Refuse it by name: a wrong picture
    // looks like a bug in the program, which is worse than an empty pane.
    vga.seq[0x04] &= ~0x08;
    const r = t.video();
    assert.ok(r.unsupported, 'refused');
    assert.match(r.unsupported, /four bit planes/);
});

test('a programmed DAC reaches the renderer unchanged', async () => {
    const { I8086Machine: M } = await import('../src/i8086-machine.js');
    const m = new M({
        clockHz: 5_000_000,
        regions: [{ kind: 'ram', start: 0, end: 0xbffff }, trapRegion()],
        chips: [{ kind: 'vga', name: 'vga1', at: 0x3c0 }],
    });
    const vga = m.chips.vga1;
    m._out(0x3c2, 0x63);
    vga.gc[0x06] |= 0x01; vga.seq[0x04] |= 0x08; vga.attr[0x10] |= 0x40;
    // Repaint palette entry 1 as full red, in the DAC's own six-bit units.
    vga.dac[3] = 63; vga.dac[4] = 0; vga.dac[5] = 0;
    m._write(0xa0000, 1);                       // one pixel of colour 1

    const f = createI8086DebugTarget({ machine: m }).video();
    assert.deepEqual([f.rgba[0], f.rgba[1], f.rgba[2]], [255, 0, 0],
        'the card stores what the hardware stores and the renderer reads the same units');
});

test('Hercules GRAPHICS now draws, at its own address and its own interleave', async () => {
    // This test asserted a REFUSAL until 2026-09-04, and the refusal was the
    // right answer for as long as there was no decoder: "720x348 mono at
    // B0000h, which this renderer does not draw". Refusing by name is what
    // let another lane build a Hercules board and correctly decline to ship a
    // UI entry for it, instead of shipping one that rendered a blank screen.
    //
    // The decoder exists now (i8086-cga.js, kind 'hgc'), so the honest
    // assertion inverts. The detail worth keeping is the address: mode 06h is
    // CGA 640x200 at B8000h with two-bank parity, and Hercules is 720x348 at
    // B0000h with four banks on `y mod 4`. modeFromHercules used to return
    // 06h, so making it "supported" without also giving it its own mode number
    // would have drawn the right card from the wrong address with the wrong
    // arithmetic -- and produced a picture. It is pseudo-mode 100h for that
    // reason. test/i8086-hercules-render.test.mjs holds the interleave itself.
    const { I8086Machine: M } = await import('../src/i8086-machine.js');
    const m = new M({
        clockHz: 5_000_000,
        regions: [
            { kind: 'ram', start: 0, end: 0x9ffff },
            { kind: 'ram', start: 0xb0000, end: 0xb7fff },
            trapRegion(),
        ],
        chips: [{ kind: 'hercules', name: 'herc1', at: 0x3b0 }],
    });
    m._out(0x3bf, 0x03);                        // config: graphics permitted
    m._out(0x3b8, 0x0a);                        // video on, graphics
    m._write(0xb0000, 0x80);                    // one pixel at (0,0)
    const r = createI8086DebugTarget({ machine: m }).video();
    assert.ok(!r.unsupported, `refused: ${r.unsupported}`);
    assert.equal(r.width, 720);
    assert.equal(r.height, 348, 'the 348-line raster, not CGA mode 6\'s 200');
    assert.ok(r.rgba[0] > 128, 'and the byte at B0000h is scanline 0');
});

test('Hercules TEXT is still refused by name, and says why', async () => {
    // The half that did NOT land. MDA text is 80x25 at B0000h with attribute
    // semantics that are not CGA's -- no colour, but intensity, underline and
    // reverse. Drawing it with the CGA text path would read the right address
    // and the wrong attributes. Refusing keeps a board honest until someone
    // writes it.
    const { I8086Machine: M } = await import('../src/i8086-machine.js');
    const m = new M({
        clockHz: 5_000_000,
        regions: [{ kind: 'ram', start: 0, end: 0xbffff }, trapRegion()],
        chips: [{ kind: 'hercules', name: 'herc1', at: 0x3b0 }],
    });
    m._out(0x3b8, 0x08);                        // video on, TEXT
    const r = createI8086DebugTarget({ machine: m }).video();
    assert.ok(r.unsupported, 'MDA text has no decoder');
    assert.match(r.unsupported, /B0000h/, 'and says why: a different address, not just a different size');
});

test('a program that reaches mode 13h through the BUS renders, registers and all', async () => {
    // The corpus's own vga_mode_13h_pixels.asm gets there through INT 10h, so
    // it never touches the card. This probe takes the other road -- OUT to the
    // real ports -- which is what a game does, and it exercises the card's
    // decode, the index/data pairs and the attribute flip-flop as well as the
    // identification.
    const { I8086Machine: M } = await import('../src/i8086-machine.js');
    const { createDos8086 } = await import('../src/i8086-dos.js');
    const m = new M({
        clockHz: 5_000_000,
        regions: [{ kind: 'ram', start: 0, end: 0xbffff }, trapRegion()],
        chips: [{ kind: 'vga', name: 'vga1', at: 0x3c0 }],
    });
    // NOTE THE DX FORM THROUGHOUT. `out imm8, al` can only address ports
    // 0-255, so `E6 C2` is port C2h and not 3C2h -- the first draft of this
    // probe did exactly that and programmed nothing, which is the same
    // mistake a learner makes once and never again.
    const outDx = (port, val) => [0xba, port & 0xff, (port >> 8) & 0xff,   // mov dx, port
        0xb0, val, 0xee];                                                   // mov al, val / out dx, al
    const prog = [
        ...outDx(0x3c2, 0x63),                      // misc: programmed
        ...outDx(0x3c4, 0x04), ...outDx(0x3c5, 0x0e),   // seq[4] = chain-4
        ...outDx(0x3ce, 0x06), ...outDx(0x3cf, 0x05),   // gc[6] = alpha disable
        0xba, 0xda, 0x03, 0xec,                     // mov dx,3DAh / in al,dx -- reset the flip-flop
        ...outDx(0x3c0, 0x10), ...outDx(0x3c0, 0x41),   // attr[10h] = 8-bit colour
        0xb8, 0x00, 0xa0, 0x8e, 0xc0,               // mov ax,A000h / mov es,ax
        0xbf, 0x00, 0x00,                           // mov di, 0
        0xb0, 0x0f, 0x26, 0x88, 0x05,               // mov al,15 / mov [es:di], al
        0xb8, 0x00, 0x4c, 0xcd, 0x21,
    ];
    // 3DAh belongs to the CGA block; a VGA card answers it too, so the read
    // above is the real hardware idiom for resetting the flip-flop.
    const dos = createDos8086(m).install().loadCom(Uint8Array.from(prog));
    dos.run(50_000);

    const st = m.chips.vga1.getVideoState();
    assert.ok(st.misc, 'the card was programmed through the bus');
    assert.ok(st.seq[0x04] & 0x08, 'chain-4 arrived through the index/data pair');
    assert.ok(st.attr[0x10] & 0x40, '8-bit colour arrived through the flip-flop');

    const f = createI8086DebugTarget({ machine: m }).video();
    assert.equal(f.mode, 0x13, 'identified from the registers, with no INT 10h anywhere');
    assert.deepEqual([f.rgba[0], f.rgba[1], f.rgba[2]], [255, 255, 255],
        'and the pixel the program wrote to A000:0000 is in the frame');
});
