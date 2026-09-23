/**
 * A small RV32IM assembler — the LOCAL, in-browser route that makes the riscv32
 * console programmable from assembly, the twin of `i8086-asm.js` for the 8086.
 *
 * It takes GNU-style RISC-V assembly and returns a loadable image
 * ({entry, segments:[{addr, bytes}]}) that boots on `RiscV32Machine` exactly as
 * the shipped clang fixtures do — same core, same ECALL console. No toolchain,
 * no network: the encoder here is the whole compiler. Programs talk to the
 * outside world through the machine's Linux-style ECALL ABI (`a7=64` write(fd,
 * buf, len), `a7=93` exit(code)), so a "hello world" is `li a7,64; ecall`.
 *
 * SCOPE. The RV32I base integer set, the M extension (mul/div/rem), the Zicsr
 * CSR instructions, and the pseudo-instructions a human actually writes (li, la,
 * mv, j, call, ret, branch-zero forms, …). Two passes: the first places every
 * label, the second encodes now that forward references are known. Immediates
 * are range-checked and misalignments refused, because a silently-truncated
 * offset is a debugging afternoon.
 *
 * The output shape is deliberately the one `lib/bw-debug/riscv-programs.js`
 * already feeds `createDebugTarget('riscv32', …)`: an entry PC and a list of
 * {addr, bytes} segments. @module
 */

/** A located assembler error — carries the 1-based line and the source text. */
export class RiscvAsmError extends Error {
    constructor(message, {line = 0, text = ''} = {}) {
        super(line ? `line ${line}: ${message}` : message);
        this.name = 'RiscvAsmError';
        this.line = line;
        this.text = text;
    }
}

// ---------------------------------------------------------------------------
// Registers.
// ---------------------------------------------------------------------------

const REG = (() => {
    const m = new Map();
    for (let i = 0; i < 32; i++) m.set('x' + i, i);
    const abi = ['zero', 'ra', 'sp', 'gp', 'tp', 't0', 't1', 't2',
        's0', 's1', 'a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7',
        's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 's10', 's11',
        't3', 't4', 't5', 't6'];
    abi.forEach((n, i) => m.set(n, i));
    m.set('fp', 8);   // s0 is the frame pointer
    return m;
})();

const reg = (tok, line) => {
    const r = REG.get(String(tok).toLowerCase());
    if (r === undefined) throw new RiscvAsmError(`not a register: ${tok}`, {line});
    return r;
};

// CSR names the assembler understands by name (the ones the machine implements).
const CSR = new Map(Object.entries({
    mstatus: 0x300, misa: 0x301, medeleg: 0x302, mideleg: 0x303, mie: 0x304,
    mtvec: 0x305, mscratch: 0x340, mepc: 0x341, mcause: 0x342, mtval: 0x343,
    mip: 0x344, mhartid: 0xf14, cycle: 0xc00, time: 0xc01, instret: 0xc02,
    sstatus: 0x100, sie: 0x104, stvec: 0x105, sscratch: 0x140, sepc: 0x141,
    scause: 0x142, stval: 0x143, sip: 0x144, satp: 0x180
}));

// ---------------------------------------------------------------------------
// Number / expression parsing (constants and label references).
// ---------------------------------------------------------------------------

function parseNumber(tok, line) {
    const t = String(tok).trim();
    let neg = false, s = t;
    if (s[0] === '-') { neg = true; s = s.slice(1); }
    else if (s[0] === '+') s = s.slice(1);
    let v;
    if (/^0x[0-9a-f]+$/i.test(s)) v = parseInt(s, 16);
    else if (/^0b[01]+$/i.test(s)) v = parseInt(s.slice(2), 2);
    else if (/^0o[0-7]+$/i.test(s)) v = parseInt(s.slice(2), 8);
    else if (/^[0-9]+$/.test(s)) v = parseInt(s, 10);
    else if (/^'(\\.|[^'])'$/.test(s)) v = charEscape(s.slice(1, -1));
    else return null;
    if (!Number.isFinite(v)) throw new RiscvAsmError(`cannot read the number ${tok}`, {line});
    return neg ? -v : v;
}

function charEscape(s) {
    if (s[0] !== '\\') return s.charCodeAt(0);
    const c = s[1];
    return {n: 10, t: 9, r: 13, '0': 0, '\\': 92, "'": 39, '"': 34}[c] ?? c.charCodeAt(0);
}

