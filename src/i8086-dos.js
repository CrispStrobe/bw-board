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
 * table points at the trap segment, which is deliberately not where any real
 * PC puts anything (see DEFAULT_TRAP_SEG).
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
/**
 * WHERE THE TRAP PAGE GOES, and why it is no longer F000.
 *
 * It was `0xf000` — one paragraph up, this file called that "this tier's
 * BIOS", which was true while there was no other. There is now: a real BIOS
 * ROM is being written for Tier C, real Microsoft binaries from the MIT
 * MS-DOS release already run here, and `F0000-FFFFF` is the system BIOS on
 * every PC ever built. Two owners of one address is not a bug you find, it is
 * a bug you inherit, so the trap moved and the ROM did not.
 *
 * THE CONSTRAINT, written down because the next person will not know it. The
 * page needs 1K of WRITABLE memory at a segment boundary, somewhere no real
 * PC puts anything:
 *
 *     00000-9FFFF  conventional RAM — programs live here
 *     A0000-AFFFF  EGA/VGA graphics
 *     B0000-B7FFF  MDA / Hercules      B8000-BFFFF  CGA
 *     C0000-C7FFF  video option ROM    C8000-CBFFF  hard disk controller ROM
 *     D0000-DFFFF  the gap  <-- here
 *     E0000-EFFFF  option ROMs on some machines; BIOS on an AT
 *     F0000-FFFFF  system BIOS, and ROM BASIC on an IBM
 *
 * `D000` is the one 64K window an XT leaves alone. It is not guaranteed
 * forever — EMS page frames were conventionally placed there — so this is a
 * DEFAULT and not a law: pass `trapSeg` to `createDos8086` and a machine that
 * populates D000 can put the trap somewhere else. What must never happen
 * again is a hardcoded address that something real also wants.
 */
export const DEFAULT_TRAP_SEG = 0xd000;
/** The default, kept under its old name so importers need not care. */
export const TRAP_SEG = DEFAULT_TRAP_SEG;
/** Bytes per trap slot: enough for `jmp $` with room to read. */
export const TRAP_STRIDE = 4;
/** Where the trap page must be writable, since it now holds real code. */
export const TRAP_BASE = TRAP_SEG << 4;
/** Bytes of RAM the trap page needs: 256 vectors at TRAP_STRIDE each. */
export const TRAP_SIZE = 256 * TRAP_STRIDE;

/**
 * The memory region a machine must map for a given trap segment. Presets and
 * tests call this instead of writing the pair of addresses out, so moving the
 * trap again is one constant and not a grep.
 */
