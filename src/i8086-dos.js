/**
 * The DOS/BIOS service layer — Tier B of the 8086 stack, and the tier with
 * no hardware in it at all.
 *
 * The 8086 teaching corpus does not want a PC. Measured across the 525
 * programs of the Amey-Thakur corpus: 3,109 `int 21h` calls, of which 2,862
 * are AH=02h (write character), 09h (write string) and 4Ch (exit); then 79
 * `int 10h`, 26 `int 16h`, 10 `int 1Ah`, 8 `int 15h`. So three services
 * cover 92% of it, and NOTHING in that set needs a BIOS ROM, a DOS image, a
 * PIC, a PIT or a disk controller. Building those first to run these
 * programs would be the long way round.
 *
 * HOW THE TRAP WORKS, and why not the obvious way. The obvious way is to
 * watch for the INT instruction and service it before the CPU executes it.
 * That breaks on the first program that hooks a vector: `int 21h` reached
 * through a program's own handler chaining to the previous one is a plain
 * far jump, not an INT, and a watcher on the instruction never sees it.
 *
 * So the vectors are made real instead. Every entry in the interrupt vector
 * table points at TRAP_SEG:n, a segment that is deliberately not mapped.
 * The CPU takes the interrupt itself — pushing FLAGS, CS and IP exactly as
 * the silicon does — and lands on the trap address, where this layer
 * recognises where it is, services the call, and performs the IRET by hand.
 * A program that chains to the saved vector lands on the same trap address
 * and is serviced identically. A program that REPLACES a vector with its
 * own handler is not serviced at all, which is also correct: its handler is
 * the implementation now.
 *
 * REFUSALS ARE COUNTED, NOT SWALLOWED. An unimplemented service records
 * {int, ah, count} in `report().unsupported` and returns with carry set,
 * which is DOS's own error convention. A program that depends on one fails
 * visibly and the report names what it wanted, rather than the program
 * quietly computing rubbish.
 *
 * The screen is the CPU-visible text buffer at B8000h, not a private
 * string. A program that calls INT 21h/09h and a program that writes
 * B800:0000 directly therefore land in the same place and `screenText()`
 * reads both — which is what a real BIOS does, and the reason the games in
 * the corpus that bypass DOS entirely still show up.
 *
 * @module
 */

/**
 * Where every interrupt vector points. Vector n lands on TRAP_SEG:(n*4),
 * and each slot holds `jmp $` — a two-byte jump to itself.
 *
 * THE SELF-LOOP IS THE WHOLE TRICK, and the first design here got it wrong.
 * The obvious arrangement is an UNMAPPED trap segment with the offset equal
 * to the vector number, intercepted before the CPU can fetch. That works for
 * software INTs, where this layer gets to look between instructions — and
 * fails the moment a HARDWARE interrupt exists, because the machine layer
 * delivers a pending IRQ and executes the next instruction in the SAME
 * step() call. There is no "between" to intercept in: the CPU lands on the
 * trap and runs whatever unmapped memory reads as, which is 0FFh, which is
 * a ModR/M group opcode, which is garbage. The symptom was a timer that
 * ticked zero times and said nothing.
 *
 * With `jmp $` in a MAPPED slot, the CPU can execute at the trap as often as
 * it likes and IP does not move, so servicing is idempotent and completely
 * independent of whether this layer looks before or after the machine
 * stepped. The stride of four leaves room for the instruction and keeps the
 * arithmetic obvious.
 */
export const TRAP_SEG = 0xf000;
/** Bytes per trap slot: enough for `jmp $` with room to read. */
export const TRAP_STRIDE = 4;
/** Where the trap page must be writable, since it now holds real code. */
export const TRAP_BASE = TRAP_SEG << 4;

/** Text mode 3: 80x25, two bytes per cell, at the CGA colour address. */
export const VRAM = 0xb8000;
export const COLS = 80, ROWS = 25;

const CF = 0x0001, ZF = 0x0040;
/** CF, PF, AF, ZF, SF, OF — the bits a service RETURNS in, as opposed to
 *  the bits (IF, TF, DF) that belong to the interrupted program. */
