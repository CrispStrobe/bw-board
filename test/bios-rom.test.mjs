// The bw-board 8086 BIOS ROM, running on the real machine.
//
// Not "the assembler produced bytes" and not "a JS layer answered an INT":
// the ROM image is loaded at F0000h, the CPU is reset, and it takes the
// vector at FFFF:0000 and runs its own power-on self test. Everything after
// that is the ROM's code executing on the vector-verified core, reached the
// way a program reaches it -- through the interrupt vector table the ROM
// wrote, with INT.
//
// THE MACHINE HERE IS NOT PCXT8086, and the difference is one region. That
// preset stops its RAM at 9FFFFh and its CGA card model carries no
// framebuffer, so B8000h is open bus: every character the BIOS writes would
// vanish and every one of these video assertions would read 0FFh. A real
// machine has memory behind the text page; this config says so.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { I8086Machine } from '../src/i8086-machine.js';
import { assembleRaw } from '../src/i8086-asm.js';
import { buildBios, verifyRom, RomError, ROM_BASE, ROM_SIZE, RESET_OFFSET }
    from '../scripts/build-bios.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The machine this BIOS is written for: the PC/XT port map plus a text page. */
const BIOSPC = {
    clockHz: 4_772_727,
    regions: [
        { kind: 'ram', start: 0x00000, end: 0x9ffff },   // 640K conventional
        { kind: 'ram', start: 0xb8000, end: 0xbffff },   // the CGA text page
        { kind: 'rom', start: 0xf0000, end: 0xfffff },   // 64K BIOS
    ],
    chips: [
        { kind: 'pic', name: 'pic1', at: 0x20 },
        { kind: 'pit', name: 'pit1', at: 0x40, irq: 0 },
        { kind: 'ppi', name: 'ppi1', at: 0x60 },
        { kind: 'cga', name: 'cga1', at: 0x3d0 },
    ],
};

const VRAM = 0xb8000;
const BDA = 0x400;
/** Where injected test programs are loaded: below the boot sector, above the BDA. */
const PROG = 0x0600;

const rom = buildBios();

/** A reset machine that has run POST to completion. */
function booted(steps = 3_000_000) {
    const m = new I8086Machine(BIOSPC);
    m.loadRom(rom.bytes);
    m.reset();
    let n = 0;
    while (n < steps && !m.cpu.halted) { m.step(); n++; }
    assert.ok(m.cpu.halted, 'POST ran off the end without halting');
    return m;
}

/**
 * Run a fragment of 8086 as an ordinary program: assembled with the tier's
 * own assembler, loaded into RAM, entered with a stack, run to its HLT.
 * This is how a service gets called the way a program calls it.
 */
function run(m, source, cap = 500_000) {
    const code = assembleRaw(`${source}\n hlt\n`, 0);
    m.mem.set(code, PROG);
    m.cpu.cs = 0; m.cpu.ip = PROG;
    m.cpu.ss = 0; m.cpu.sp = 0x7000;
    m.cpu.ds = 0; m.cpu.es = 0;
    m.cpu.halted = false;
    m.cpu.flags |= 0x0200;              // interrupts on, as DOS leaves them
    let n = 0;
    while (n < cap && !m.cpu.halted) { m.step(); n++; }
    assert.ok(m.cpu.halted, `the injected program did not reach its HLT in ${cap} steps`);
    return n;
}

const rd8 = (m, a) => m.mem[a];
const rd16 = (m, a) => m.mem[a] | (m.mem[a + 1] << 8);
/** The character and attribute of one text cell, in 80-column geometry. */
const cell = (m, row, col) => [m.mem[VRAM + (row * 80 + col) * 2], m.mem[VRAM + (row * 80 + col) * 2 + 1]];
/** One row of the text page as a string, for asserting on what was printed. */
function screenRow(m, row) {
    let s = '';
    for (let c = 0; c < 80; c++) {
        const ch = m.mem[VRAM + (row * 80 + c) * 2];
        s += ch >= 32 && ch < 127 ? String.fromCharCode(ch) : ' ';
    }
    return s.replace(/\s+$/, '');
}

// ---------------------------------------------------------------------------
// The image, before anything executes.
// ---------------------------------------------------------------------------

test('the image fills the F000 segment and ends in a far jump to its own POST', () => {
    assert.equal(rom.bytes.length, ROM_SIZE);
    assert.equal(ROM_BASE, 0xf0000);
    assert.equal(rom.bytes[RESET_OFFSET], 0xea, 'FFF0h must hold JMP FAR');
    assert.equal(rom.segment, 0xf000);
    assert.equal(rom.entry, rom.symbols.get('post').value);
    // FFFF:0005 is where a BIOS's release date has lived since 1981.
    const date = String.fromCharCode(...rom.bytes.slice(0xfff5, 0xfffd));
    assert.match(date, /^\d\d\/\d\d\/\d\d$/);
    assert.equal(rom.warnings.length, 0, 'the source assembles with no warnings');
});