// ---------------------------------------------------------------------------
// Tokenising one line into a mnemonic and comma-separated operands.
// ---------------------------------------------------------------------------

/** Split a source line into {labels:[…], op, args:[…]} — comments and the
 *  trailing label colon removed. `%hi(x)`, `%lo(x)` and `off(reg)` are single
 *  operands, so commas inside parentheses do not split. */
function lex(rawLine, line) {
    // Strip a trailing `#`/`;` comment, but not one inside a "quoted" string.
    let s = rawLine, inStr = false, esc = false;
    for (let i = 0; i < rawLine.length; i++) {
        const ch = rawLine[i];
        if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
        if (ch === '"') { inStr = true; continue; }
        if (ch === '#' || ch === ';') { s = rawLine.slice(0, i); break; }
    }
    const labels = [];
    // Leading labels: `name:` possibly several.
    for (;;) {
        const m = /^\s*([.$A-Za-z_][.$\w]*)\s*:/.exec(s);
        if (!m) break;
        labels.push(m[1]);
        s = s.slice(m[0].length);
    }
    s = s.trim();
    if (!s) return {labels, op: null, args: []};
    const sp = s.search(/\s/);
    const op = (sp < 0 ? s : s.slice(0, sp)).toLowerCase();
    const rest = sp < 0 ? '' : s.slice(sp).trim();
    const args = [];
    if (rest) {
        let depth = 0, cur = '', inStr = false, esc = false;
        for (const ch of rest) {
            if (inStr) {
                cur += ch;
                if (esc) esc = false;
                else if (ch === '\\') esc = true;
                else if (ch === '"') inStr = false;
                continue;
            }
            if (ch === '"') { inStr = true; cur += ch; continue; }
            if (ch === '(') depth++;
            if (ch === ')') depth--;
            if (ch === ',' && depth === 0) { args.push(cur.trim()); cur = ''; continue; }
            cur += ch;
        }
        if (cur.trim()) args.push(cur.trim());
    }
    return {labels, op, args};
}

// ---------------------------------------------------------------------------
// Instruction encoders (32-bit little-endian words).
// ---------------------------------------------------------------------------

const u = n => n >>> 0;
const rType = (f7, f3, op, rd, rs1, rs2) => u((f7 << 25) | (rs2 << 20) | (rs1 << 15) | (f3 << 12) | (rd << 7) | op);
const iType = (f3, op, rd, rs1, imm) => u(((imm & 0xfff) << 20) | (rs1 << 15) | (f3 << 12) | (rd << 7) | op);
const sType = (f3, op, rs1, rs2, imm) => u((((imm >> 5) & 0x7f) << 25) | (rs2 << 20) | (rs1 << 15) | (f3 << 12) | ((imm & 0x1f) << 7) | op);
const uType = (op, rd, imm) => u((imm & 0xfffff000) | (rd << 7) | op);
function bType(f3, op, rs1, rs2, imm) {
    const b = imm;
    return u((((b >> 12) & 1) << 31) | (((b >> 5) & 0x3f) << 25) | (rs2 << 20) | (rs1 << 15)
        | (f3 << 12) | (((b >> 1) & 0xf) << 8) | (((b >> 11) & 1) << 7) | op);
}
function jType(op, rd, imm) {
    const j = imm;
    return u((((j >> 20) & 1) << 31) | (((j >> 1) & 0x3ff) << 21) | (((j >> 11) & 1) << 20)
        | (((j >> 12) & 0xff) << 12) | (rd << 7) | op);
}

const checkRange = (v, bits, line, what) => {
    const lo = -(1 << (bits - 1)), hi = (1 << (bits - 1)) - 1;
    if (v < lo || v > hi) throw new RiscvAsmError(`${what} ${v} out of range for a ${bits}-bit signed field`, {line});
};

