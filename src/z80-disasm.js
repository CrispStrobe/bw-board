/**
 * Z80 disassembler — the debugger's live pane for the Z80 machines, same
 * standard as the 6502 one: lengths ground against the SingleStepTests
 * vectors' pc-deltas, formats spot-checked against the published table.
 * Decoding follows the classic octal-field structure (x = op>>6,
 * y = (op>>3)&7, z = op&7), which keeps the four prefix pages compact.
 *
 * @module
 */

const h2 = (v) => v.toString(16).toUpperCase().padStart(2, '0');
const h4 = (v) => v.toString(16).toUpperCase().padStart(4, '0');
const R = ['B', 'C', 'D', 'E', 'H', 'L', '(HL)', 'A'];
const RP = ['BC', 'DE', 'HL', 'SP'];
const RP2 = ['BC', 'DE', 'HL', 'AF'];
const CC = ['NZ', 'Z', 'NC', 'C', 'PO', 'PE', 'P', 'M'];
const ALU = ['ADD A,', 'ADC A,', 'SUB ', 'SBC A,', 'AND ', 'XOR ', 'OR ', 'CP '];
const ROT = ['RLC', 'RRC', 'RL', 'RR', 'SLA', 'SRA', 'SLL', 'SRL'];
const X0Z7 = ['RLCA', 'RRCA', 'RLA', 'RRA', 'DAA', 'CPL', 'SCF', 'CCF'];
const BLOCK = {
    0xa0: 'LDI', 0xa1: 'CPI', 0xa2: 'INI', 0xa3: 'OUTI',
    0xa8: 'LDD', 0xa9: 'CPD', 0xaa: 'IND', 0xab: 'OUTD',
    0xb0: 'LDIR', 0xb1: 'CPIR', 0xb2: 'INIR', 0xb3: 'OTIR',
    0xb8: 'LDDR', 0xb9: 'CPDR', 0xba: 'INDR', 0xbb: 'OTDR',
};

/** Well-known CP/M page-zero entry points — useful labels even for
 *  symbol-less binaries like BBCBASIC.COM. */
export const CPM_LABELS = new Map([[0x0000, 'WBOOT'], [0x0005, 'BDOS'], [0x0100, 'TPA']]);

/**
 * @param {(a:number)=>number} read @param {number} pc
 * @param {{ labels?: Map<number,string> }} [opts] — addresses render as
 *   their label (`CALL BDOS` instead of `CALL $0005`) when one is known.
 * @returns {{ text: string, bytes: number[], length: number }}
 */