test('the builder refuses an image whose reset vector is not a far jump', () => {
    // The whole reason build-bios.mjs exists rather than a bare assemble()
    // call: an image can be perfectly valid 8086 and still be a machine that
    // does nothing, and nothing downstream would say so.
    const source = readFileSync(join(ROOT, 'rom', 'bios.asm'), 'utf8');
    const broken = source.replace(/reset_vector:\n    db   0EAh/, 'reset_vector:\n    db   090h');
    assert.notEqual(broken, source, 'the reset vector block moved; fix this test');
    assert.throws(() => buildBios({ source: broken }), (e) => {
        assert.ok(e instanceof RomError);
        assert.match(e.message, /far jump/);
        return true;
    });
});

test('the builder refuses an image that is not exactly 64K', () => {
    assert.throws(() => verifyRom(new Uint8Array(0x8000), rom.symbols), /must be exactly/);
});

// ---------------------------------------------------------------------------
// Reset and POST.
// ---------------------------------------------------------------------------

test('reset fetches FFFF:0000 and the far jump there lands on POST', () => {
    const m = new I8086Machine(BIOSPC);
    m.loadRom(rom.bytes);
    m.reset();
    assert.equal(m.cpu.cs, 0xffff);
    assert.equal(m.cpu.ip, 0);
    assert.equal(m.cpu.pc, 0xffff0);

    m.step();                                   // the one instruction that fits there
    assert.equal(m.cpu.cs, 0xf000);
    assert.equal(m.cpu.ip, rom.symbols.get('post').value);
});

test('POST fills the interrupt vector table, real handlers and dummies alike', () => {
    const m = booted();
    // Every vector points into the ROM: the ones POST installs by name, and
    // the 240-odd it does not, which get an IRET. A vector left at whatever
    // the RAM powered up holding is the thing this is checking against.
    for (let n = 0; n < 256; n++) {
        assert.equal(rd16(m, n * 4 + 2), 0xf000, `vector ${n.toString(16)}h is not in the ROM`);
    }
    for (const [vec, name] of [[0x08, 'int08'], [0x09, 'int09'], [0x10, 'int10'],
        [0x11, 'int11'], [0x12, 'int12'], [0x13, 'int13'], [0x16, 'int16'],
        [0x19, 'int19'], [0x1a, 'int1a']]) {
        assert.equal(rd16(m, vec * 4), rom.symbols.get(name).value,
            `vector ${vec.toString(16)}h does not point at ${name}`);
    }
    // INT 1Eh is a POINTER to the diskette parameter table, not a handler.
    // Installing an IRET there hands the floppy driver two bytes of opcode
    // as its step rate.
    assert.equal(rd16(m, 0x1e * 4), rom.symbols.get('dpt').value);
    // An unimplemented vector really is the do-nothing handler.
    assert.equal(rd16(m, 0x4f * 4), rom.symbols.get('int_ignore').value);
    assert.equal(rom.bytes[rom.symbols.get('int_ignore').value], 0xcf, 'IRET');
});

test('POST initialises the BIOS data area at 0040:0000', () => {
    const m = booted();
    assert.equal(rd16(m, BDA + 0x10), 0x0021, 'equipment word: one floppy, 80x25 colour');
    assert.equal(rd16(m, BDA + 0x13), 640, 'memory size in KB');
    // The keyboard ring starts empty: head == tail is the only cheap way to
    // say that, which is why the buffer holds fifteen keys and not sixteen.
    assert.equal(rd16(m, BDA + 0x1a), 0x1e, 'keyboard buffer head');
    assert.equal(rd16(m, BDA + 0x1c), 0x1e, 'keyboard buffer tail');
    assert.equal(rd16(m, BDA + 0x80), 0x1e, 'buffer start offset');
    assert.equal(rd16(m, BDA + 0x82), 0x3e, 'buffer end offset, exclusive');
    assert.equal(rd8(m, BDA + 0x49), 3, 'video mode 3, set by POST');
    assert.equal(rd16(m, BDA + 0x4a), 80, 'columns');
    assert.equal(rd16(m, BDA + 0x4c), 0x1000, 'bytes per page');
    assert.equal(rd16(m, BDA + 0x63), 0x3d4, 'CRTC index port');
    assert.equal(rd8(m, BDA + 0x61), 6, 'cursor start scan line');
    assert.equal(rd8(m, BDA + 0x60), 7, 'cursor end scan line');
});