// R-type: mnemonic -> [funct7, funct3]
const R = {
    add: [0x00, 0], sub: [0x20, 0], sll: [0x00, 1], slt: [0x00, 2], sltu: [0x00, 3],
    xor: [0x00, 4], srl: [0x00, 5], sra: [0x20, 5], or: [0x00, 6], and: [0x00, 7],
    mul: [0x01, 0], mulh: [0x01, 1], mulhsu: [0x01, 2], mulhu: [0x01, 3],
    div: [0x01, 4], divu: [0x01, 5], rem: [0x01, 6], remu: [0x01, 7]
};
// I-type ALU: mnemonic -> funct3 (opcode 0x13)
const I_ALU = {addi: 0, slti: 2, sltiu: 3, xori: 4, ori: 6, andi: 7};
// Loads: mnemonic -> funct3 (opcode 0x03)
const LOAD = {lb: 0, lh: 1, lw: 2, lbu: 4, lhu: 5};
// Stores: mnemonic -> funct3 (opcode 0x23)
const STORE = {sb: 0, sh: 1, sw: 2};
// Branches: mnemonic -> funct3 (opcode 0x63)
const BRANCH = {beq: 0, bne: 1, blt: 4, bge: 5, bltu: 6, bgeu: 7};
// Shift-immediate: mnemonic -> [funct7-top, funct3]
const SHIFT_I = {slli: [0x00, 1], srli: [0x00, 5], srai: [0x20, 5]};
// CSR: mnemonic -> [funct3, isImmediate]
const CSR_OP = {csrrw: [1, 0], csrrs: [2, 0], csrrc: [3, 0], csrrwi: [5, 1], csrrsi: [6, 1], csrrci: [7, 1]};

export default assembleRiscv;

/**
 * Assemble RV32IM source into a loadable image.
 * @param {string} source
 * @param {{textBase?: number, dataBase?: number, entry?: string}} [opts]
 * @returns {{ok: true, image: {entry: number, segments: {addr:number, bytes:Uint8Array}[]},
 *            entry: number, symbols: Map<string, number>, bytes: number}}
 */