export const trapRegion = (seg = DEFAULT_TRAP_SEG) => ({
    kind: 'ram', start: seg << 4, end: ((seg << 4) + TRAP_SIZE - 1),
});

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
    /** This instance's trap page. See DEFAULT_TRAP_SEG for the constraint. */
    const trapSeg = io.trapSeg ?? DEFAULT_TRAP_SEG;
    const trapBase = trapSeg << 4;
    const onChar = io.onChar || null;
    /** Pending keystrokes, as ASCII bytes. INT 16h and INT 21h both drink here. */
    const keys = io.keys ? [...io.keys] : [];
    /** The virtual filesystem. A teaching sandbox has no business touching a real one. */
    const files = io.files || new Map();
    const handles = new Map();          // handle → { name, pos, write }
    let nextHandle = 5;                 // 0-4 are the standard handles

    const unsupported = new Map();      // "int:ah" → count
    let stdout = '';
    /** Every INT 03h the program executed, in order. */
    const breakpoints = [];
    let rebooted = 0;
    /** Which interrupt numbers this layer answers. See install(). */
    let claimed = null;
    /** Next free paragraph for INT 21h/48h. Above a .COM's 64K arena. */
    let allocTop = 0x1800;
    /** How many times the program asked for a keystroke. A run with no input
     *  cannot be compared against one that had some, and this is how a
     *  consumer tells those apart from a real disagreement. */
    let keyRequests = 0;
    /** Set by a handler that has taken CS:IP (and the stack) for itself, so
     *  the generic IRET below must not run and undo it. */
    let controlTransferred = false;
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
    /**
     * INT 10h/06h and /07h -- scroll a RECTANGLE, not the screen.
     *
     * This was a clear() for a while, on the grounds that clearing is the
     * honest subset. It is not: a program that scrolls a five-line window in
     * the middle of a full screen and one that wipes the display are doing
     * visibly different things, and the corpus has a program written to show
     * exactly that difference. Comparing our output against an independent
     * implementation's is what made it visible.
     *
     * AL is the number of lines to move; AL=0 means BLANK THE WHOLE WINDOW,
     * which is the special case worth stating, because a caller asking for
     * "scroll by nothing" would otherwise get nothing. BH is the attribute
     * the vacated lines are filled with -- not the current one.
     *
     * @param {boolean} up true for 06h (text moves up, blanks at the bottom)
     */
    const scrollWindow = (up) => {
        const lines = cpu.al;
        const top = Math.min(cpu.ch, ROWS - 1), left = Math.min(cpu.cl, COLS - 1);
        const bot = Math.min(cpu.dh, ROWS - 1), right = Math.min(cpu.dl, COLS - 1);
        if (bot < top || right < left) return;
        const fill = cpu.bh;
        const height = bot - top + 1;
        const blank = (row) => {
            for (let c = left; c <= right; c++) {
                machine._write(cellAt(row * COLS + c), 0x20);
                machine._write(cellAt(row * COLS + c) + 1, fill);
            }
        };
        if (lines === 0 || lines >= height) {
            for (let r = top; r <= bot; r++) blank(r);
            return;
        }
        if (up) {
            for (let r = top; r <= bot - lines; r++) {
                for (let c = left; c <= right; c++) {
                    const from = (r + lines) * COLS + c, to = r * COLS + c;
                    machine._write(cellAt(to), machine._read(cellAt(from)));
                    machine._write(cellAt(to) + 1, machine._read(cellAt(from) + 1));
                }
            }
            for (let r = bot - lines + 1; r <= bot; r++) blank(r);
        } else {
            for (let r = bot; r >= top + lines; r--) {
                for (let c = left; c <= right; c++) {
                    const from = (r - lines) * COLS + c, to = r * COLS + c;
                    machine._write(cellAt(to), machine._read(cellAt(from)));
                    machine._write(cellAt(to) + 1, machine._read(cellAt(from) + 1));
                }
            }
            for (let r = top; r < top + lines; r++) blank(r);
        }
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
                keyRequests++;
                const c = keys.length ? keys.shift() : 0;
                cpu.al = c; putChar(c); return;
            }
            case 0x02: putChar(cpu.dl); return;           // 1347 of 3109 calls
            case 0x06:                                    // direct console I/O
                if (cpu.dl === 0xff) {
                    keyRequests++;
                    if (!keys.length) { cpu.flags |= ZF; cpu.al = 0; return; }
                    cpu.flags &= ~ZF; cpu.al = keys.shift(); return;
                }
                putChar(cpu.dl); return;
            case 0x07: case 0x08:                         // input, no echo
                keyRequests++;
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
                keyRequests++;
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
            case 0x0b: keyRequests++; cpu.al = keys.length ? 0xff : 0x00; return;
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
            case 0x19: cpu.al = 0; return;                // current drive: A:
            case 0x29: return parseFilename();
            case 0x2d:                                    // set time: accepted, not kept
                cpu.al = 0; return;
            case 0x30:
                // THE VERSION IS CONFIGURABLE, and it has to be. MS-DOS 2.0's
                // own CHKDSK.COM refuses to run against anything else --
                // "Incorrect DOS version" -- so a fixed 5.00 makes genuine
                // period binaries unrunnable for no reason. Default stays 5.00
                // because that is what the textbook corpus expects.
                cpu.ax = ((io.dosVersion && io.dosVersion.minor) || 0) << 8
                    | ((io.dosVersion && io.dosVersion.major) || 5);
                cpu.bx = 0; cpu.cx = 0; return;
            case 0x37:                                    // switch character
                // Undocumented, and real utilities call it before parsing a
                // command line. AL=0 gets it; anything else is a set we accept
                // and ignore.
                if (cpu.al === 0) { cpu.dl = 0x2f; cpu.al = 0; return; }
                cpu.al = 0; return;
            case 0x45: {                                  // duplicate handle
                const h = handles.get(cpu.bx);
                if (!h && cpu.bx > 4) return fail(6);
                const n = nextHandle++;
                handles.set(n, h ? { ...h } : { name: null, pos: 0, write: true, std: cpu.bx });
                cpu.ax = n; return ok();
            }
            case 0x46: {                                  // force duplicate handle
                const h = handles.get(cpu.bx);
                if (!h && cpu.bx > 4) return fail(6);
                handles.set(cpu.cx, h ? { ...h } : { name: null, pos: 0, write: true, std: cpu.bx });
                return ok();
            }
            case 0x48: {                                  // allocate memory
                // A bump allocator over the space above the program. DOS
                // answers a FAILED request with the LARGEST BLOCK AVAILABLE in
                // BX, and a program that asks for everything to find out how
                // much there is depends on that -- returning only carry makes
                // it conclude there is no memory at all.
                const want = cpu.bx;
                const avail = (0xa000 - allocTop) & 0xffff;
                if (want > avail) { cpu.bx = avail; return fail(8); }
                cpu.ax = allocTop; allocTop += want; return ok();
            }
            case 0x49: return ok();                       // free: this allocator never reuses
            case 0x4a: {                                  // resize a block
                const want = cpu.bx;
                const avail = (0xa000 - allocTop) & 0xffff;
                if (want > avail + 0x1000) { cpu.bx = avail; return fail(8); }
                return ok();
            }
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
            case 0x3e:                                    // close
                // DOS reports an invalid handle; answering ok() unconditionally
                // made "close a handle that was never open" look like success,
                // and a program written to TEST that convention printed the
                // wrong answer while appearing to work.
                if (!handles.has(cpu.bx)) return fail(6);
                handles.delete(cpu.bx);
                return ok();
            case 0x3f: {                                  // read from handle
                const h = handles.get(cpu.bx);
                if (cpu.bx === 0) {                       // stdin
                    keyRequests++;
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
            case 0x41: {                                  // delete file
                const name = zstr(cpu.ds, cpu.dx);
                if (!files.has(name)) return fail(2);     // file not found
                files.delete(name);
                return ok();
            }
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

    /**
     * Write a command tail and the two default FCBs into a PSP.
     *
     * THE TAIL IS NOT THE COMMAND LINE. DOS puts a LENGTH BYTE at 80h, the
     * arguments at 81h -- INCLUDING the leading space that separated them
     * from the program name -- and a carriage return after them, and it does
     * NOT include the program's own name. A program that reads 81h and finds
     * its own name there, or finds no leading space, mis-parses its first
     * argument. That is why CHKDSK answered "Invalid parameter" to everything
     * before this existed: it was reading an empty tail.
     *
     * The two FCBs at 5Ch and 6Ch are parsed from the first two arguments.
     * Real utilities of the DOS 1.x era read those rather than the tail --
     * that is the whole reason DOS builds them -- so a loader that writes the
     * tail and leaves the FCBs zeroed only half-works.
     */
    function writeCommandTail(seg, args) {
        const tail = args ? ` ${String(args).trim()}` : '';
        const n = Math.min(tail.length, 126);
        wr8(seg, 0x80, n);
        for (let i = 0; i < n; i++) wr8(seg, 0x81 + i, tail.charCodeAt(i) & 0xff);
        wr8(seg, 0x81 + n, 0x0d);
        // FCB 1 at 5Ch, FCB 2 at 6Ch, from the first two arguments.
        const words = tail.trim().length ? tail.trim().split(/\s+/) : [];
        for (let k = 0; k < 2; k++) {
            const base = k === 0 ? 0x5c : 0x6c;
            for (let i = 0; i < 16; i++) wr8(seg, base + i, 0);
            for (let i = 1; i <= 11; i++) wr8(seg, base + i, 0x20);
            const w = words[k];
            if (!w) continue;
            let t = w, drive = 0;
            if (t.length > 1 && t[1] === ':') {
                const c = t.toUpperCase().charCodeAt(0);
                if (c >= 65 && c <= 90) drive = c - 64;
                t = t.slice(2);
            }
            wr8(seg, base, drive);
            const [name, ext = ''] = t.split('.');
            for (let i = 0; i < 8 && i < name.length; i++) {
                wr8(seg, base + 1 + i, name.toUpperCase().charCodeAt(i));
            }
            for (let i = 0; i < 3 && i < ext.length; i++) {
                wr8(seg, base + 9 + i, ext.toUpperCase().charCodeAt(i));
            }
        }
    }

    /**
     * INT 21h/29h -- parse a filename from DS:SI into the FCB at ES:DI.
     *
     * Real utilities call this before they touch a command line, so a stub
     * that only returned carry stopped CHKDSK and COMP before they started.
     * The subset here is what those actually use: an optional `d:` drive
     * letter, the name padded to eight with spaces, the extension padded to
     * three, wildcards allowed. AL answers 0 for a clean parse, 1 if a
     * wildcard appeared, FFh for an invalid drive.
     */
    function parseFilename() {
        let si = cpu.si;
        const at = (i) => rd8(cpu.ds, (si + i) & 0xffff);
        let i = 0;
        while (at(i) === 0x20 || at(i) === 0x09) i++;      // leading blanks
        let drive = 0, wild = 0;
        if (at(i + 1) === 0x3a) {                          // "d:"
            const c = at(i) & 0xdf;
            if (c < 0x41 || c > 0x5a) { cpu.al = 0xff; return; }
            drive = c - 0x40; i += 2;
        }
        wr8(cpu.es, cpu.di, drive);
        const field = (len, off, stop) => {
            let n = 0;
            for (let k = 0; k < len; k++) wr8(cpu.es, (cpu.di + off + k) & 0xffff, 0x20);
            while (n < len) {
                const c = at(i);
                if (c === 0 || c === 0x20 || c === 0x0d || c === stop) break;
                if (c === 0x2a) {                          // '*' fills the rest
                    wild = 1;
                    for (let k = n; k < len; k++) wr8(cpu.es, (cpu.di + off + k) & 0xffff, 0x3f);
                    i++; n = len; break;
                }
                if (c === 0x3f) wild = 1;
                wr8(cpu.es, (cpu.di + off + n) & 0xffff, c & 0xdf === 0 ? c : c);
                i++; n++;
            }
            while (at(i) !== 0 && at(i) !== 0x20 && at(i) !== 0x0d && at(i) !== stop) i++;
        };
        field(8, 1, 0x2e);
        if (at(i) === 0x2e) { i++; field(3, 9, -1); }
        else for (let k = 0; k < 3; k++) wr8(cpu.es, (cpu.di + 9 + k) & 0xffff, 0x20);
        cpu.si = (si + i) & 0xffff;
        cpu.al = wild;
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
            case 0x06: case 0x07: scrollWindow(cpu.ah === 0x06); return;
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
            case 0x0c: {                                  // write pixel
                const at = pixelAt(cpu.cx, cpu.dx);
                if (!at) { note(0x10, 0x0c); return fail(1); }
                if (at.bits === 8) machine._write(at.addr, cpu.al);
                else {
                    // XOR when AL bit 7 is set -- how a game draws and erases
                    // a sprite with the same call.
                    const v = machine._read(at.addr);
                    const val = cpu.al & ((1 << at.bits) - 1);
                    const next = (cpu.al & 0x80)
                        ? v ^ (val << at.shift)
                        : (v & ~(at.mask << at.shift)) | (val << at.shift);
                    machine._write(at.addr, next);
                }
                return;
            }
            case 0x0d: {                                  // read pixel
                const at = pixelAt(cpu.cx, cpu.dx);
                if (!at) { note(0x10, 0x0d); return fail(1); }
                const v = machine._read(at.addr);
                cpu.al = at.bits === 8 ? v : (v >> at.shift) & at.mask;
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

    /**
     * Where pixel (x, y) lives, in the mode the program last selected.
     *
     * THE LAYOUT IS DUPLICATED HERE ON PURPOSE. i8086-cga.js knows it too,
     * and importing it would couple the service layer to the renderer -- the
     * independence that let the two be written at the same time. Instead the
     * two implementations are CROSS-CHECKED: a test plots through this
     * service and then renders with the other module, and requires the pixel
     * to appear where it was put. Two independent implementations agreeing is
     * worth more than one shared one.
     *
     * Returns null for a text mode, because a pixel there is meaningless and
     * a service that pretended otherwise would corrupt the screen silently.
     */
    function pixelAt(x, y) {
        const mode = modeLog.length ? (modeLog[modeLog.length - 1] & 0x7f) : 0x03;
        if (mode === 0x13) {
            if (x >= 320 || y >= 200) return null;
            return { addr: 0xa0000 + y * 320 + x, bits: 8, shift: 0, mask: 0xff };
        }
        // The CGA graphics modes interleave: even rows at +0000h, odd at
        // +2000h. A plot that walks straight down memory lands on the wrong
        // half of the screen for every second row.
        if (mode === 0x04 || mode === 0x05) {
            if (x >= 320 || y >= 200) return null;
            const bank = (y & 1) ? 0x2000 : 0;
            const addr = 0xb8000 + bank + (y >> 1) * 80 + (x >> 2);
            return { addr, bits: 2, shift: (3 - (x & 3)) * 2, mask: 3 };
        }
        if (mode === 0x06) {
            if (x >= 640 || y >= 200) return null;
            const bank = (y & 1) ? 0x2000 : 0;
            const addr = 0xb8000 + bank + (y >> 1) * 80 + (x >> 3);
            return { addr, bits: 1, shift: 7 - (x & 7), mask: 1 };
        }
        return null;
    }

    // ---- INT 13h (BIOS disk) --------------------------------------------
    /**
     * Enough of the disk BIOS for a boot sector to load the thing it exists
     * to load. CHS is converted with the geometry the caller declared, and a
     * request outside the image FAILS WITH CARRY rather than reading zeros --
     * a boot loader that silently gets a sector of nothing is the hardest
     * kind of bug to see.
     */
    function int13() {
        const g = io.geometry || { sectors: 18, heads: 2 };
        const disk = io.disk || null;
        const lba = (c, h, sec) => (c * g.heads + h) * g.sectors + (sec - 1);
        switch (cpu.ah) {
            case 0x00: cpu.ah = 0; return ok();          // reset
            case 0x02: case 0x03: {
                if (!disk) { cpu.ah = 0x80; return fail(0x8000); }   // no media
                const count = cpu.al, sec = cpu.cl & 0x3f;
                const cyl = cpu.ch | ((cpu.cl & 0xc0) << 2);
                const start = lba(cyl, cpu.dh, sec) * 512;
                if (sec === 0 || start < 0 || start + count * 512 > disk.length) {
                    cpu.ah = 0x04; cpu.al = 0; return fail(0x0400);  // sector not found
                }
                for (let i = 0; i < count * 512; i++) {
                    if (cpu.ah === 0x02) wr8(cpu.es, (cpu.bx + i) & 0xffff, disk[start + i]);
                    else disk[start + i] = rd8(cpu.es, (cpu.bx + i) & 0xffff);
                }
                cpu.ah = 0; cpu.al = count; return ok();
            }
            case 0x08: {                                  // drive parameters
                if (!disk) { cpu.ah = 0x07; return fail(0x0700); }
                const cyls = Math.max(1, Math.floor(disk.length / (512 * g.sectors * g.heads)));
                cpu.ch = (cyls - 1) & 0xff;
                cpu.cl = g.sectors & 0x3f;
                cpu.dh = (g.heads - 1) & 0xff;
                cpu.dl = 1; cpu.ah = 0;
                return ok();
            }
            default: note(0x13, cpu.ah); cpu.ah = 0x01; return fail(0x0100);
        }
    }

    // ---- INT 16h (BIOS keyboard) ----------------------------------------
    function int16() {
        switch (cpu.ah) {
            case 0x00: case 0x10: {
                keyRequests++;
                const c = keys.length ? keys.shift() : 0;
                cpu.al = c; cpu.ah = 0; return;           // scan code unmodelled: AH = 0
            }
            case 0x01: case 0x11:
                keyRequests++;
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

    /**
     * INT 03h -- the one-byte breakpoint, and the corpus really does use it.
     * Three textbook programs execute it under a comment reading "Debugging
     * Breakpoint": the program is ASKING for a debugger.
     *
     * So the service is to answer as DOS does. With no debugger installed the
     * handler returns and the program continues -- which is why those three
     * still print their results -- and the event is recorded either way, so a
     * debugger that IS watching can stop on it. Counting it as an unsupported
     * service, which is what happened before, told the user we lacked
     * something we merely had not connected.
     */
    function int03() {
        // WHERE the breakpoint was is on the STACK, not in CS:IP. By the time
        // a handler runs, the CPU has already taken the interrupt and CS:IP
        // is the trap slot -- reporting that would tell a debugger the
        // address of the trap table, which is useless and looks plausible.
        // The pushed IP is the byte AFTER the one-byte INT 3, so `at` backs
        // up over it to name the instruction the user actually wrote.
        const ip = rd16(cpu.ss, cpu.sp);
        const cs = rd16(cpu.ss, (cpu.sp + 2) & 0xffff);
        const where = { cs, ip, at: (ip - 1) & 0xffff, cycles: machine.cycles };
        breakpoints.push(where);
        if (io.onBreakpoint) io.onBreakpoint(where);
    }

    /**
     * INT 19h -- bootstrap. A program that calls it wants the machine
     * restarted, and one corpus program ends that way on purpose.
     *
     * A real BIOS re-reads the boot sector. There is no disk here unless the
     * caller supplied one, so this resets the CPU and ends the program, and
     * says which it did in the report rather than pretending a reboot
     * happened. If a disk IS present, the boot sector is re-loaded and
     * control really does go back to 0000:7C00 -- the same path loadBoot()
     * uses, because a reboot that did something DIFFERENT from booting would
     * be the lie.
     */
    function int19() {
        rebooted++;
        const disk = io.disk;
        if (disk && disk.length >= 512 && disk[510] === 0x55 && disk[511] === 0xaa) {
            for (let i = 0; i < 512; i++) machine._write(0x7c00 + i, disk[i]);
            cpu.cs = 0; cpu.ip = 0x7c00; cpu.ss = 0; cpu.sp = 0x7c00;
            cpu.ds = 0; cpu.es = 0; cpu.dl = 0;
            // A REBOOT MUST NOT IRET. The generic return below pops the CS:IP
            // the INT pushed, which would drop the machine straight back into
            // the program that just asked to be restarted -- the same shape
            // as a handler setting a flag and having the IRET restore it.
            controlTransferred = true;
            return;
        }
        terminated = true;
    }

    /** INT 33h: the mouse driver nobody installed. Saying so is the service. */
    function int33() {
        if (cpu.ax === 0) { cpu.ax = 0; cpu.bx = 0; return; }   // 0 = no driver
        note(0x33, cpu.ah); return fail(1);
    }

    /** INT 11h -- the equipment word. One floppy, 80x25 colour, no printer. */
    function int11() { cpu.ax = io.equipment !== undefined ? io.equipment : 0x0021; }
    /** INT 12h -- conventional memory in KB, which for this tier is 640. */
    function int12() { cpu.ax = io.memoryKb !== undefined ? io.memoryKb : 640; }

    const HANDLERS = {
        0x03: int03, 0x08: int08, 0x09: int09,
        0x11: int11, 0x12: int12,
        0x10: int10, 0x13: int13, 0x15: int15, 0x16: int16, 0x19: int19, 0x1a: int1a,
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
        /** Where this instance put its trap page. Tests and the debug layer
         *  read it rather than assuming the default. */
        trapSeg,

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
        install(opts = {}) {
            // WHICH VECTORS TO CLAIM, and the default is "all of them"
            // because on a machine with no BIOS ROM there is nothing else to
            // answer them.
            //
            // THAT DEFAULT IS WRONG THE MOMENT A REAL BIOS EXISTS, and one
            // now does (`rom/bios.asm` boots itself from the reset fetch and
            // serves INT 10h/13h/16h/08h/09h/11h/12h/1Ah/19h). POST fills the
            // vector table; install() would then overwrite it, and the ROM's
            // services -- the ones a booted DOS is entitled to call -- would
            // silently stop being reachable. Two implementations of INT 13h
            // with the later loader winning is not a layering, it is a race.
            //
            // So a machine that boots a ROM passes the DOS set and leaves the
            // BIOS interrupts alone, which is exactly the division real DOS
            // keeps: DOS owns INT 20h-2Fh, the BIOS owns the rest.
            //
            //     dos.install({ vectors: DOS_VECTORS })
            //
            // `vectors` is an iterable of interrupt numbers; omit it for the
            // no-ROM machine and nothing changes.
            const claim = opts.vectors
                ? [...opts.vectors].map((n) => n & 0xff)
                : Array.from({ length: 256 }, (_, n) => n);
            claimed = new Set(claim);
            for (const n of claim) {
                const off = n * TRAP_STRIDE;
                wr16(0, n * 4, off);
                wr16(0, n * 4 + 2, trapSeg);
                wr8(trapSeg, off, 0xeb);       // jmp $
                wr8(trapSeg, off + 1, 0xfe);
            }
            const probe = claim[0] * TRAP_STRIDE;
            if (rd8(trapSeg, probe) !== 0xeb || rd8(trapSeg, probe + 1) !== 0xfe) {
                throw new Error(
                    `the trap page at ${trapBase.toString(16)}h is not writable: this machine `
                    + `must map ${TRAP_SIZE} bytes of RAM there — trapRegion(0x${trapSeg.toString(16)}) `
                    + 'gives the region, and DOSBOX8086 already has it. Without it every '
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
        loadCom(bytes, opts = {}) {
            const at = typeof opts === 'number' ? opts : (opts.at ?? 0x0800);
            const args = typeof opts === 'number' ? '' : (opts.args ?? '');
            psp = at;
            for (let i = 0; i < 0x100; i++) wr8(psp, i, 0);
            wr8(psp, 0, 0xcd); wr8(psp, 1, 0x20);       // int 20h
            writeCommandTail(psp, args);
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
        loadExe(bytes, opts = {}) {
            const at = typeof opts === 'number' ? opts : (opts.at ?? 0x0800);
            const args = typeof opts === 'number' ? '' : (opts.args ?? '');
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
            writeCommandTail(psp, args);
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

        /**
         * Load a 512-byte boot sector the way the BIOS does: at 0000:7C00,
         * with DL naming the drive, and jump there.
         *
         * This is a THIRD loader beside .COM and .EXE, and it needs neither
         * DOS nor an assembler: a boot sector is already a binary. It is what
         * makes the boot-sector corpus runnable today, and it is also the
         * shape a real machine starts in, so a lesson can show the same
         * 512 bytes the hardware would have read.
         *
         * The signature is checked and REFUSED if absent, because a boot
         * sector without AA55h at the end is one the BIOS would not have
         * executed either -- running it anyway would teach the wrong thing.
         */
        loadBoot(bytes, drive = 0x00) {
            if (bytes.length < 512) throw new Error(`a boot sector is 512 bytes, not ${bytes.length}`);
            if (bytes[510] !== 0x55 || bytes[511] !== 0xaa) {
                throw new Error(
                    'no AA55h boot signature at offset 1FEh: the BIOS would have refused this '
                    + 'sector too, so running it would teach the wrong thing');
            }
            for (let i = 0; i < 512; i++) machine._write(0x7c00 + i, bytes[i]);
            cpu.cs = 0; cpu.ip = 0x7c00;
            cpu.ss = 0; cpu.sp = 0x7c00;          // the stack grows down away from the code
            cpu.ds = 0; cpu.es = 0;
            cpu.dl = drive & 0xff;                 // which drive it came from
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
            if (cpu.cs !== trapSeg) return null;
            if (cpu.ip % TRAP_STRIDE !== 0 || cpu.ip / TRAP_STRIDE > 0xff) return null;
            const n = cpu.ip / TRAP_STRIDE;
            // Only answer what we claimed. A vector left to the BIOS ROM
            // whose handler happens to land here is a bug worth seeing, not
            // one worth quietly servicing.
            if (claimed && !claimed.has(n)) return null;
            const h = HANDLERS[n];
            controlTransferred = false;
            if (h) h();
            else { note(n, cpu.ah); fail(1); }
            if (controlTransferred) return n;   // the handler owns CS:IP now
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
                breakpoints: breakpoints.length,
                rebooted,
                keyRequests,
            };
        },
    };
}

/** A machine shaped for Tier B: 768K of RAM, no ROM, nothing decoded. The
 *  services are the hardware. */
/**
 * Tier B with just enough hardware to be AUDIBLE, and not one chip more.
 *
 * Twenty-four accesses to port 61h across the 525-program corpus are real
 * programs written for a real PC, poking the speaker gate on a machine that
 * has none. This config gives them somewhere to land: an 8255 at 60h, an
 * 8254 at 40h, and the speaker that reads the gate from one and the divisor
 * from the other.
 *
 * DELIBERATELY NO PIC, AND THE PIT IS NOT WIRED TO AN IRQ. A timer on an
 * interrupt line means a program that enables interrupts and programs the
 * counter starts taking INT 8, which is a whole interrupt surface bought to
 * make a beep audible. Three chips, because twenty-four programs ask for
 * them, and nothing else.
 */
/**
 * The vectors DOS owns when a real BIOS is present.
 *
 * INT 20h-2Fh is the DOS range, and it is the whole of it: 20h terminate,
 * 21h the service call, 22h-24h the terminate/break/error handler ADDRESSES
 * (which are pointers DOS stores in the PSP, not handlers), 25h/26h absolute
 * disk read and write, 27h terminate-and-stay-resident, and the rest
 * reserved. Everything below 20h belongs to the BIOS and the hardware, and
 * a DOS that claimed INT 13h would be taking the disk away from the ROM
 * that owns the controller.
 */
export const DOS_VECTORS = Object.freeze([
    0x20, 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x29,
    0x2a, 0x2b, 0x2c, 0x2d, 0x2e, 0x2f,
]);

export const DOSBOX8086_XT = Object.freeze({
    clockHz: 5_000_000,
    regions: [
        { kind: 'ram', start: 0x00000, end: 0xbffff },
        trapRegion(),
    ],
    chips: [
        { kind: 'ppi', name: 'ppi1', at: 0x60 },
        { kind: 'pit', name: 'pit1', at: 0x40 },
        { kind: 'pcspeaker', name: 'spk', ppi: 'ppi1', pit: 'pit1' },
    ],
});

export const DOSBOX8086 = Object.freeze({
    clockHz: 5_000_000,
    regions: [
        { kind: 'ram', start: 0x00000, end: 0xbffff },
        // The trap page: 1K of RAM holding 256 `jmp $` slots. It used to sit
        // at F000 and be described as this tier's BIOS. F000 is where a real
        // BIOS goes, and there is one now, so it moved. See DEFAULT_TRAP_SEG.
        trapRegion(),
    ],
    chips: [],
});

export default createDos8086;