test('POST prints its banner through its own INT 10h teletype call', () => {
    const m = booted();
    assert.equal(screenRow(m, 0), 'bw-board 8086 BIOS v0.1');
    assert.equal(screenRow(m, 1), '640K OK');
    // The banner goes out one character at a time through INT 10h AH=0Eh, so
    // this is also the first proof that the vector table, the teletype call,
    // the cursor and the CR/LF handling all work.
    assert.equal(cell(m, 0, 0)[1], 0x07, 'light grey on black');
});

test('the timer interrupt reaches 0040:006C without anything asking it to', () => {
    // POST programs the 8254 for 18.2065 Hz and unmasks IRQ0 on the 8259;
    // the machine layer delivers INTR; INT 08h counts. Nothing in the test
    // touches a timer -- the tick is the machine running.
    const m = booted();
    const ticks = rd16(m, BDA + 0x6c) | (rd16(m, BDA + 0x6e) << 16);
    assert.ok(ticks > 0, `the tick count is still ${ticks}: IRQ0 never arrived`);
});

// ---------------------------------------------------------------------------
// INT 11h and INT 12h -- one word each, and both load-bearing.
// ---------------------------------------------------------------------------

test('INT 11h returns the equipment word and INT 12h the memory size', () => {
    const m = booted();
    run(m, ` int 11h\n mov si, ax\n int 12h\n mov di, ax`);
    assert.equal(m.cpu.si, 0x0021);
    assert.equal(m.cpu.di, 640);
});

// ---------------------------------------------------------------------------
// INT 10h -- video.
// ---------------------------------------------------------------------------

test('INT 10h AH=0Eh puts a character on the text page and moves the cursor', () => {
    const m = booted();
    run(m, ` mov ax, 0003h\n int 10h
             mov ax, 0E41h\n mov bx, 0007h\n int 10h
             mov ax, 0E42h\n int 10h`);
    assert.deepEqual(cell(m, 0, 0), [0x41, 0x07], "'A' at the home position");
    assert.deepEqual(cell(m, 0, 1), [0x42, 0x07], "'B' after it");
    assert.equal(rd16(m, BDA + 0x50), 0x0002, 'the cursor is at row 0, column 2');
});

test('INT 10h AH=0Eh treats CR, LF and backspace as control, not as characters', () => {
    // The mistake this is aimed at: writing all 256 codes into the buffer,
    // which prints a musical note for a newline and leaves the cursor one
    // cell to the right of where it started.
    const m = booted();
    run(m, ` mov ax, 0003h\n int 10h
             mov bx, 0007h
             mov ax, 0E58h\n int 10h
             mov ax, 0E0Dh\n int 10h
             mov ax, 0E0Ah\n int 10h
             mov ax, 0E59h\n int 10h
             mov ax, 0E08h\n int 10h
             mov ax, 0E5Ah\n int 10h`);
    assert.equal(cell(m, 0, 0)[0], 0x58, "'X' on the first line");
    assert.equal(cell(m, 1, 0)[0], 0x5a, "'Z' overwrote 'Y' after the backspace");
    assert.equal(rd16(m, BDA + 0x50), 0x0101, 'row 1, column 1');
});

test('INT 10h AH=0Eh scrolls when the cursor leaves the bottom of the screen', () => {
    const m = booted();
    run(m, ` mov ax, 0003h\n int 10h
             mov ah, 02h\n mov bh, 0\n mov dx, 1800h\n int 10h
             mov bx, 0007h
             mov ax, 0E51h\n int 10h
             mov ax, 0E0Dh\n int 10h
             mov ax, 0E0Ah\n int 10h`);
    assert.equal(cell(m, 24, 0)[0], 0x20, 'the bottom row came back blank');
    assert.equal(cell(m, 23, 0)[0], 0x51, "'Q' moved up one row");
    assert.equal(rd16(m, BDA + 0x50), 0x1800, 'the cursor stayed on the last row');
});

test('INT 10h AH=02h/03h set and read the cursor, and 03h reports its shape', () => {
    const m = booted();
    run(m, ` mov ah, 02h\n mov bh, 0\n mov dx, 0A14h\n int 10h
             mov ah, 03h\n mov bh, 0\n int 10h`);
    assert.equal(m.cpu.dx, 0x0a14, 'row 10, column 20');
    assert.equal(m.cpu.cx, 0x0607, 'CH = start line, CL = end line');
});

