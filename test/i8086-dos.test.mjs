// The DOS/BIOS service layer. Tier B: no hardware at all, and the tier the
// 8086 teaching corpus actually wants — measured across 525 programs, 2,862
// of 3,109 int 21h calls are AH=02h/09h/4Ch. These tests are those three
// services, the trap mechanism that makes vector HOOKING work, and the
// screen that a program bypassing DOS entirely still reaches.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { I8086Machine } from '../src/i8086-machine.js';
import { createDos8086, DOSBOX8086, TRAP_SEG, VRAM } from '../src/i8086-dos.js';

/** A Tier B machine with the services installed and a .COM loaded. */
function dosWith(bytes) {
    const m = new I8086Machine(DOSBOX8086);
    const dos = createDos8086(m).install().loadCom(Uint8Array.from(bytes));
    return { m, dos };
}

/** Assemble at .COM offset 100h: pairs of [offset, bytes]. */
function com(chunks) {
    const out = new Uint8Array(0x200);
    for (const [off, bytes] of chunks) out.set(bytes, off - 0x100);
    return out.subarray(0, Math.max(...chunks.map(([o, b]) => o - 0x100 + b.length)));
}

test('print a string with AH=09h and exit with AH=4Ch — 2,862 of 3,109 calls', () => {
    const { dos } = dosWith(com([
        [0x100, [0xba, 0x10, 0x01]],        // mov dx, 0110h
        [0x103, [0xb4, 0x09]],              // mov ah, 9
        [0x105, [0xcd, 0x21]],              // int 21h
        [0x107, [0xb8, 0x07, 0x4c]],        // mov ax, 4C07h
        [0x10a, [0xcd, 0x21]],              // int 21h
        [0x110, [0x48, 0x69, 0x21, 0x24]],  // 'Hi!$'
    ]));
    const r = dos.run(10_000);
    assert.ok(r.terminated, 'the program exited');
    assert.equal(r.exitCode, 7, 'AL is the exit code');
    assert.equal(dos.stdout, 'Hi!');
    assert.equal(dos.screenText()[0], 'Hi!', 'and it landed on the text page, not just a string');
});

test('AH=02h writes a character, and the cursor and scrolling are real', () => {
    const chunks = [];
    let off = 0x100;
    for (const ch of 'ab\r\ncd') {
        chunks.push([off, [0xb4, 0x02, 0xb2, ch.charCodeAt(0), 0xcd, 0x21]]);
        off += 6;
    }
    chunks.push([off, [0xb8, 0x00, 0x4c, 0xcd, 0x21]]);
    const { dos } = dosWith(com(chunks));
    dos.run(10_000);
    assert.equal(dos.stdout, 'ab\r\ncd');
    assert.equal(dos.screenText()[0], 'ab');
    assert.equal(dos.screenText()[1], 'cd', 'CR went to column zero, LF to the next row');
});

test('a program that HOOKS int 21h and chains is still serviced', () => {
    // This is the whole reason the vectors are real rather than the INT
    // instruction being watched: after the hook, `int 21h` reaches DOS by a
    // far jump through the saved vector, and an instruction watcher would
    // never see it.
    const { m, dos } = dosWith(com([
        [0x100, [0xb4, 0x35, 0xb0, 0x21, 0xcd, 0x21]],        // ah=35 al=21 int21 -> ES:BX
        [0x106, [0x89, 0x1e, 0x40, 0x01]],                    // mov [0140], bx
        [0x10a, [0x8c, 0x06, 0x42, 0x01]],                    // mov [0142], es
        [0x10e, [0xb4, 0x25, 0xb0, 0x21]],                    // ah=25 al=21
        [0x112, [0xba, 0x30, 0x01]],                          // mov dx, 0130h (our handler)
        [0x115, [0xcd, 0x21]],                                // int 21h -> vector replaced
        [0x117, [0xb4, 0x02, 0xb2, 0x41]],                    // ah=2 dl='A'
        [0x11b, [0xcd, 0x21]],                                // int 21h -> OUR handler
        [0x11d, [0xb8, 0x00, 0x4c, 0xcd, 0x21]],              // exit
        [0x130, [0xff, 0x06, 0x44, 0x01]],                    // inc word [0144]
        [0x134, [0xff, 0x2e, 0x40, 0x01]],                    // jmp far [0140] — chain
    ]));
    const r = dos.run(10_000);
    assert.ok(r.terminated);
    assert.equal(dos.stdout, 'A', 'the chained call printed');
    const psp = 0x0800;
    const count = m._read((psp << 4) + 0x144) | (m._read((psp << 4) + 0x145) << 8);
    // TWO, not one: the exit call goes through the hook as well, which is
    // the proof the hook stayed installed rather than being serviced once.
    assert.equal(count, 2, 'and it really went through the program\'s own handler');
    // The IVT now holds the PROGRAM's handler — it replaced DOS — and the
    // copy the program saved holds the trap address it chains to. Both
    // halves matter: the first says the hook took, the second says what it
    // is chaining into is us.
    assert.equal(m._read(0x21 * 4 + 2) | (m._read(0x21 * 4 + 3) << 8), psp);
    assert.equal(m._read(0x21 * 4) | (m._read(0x21 * 4 + 1) << 8), 0x0130);
    const savedSeg = m._read((psp << 4) + 0x142) | (m._read((psp << 4) + 0x143) << 8);
    const savedOff = m._read((psp << 4) + 0x140) | (m._read((psp << 4) + 0x141) << 8);
    assert.equal(savedSeg, TRAP_SEG);
    assert.equal(savedOff, 0x21 * 4, 'the slot is the vector number times the stride');
});

