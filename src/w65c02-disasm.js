/**
 * W65C02 disassembler — the debugger's live pane for the 6502 machines,
 * held to the 8051 standard (emu_disasm was verified 237/0 against an
 * independent table). Verification here: instruction LENGTHS are ground
 * against the SingleStepTests vectors' pc-deltas across every opcode
 * (the same 2.54M-vector suite the core passed), mnemonics against the
 * published WDC table. Live disassembly reads MEMORY, so it works on
 * hand-poked code — a listing cannot.
 *
 * @module
 */

// mode → [operand byte count, formatter]
const MODES = {
    imp: [0, () => ''],
    acc: [0, () => 'A'],
    imm: [1, (o) => `#$${h2(o[0])}`],
    zp: [1, (o) => `$${h2(o[0])}`],
    zpx: [1, (o) => `$${h2(o[0])},X`],
    zpy: [1, (o) => `$${h2(o[0])},Y`],
    abs: [2, (o) => `$${h4(o[0] | (o[1] << 8))}`],
    abx: [2, (o) => `$${h4(o[0] | (o[1] << 8))},X`],
    aby: [2, (o) => `$${h4(o[0] | (o[1] << 8))},Y`],
    ind: [2, (o) => `($${h4(o[0] | (o[1] << 8))})`],
    iax: [2, (o) => `($${h4(o[0] | (o[1] << 8))},X)`],
    izx: [1, (o) => `($${h2(o[0])},X)`],
    izy: [1, (o) => `($${h2(o[0])}),Y`],
    zpi: [1, (o) => `($${h2(o[0])})`],
    rel: [1, (o, pc) => `$${h4((pc + 2 + (o[0] << 24 >> 24)) & 0xffff)}`],
    zpr: [2, (o, pc) => `$${h2(o[0])},$${h4((pc + 3 + (o[1] << 24 >> 24)) & 0xffff)}`],
};

const h2 = (v) => v.toString(16).toUpperCase().padStart(2, '0');
const h4 = (v) => v.toString(16).toUpperCase().padStart(4, '0');

/** opcode → [mnemonic, mode]; built from compact group tables below. */
const TABLE = new Array(256);
{
    const set = (op, m, mode) => { TABLE[op] = [m, mode]; };
    const alu = ['ORA', 'AND', 'EOR', 'ADC', 'STA', 'LDA', 'CMP', 'SBC'];
    alu.forEach((m, i) => {
        const b = i << 5;
        set(b | 0x09, m, 'imm'); set(b | 0x05, m, 'zp'); set(b | 0x15, m, 'zpx');
        set(b | 0x0d, m, 'abs'); set(b | 0x1d, m, 'abx'); set(b | 0x19, m, 'aby');
        set(b | 0x01, m, 'izx'); set(b | 0x11, m, 'izy'); set(b | 0x12, m, 'zpi');
    });
    TABLE[0x89] = ['BIT', 'imm']; delete TABLE[0x89];   // placed below with BIT group
    set(0x89, 'BIT', 'imm');
    // STA #imm does not exist: 0x89 is BIT #imm (handled above).
    const rmw = ['ASL', 'ROL', 'LSR', 'ROR'];
    rmw.forEach((m, i) => {
        const b = i << 5;
        set(b | 0x0a, m, 'acc'); set(b | 0x06, m, 'zp'); set(b | 0x16, m, 'zpx');
        set(b | 0x0e, m, 'abs'); set(b | 0x1e, m, 'abx');
    });
    set(0xa2, 'LDX', 'imm'); set(0xa6, 'LDX', 'zp'); set(0xb6, 'LDX', 'zpy');
    set(0xae, 'LDX', 'abs'); set(0xbe, 'LDX', 'aby');
    set(0xa0, 'LDY', 'imm'); set(0xa4, 'LDY', 'zp'); set(0xb4, 'LDY', 'zpx');
    set(0xac, 'LDY', 'abs'); set(0xbc, 'LDY', 'abx');
    set(0x86, 'STX', 'zp'); set(0x96, 'STX', 'zpy'); set(0x8e, 'STX', 'abs');
    set(0x84, 'STY', 'zp'); set(0x94, 'STY', 'zpx'); set(0x8c, 'STY', 'abs');
    set(0x64, 'STZ', 'zp'); set(0x74, 'STZ', 'zpx'); set(0x9c, 'STZ', 'abs'); set(0x9e, 'STZ', 'abx');
    set(0x24, 'BIT', 'zp'); set(0x2c, 'BIT', 'abs'); set(0x34, 'BIT', 'zpx'); set(0x3c, 'BIT', 'abx');
    set(0x04, 'TSB', 'zp'); set(0x0c, 'TSB', 'abs'); set(0x14, 'TRB', 'zp'); set(0x1c, 'TRB', 'abs');
    set(0xe6, 'INC', 'zp'); set(0xf6, 'INC', 'zpx'); set(0xee, 'INC', 'abs'); set(0xfe, 'INC', 'abx');
    set(0xc6, 'DEC', 'zp'); set(0xd6, 'DEC', 'zpx'); set(0xce, 'DEC', 'abs'); set(0xde, 'DEC', 'abx');
    set(0x1a, 'INC', 'acc'); set(0x3a, 'DEC', 'acc');
    set(0xe0, 'CPX', 'imm'); set(0xe4, 'CPX', 'zp'); set(0xec, 'CPX', 'abs');
    set(0xc0, 'CPY', 'imm'); set(0xc4, 'CPY', 'zp'); set(0xcc, 'CPY', 'abs');
    set(0x4c, 'JMP', 'abs'); set(0x6c, 'JMP', 'ind'); set(0x7c, 'JMP', 'iax');
    set(0x20, 'JSR', 'abs'); set(0x60, 'RTS', 'imp'); set(0x40, 'RTI', 'imp');
    set(0x00, 'BRK', 'imm');   // BRK consumes its padding byte
    const br = { 0x10: 'BPL', 0x30: 'BMI', 0x50: 'BVC', 0x70: 'BVS', 0x90: 'BCC', 0xb0: 'BCS', 0xd0: 'BNE', 0xf0: 'BEQ', 0x80: 'BRA' };
    for (const [op, m] of Object.entries(br)) set(Number(op), m, 'rel');
    const imp = { 0x18: 'CLC', 0x38: 'SEC', 0x58: 'CLI', 0x78: 'SEI', 0xb8: 'CLV', 0xd8: 'CLD', 0xf8: 'SED',
        0xaa: 'TAX', 0xa8: 'TAY', 0x8a: 'TXA', 0x98: 'TYA', 0xba: 'TSX', 0x9a: 'TXS',
        0x48: 'PHA', 0x68: 'PLA', 0x08: 'PHP', 0x28: 'PLP', 0xda: 'PHX', 0xfa: 'PLX', 0x5a: 'PHY', 0x7a: 'PLY',
        0xea: 'NOP', 0xcb: 'WAI', 0xdb: 'STP' };
    for (const [op, m] of Object.entries(imp)) set(Number(op), m, 'imp');
    for (let i = 0; i < 8; i++) {
        set(0x07 | (i << 4), `RMB${i}`, 'zp');
        set(0x87 | (i << 4), `SMB${i}`, 'zp');
        set(0x0f | (i << 4), `BBR${i}`, 'zpr');
        set(0x8f | (i << 4), `BBS${i}`, 'zpr');
    }
    // Undefined NOPs, lengths per the vector suite (the core's own map).
    for (let op = 0; op < 256; op++) {
        if (TABLE[op]) continue;
        const col = op & 0x0f;
        if (col === 0x03 || col === 0x0b) set(op, 'NOP', 'imp');
        else if ([0x02, 0x22, 0x42, 0x62, 0x82, 0xc2, 0xe2, 0x44, 0x54, 0xd4, 0xf4].includes(op)) set(op, 'NOP', 'imm');
        else if ([0x5c, 0xdc, 0xfc].includes(op)) set(op, 'NOP', 'abs');
        else set(op, 'NOP', 'imp');
    }
}