test('INT 10h AH=09h writes a character with an attribute without moving the cursor', () => {
    const m = booted();
    run(m, ` mov ax, 0003h\n int 10h
             mov ah, 02h\n mov bh, 0\n mov dx, 0005h\n int 10h
             mov ax, 0958h\n mov bx, 004Eh\n mov cx, 3\n int 10h
             mov ah, 08h\n mov bh, 0\n int 10h`);
    assert.deepEqual(cell(m, 0, 5), [0x58, 0x4e]);
    assert.deepEqual(cell(m, 0, 7), [0x58, 0x4e], 'all three copies');
    assert.equal(rd16(m, BDA + 0x50), 0x0005, 'the cursor did not move');
    assert.equal(m.cpu.ax, 0x4e58, 'AH=08h read the cell back as attribute:character');
});

test('INT 10h AH=0Ah writes the character and leaves the attribute alone', () => {
    const m = booted();
    run(m, ` mov ax, 0003h\n int 10h
             mov ah, 02h\n mov bh, 0\n mov dx, 0000h\n int 10h
             mov ax, 0941h\n mov bx, 001Fh\n mov cx, 2\n int 10h
             mov ax, 0A42h\n mov bx, 0000h\n mov cx, 2\n int 10h`);
    assert.deepEqual(cell(m, 0, 0), [0x42, 0x1f], 'character replaced, attribute kept');
    assert.deepEqual(cell(m, 0, 1), [0x42, 0x1f]);
});

test('INT 10h AH=06h with AL=0 clears the window -- it does not scroll nothing', () => {
    // AL=0 is the documented CLEAR and is how essentially every program
    // clears the screen. Reading it literally leaves the display untouched
    // and looks like the write failed rather than the scroll.
    const m = booted();
    run(m, ` mov ax, 0003h\n int 10h
             mov ax, 0600h\n mov bh, 5Fh
             mov cx, 020Ah\n mov dx, 040Eh\n int 10h`);
    assert.deepEqual(cell(m, 3, 12), [0x20, 0x5f], 'inside the window');
    assert.deepEqual(cell(m, 2, 10), [0x20, 0x5f], 'the top-left corner is INCLUSIVE');
    assert.deepEqual(cell(m, 4, 14), [0x20, 0x5f], 'and so is the bottom-right');
    assert.deepEqual(cell(m, 3, 15), [0x20, 0x07], 'one column past the window is untouched');
    assert.deepEqual(cell(m, 1, 12), [0x20, 0x07], 'and one row above it');
});

test('INT 10h AH=06h moves text up and AH=07h moves it down', () => {
    const up = booted();
    run(up, ` mov ax, 0003h\n int 10h
              mov ah, 02h\n mov bh, 0\n mov dx, 0100h\n int 10h
              mov ax, 0E5Ah\n mov bx, 0007h\n int 10h
              mov ax, 0601h\n mov bh, 17h\n xor cx, cx\n mov dx, 184Fh\n int 10h`);
    assert.equal(cell(up, 0, 0)[0], 0x5a, "'Z' moved from row 1 to row 0");
    assert.deepEqual(cell(up, 24, 0), [0x20, 0x17], 'the vacated bottom row got the new attribute');

    const down = booted();
    run(down, ` mov ax, 0003h\n int 10h
                mov ah, 02h\n mov bh, 0\n xor dx, dx\n int 10h
                mov ax, 0E44h\n mov bx, 0007h\n int 10h
                mov ax, 0701h\n mov bh, 4Eh\n xor cx, cx\n mov dx, 184Fh\n int 10h`);
    assert.equal(cell(down, 1, 0)[0], 0x44, "'D' moved from row 0 to row 1");
    assert.deepEqual(cell(down, 0, 0), [0x20, 0x4e], 'the vacated top row');
});

test('INT 10h AH=0Fh reports the mode, the width and the active page', () => {
    const m = booted();
    run(m, ` mov ah, 0Fh\n int 10h`);
    assert.equal(m.cpu.ax & 0xff, 0x03, 'AL = mode 3');
    assert.equal(m.cpu.ax >> 8, 80, 'AH = columns');
    assert.equal(m.cpu.bx >> 8, 0, 'BH = active page');
});

test('INT 10h AH=00h re-reads as the mode it set, and clears the page', () => {
    const m = booted();
    run(m, ` mov ax, 0001h\n int 10h\n mov ah, 0Fh\n int 10h`);
    assert.equal(m.cpu.ax & 0xff, 1, 'mode 1');
    assert.equal(m.cpu.ax >> 8, 40, '40 columns');
    assert.equal(rd16(m, BDA + 0x4c), 0x0800, 'and a smaller page');
    assert.equal(rd16(m, BDA + 0x50), 0, 'every page cursor went home');
    assert.equal(m.mem[VRAM], 0x20, 'the buffer was cleared');
});

// ---------------------------------------------------------------------------
// INT 16h -- the keyboard, over the ring buffer.
// ---------------------------------------------------------------------------