test('buffered input AH=0Ah takes typed keys and terminates the line', () => {
    const { m, dos } = dosWith(com([
        [0x100, [0xba, 0x20, 0x01]],        // mov dx, 0120h  (the buffer)
        [0x103, [0xb4, 0x0a]],              // mov ah, 0Ah
        [0x105, [0xcd, 0x21]],
        [0x107, [0xb8, 0x00, 0x4c, 0xcd, 0x21]],
        [0x120, [0x10]],                    // max length 16
    ]));
    dos.type('brick\r');
    dos.run(10_000);
    const psp = 0x0800, base = (psp << 4) + 0x120;
    assert.equal(m._read(base + 1), 5, 'five characters before the CR');
    let s = '';
    for (let i = 0; i < 5; i++) s += String.fromCharCode(m._read(base + 2 + i));
    assert.equal(s, 'brick');
    assert.equal(m._read(base + 2 + 5), 0x0d, 'the buffer is CR-terminated, as DOS leaves it');
    assert.equal(dos.stdout, 'brick\r', 'and AH=0Ah echoes');
});

test('int 16h reports an empty keyboard through the zero flag', () => {
    const { m, dos } = dosWith(com([
        [0x100, [0xb4, 0x01, 0xcd, 0x16]],  // ah=1 int 16h — check for a key
        [0x104, [0x9c]],                     // pushf  (so the test can read ZF)
        [0x105, [0xb8, 0x00, 0x4c, 0xcd, 0x21]],
    ]));
    dos.run(10_000);
    const sp = 0xfffe - 2;
    const flags = m._read((0x0800 << 4) + sp) | (m._read((0x0800 << 4) + sp + 1) << 8);
    assert.ok(flags & 0x0040, 'ZF set: no key waiting');
});

test('a program that writes B800h directly still shows on the screen', () => {
    const { dos } = dosWith(com([
        [0x100, [0xb8, 0x00, 0xb8]],                    // mov ax, B800h
        [0x103, [0x8e, 0xc0]],                          // mov es, ax
        [0x105, [0x26, 0xc6, 0x06, 0x00, 0x00, 0x58]],  // mov byte [es:0000], 'X'
        [0x10b, [0x26, 0xc6, 0x06, 0x02, 0x00, 0x59]],  // mov byte [es:0002], 'Y'
        [0x111, [0xb8, 0x00, 0x4c, 0xcd, 0x21]],
    ]));
    dos.run(10_000);
    assert.equal(dos.screenText()[0], 'XY',
        'the screen is the CPU-visible buffer, so bypassing DOS is not bypassing us');
    assert.equal(dos.stdout, '', 'and nothing went through the service path');
});