export function assembleRiscv(source, opts = {}) {
    const textBase = opts.textBase ?? 0x1000;
    const dataBase = opts.dataBase ?? 0x8000;
    const lines = String(source).split(/\r?\n/).map((t, i) => ({text: t, line: i + 1}));

    // Sections: text and data (rodata folds into data; bss reserves zeroed space
    // at the end of data so it is file-backed here — simplest correct thing).
    const sec = {
        text: {base: textBase, buf: [], name: 'text'},
        data: {base: dataBase, buf: [], name: 'data'}
    };
    const sectionOf = name => (name === '.text' ? sec.text
        : (name === '.data' || name === '.rodata' || name === '.bss' || name === '.sdata') ? sec.data : null);

    const symbols = new Map();
    const globals = new Set();

    // ---- Pass 1: place labels and size everything. -------------------------
    let cur = sec.text;
    const placed = [];     // {kind, line, ...} instructions/data to encode in pass 2
    const here = () => cur.base + cur.buf.length;

    const emitBytes = (arr) => { for (const b of arr) cur.buf.push(b & 0xff); };
    const align = (n) => { while ((cur.base + cur.buf.length) % n !== 0) cur.buf.push(0); };

    for (const {text, line} of lines) {
        let lx;
        try { lx = lex(text, line); } catch (e) { throw e instanceof RiscvAsmError ? e : new RiscvAsmError(String(e.message), {line, text}); }
        for (const lbl of lx.labels) {
            if (symbols.has(lbl)) throw new RiscvAsmError(`label "${lbl}" defined twice`, {line, text});
            symbols.set(lbl, here());
        }
        if (!lx.op) continue;

        if (lx.op[0] === '.') {
            handleDirective(lx, {line, text});
            continue;
        }
        // An instruction: reserve its size now (all are 4 bytes; pseudo-ops that
        // expand to two words reserve 8). Encode in pass 2.
        const words = instrWordCount(lx.op);
        placed.push({kind: 'instr', addr: here(), lx, line, text, words});
        for (let i = 0; i < words * 4; i++) cur.buf.push(0);
    }

    function handleDirective(lx, ctx) {
        const {op, args} = lx;
        switch (op) {
            case '.text': cur = sec.text; return;
            case '.data': case '.rodata': case '.sdata': case '.bss': cur = sec.data; return;
            case '.section': { const s = sectionOf(args[0]); if (s) cur = s; return; }
            case '.globl': case '.global': for (const a of args) globals.add(a); return;
            case '.align': case '.p2align': { const n = parseNumber(args[0], ctx.line) || 0; align(1 << n); return; }
            case '.balign': { const n = parseNumber(args[0], ctx.line) || 1; align(n); return; }
            case '.equ': case '.set': { symbols.set(args[0], resolveConst(args[1], ctx.line)); return; }
            case '.zero': case '.space': { const n = resolveConst(args[0], ctx.line); for (let i = 0; i < n; i++) cur.buf.push(0); return; }
            case '.byte': for (const a of args) placeData(a, 1, ctx); return;
            case '.half': case '.2byte': case '.short': for (const a of args) placeData(a, 2, ctx); return;
            case '.word': case '.4byte': case '.long': for (const a of args) placeData(a, 4, ctx); return;
            case '.ascii': emitString(args, ctx, false); return;
            case '.string': case '.asciz': case '.asciiz': emitString(args, ctx, true); return;
            case '.option': case '.file': case '.ident': case '.size': case '.type':
            case '.attribute': case '.cfi_startproc': case '.cfi_endproc': return;   // ignored, harmless
            default: throw new RiscvAsmError(`unknown directive ${op}`, ctx);
        }
    }

    // Data placements may reference labels, so record them for pass 2 and reserve now.
    function placeData(expr, size, ctx) {
        const n = parseNumber(expr, ctx.line);
        const addr = here();
        for (let i = 0; i < size; i++) cur.buf.push(0);
        placed.push({kind: 'data', addr, expr, size, line: ctx.line, text: ctx.text, sec: cur, resolved: n});
    }
    function emitString(args, ctx, nul) {
        for (const a of args) {
            const raw = stripQuotes(a, ctx);
            for (const b of decodeStringBytes(raw)) cur.buf.push(b & 0xff);
            if (nul) cur.buf.push(0);
        }
    }

    // A constant expression that MUST be known in pass 1 (.equ, .space): allow a
    // number or an already-defined symbol.
    function resolveConst(expr, line) {
        const n = parseNumber(expr, line);
        if (n !== null) return n;
        if (symbols.has(expr)) return symbols.get(expr);
        throw new RiscvAsmError(`expected a constant, got "${expr}"`, {line});
    }

    // ---- Pass 2: encode. ---------------------------------------------------
    const symOf = (name, line) => {
        if (symbols.has(name)) return symbols.get(name);
        const n = parseNumber(name, line);
        if (n !== null) return n;
        throw new RiscvAsmError(`undefined symbol "${name}"`, {line});
    };

    const writeWord = (secObj, addr, word) => {
        const off = addr - secObj.base;
        secObj.buf[off] = word & 0xff;
        secObj.buf[off + 1] = (word >>> 8) & 0xff;
        secObj.buf[off + 2] = (word >>> 16) & 0xff;
        secObj.buf[off + 3] = (word >>> 24) & 0xff;
    };

    for (const item of placed) {
        if (item.kind === 'data') {
            const v = item.resolved !== null ? item.resolved : symOf(item.expr, item.line);
            const off = item.addr - item.sec.base;
            for (let i = 0; i < item.size; i++) item.sec.buf[off + i] = (v >> (8 * i)) & 0xff;
            continue;
        }
        // instruction
        const words = encodeInstr(item.lx, item.addr, item.line, item.text, symOf);
        const secObj = item.addr >= sec.data.base ? sec.data : sec.text;
        words.forEach((w, i) => writeWord(secObj, item.addr + i * 4, w));
    }

    // ---- Build the image. --------------------------------------------------
    const segments = [];
    if (sec.text.buf.length) segments.push({addr: sec.text.base, bytes: Uint8Array.from(sec.text.buf)});
    if (sec.data.buf.length) segments.push({addr: sec.data.base, bytes: Uint8Array.from(sec.data.buf)});

    const entryName = opts.entry || (symbols.has('_start') ? '_start' : (symbols.has('main') ? 'main' : null));
    const entry = entryName ? symOf(entryName, 0) : sec.text.base;

    return {ok: true, image: {entry, segments}, entry, symbols,
        bytes: segments.reduce((n, s) => n + s.bytes.length, 0)};
}

// A couple of pseudo-instructions expand to two 32-bit words; the rest are one.
function instrWordCount(op) {
    return (op === 'li' || op === 'la' || op === 'call' || op === 'tail') ? 2 : 1;
}