/** Put one key straight into the ring buffer, as INT 09h would. */
function pushKey(m, ascii, scancode) {
    const tail = rd16(m, BDA + 0x1c);
    m.mem[0x400 + tail] = ascii;
    m.mem[0x400 + tail + 1] = scancode;
    let next = tail + 2;
    if (next >= 0x3e) next = 0x1e;
    m.mem[BDA + 0x1c] = next & 0xff;
    m.mem[BDA + 0x1d] = next >> 8;
}

test('INT 16h AH=00h returns a key pushed into the ring buffer and consumes it', () => {
    const m = booted();
    pushKey(m, 0x61, 0x1e);                     // 'a'
    run(m, ` mov ah, 0\n int 16h`);
    assert.equal(m.cpu.ax, 0x1e61, 'AH = scancode, AL = ASCII');
    assert.equal(rd16(m, BDA + 0x1a), 0x20, 'the head advanced past it');
    assert.equal(rd16(m, BDA + 0x1a), rd16(m, BDA + 0x1c), 'and the buffer is empty again');
});

test('INT 16h AH=00h drains the buffer in order and wraps at the end of the ring', () => {
    const m = booted();
    // Fill past the wrap. The ring is sixteen slots and holds fifteen keys;
    // the sixteenth would make tail == head, which is how "empty" is spelled.
    m.mem[BDA + 0x1a] = 0x38; m.mem[BDA + 0x1b] = 0;
    m.mem[BDA + 0x1c] = 0x38; m.mem[BDA + 0x1d] = 0;
    pushKey(m, 0x31, 0x02);
    pushKey(m, 0x32, 0x03);
    pushKey(m, 0x33, 0x04);
    assert.equal(rd16(m, BDA + 0x1c), 0x1e, 'the tail wrapped');
    run(m, ` mov ah,0\n int 16h\n mov si,ax\n mov ah,0\n int 16h\n mov di,ax\n mov ah,0\n int 16h\n mov bx,ax`);
    assert.equal(m.cpu.si, 0x0231);
    assert.equal(m.cpu.di, 0x0332);
    assert.equal(m.cpu.bx, 0x0433, 'the third came from the other side of the wrap');
});

test('INT 16h AH=01h answers in ZF, which means editing the pushed FLAGS', () => {
    // The single thing a naive BIOS gets wrong: IRET reloads FLAGS from the
    // stack, so `or ax,ax` before it is thrown away. The only way to answer
    // in a flag is to edit the caller's FLAGS image where the CPU pushed it.
    const empty = booted();
    run(empty, ` mov ah, 1\n int 16h\n pushf\n pop bx`);
    assert.equal(empty.cpu.bx & 0x40, 0x40, 'ZF set: nothing waiting');

    const ready = booted();
    pushKey(ready, 0x62, 0x30);
    run(ready, ` mov ah, 1\n int 16h\n pushf\n pop bx`);
    assert.equal(ready.cpu.bx & 0x40, 0, 'ZF clear: a key is waiting');
    assert.equal(ready.cpu.ax, 0x3062, 'and it is reported');
    assert.equal(rd16(ready, BDA + 0x1a), 0x1e, 'PEEK does not consume it');
});

test('INT 16h AH=02h reports the shift state from 0040:0017', () => {
    const m = booted();
    m.mem[BDA + 0x17] = 0x43;                   // right shift, ctrl, caps lock
    run(m, ` mov ah, 2\n int 16h`);
    assert.equal(m.cpu.ax & 0xff, 0x43);
});

test('INT 16h AH=00h blocks on an empty buffer and wakes when a key arrives', () => {
    // HLT, not a spin: the CPU stops until the next interrupt of any kind.
    // The timer provides one 18 times a second, so the loop costs nothing --
    // and this is also the proof that the timer ISR returns cleanly enough
    // to be re-entered indefinitely.
    const m = booted();
    const code = assembleRaw(` mov ah, 0\n int 16h\n hlt\n`, 0);
    m.mem.set(code, PROG);
    m.cpu.cs = 0; m.cpu.ip = PROG; m.cpu.ss = 0; m.cpu.sp = 0x7000;
    m.cpu.ds = 0; m.cpu.es = 0; m.cpu.halted = false; m.cpu.flags |= 0x0200;

    for (let i = 0; i < 200_000; i++) m.step();
    // Then run on to the next HLT rather than sampling wherever step number
    // 200,000 happened to land. The loop wakes on every timer tick, walks a
    // few instructions and halts again, so the instant this stops on is a
    // property of how long POST took -- not of whether INT 16h is blocking.
    // Asserting the sampled IP made this test fail when the disk driver made
    // POST longer, which is the wrong thing to have noticed.
    let guard = 0;
    while (!m.cpu.halted && guard++ < 200_000) m.step();
    const loop = rom.symbols.get('k16_read').value;
    assert.equal(m.cpu.halted, true, 'stopped in a HLT, not spinning');
    assert.equal(m.cpu.cs, 0xf000);
    assert.ok(m.cpu.ip >= loop && m.cpu.ip <= loop + 10,
        `halted somewhere other than the INT 16h wait loop (IP ${m.cpu.ip.toString(16)}, `
        + `loop at ${loop.toString(16)})`);

    // Now the keyboard interrupts, exactly as IRQ1 would: the scancode is in
    // the 8255's port A latch and the CPU takes vector 9.
    m.chips.ppi1.setInputPort('a', 0x1f);       // 's'
    m.cpu.interrupt(9);
    let n = 0;
    while (n < 200_000 && !m.cpu.halted) { m.step(); n++; }
    assert.ok(m.cpu.halted, 'INT 16h never returned');
    assert.equal(m.cpu.ax, 0x1f73, "'s' with its scancode");
});