test('files round-trip through the virtual filesystem', () => {
    const { dos } = dosWith(com([
        [0x100, [0xb4, 0x3c, 0xb9, 0x00, 0x00, 0xba, 0x40, 0x01]],   // create "OUT.TXT"
        [0x108, [0xcd, 0x21]],
        [0x10a, [0x89, 0xc3]],                                        // mov bx, ax (handle)
        [0x10c, [0xb4, 0x40, 0xb9, 0x03, 0x00, 0xba, 0x50, 0x01]],   // write 3 bytes
        [0x114, [0xcd, 0x21]],
        [0x116, [0xb4, 0x3e, 0xcd, 0x21]],                            // close
        [0x11a, [0xb8, 0x00, 0x4c, 0xcd, 0x21]],
        [0x140, [0x4f, 0x55, 0x54, 0x2e, 0x54, 0x58, 0x54, 0x00]],   // "OUT.TXT\0"
        [0x150, [0x61, 0x62, 0x63]],                                  // "abc"
    ]));
    dos.run(10_000);
    const f = dos.files.get('OUT.TXT');
    assert.ok(f, 'the file exists');
    assert.equal(String.fromCharCode(...f), 'abc');
});

test('int 15h/86h spends MACHINE time, not wall-clock time', () => {
    const { m, dos } = dosWith(com([
        [0x100, [0xb4, 0x86]],                          // ah = 86h
        [0x102, [0xb9, 0x0f, 0x00]],                    // cx = 000Fh
        [0x105, [0xba, 0x42, 0x40]],                    // dx = 4042h -> 0F4042h us = ~1.0 s
        [0x108, [0xcd, 0x15]],
        [0x10a, [0xb8, 0x00, 0x4c, 0xcd, 0x21]],
    ]));
    const t0 = Date.now();
    dos.run(10_000);
    const wall = Date.now() - t0;
    assert.ok(m.tMs > 999 && m.tMs < 1002, `a second of simulated time passed (${m.tMs.toFixed(1)} ms)`);
    assert.ok(wall < 200, `and none of it was real (${wall} ms)`);
    // yousefkotp's traffic-light project is built entirely on this service,
    // waiting sixty seconds at a time.
});

test('an unsupported service fails visibly and names itself', () => {
    const { dos } = dosWith(com([
        [0x100, [0xb4, 0x99, 0xcd, 0x21]],              // ah = 99h — no such function
        [0x104, [0x9c]],                                 // pushf
        [0x105, [0xb8, 0x00, 0x4c, 0xcd, 0x21]],
    ]));
    dos.run(10_000);
    const r = dos.report();
    assert.deepEqual(r.unsupported, [{ int: 0x21, ah: 0x99, count: 1 }],
        'the refusal is counted and named, not swallowed');
});

test('a RET with an empty stack terminates through the PSP, as it does on DOS', () => {
    const { dos } = dosWith(com([[0x100, [0xc3]]]));    // ret
    const r = dos.run(10_000);
    assert.ok(r.terminated, 'PSP:0000 holds INT 20h and that is the trapdoor');
    assert.equal(r.exitCode, 0);
});

test('an MZ .EXE loads, relocates, and runs — what MASM actually emits', () => {
    const code = [
        0xb8, 0x00, 0x00,     // mov ax, 0000h   <- the word at image offset 1 is relocated
        0x8e, 0xd8,           // mov ds, ax
        0xb4, 0x02,           // mov ah, 2
        0xb2, 0x45,           // mov dl, 'E'
        0xcd, 0x21,
        0xb8, 0x00, 0x4c,
        0xcd, 0x21,
    ];
    const exe = new Uint8Array(32 + code.length);
    const w16 = (o, v) => { exe[o] = v & 0xff; exe[o + 1] = (v >> 8) & 0xff; };
    exe[0] = 0x4d; exe[1] = 0x5a;         // 'MZ'
    w16(0x02, 32 + code.length);          // bytes in the last page
    w16(0x04, 1);                         // one page
    w16(0x06, 1);                         // one relocation
    w16(0x08, 2);                         // header is two paragraphs
    w16(0x0e, 0x0000);                    // SS (relative)
    w16(0x10, 0xfffe);                    // SP
    w16(0x14, 0x0000);                    // IP
    w16(0x16, 0x0000);                    // CS (relative)
    w16(0x18, 0x001c);                    // relocation table
    w16(0x1c, 0x0001); w16(0x1e, 0x0000); // the entry: seg 0, offset 1
    exe.set(code, 32);

    const m = new I8086Machine(DOSBOX8086);
    const dos = createDos8086(m).install().loadExe(exe, 0x0800);
    const loadSeg = 0x0810;
    const patched = m._read((loadSeg << 4) + 1) | (m._read((loadSeg << 4) + 2) << 8);
    assert.equal(patched, loadSeg, 'the relocation biased the segment word by where we loaded');
    const r = dos.run(10_000);
    assert.ok(r.terminated);
    assert.equal(dos.stdout, 'E');
});