export function disasmZ80(read, pc, opts = {}) {
    const bytes = [];
    let i = 0;
    const next = () => { const b = read((pc + i) & 0xffff) & 0xff; bytes.push(b); i++; return b; };
    const n8 = () => `$${h2(next())}`;
    const n16 = () => { const lo = next(); const hi = next(); return `$${h4(lo | (hi << 8))}`; };
    const rel = () => { const d = next(); return `$${h4((pc + i + (d << 24 >> 24)) & 0xffff)}`; };
    const done = (text) => {
        if (opts.labels) {
            text = text.replace(/\$([0-9A-F]{4})/g, (m0, hex) => opts.labels.get(parseInt(hex, 16)) ?? m0);
        }
        return { text, bytes, length: i };
    };

    let ixMode = null;       // 'IX' | 'IY'
    let op = next();
    if (op === 0xdd || op === 0xfd) { ixMode = op === 0xdd ? 'IX' : 'IY'; op = next(); }

    // Substituted register names under DD/FD.
    const disp = () => { const d = next() << 24 >> 24; return `(${ixMode}${d >= 0 ? '+' : '-'}$${h2(Math.abs(d))})`; };
    const rr = (k, memForm) => {
        if (!ixMode) return R[k];
        if (k === 6) return memForm || R[6];
        if (k === 4) return `${ixMode}H`;
        if (k === 5) return `${ixMode}L`;
        return R[k];
    };
    const HLn = () => ixMode || 'HL';

    if (op === 0xcb) {
        // CB page — or DDCB/FDCB with the displacement BEFORE the sub-op.
        const mem = ixMode ? disp() : '(HL)';
        const sub = next();
        const x = sub >> 6; const y = (sub >> 3) & 7; const z = sub & 7;
        const tgt = (z === 6 || ixMode) ? mem : R[z];
        const copy = ixMode && z !== 6 ? `,${R[z]}` : '';
        if (x === 0) return done(`${ROT[y]} ${tgt}${copy}`);
        if (x === 1) return done(`BIT ${y},${tgt}`);
        return done(`${x === 2 ? 'RES' : 'SET'} ${y},${tgt}${copy}`);
    }
    if (op === 0xed) {
        const sub = next();
        if (BLOCK[sub]) return done(BLOCK[sub]);
        const y = (sub >> 3) & 7; const z = sub & 7;
        if (sub >= 0x40 && sub <= 0x7f) {
            switch (z) {
                case 0: return done(y === 6 ? 'IN (C)' : `IN ${R[y]},(C)`);
                case 1: return done(y === 6 ? 'OUT (C),0' : `OUT (C),${R[y]}`);
                case 2: return done(`${(sub & 8) ? 'ADC' : 'SBC'} HL,${RP[y >> 1]}`);
                case 3: { const nn = n16(); return done((sub & 8) ? `LD ${RP[y >> 1]},(${nn})` : `LD (${nn}),${RP[y >> 1]}`); }
                case 4: return done('NEG');
                case 5: return done(sub === 0x4d ? 'RETI' : 'RETN');
                case 6: return done(`IM ${[0, 0, 1, 2][y & 3]}`);
                default:
                    return done({ 0x47: 'LD I,A', 0x4f: 'LD R,A', 0x57: 'LD A,I', 0x5f: 'LD A,R', 0x67: 'RRD', 0x6f: 'RLD' }[sub] || 'NONI');
            }
        }
        return done('NONI');
    }

    const x = op >> 6; const y = (op >> 3) & 7; const z = op & 7;
    if (x === 0) {
        switch (z) {
            case 0:
                if (y === 0) return done('NOP');
                if (y === 1) return done("EX AF,AF'");
                if (y === 2) return done(`DJNZ ${rel()}`);
                if (y === 3) return done(`JR ${rel()}`);
                return done(`JR ${CC[y - 4]},${rel()}`);
            case 1:
                if (op & 8) return done(`ADD ${HLn()},${y >> 1 === 2 ? HLn() : RP[y >> 1]}`);
                return done(`LD ${y >> 1 === 2 ? HLn() : RP[y >> 1]},${n16()}`);
            case 2: {
                const table = {
                    0x02: 'LD (BC),A', 0x0a: 'LD A,(BC)', 0x12: 'LD (DE),A', 0x1a: 'LD A,(DE)',
                };
                if (table[op]) return done(table[op]);
                const nn = n16();
                if (op === 0x22) return done(`LD (${nn}),${HLn()}`);
                if (op === 0x2a) return done(`LD ${HLn()},(${nn})`);
                if (op === 0x32) return done(`LD (${nn}),A`);
                return done(`LD A,(${nn})`);
            }
            case 3: return done(`${(op & 8) ? 'DEC' : 'INC'} ${y >> 1 === 2 ? HLn() : RP[y >> 1]}`);
            case 4: return done(`INC ${y === 6 && ixMode ? disp() : rr(y)}`);
            case 5: return done(`DEC ${y === 6 && ixMode ? disp() : rr(y)}`);
            case 6: {
                if (y === 6 && ixMode) { const m = disp(); return done(`LD ${m},${n8()}`); }
                return done(`LD ${rr(y)},${n8()}`);
            }
            default: return done(X0Z7[y]);
        }
    }
    if (x === 1) {
        if (op === 0x76) return done('HALT');
        if (ixMode && (y === 6 || z === 6)) {
            const m = disp();
            return done(y === 6 ? `LD ${m},${R[z]}` : `LD ${R[y]},${m}`);
        }
        return done(`LD ${rr(y)},${rr(z)}`);
    }
    if (x === 2) {
        if (z === 6 && ixMode) return done(`${ALU[y]}${disp()}`.trim());
        return done(`${ALU[y]}${rr(z)}`.trim());
    }
    switch (z) {
        case 0: return done(`RET ${CC[y]}`);
        case 1:
            if (op & 8) return done(['RET', 'EXX', `JP (${HLn()})`, `LD SP,${HLn()}`][y >> 1]);
            return done(`POP ${y >> 1 === 2 ? HLn() : RP2[y >> 1]}`);
        case 2: return done(`JP ${CC[y]},${n16()}`);
        case 3:
            switch (y) {
                case 0: return done(`JP ${n16()}`);
                case 2: return done(`OUT (${n8()}),A`);
                case 3: return done(`IN A,(${n8()})`);
                case 4: return done(`EX (SP),${HLn()}`);
                case 5: return done('EX DE,HL');
                case 6: return done('DI');
                default: return done('EI');
            }
        case 4: return done(`CALL ${CC[y]},${n16()}`);
        case 5:
            if (op & 8) return done(`CALL ${n16()}`);
            return done(`PUSH ${y >> 1 === 2 ? HLn() : RP2[y >> 1]}`);
        case 6: return done(`${ALU[y]}${n8()}`.trim());
        default: return done(`RST $${h2(y * 8)}`);
    }
}

export default disasmZ80;