// ---------------------------------------------------------------------------
// INT 09h -- the keyboard interrupt that fills the buffer.
// ---------------------------------------------------------------------------

/** Latch a scancode in the 8255 and take vector 9, as the hardware would. */
function keystroke(m, scancode) {
    m.chips.ppi1.setInputPort('a', scancode & 0xff);
    // The handler returns to wherever the machine was, which after POST is
    // the ROM's own halt loop -- so "back in CS:IP where we started" is the
    // only reliable "the ISR finished", not "left the ROM segment".
    const cs = m.cpu.cs, ip = m.cpu.ip;
    m.cpu.interrupt(9);
    let n = 0;
    while (n < 100_000 && !(m.cpu.cs === cs && m.cpu.ip === ip)) { m.step(); n++; }
    assert.ok(n < 100_000, 'INT 09h did not return');
}

test('INT 09h translates a scancode and inserts it, shifted and unshifted', () => {
    const plain = booted();
    keystroke(plain, 0x1e);
    assert.equal(rd8(plain, 0x41e), 0x61, "'a'");
    assert.equal(rd8(plain, 0x41f), 0x1e, 'with its scancode');

    const shifted = booted();
    keystroke(shifted, 0x2a);                   // left shift down
    assert.equal(rd8(shifted, BDA + 0x17) & 0x02, 0x02, 'the shift bit is set');
    assert.equal(rd16(shifted, BDA + 0x1c), 0x1e, 'a modifier inserts nothing');
    keystroke(shifted, 0x1e);
    assert.equal(rd8(shifted, 0x41e), 0x41, "'A'");
    keystroke(shifted, 0xaa);                   // left shift up
    assert.equal(rd8(shifted, BDA + 0x17) & 0x02, 0, 'and the break code clears it');
});

test('INT 09h gives a function key AL=0 and the scancode, which is how F1 is told apart', () => {
    const m = booted();
    keystroke(m, 0x3b);                         // F1
    assert.equal(rd8(m, 0x41e), 0x00);
    assert.equal(rd8(m, 0x41f), 0x3b);
});

test('INT 09h makes Ctrl-A 01h, because that is what a control character IS', () => {
    const m = booted();
    keystroke(m, 0x1d);                         // ctrl down
    keystroke(m, 0x1e);                         // 'a'
    assert.equal(rd8(m, 0x41e), 0x01);
});

test('INT 09h applies Caps Lock to letters only, not to the whole keyboard', () => {
    // Applying it everywhere turns Caps Lock into a second Shift, so a
    // locked keyboard types '!' for '1'.
    const m = booted();
    keystroke(m, 0x3a);                         // caps lock
    assert.equal(rd8(m, BDA + 0x17) & 0x40, 0x40);
    keystroke(m, 0x1e);                         // 'a' -> 'A'
    assert.equal(rd8(m, 0x41e), 0x41);
    keystroke(m, 0x02);                         // '1' stays '1'
    assert.equal(rd8(m, 0x420), 0x31);
});

// ---------------------------------------------------------------------------
// INT 1Ah -- the clock, over the tick count the timer ISR maintains.
// ---------------------------------------------------------------------------

test('INT 1Ah AH=01h sets the tick count and AH=00h reads it back', () => {
    const m = booted();
    run(m, ` mov ah, 1\n mov cx, 0001h\n mov dx, 2345h\n int 1Ah
             mov ah, 0\n int 1Ah\n mov si, cx\n mov di, dx`);
    assert.equal(m.cpu.si, 0x0001, 'CX = the high word');
    assert.equal(m.cpu.di, 0x2345, 'DX = the low word');
    assert.equal(m.cpu.ax & 0xff, 0, 'AL = the midnight flag, still clear');
});