test('the machine underneath is untouched by any of this', () => {
    // Tier B adds no chips, decodes no ports, and needs no ROM: the config
    // is 768K of RAM and nothing else. If this ever stops being true, the
    // tier has grown hardware it does not need.
    assert.deepEqual(DOSBOX8086.chips, [], 'no chips at all: the services ARE the hardware');
    assert.ok(DOSBOX8086.regions.every((r) => r.kind === 'ram'), 'and no ROM either');
    // The only thing resembling hardware is 1K holding the trap slots —
    // this tier's entire BIOS. If a chip ever appears in this list, the tier
    // has grown hardware it does not need.
    assert.equal(DOSBOX8086.regions.length, 2);
    assert.equal(DOSBOX8086.regions[1].start, 0xf0000);
    assert.equal(DOSBOX8086.regions[1].end - DOSBOX8086.regions[1].start + 1, 1024);
    assert.equal(VRAM, 0xb8000);
});

test('the video mode a program sets is recorded, and the renderer can read it', async () => {
    // The seam between Tier B and the framebuffer renderer: this layer draws
    // characters and nothing else, so a graphics program's mode set is the
    // ONLY evidence anywhere of which mode it believes it is in. Without the
    // log, a mode-13h game paints A0000h and nobody knows how to read it.
    const { dos } = dosWith(com([
        [0x100, [0xb4, 0x00, 0xb0, 0x13, 0xcd, 0x10]],  // ah=0 al=13h int 10h
        [0x106, [0xb4, 0x00, 0xb0, 0x83, 0xcd, 0x10]],  // ah=0 al=83h (mode 3, no clear)
        [0x10c, [0xb8, 0x00, 0x4c, 0xcd, 0x21]],
    ]));
    dos.run(10_000);
    assert.deepEqual(dos.videoModeLog(), [0x13, 0x83],
        'recorded AS WRITTEN, bit 7 included — masking it here would make the log lie');

    const { likelyMode } = await import('../src/i8086-cga.js');
    const verdict = likelyMode(dos.videoModeLog());
    assert.equal(verdict.mode, 0x03, 'the renderer masks bit 7: 83h IS mode 3');
    assert.ok(verdict.supported);
    // And with no mode set at all, the power-on text mode is the right guess.
    const fresh = dosWith(com([[0x100, [0xb8, 0x00, 0x4c, 0xcd, 0x21]]]));
    fresh.dos.run(1000);
    assert.deepEqual(fresh.dos.videoModeLog(), []);
    assert.equal(likelyMode(fresh.dos.videoModeLog()).mode, 0x03);
});

test('AL bit 7 means the mode set does NOT clear the screen', () => {
    const { dos } = dosWith(com([
        [0x100, [0xba, 0x20, 0x01, 0xb4, 0x09, 0xcd, 0x21]],   // print "hi$"
        [0x107, [0xb4, 0x00, 0xb0, 0x83, 0xcd, 0x10]],          // mode 3, no clear
        [0x10d, [0xb8, 0x00, 0x4c, 0xcd, 0x21]],
        [0x120, [0x68, 0x69, 0x24]],
    ]));
    dos.run(10_000);
    assert.equal(dos.screenText()[0], 'hi', 'bit 7 set: the text survived the mode set');

    const cleared = dosWith(com([
        [0x100, [0xba, 0x20, 0x01, 0xb4, 0x09, 0xcd, 0x21]],
        [0x107, [0xb4, 0x00, 0xb0, 0x03, 0xcd, 0x10]],          // mode 3, clearing
        [0x10d, [0xb8, 0x00, 0x4c, 0xcd, 0x21]],
        [0x120, [0x68, 0x69, 0x24]],
    ]));
    cleared.dos.run(10_000);
    assert.equal(cleared.dos.screenText()[0], '', 'bit 7 clear: it did not');
});