function stripQuotes(a, ctx) {
    const s = a.trim();
    if (s[0] !== '"' || s[s.length - 1] !== '"') throw new RiscvAsmError(`expected a "quoted" string, got ${a}`, ctx);
    return s.slice(1, -1);
}
function decodeStringBytes(raw) {
    const out = [];
    for (let i = 0; i < raw.length; i++) {
        if (raw[i] === '\\') {
            const c = raw[++i];
            const map = {n: 10, t: 9, r: 13, '0': 0, '\\': 92, '"': 34, "'": 39};
            out.push(map[c] ?? c.charCodeAt(0));
        } else {
            const cp = raw.codePointAt(i);
            if (cp < 0x80) out.push(cp);
            else for (const b of new TextEncoder().encode(raw[i])) out.push(b);
        }
    }
    return out;
}

// Parse `%hi(sym)`, `%lo(sym)`, `%pcrel_hi(sym)`, `%pcrel_lo(sym)` or a bare
// immediate/symbol into {reloc, name} or {value}.
function relocOperand(tok, line) {
    const m = /^%(hi|lo|pcrel_hi|pcrel_lo)\(\s*(.+?)\s*\)$/i.exec(tok.trim());
    if (m) return {reloc: m[1].toLowerCase(), name: m[2]};
    return {reloc: null, name: tok.trim()};
}