test('INT 1Ah AH=00h clears the midnight flag by reading it', () => {
    // The flag means "midnight passed since you last asked". Leaving it set
    // would make every later read claim a new day.
    const m = booted();
    m.mem[BDA + 0x70] = 1;
    run(m, ` mov ah, 0\n int 1Ah\n mov si, ax`);
    assert.equal(m.cpu.si & 0xff, 1, 'reported once');
    assert.equal(rd8(m, BDA + 0x70), 0, 'and cleared');
});

test('INT 1Ah refuses the real-time clock functions instead of inventing a time', () => {
    const m = booted();
    run(m, ` mov ah, 2\n int 1Ah\n pushf\n pop bx`);
    assert.equal(m.cpu.bx & 1, 1, 'CF set: there is no RTC on this machine');
});

// ---------------------------------------------------------------------------
// INT 13h -- entry points, register conventions, and one named hole.
// ---------------------------------------------------------------------------

// BIOSPC has no floppy controller and no 8237: 3F0h-3F7h and 00h-0Fh are
// undecoded, so every IN returns the floating bus. That is not a contrived
// config -- it is every machine in this tier that has not been given a disk
// -- and what the driver must do there is fail in bounded time and say so.
// The real controller is driven in test/bios-fdc.test.mjs.

test('with no controller decoded, a read TIMES OUT rather than hanging', () => {
    const m = booted();
    run(m, ` mov ax, 0201h\n mov cx, 0001h\n xor dx, dx\n mov bx, 5000h
             int 13h\n pushf\n pop si`, 2_000_000);
    assert.equal(m.cpu.si & 1, 1, 'CF set');
    assert.equal(m.cpu.ax >> 8, 0x80, 'AH = 80h: the drive never answered');
    assert.equal(rd8(m, BDA + 0x41), 0x80, 'and it is left in 0040:0041');
    // The floating bus reads as 0FFh, which is RQM and DIO both set -- a
    // main status register that says "I have a byte for you" forever. A
    // driver that polls for RQM alone, without checking DIO, would take that
    // as ready and push nine command bytes into nothing.
    assert.equal(m.mem[0x5000], 0, 'and nothing was transferred');
});

test('INT 13h AH=01h reports the last status without touching a controller', () => {
    const m = booted();
    run(m, ` mov ax, 0201h\n mov cx, 1\n xor dx, dx\n mov bx, 5000h\n int 13h
             mov ah, 1\n xor dl, dl\n int 13h\n mov si, ax`, 2_000_000);
    assert.equal(m.cpu.si & 0xff, 0x80, 'AL = the status the read left behind');
    assert.equal(m.cpu.si >> 8, 0x80,
        'AH carries it too, which is what makes CF agree with it');
});

test('INT 13h AH=08h answers the geometry, which is configuration and not traffic', () => {
    const m = booted();
    run(m, ` mov ah, 8\n xor dl, dl\n int 13h\n pushf\n pop si`);
    assert.equal(m.cpu.si & 1, 0, 'CF clear');
    assert.equal(m.cpu.cx >> 8, 39, 'CH = last cylinder');
    assert.equal(m.cpu.cx & 0x3f, 9, 'CL bits 0-5 = sectors per track');
    assert.equal(m.cpu.dx >> 8, 1, 'DH = last head');
    assert.equal(m.cpu.dx & 0xff, 1, 'DL = one drive');
    assert.equal(m.cpu.es, 0xf000);
    assert.equal(m.cpu.di, rom.symbols.get('dpt').value, 'ES:DI -> the parameter table');
});

test('INT 13h says there is no fixed disk rather than inventing one', () => {
    const m = booted();
    run(m, ` mov ah, 8\n mov dl, 80h\n int 13h\n pushf\n pop si`);
    assert.equal(m.cpu.si & 1, 1, 'CF set');
    assert.equal(m.cpu.dx & 0xff, 0, 'DL = no drives of that kind');
});

// ---------------------------------------------------------------------------
// INT 19h -- bootstrap. The point of the exercise.
// ---------------------------------------------------------------------------

/**
 * An INT 13h that works, installed in RAM over the ROM's vector -- which is
 * exactly how an option ROM or a driver would do it, and the honest way to
 * test INT 19h while the controller behind INT 13h is still a hole.
 *
 * It has to edit the pushed FLAGS to answer in CF, for the same reason the
 * ROM's own handlers do: the IRET is about to reload them.
 */