test('a pixel plotted through INT 10h/0Ch lands where the RENDERER finds it', async () => {
    // The layout is implemented twice on purpose — once here, once in
    // i8086-cga.js — so that importing the renderer does not couple the
    // service layer to it. This test is what makes that safe: two
    // independent implementations of the same addressing, cross-checked.
    const { renderMode } = await import('../src/i8086-cga.js');

    // NOTE the colour choices: VGA palette entries 248-255 are BLACK, so a
    // plot in colour FFh is invisible and would read as a failed write. The
    // first run of this test asserted exactly that and was wrong about the
    // palette, not about the plot.
    for (const [mode, x, y, colour] of [[0x13, 17, 3, 0x2a], [0x13, 319, 199, 0x0f],
        [0x04, 5, 1, 2], [0x04, 318, 199, 3], [0x06, 9, 1, 1]]) {
        const { m, dos } = dosWith(com([
            [0x100, [0xb4, 0x00, 0xb0, mode, 0xcd, 0x10]],                  // set mode
            [0x106, [0xb4, 0x0c, 0xb0, colour]],                            // ah=0Ch al=colour
            [0x10a, [0xb9, x & 0xff, (x >> 8) & 0xff]],                     // cx = x
            [0x10d, [0xba, y & 0xff, (y >> 8) & 0xff]],                     // dx = y
            [0x110, [0xcd, 0x10]],
            [0x112, [0xb8, 0x00, 0x4c, 0xcd, 0x21]],
        ]));
        dos.run(10_000);
        assert.deepEqual(dos.report().unsupported, [], `mode ${mode.toString(16)}h plot accepted`);

        const f = renderMode(mode, (a) => m._read(a), { background: 0 });
        const i = (y * f.width + x) * 4;
        const px = [f.rgba[i], f.rgba[i + 1], f.rgba[i + 2]];
        assert.notDeepEqual(px, [0, 0, 0],
            `mode ${mode.toString(16)}h: the renderer sees the pixel at (${x},${y})`);
        // ...and its neighbour is untouched, which is what catches an
        // off-by-one in the bit shift or the scanline interleave.
        const j = (y * f.width + (x + 1 < f.width ? x + 1 : x - 1)) * 4;
        assert.deepEqual([f.rgba[j], f.rgba[j + 1], f.rgba[j + 2]], [0, 0, 0],
            `mode ${mode.toString(16)}h: the neighbour is not`);
    }
});

test('a pixel in a TEXT mode is refused, not silently written', () => {
    const { dos } = dosWith(com([
        [0x100, [0xb4, 0x0c, 0xb0, 0x01, 0xb9, 0x05, 0x00, 0xba, 0x05, 0x00, 0xcd, 0x10]],
        [0x10c, [0xb8, 0x00, 0x4c, 0xcd, 0x21]],
    ]));
    dos.run(10_000);
    assert.deepEqual(dos.report().unsupported, [{ int: 0x10, ah: 0x0c, count: 1 }],
        'a pixel in mode 3 is meaningless and says so');
});

test('a boot sector loads at 0000:7C00 and runs with no DOS at all', () => {
    const boot = new Uint8Array(512);
    // mov ax,0B800h; mov es,ax; mov byte [es:0],'B'; jmp $
    boot.set([0xb8, 0x00, 0xb8, 0x8e, 0xc0, 0x26, 0xc6, 0x06, 0x00, 0x00, 0x42, 0xeb, 0xfe], 0);
    boot[510] = 0x55; boot[511] = 0xaa;
    const m = new I8086Machine(DOSBOX8086);
    const dos = createDos8086(m).install().loadBoot(boot, 0x00);
    assert.equal(m.cpu.ip, 0x7c00, 'the BIOS entry point, not a PSP');
    assert.equal(m.cpu.dl, 0x00, 'DL names the drive it came from');
    for (let i = 0; i < 50; i++) dos.step();
    assert.equal(dos.screenText()[0], 'B');
});

test('a sector without the AA55h signature is refused, as the BIOS would', () => {
    const m = new I8086Machine(DOSBOX8086);
    const dos = createDos8086(m).install();
    assert.throws(() => dos.loadBoot(new Uint8Array(512)), /no AA55h boot signature/);
    assert.throws(() => dos.loadBoot(new Uint8Array(100)), /a boot sector is 512 bytes/);
});