/**
 * Disassemble one instruction.
 * @param {(a:number)=>number} read
 * @param {number} pc
 * @param {{ labels?: Map<number,string> }} [opts] — addresses render as
 *   their label (`JSR reset` instead of `JSR $8000`) when one is known.
 * @returns {{ text: string, bytes: number[], length: number }}
 */
export function disasm6502(read, pc, opts = {}) {
    const op = read(pc) & 0xff;
    const [mn, mode] = TABLE[op];
    const [n, fmt] = MODES[mode];
    const operands = [];
    for (let i = 0; i < n; i++) operands.push(read((pc + 1 + i) & 0xffff) & 0xff);
    let arg = fmt(operands, pc);
    if (opts.labels && arg) {
        arg = arg.replace(/\$([0-9A-F]{4})/g, (m0, hex) => opts.labels.get(parseInt(hex, 16)) ?? m0);
    }
    return {
        text: arg ? `${mn} ${arg}` : mn,
        bytes: [op, ...operands],
        length: 1 + n,
    };
}

/**
 * Parse ld65's VICE label file (`ld65 -Ln labels.txt`) into the pieces the
 * debugger wants: a labels map for the disassembler, and — when the @bw
 * naming convention is present (`_bw_task0_state` etc. from generateC via
 * cc65) — the scheduler-symbols object m6502-debug's yield breakpoints,
 * block stepping and position() consume.
 * Line shape: `al 00F00A .some_label`
 * @param {string} text
 * @returns {{ labels: Map<number,string>, scheduler: { tasks: Array<{name: string, state: {addr: number, size: number}}> } }}
 */
export function symbolsFromLd65Labels(text) {
    const labels = new Map();
    const tasks = [];
    for (const line of String(text).split(/\r?\n/)) {
        const m = line.match(/^al\s+([0-9A-Fa-f]+)\s+\.(.+)$/);
        if (!m) continue;
        const addr = parseInt(m[1], 16) & 0xffff;
        const name = m[2].replace(/^_/, '');
        if (!labels.has(addr)) labels.set(addr, name);
        const t = name.match(/^(bw_task\d+)_state$/);
        // The scheduler state vars are `unsigned int` on cc65: 2 bytes.
        if (t) tasks.push({ name: t[1], state: { addr, size: 2 } });
    }
    tasks.sort((a, b) => a.name.localeCompare(b.name));
    return { labels, scheduler: { tasks } };
}

export default disasm6502;