function installDiskStub(m, { fail = false } = {}) {
    const stub = assembleRaw(`
        push bp
        mov  bp, sp
        push ax
        push cx
        push si
        push di
        push ds
        cmp  ah, 2
        jne  stub_fail
        mov  ax, 07E0h              ; the staged image sits at 07E0:0000
        mov  ds, ax
        xor  si, si
        mov  di, bx                 ; ES:BX is the caller's buffer
        mov  cx, 256
        cld
        rep  movsw
        and  word ptr [bp+6], 0FFFEh
        jmp  stub_out
    stub_fail:
        or   word ptr [bp+6], 1
    stub_out:
        pop  ds
        pop  di
        pop  si
        pop  cx
        pop  ax
        mov  ah, 0
        pop  bp
        iret
    `, 0);
    const at = 0x0500;
    m.mem.set(stub, at);
    if (fail) m.mem[at + 7] = 0xff;             // make the AH=2 compare never match
    m.mem[0x13 * 4] = at & 0xff;
    m.mem[0x13 * 4 + 1] = at >> 8;
    m.mem[0x13 * 4 + 2] = 0;
    m.mem[0x13 * 4 + 3] = 0;
}

/** Stage a boot sector where the stub will find it. */
function stageSector(m, { signature = true } = {}) {
    const sector = new Uint8Array(512);
    sector.set(assembleRaw(` mov ax, 0BEEFh\n mov [7000h], ax\n mov [7002h], dx\n hlt\n`, 0), 0);
    if (signature) { sector[510] = 0x55; sector[511] = 0xaa; }
    m.mem.set(sector, 0x7e00);
}

test('INT 19h reads the boot sector to 0000:7C00 and transfers control to it', () => {
    const m = booted();
    installDiskStub(m);
    stageSector(m);
    run(m, ` int 19h`);

    assert.equal(m.mem[0x7c00], 0xb8, 'the sector really landed at 0000:7C00');
    assert.equal(rd16(m, 0x7dfe), 0xaa55, 'signature and all');
    assert.equal(rd16(m, 0x7000), 0xbeef, 'and it executed: only the sector writes this');
    assert.equal(m.cpu.cs, 0x0000, 'control went to segment 0...');
    assert.ok(m.cpu.ip > 0x7c00 && m.cpu.ip < 0x7d00, '...at the boot offset');
    assert.equal(rd8(m, 0x7002), 0x00, 'DL carries the drive it booted from');
    assert.equal(m.cpu.ss, 0x0000);
    assert.equal(m.cpu.sp, 0x7c00, 'the stack grows down from under the sector');
});

test('INT 19h refuses a sector with no 55AA signature', () => {
    // Without the check a blank or data disk is "booted" and 512 bytes of
    // whatever executes. The two-byte marker is the only thing between a
    // formatted disk and a runaway.
    const m = booted();
    installDiskStub(m);
    stageSector(m, { signature: false });
    run(m, ` int 19h`);
    assert.notEqual(rd16(m, 0x7000), 0xbeef, 'the sector was NOT executed');
    const screen = Array.from({ length: 25 }, (_, r) => screenRow(m, r)).join('\n');
    assert.match(screen, /Not a boot disk/, 'and it said so');
});

test('INT 19h retries, then says the machine has nothing to boot from', () => {
    const m = booted();
    installDiskStub(m, { fail: true });
    stageSector(m);
    // The budget is larger than the other INT 19h tests' because the failing
    // path now includes three real AH=00h resets between the three read
    // attempts, and a reset of a controller that is not there is three
    // bounded timeouts rather than an immediate return.
    run(m, ` int 19h`, 4_000_000);
    const screen = Array.from({ length: 25 }, (_, r) => screenRow(m, r)).join('\n');
    assert.match(screen, /No disk controller/);
    assert.match(screen, /No ROM BASIC/, 'INT 18h got its chance, as on a real machine');
    assert.ok(m.cpu.halted);
});

test('POST itself ends in INT 19h, so an unattended machine tries to boot', () => {
    // The end-to-end shape: reset, POST, bootstrap, boot sector -- with
    // nothing in the test doing anything but supplying a disk.
    const m = new I8086Machine(BIOSPC);
    m.loadRom(rom.bytes);
    m.reset();
    // The stub and the staged sector go in before the CPU gets there; the
    // vector is installed by hand after POST has written the table, which is
    // the one thing a driver could not do from cold.
    let n = 0;
    while (n < 3_000_000 && !(m.cpu.cs === 0xf000 && m.cpu.ip === rom.symbols.get('int19').value)) {
        m.step(); n++;
    }
    assert.ok(n < 3_000_000, 'POST never reached INT 19h');
    installDiskStub(m);
    stageSector(m);
    n = 0;
    while (n < 1_000_000 && !m.cpu.halted) { m.step(); n++; }
    assert.equal(rd16(m, 0x7000), 0xbeef, 'the machine booted itself');
});