test('INT 13h reads sectors, and refuses to read past the image', () => {
    const disk = new Uint8Array(512 * 4);
    for (let i = 0; i < disk.length; i++) disk[i] = (i >> 9) + 1;   // sector n holds n+1
    const m = new I8086Machine(DOSBOX8086);
    const dos = createDos8086(m, { disk, geometry: { sectors: 4, heads: 1 } })
        .install()
        .loadCom(Uint8Array.from([
            0xb4, 0x02, 0xb0, 0x02,                 // ah=02h read, al=2 sectors
            0xb5, 0x00, 0xb1, 0x02,                 // ch=0 cyl, cl=2 -> sector 2
            0xb6, 0x00,                             // dh=0 head
            0xbb, 0x00, 0x30,                       // bx=3000h
            0xcd, 0x13,
            0xb8, 0x00, 0x4c, 0xcd, 0x21,
        ]));
    dos.run(10_000);
    const psp = 0x0800;
    assert.equal(m._read((psp << 4) + 0x3000), 2, 'sector 2 arrived at ES:BX');
    assert.equal(m._read((psp << 4) + 0x3200), 3, 'and sector 3 right behind it');

    // Past the end: carry set and AH=04h, not a buffer full of zeros.
    const m2 = new I8086Machine(DOSBOX8086);
    const d2 = createDos8086(m2, { disk, geometry: { sectors: 4, heads: 1 } })
        .install()
        .loadCom(Uint8Array.from([
            0xb4, 0x02, 0xb0, 0x01, 0xb5, 0x00, 0xb1, 0x04, 0xb6, 0x01,
            0xbb, 0x00, 0x30, 0xcd, 0x13, 0x9c,     // pushf
            0xb8, 0x00, 0x4c, 0xcd, 0x21,
        ]));
    d2.run(10_000);
    const flags = m2._read((0x0800 << 4) + 0xfffc) | (m2._read((0x0800 << 4) + 0xfffd) << 8);
    assert.ok(flags & 1, 'carry set: a boot loader that got zeros instead would be unfindable');
});

test('INT 03h is answered as a breakpoint, not counted as a missing service', () => {
    // Three textbook programs execute INT 03h under a comment reading
    // "Debugging Breakpoint". They are asking for a debugger; reporting them
    // as an unsupported service said we lacked something we had merely not
    // connected.
    const hits = [];
    const m = new I8086Machine(DOSBOX8086);
    const dos = createDos8086(m, { onBreakpoint: (at) => hits.push(at) })
        .install()
        .loadCom(Uint8Array.from([
            0xcc,                                   // int 3
            0xb4, 0x02, 0xb2, 0x41, 0xcd, 0x21,     // and carry on printing
            0xb8, 0x00, 0x4c, 0xcd, 0x21,
        ]));
    const r = dos.run(10_000);
    assert.ok(r.terminated);
    assert.equal(dos.stdout, 'A', 'with no debugger attached the program continues, as on DOS');
    assert.equal(hits.length, 1, 'but a debugger that IS watching is told');
    assert.equal(hits[0].at, 0x0100, 'and told WHERE -- the INT 3 byte, not the trap slot');
    assert.equal(hits[0].ip, 0x0101, 'with the return address beside it');
    assert.deepEqual(dos.report().unsupported, [], 'and it is not a gap any more');
    assert.equal(dos.report().breakpoints, 1);
});

test('INT 19h reboots into the boot sector, or ends the program if there is none', () => {
    // With a disk: control really goes back to 0000:7C00 by the same path
    // loadBoot uses, because a reboot that did something different from
    // booting would be the lie.
    const disk = new Uint8Array(512 * 2);
    disk.set([0xb4, 0x02, 0xb2, 0x5a, 0xcd, 0x21, 0xeb, 0xfe], 0);   // print 'Z', park
    disk[510] = 0x55; disk[511] = 0xaa;
    const m = new I8086Machine(DOSBOX8086);
    const dos = createDos8086(m, { disk }).install()
        .loadCom(Uint8Array.from([0xcd, 0x19]));
    for (let i = 0; i < 200; i++) dos.step();
    assert.equal(m.cpu.cs, 0, 'CS:IP is the BIOS entry point again');
    assert.equal(dos.stdout, 'Z', 'and the boot sector really ran');
    assert.equal(dos.report().rebooted, 1);

    // Without one: the program ends, and the report says a reboot was asked
    // for rather than pretending one happened.
    const m2 = new I8086Machine(DOSBOX8086);
    const d2 = createDos8086(m2).install().loadCom(Uint8Array.from([0xcd, 0x19]));
    const r = d2.run(10_000);
    assert.ok(r.terminated);
    assert.equal(d2.report().rebooted, 1);
    assert.deepEqual(d2.report().unsupported, []);
});