function encodeInstr(lx, addr, line, text, symOf) {
    const op = lx.op, a = lx.args;
    const rr = (i) => reg(a[i], line);
    const imm = (i) => {
        const n = parseNumber(a[i], line);
        if (n === null) throw new RiscvAsmError(`expected an immediate, got "${a[i]}"`, {line});
        return n;
    };
    const need = (n) => { if (a.length !== n) throw new RiscvAsmError(`${op} takes ${n} operands, got ${a.length}`, {line}); };

    // ---- pseudo-instructions -> real ones ----
    switch (op) {
        case 'nop': return [iType(0, 0x13, 0, 0, 0)];                          // addi x0,x0,0
        case 'mv': need(2); return [iType(0, 0x13, rr(0), rr(1), 0)];          // addi rd,rs,0
        case 'not': need(2); return [iType(4, 0x13, rr(0), rr(1), -1)];        // xori rd,rs,-1
        case 'neg': need(2); return [rType(0x20, 0, 0x33, rr(0), 0, rr(1))];   // sub rd,x0,rs
        case 'seqz': need(2); return [iType(3, 0x13, rr(0), rr(1), 1)];        // sltiu rd,rs,1
        case 'snez': need(2); return [rType(0x00, 3, 0x33, rr(0), 0, rr(1))];  // sltu rd,x0,rs
        case 'sltz': need(2); return [rType(0x00, 2, 0x33, rr(0), rr(1), 0)];  // slt rd,rs,x0
        case 'sgtz': need(2); return [rType(0x00, 2, 0x33, rr(0), 0, rr(1))];  // slt rd,x0,rs
        case 'j': need(1); return [encodeJal(0, a[0], addr, line, symOf)];     // jal x0,label
        case 'jal': if (a.length === 1) return [encodeJal(1, a[0], addr, line, symOf)]; break; // jal ra,label
        case 'jr': need(1); return [iType(0, 0x67, 0, rr(0), 0)];              // jalr x0,rs,0
        case 'ret': need(0); return [iType(0, 0x67, 0, 1, 0)];                 // jalr x0,ra,0
        case 'li': need(2); return encodeLi(rr(0), imm(1), line);
        case 'la': need(2); return encodeLa(rr(0), a[1], addr, line, symOf);
        case 'call': need(1); return encodeCall(1, a[0], addr, line, symOf);  // auipc ra + jalr ra
        case 'tail': need(1); return encodeCall(6, a[0], addr, line, symOf);  // auipc t1 + jalr x0,t1
        case 'beqz': need(2); return [encodeBranch(0, rr(0), 0, a[1], addr, line, symOf)];
        case 'bnez': need(2); return [encodeBranch(1, rr(0), 0, a[1], addr, line, symOf)];
        case 'blez': need(2); return [encodeBranch(5, 0, rr(0), a[1], addr, line, symOf)];  // bge x0,rs
        case 'bgez': need(2); return [encodeBranch(5, rr(0), 0, a[1], addr, line, symOf)];
        case 'bltz': need(2); return [encodeBranch(4, rr(0), 0, a[1], addr, line, symOf)];
        case 'bgtz': need(2); return [encodeBranch(4, 0, rr(0), a[1], addr, line, symOf)];  // blt x0,rs
        case 'bgt': need(3); return [encodeBranch(4, rr(1), rr(0), a[2], addr, line, symOf)];// blt rt,rs
        case 'ble': need(3); return [encodeBranch(5, rr(1), rr(0), a[2], addr, line, symOf)];// bge rt,rs
        case 'bgtu': need(3); return [encodeBranch(6, rr(1), rr(0), a[2], addr, line, symOf)];
        case 'bleu': need(3); return [encodeBranch(7, rr(1), rr(0), a[2], addr, line, symOf)];
        default: break;
    }

    // ---- real instructions ----
    if (R[op]) { need(3); const [f7, f3] = R[op]; return [rType(f7, f3, 0x33, rr(0), rr(1), rr(2))]; }
    if (I_ALU[op] !== undefined) { need(3); const v = imm(2); checkRange(v, 12, line, 'immediate'); return [iType(I_ALU[op], 0x13, rr(0), rr(1), v)]; }
    if (SHIFT_I[op]) { need(3); const [top, f3] = SHIFT_I[op]; const sh = imm(2); if (sh < 0 || sh > 31) throw new RiscvAsmError(`shift amount ${sh} out of range 0..31`, {line}); return [iType(f3, 0x13, rr(0), rr(1), (top << 5) | sh)]; }
    if (LOAD[op] !== undefined) { need(2); const {base, off} = memOperand(a[1], line); return [iType(LOAD[op], 0x03, rr(0), base, off)]; }
    if (STORE[op] !== undefined) { need(2); const {base, off} = memOperand(a[1], line); return [sType(STORE[op], 0x23, base, rr(0), off)]; }
    if (BRANCH[op] !== undefined) { need(3); return [encodeBranch(BRANCH[op], rr(0), rr(1), a[2], addr, line, symOf)]; }
    if (CSR_OP[op]) { need(3); const [f3, isImm] = CSR_OP[op]; const csr = csrNum(a[1], line); const src = isImm ? (imm(2) & 0x1f) : rr(2); return [iType(f3, 0x73, rr(0), src, csr)]; }

    switch (op) {
        case 'lui': need(2); { const v = immOrReloc(a[1], line, symOf, 'hi'); return [uType(0x37, rr(0), v << 12)]; }
        case 'auipc': need(2); { const v = immOrReloc(a[1], line, symOf, 'hi'); return [uType(0x17, rr(0), v << 12)]; }
        case 'jalr':
            if (a.length === 1) return [iType(0, 0x67, 1, rr(0), 0)];           // jalr rs -> jalr ra,rs,0
            if (a.length === 2) { const {base, off} = memOperand(a[1], line); return [iType(0, 0x67, rr(0), base, off)]; }
            need(3); return [iType(0, 0x67, rr(0), rr(1), imm(2))];
        case 'jal': need(2); return [encodeJalReg(rr(0), a[1], addr, line, symOf)];
        case 'ecall': need(0); return [0x00000073];
        case 'ebreak': need(0); return [0x00100073];
        case 'fence': return [0x0ff0000f];
        case 'fence.i': return [0x0000100f];
        case 'mret': need(0); return [0x30200073];
        case 'sret': need(0); return [0x10200073];
        case 'wfi': need(0); return [0x10500073];
        case 'csrr': need(2); return [iType(2, 0x73, rr(0), 0, csrNum(a[1], line))];       // csrrs rd,csr,x0
        case 'csrw': need(2); return [iType(1, 0x73, 0, rr(1), csrNum(a[0], line))];       // csrrw x0,csr,rs
        case 'csrs': need(2); return [iType(2, 0x73, 0, rr(1), csrNum(a[0], line))];       // csrrs x0,csr,rs
        case 'csrc': need(2); return [iType(3, 0x73, 0, rr(1), csrNum(a[0], line))];       // csrrc x0,csr,rs
        default: throw new RiscvAsmError(`unknown instruction "${op}"`, {line});
    }
}

function csrNum(tok, line) {
    const name = String(tok).toLowerCase();
    if (CSR.has(name)) return CSR.get(name);
    const n = parseNumber(tok, line);
    if (n !== null && n >= 0 && n < 0x1000) return n;
    throw new RiscvAsmError(`unknown CSR "${tok}"`, {line});
}