const STATUS_FLAGS = 0x0001 | 0x0004 | 0x0010 | 0x0040 | 0x0080 | 0x0800;

/**
 * @param {import('./i8086-machine.js').I8086Machine} machine
 * @param {{ onChar?: (ch: string) => void, keys?: number[],
 *           files?: Map<string, Uint8Array>, ticks?: () => number }} [io]
 */
export function createDos8086(machine, io = {}) {
    const cpu = machine.cpu;
    const onChar = io.onChar || null;
    /** Pending keystrokes, as ASCII bytes. INT 16h and INT 21h both drink here. */
    const keys = io.keys ? [...io.keys] : [];
    /** The virtual filesystem. A teaching sandbox has no business touching a real one. */
    const files = io.files || new Map();
    const handles = new Map();          // handle → { name, pos, write }
    let nextHandle = 5;                 // 0-4 are the standard handles

    const unsupported = new Map();      // "int:ah" → count
    let stdout = '';
    let terminated = false;
    let exitCode = 0;
    let psp = 0;
    let cursor = 0;                     // linear cell index into the text page
    let attr = 0x07;
    /** Every AL passed to INT 10h/AH=00h, oldest first. The only record of
     *  which video mode a program believes it is in. */
    const modeLog = [];

    // ---- memory helpers (physical, through the machine's own bus) --------
    const phys = (seg, off) => (((seg & 0xffff) << 4) + (off & 0xffff)) & 0xfffff;
    const rd8 = (seg, off) => machine._read(phys(seg, off));
    const wr8 = (seg, off, v) => machine._write(phys(seg, off), v & 0xff);
    const rd16 = (seg, off) => rd8(seg, off) | (rd8(seg, (off + 1) & 0xffff) << 8);
    const wr16 = (seg, off, v) => { wr8(seg, off, v); wr8(seg, (off + 1) & 0xffff, v >> 8); };
    const pop = () => { const v = rd16(cpu.ss, cpu.sp); cpu.sp = (cpu.sp + 2) & 0xffff; return v; };

    // ---- the screen -----------------------------------------------------
    const cellAt = (i) => VRAM + i * 2;
    const scroll = () => {
        for (let i = 0; i < (ROWS - 1) * COLS; i++) {
            machine._write(cellAt(i), machine._read(cellAt(i + COLS)));
            machine._write(cellAt(i) + 1, machine._read(cellAt(i + COLS) + 1));
        }
        for (let i = (ROWS - 1) * COLS; i < ROWS * COLS; i++) {
            machine._write(cellAt(i), 0x20);
            machine._write(cellAt(i) + 1, attr);
        }
        cursor -= COLS;
    };
    /** One character through the BIOS teletype path: the shared write. */
    const putChar = (code) => {
        const ch = String.fromCharCode(code);
        stdout += ch;
        if (onChar) onChar(ch);
        if (code === 0x0d) { cursor -= cursor % COLS; }
        else if (code === 0x0a) { cursor += COLS; }
        else if (code === 0x08) { if (cursor % COLS) cursor--; }
        else if (code === 0x07) { /* bell: audible, not visible */ }
        else {
            machine._write(cellAt(cursor), code);
            machine._write(cellAt(cursor) + 1, attr);
            cursor++;
        }
        while (cursor >= ROWS * COLS) scroll();
    };
    const clearScreen = () => {
        for (let i = 0; i < ROWS * COLS; i++) {
            machine._write(cellAt(i), 0x20);
            machine._write(cellAt(i) + 1, attr);
        }
        cursor = 0;
    };

    // ---- flag helpers: DOS reports failure in carry ---------------------
    const ok = () => { cpu.flags &= ~CF; };
    const fail = (code) => { cpu.flags |= CF; cpu.ax = code & 0xffff; };
    const note = (int, ah) => {
        const k = `${int.toString(16)}:${ah.toString(16)}`;
        unsupported.set(k, (unsupported.get(k) || 0) + 1);
    };

    // ---- INT 21h --------------------------------------------------------
    function int21() {
        const ah = cpu.ah;
        switch (ah) {
            case 0x00: terminated = true; exitCode = 0; return;
            case 0x01: {                                  // input with echo
                const c = keys.length ? keys.shift() : 0;
                cpu.al = c; putChar(c); return;
            }
            case 0x02: putChar(cpu.dl); return;           // 1347 of 3109 calls
            case 0x06:                                    // direct console I/O
                if (cpu.dl === 0xff) {
                    if (!keys.length) { cpu.flags |= ZF; cpu.al = 0; return; }
                    cpu.flags &= ~ZF; cpu.al = keys.shift(); return;
                }
                putChar(cpu.dl); return;
            case 0x07: case 0x08:                         // input, no echo
                cpu.al = keys.length ? keys.shift() : 0; return;
            case 0x09: {                                  // 1064 of 3109 calls
                let off = cpu.dx;
                for (let n = 0; n < 0x10000; n++) {
                    const c = rd8(cpu.ds, off++);
                    if (c === 0x24) break;                // '$' ends it, not NUL
                    putChar(c);
                }
                cpu.al = 0x24; return;
            }
            case 0x0a: {                                  // buffered input
                const base = cpu.dx, max = rd8(cpu.ds, base);
                let n = 0;
                while (n < max - 1 && keys.length) {
                    const c = keys.shift();
                    if (c === 0x0d) break;
                    wr8(cpu.ds, base + 2 + n, c); putChar(c); n++;
                }
                wr8(cpu.ds, base + 1, n);
                wr8(cpu.ds, base + 2 + n, 0x0d);
                putChar(0x0d); return;
            }
            case 0x0b: cpu.al = keys.length ? 0xff : 0x00; return;
            case 0x0c: keys.length = 0; cpu.ah = cpu.al; return int21();
            case 0x25: {                                  // set interrupt vector
                wr16(0, cpu.al * 4, cpu.dx);
                wr16(0, cpu.al * 4 + 2, cpu.ds);
                return;
            }
            case 0x2a: {                                  // get date
                const d = new Date(0);
                cpu.cx = d.getUTCFullYear(); cpu.dh = d.getUTCMonth() + 1;
                cpu.dl = d.getUTCDate(); cpu.al = d.getUTCDay(); return;
            }
            case 0x2c: {                                  // get time
                const ms = machine.tMs;
                cpu.ch = Math.floor(ms / 3600000) % 24; cpu.cl = Math.floor(ms / 60000) % 60;
                cpu.dh = Math.floor(ms / 1000) % 60; cpu.dl = Math.floor(ms / 10) % 100;
                return;
            }
            case 0x30: cpu.ax = 0x0005; cpu.bx = 0; cpu.cx = 0; return;   // version 5.00
            case 0x35: {                                  // get interrupt vector
                cpu.bx = rd16(0, cpu.al * 4);
                cpu.es = rd16(0, cpu.al * 4 + 2);
                return;
            }
            case 0x3c: {                                  // create file
                const name = zstr(cpu.ds, cpu.dx);
                files.set(name, new Uint8Array(0));
                const h = nextHandle++;
                handles.set(h, { name, pos: 0, write: true });
                cpu.ax = h; return ok();
            }
            case 0x3d: {                                  // open file
                const name = zstr(cpu.ds, cpu.dx);
                if (!files.has(name)) return fail(2);     // file not found
                const h = nextHandle++;
                handles.set(h, { name, pos: 0, write: (cpu.al & 3) !== 0 });
                cpu.ax = h; return ok();
            }
            case 0x3e: handles.delete(cpu.bx); return ok();
            case 0x3f: {                                  // read from handle
                const h = handles.get(cpu.bx);
                if (cpu.bx === 0) {                       // stdin
                    let n = 0;
                    while (n < cpu.cx && keys.length) wr8(cpu.ds, cpu.dx + n++, keys.shift());
                    cpu.ax = n; return ok();
                }
                if (!h) return fail(6);                   // invalid handle
                const buf = files.get(h.name) || new Uint8Array(0);
                let n = 0;
                while (n < cpu.cx && h.pos < buf.length) wr8(cpu.ds, cpu.dx + n++, buf[h.pos++]);
                cpu.ax = n; return ok();
            }
            case 0x40: {                                  // write to handle
                if (cpu.bx === 1 || cpu.bx === 2) {       // stdout / stderr
                    for (let i = 0; i < cpu.cx; i++) putChar(rd8(cpu.ds, cpu.dx + i));
                    cpu.ax = cpu.cx; return ok();
                }
                const h = handles.get(cpu.bx);
                if (!h) return fail(6);
                const old = files.get(h.name) || new Uint8Array(0);
                const end = Math.max(old.length, h.pos + cpu.cx);
                const next = new Uint8Array(end);
                next.set(old);
                for (let i = 0; i < cpu.cx; i++) next[h.pos + i] = rd8(cpu.ds, cpu.dx + i);
                h.pos += cpu.cx;
                files.set(h.name, next);
                cpu.ax = cpu.cx; return ok();
            }
            case 0x41: files.delete(zstr(cpu.ds, cpu.dx)); return ok();
            case 0x42: {                                  // seek
                const h = handles.get(cpu.bx);
                if (!h) return fail(6);
                const buf = files.get(h.name) || new Uint8Array(0);
                const off = ((cpu.cx << 16) | cpu.dx) >>> 0;
                h.pos = cpu.al === 1 ? h.pos + off : cpu.al === 2 ? buf.length + off : off;
                cpu.dx = (h.pos >>> 16) & 0xffff; cpu.ax = h.pos & 0xffff;
                return ok();
            }
            case 0x4c: terminated = true; exitCode = cpu.al; return;      // 451 calls
            case 0x4d: cpu.ax = exitCode; return;
            default: note(0x21, ah); return fail(1);      // function not supported
        }
    }

    const zstr = (seg, off) => {
        let s = '';
        for (let i = 0; i < 128; i++) {
            const c = rd8(seg, off + i);
            if (!c) break;
            s += String.fromCharCode(c);
        }
        return s;
    };

    // ---- INT 10h (BIOS video) -------------------------------------------
    function int10() {
        switch (cpu.ah) {
            case 0x00:
                // RECORD THE MODE, then behave as text either way. This
                // layer draws characters and nothing else, but a graphics
                // program's mode set is the only evidence anywhere of which
                // mode it thinks it is in -- and `likelyMode()` in
                // i8086-cga.js needs exactly this log to decide how to
                // render the bytes the program is about to write. Without
                // it a mode-13h game paints A0000h and no one knows.
                //
                // AL bit 7 ("do not clear the display") is kept AS WRITTEN:
                // the renderer masks it, and throwing information away here
                // would make the log lie about what the program asked for.
                modeLog.push(cpu.al);
                if (!(cpu.al & 0x80)) clearScreen();
                return;
            case 0x01: return;                            // cursor shape: nothing to show
            case 0x02: cursor = cpu.dh * COLS + cpu.dl; return;
            case 0x03: cpu.dh = Math.floor(cursor / COLS); cpu.dl = cursor % COLS; cpu.cx = 0x0607; return;
            case 0x05: return;                            // page select: one page here
            case 0x06: case 0x07: clearScreen(); return;  // scroll a window: clear is the honest subset
            case 0x08:
                cpu.al = machine._read(cellAt(cursor));
                cpu.ah = machine._read(cellAt(cursor) + 1);
                return;
            case 0x09: case 0x0a: {                       // write char (+attr), no cursor move
                const a = cpu.ah === 0x09 ? cpu.bl : attr;
                for (let i = 0; i < Math.max(1, cpu.cx); i++) {
                    machine._write(cellAt(cursor + i), cpu.al);
                    machine._write(cellAt(cursor + i) + 1, a);
                }
                return;
            }
            case 0x0e: attr = cpu.bl || attr; putChar(cpu.al); return;     // teletype
            case 0x0f: cpu.al = 0x03; cpu.ah = COLS; cpu.bh = 0; return;   // mode 3
            case 0x13: {                                  // write string (AT+, common anyway)
                for (let i = 0; i < cpu.cx; i++) putChar(rd8(cpu.es, cpu.bp + i));
                return;
            }
            default: note(0x10, cpu.ah); return fail(1);
        }
    }

    // ---- INT 16h (BIOS keyboard) ----------------------------------------
    function int16() {
        switch (cpu.ah) {
            case 0x00: case 0x10: {
                const c = keys.length ? keys.shift() : 0;
                cpu.al = c; cpu.ah = 0; return;           // scan code unmodelled: AH = 0
            }
            case 0x01: case 0x11:
                if (!keys.length) { cpu.flags |= ZF; return; }
                cpu.flags &= ~ZF; cpu.al = keys[0]; cpu.ah = 0; return;
            case 0x02: case 0x12: cpu.al = 0; return;     // no shift state modelled
            default: note(0x16, cpu.ah); return fail(1);
        }
    }

    // ---- the rest --------------------------------------------------------
    function int1a() {
        switch (cpu.ah) {
            case 0x00: {                                  // ticks since midnight
                const ticks = io.ticks ? io.ticks() : Math.floor(machine.tMs / (1000 / 18.2065));
                cpu.cx = (ticks >>> 16) & 0xffff; cpu.dx = ticks & 0xffff; cpu.al = 0; return;
            }
            default: note(0x1a, cpu.ah); return fail(1);
        }
    }

    function int15() {
        // AH=86h WAIT: CX:DX microseconds. The corpus uses it as a delay and
        // yousefkotp's traffic-light project is built on it. Time here is
        // MACHINE time, so a five-second wait costs five seconds of
        // simulated clock and no wall clock at all.
        if (cpu.ah === 0x86) {
            const us = ((cpu.cx << 16) | cpu.dx) >>> 0;
            const target = machine.cycles + Math.round(us * machine.clockHz / 1e6);
            machine.cycles = target;
            cpu.flags &= ~CF;
            return;
        }
        note(0x15, cpu.ah); return fail(1);
    }

    /**
     * INT 08h — the BIOS timer tick, and the reason this exists at all.
     *
     * install() claims all 256 vectors, hardware ones included. On a machine
     * that also has a PIC and a PIT (E6.3), IRQ0 therefore lands here. If
     * nothing serviced it the interrupt would be counted as an unsupported
     * call and IRET'd — and, far worse, the PIC would never receive its
     * end-of-interrupt, so IRQ0 would stay in service and NO FURTHER TIMER
     * INTERRUPT WOULD EVER BE DELIVERED. One tick, then silence, and the
     * symptom is a program that runs but never advances.
     *
     * So this is a real BIOS tick: bump the count at 0040:006Ch where every
     * DOS program expects to find it, and acknowledge the PIC.
     */
    function int08() {
        const lo = rd16(0x40, 0x6c), hi = rd16(0x40, 0x6e);
        const next = ((hi << 16) | lo) + 1;
        wr16(0x40, 0x6c, next & 0xffff);
        wr16(0x40, 0x6e, (next >>> 16) & 0xffff);
        eoi();
    }

    /** INT 09h — the keyboard IRQ. Nothing to fetch (keys arrive through
     *  type()), but the PIC still has to be told the interrupt is over. */
    function int09() { eoi(); }

    /** Acknowledge whichever PIC the machine has, if it has one. Written as
     *  a lookup rather than a constant because Tier B machines have no PIC at
     *  all and a breadboard is free to decode one anywhere. */
    function eoi() {
        for (const c of machine.config.chips || []) {
            if (c.kind === 'pic') { machine._out(c.at, 0x20); return; }
        }
    }

    /** INT 33h: the mouse driver nobody installed. Saying so is the service. */
    function int33() {
        if (cpu.ax === 0) { cpu.ax = 0; cpu.bx = 0; return; }   // 0 = no driver
        note(0x33, cpu.ah); return fail(1);
    }

    const HANDLERS = {
        0x08: int08, 0x09: int09,
        0x10: int10, 0x15: int15, 0x16: int16, 0x1a: int1a,
        // INT 1Ch is the user timer hook a real BIOS calls from INT 08h.
        // Nothing calls it here — a nested dispatch through the trap would
        // need its own frame — so a program that hooks 1Ch and expects to be
        // called is NOT served, and hooks 08h instead. Stated, not hidden.
        0x1c: () => {},
        0x20: () => { terminated = true; exitCode = 0; },
        0x21: int21, 0x33: int33,
    };

    return {
        machine,

        /**
         * Point every vector at its trap slot, fill the slots with `jmp $`,
         * and clear the screen.
         *
         * The trap page has to be WRITABLE, because it holds instructions
         * now. A machine that has not mapped it would take the writes into
         * open bus, read 0FFh back, and execute garbage on the first
         * interrupt — so it is verified by read-back and refused by name
         * rather than discovered later as a mystery crash.
         */
        install() {
            for (let n = 0; n < 256; n++) {
                const off = n * TRAP_STRIDE;
                wr16(0, n * 4, off);
                wr16(0, n * 4 + 2, TRAP_SEG);
                wr8(TRAP_SEG, off, 0xeb);       // jmp $
                wr8(TRAP_SEG, off + 1, 0xfe);
            }
            if (rd8(TRAP_SEG, 0) !== 0xeb || rd8(TRAP_SEG, 1) !== 0xfe) {
                throw new Error(
                    `the trap page at ${TRAP_BASE.toString(16)}h is not writable: this machine `
                    + 'must map at least 1K of RAM there (DOSBOX8086 does). Without it every '
                    + 'interrupt executes open bus.');
            }
            clearScreen();
            return this;
        },

        /**
         * Load a .COM at PSP:0100h — the flat model the corpus assembles to.
         * A RET with nothing pushed lands on PSP:0000, which holds INT 20h,
         * which terminates: the same trapdoor DOS itself provides.
         */
        loadCom(bytes, at = 0x0800) {
            psp = at;
            for (let i = 0; i < 0x100; i++) wr8(psp, i, 0);
            wr8(psp, 0, 0xcd); wr8(psp, 1, 0x20);       // int 20h
            wr8(psp, 0x80, 0);                          // empty command tail
            for (let i = 0; i < bytes.length; i++) wr8(psp, 0x100 + i, bytes[i]);
            cpu.cs = psp; cpu.ds = psp; cpu.es = psp; cpu.ss = psp;
            cpu.ip = 0x100; cpu.sp = 0xfffe;
            wr16(cpu.ss, cpu.sp, 0);                    // the RET-to-PSP:0000 trapdoor
            cpu.flags |= 0x0200;                        // interrupts enabled, as DOS leaves them
            terminated = false; exitCode = 0;
            return this;
        },

        /**
         * Load an MZ .EXE: header, image, relocations, and the entry point
         * the header names. This is what MASM's .MODEL SMALL produces, so
         * it is the form most of the corpus actually ships.
         */
        loadExe(bytes, at = 0x0800) {
            if (bytes[0] !== 0x4d || bytes[1] !== 0x5a) throw new Error('not an MZ executable');
            const u16 = (o) => bytes[o] | (bytes[o + 1] << 8);
            const headerParas = u16(0x08);
            const imageStart = headerParas * 16;
            const pages = u16(0x04), lastPage = u16(0x02);
            const imageEnd = lastPage ? (pages - 1) * 512 + lastPage : pages * 512;
            psp = at;
            const loadSeg = psp + 0x10;                 // the image sits above the PSP
            for (let i = 0; i < 0x100; i++) wr8(psp, i, 0);
            wr8(psp, 0, 0xcd); wr8(psp, 1, 0x20);
            const image = bytes.subarray(imageStart, imageEnd);
            for (let i = 0; i < image.length; i++) {
                machine._write((phys(loadSeg, 0) + i) & 0xfffff, image[i]);
            }
            // Relocations: each entry names a word holding a segment that
            // must be biased by where we actually loaded.
            const relCount = u16(0x06), relOff = u16(0x18);
            for (let i = 0; i < relCount; i++) {
                const off = u16(relOff + i * 4), seg = u16(relOff + i * 4 + 2);
                const a = phys(loadSeg + seg, off);
                const v = (machine._read(a) | (machine._read(a + 1) << 8)) + loadSeg;
                machine._write(a, v & 0xff);
                machine._write(a + 1, (v >> 8) & 0xff);
            }
            cpu.cs = (loadSeg + u16(0x16)) & 0xffff;
            cpu.ip = u16(0x14);
            cpu.ss = (loadSeg + u16(0x0e)) & 0xffff;
            cpu.sp = u16(0x10);
            cpu.ds = psp; cpu.es = psp;
            cpu.flags |= 0x0200;
            terminated = false; exitCode = 0;
            return this;
        },

        /** Type into the machine. Both INT 16h and INT 21h read this queue. */
        type(text) {
            for (const ch of String(text)) keys.push(ch.charCodeAt(0) & 0xff);
            return this;
        },

        /**
         * If the CPU is parked on a trap address, service it and IRET.
         * @returns {number|null} the interrupt number serviced, or null
         */
        service() {
            if (cpu.cs !== TRAP_SEG) return null;
            if (cpu.ip % TRAP_STRIDE !== 0 || cpu.ip / TRAP_STRIDE > 0xff) return null;
            const n = cpu.ip / TRAP_STRIDE;
            const h = HANDLERS[n];
            if (h) h();
            else { note(n, cpu.ah); fail(1); }
            // IRET by hand, with the one subtlety that makes status returns
            // work at all: a plain IRET restores the FLAGS the INT pushed,
            // which would WIPE the carry a DOS error just set and the zero
            // flag INT 16h/01h answers with. A real handler avoids that by
            // patching the flags image ON THE STACK before returning, so
            // the arithmetic bits come from the handler and everything
            // else — the caller's interrupt-enable, direction and trap
            // state — comes back off the stack. That is what this blend is.
            //
            // Without it every `jc` after an open, and every `jz` after a
            // keyboard poll, reads the flags the program had BEFORE the
            // call, and the failure looks like the service returning wrong
            // answers rather than never returning them at all.
            cpu.ip = pop();
            cpu.cs = pop();
            const saved = pop();
            cpu.flags = (((saved & ~STATUS_FLAGS) | (cpu.flags & STATUS_FLAGS)) | 0xf002) & ~0x0028;
            return n;
        },

        /** One unit of progress: service a pending trap, else run an instruction. */
        step() {
            if (this.service() !== null) return 0;
            return machine.step();
        },

        /**
         * Run until the program terminates or the budget runs out. The
         * budget is instructions, not time, because a program that never
         * exits is the failure this has to end.
         */
        run(maxSteps = 5_000_000) {
            let i = 0;
            while (!terminated && i < maxSteps) { this.step(); i++; }
            return { terminated, exitCode, steps: i, exhausted: i >= maxSteps };
        },

        get terminated() { return terminated; },
        get exitCode() { return exitCode; },
        get stdout() { return stdout; },
        get files() { return files; },

        /**
         * The video modes this program set, oldest first, exactly as the AL
         * bytes it passed. Hand this to `likelyMode()` in i8086-cga.js to
         * find out how to render memory; this layer deliberately does not
         * import the renderer, so the two stay independent and either can be
         * used without the other.
         */
        videoModeLog() { return [...modeLog]; },

        /** The text page as 25 lines, read from the CPU-visible buffer —
         *  so a program that wrote B800:0000 directly appears here too. */
        screenText() {
            const lines = [];
            for (let r = 0; r < ROWS; r++) {
                let s = '';
                for (let c = 0; c < COLS; c++) {
                    s += String.fromCharCode(machine._read(cellAt(r * COLS + c)) || 0x20);
                }
                lines.push(s.replace(/\s+$/, ''));
            }
            return lines;
        },

        /** What was asked for and refused, so a failure names itself. */
        report() {
            return {
                unsupported: [...unsupported].map(([k, count]) => {
                    const [int, ah] = k.split(':');
                    return { int: parseInt(int, 16), ah: parseInt(ah, 16), count };
                }),
                stdout,
                terminated,
                exitCode,
            };
        },
    };
}

/** A machine shaped for Tier B: 768K of RAM, no ROM, nothing decoded. The
 *  services are the hardware. */
export const DOSBOX8086 = Object.freeze({
    clockHz: 5_000_000,
    regions: [
        { kind: 'ram', start: 0x00000, end: 0xbffff },
        // The trap page. A real machine has its BIOS ROM here; this one has
        // 1K of RAM holding 256 `jmp $` slots, which is this tier's BIOS.
        { kind: 'ram', start: 0xf0000, end: 0xf03ff },
    ],
    chips: [],
});

export default createDos8086;