// `off(reg)` or `(reg)` or a bare reg with a preceding immediate operand.
function memOperand(tok, line) {
    const m = /^\s*(.*?)\s*\(\s*([A-Za-z0-9]+)\s*\)\s*$/.exec(tok);
    if (m) {
        const off = m[1] === '' ? 0 : (parseNumber(m[1], line) ?? (() => { throw new RiscvAsmError(`bad offset "${m[1]}"`, {line}); })());
        checkRange(off, 12, line, 'offset');
        return {base: reg(m[2], line), off};
    }
    throw new RiscvAsmError(`expected off(reg), got "${tok}"`, {line});
}

function immOrReloc(tok, line, symOf, kind) {
    const r = relocOperand(tok, line);
    if (!r.reloc) { const n = parseNumber(tok, line); if (n !== null) return n; throw new RiscvAsmError(`expected an immediate, got "${tok}"`, {line}); }
    const v = symOf(r.name, line) >>> 0;
    if (r.reloc === 'hi') return (v + 0x800) >>> 12;      // %hi rounds for the signed %lo
    if (r.reloc === 'lo') return (v << 20) >> 20;          // sign-extended low 12
    throw new RiscvAsmError(`%${r.reloc} is only supported via li/la here`, {line});
}

// li reserves TWO words in pass 1, so it always emits two: a small value is
// `addi rd,x0,v` + `nop`, a large one is `lui rd,%hi` + `addi rd,rd,%lo`. Keeping
// the width fixed means no address downstream shifts between the two passes.
const NOPWORD = iType(0, 0x13, 0, 0, 0);
function encodeLi(rd, value, line) {
    const v = value | 0;
    if (v >= -2048 && v <= 2047) return [iType(0, 0x13, rd, 0, v), NOPWORD];   // addi rd,x0,v ; nop
    const hi = (v + 0x800) >>> 12;
    const lo = (v << 20) >> 20;
    return [uType(0x37, rd, hi << 12), iType(0, 0x13, rd, rd, lo)];            // lui rd,hi ; addi rd,rd,lo
}

// la rd, symbol -> auipc rd,%pcrel_hi + addi rd,rd,%pcrel_lo (position-independent).
function encodeLa(rd, symTok, addr, line, symOf) {
    const target = symOf(relocOperand(symTok, line).name, line) >>> 0;
    const rel = (target - addr) | 0;
    const hi = (rel + 0x800) >>> 12;
    const lo = (rel << 20) >> 20;
    return [uType(0x17, rd, hi << 12), iType(0, 0x13, rd, rd, lo)];
}

function encodeCall(linkReg, symTok, addr, line, symOf) {
    const target = symOf(relocOperand(symTok, line).name, line) >>> 0;
    const rel = (target - addr) | 0;
    const hi = (rel + 0x800) >>> 12;
    const lo = (rel << 20) >> 20;
    const rd = linkReg === 6 ? 6 : 1;   // tail uses t1; the jalr links x0
    const link = linkReg === 6 ? 0 : 1;
    return [uType(0x17, rd, hi << 12), iType(0, 0x67, link, rd, lo)];
}

function encodeBranch(f3, rs1, rs2, target, addr, line, symOf) {
    const dst = symOf(relocOperand(target, line).name, line);
    const off = (dst - addr) | 0;
    if (off & 1) throw new RiscvAsmError(`branch target ${target} is not 2-byte aligned`, {line});
    if (off < -4096 || off > 4094) throw new RiscvAsmError(`branch to ${target} is out of ±4 KiB range`, {line});
    return bType(f3, 0x63, rs1, rs2, off);
}
function encodeJal(rd, target, addr, line, symOf) {
    const dst = symOf(relocOperand(target, line).name, line);
    const off = (dst - addr) | 0;
    if (off & 1) throw new RiscvAsmError(`jump target ${target} is not 2-byte aligned`, {line});
    if (off < -(1 << 20) || off > (1 << 20) - 1) throw new RiscvAsmError(`jump to ${target} is out of ±1 MiB range`, {line});
    return jType(0x6f, rd, off);
}
function encodeJalReg(rd, target, addr, line, symOf) { return encodeJal(rd, target, addr, line, symOf); }
