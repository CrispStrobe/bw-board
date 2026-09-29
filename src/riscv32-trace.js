/**
 * The RETIRED-INSTRUCTION TRACE of the RV32 core (E8.1) — the one interface
 * the timing models (uarch-pipeline.js, uarch-cache.js, uarch-predictor.js)
 * consume. Semantics stay in the functional core, which Spike checks; timing
 * is a separate, optional consumer that reads this record stream and can
 * never change a result.
 *
 * HOW IT ATTACHES. `attachRetireTrace(cpu, sink)` gives that one core
 * instance its own `step` that wraps the class's: it peeks the instruction
 * and the data address the step is about to use (RiscV32.peekTranslate /
 * peekRam: no TLB fill, no A/D update, no device read, no trap), runs the
 * real step, and hands `sink` one record for what happened. Detached (or
 * never attached), the instance has no step of its own and runs exactly the
 * class's code — the hook costs nothing when off, by construction, and the
 * riscv-bench A/B measures that on CI.
 *
 * ONE RECORD PER STEP that did something architectural:
 *   seq        running number (0, 1, …) since attach
 *   pc         virtual pc of the instruction (or of the interrupted one)
 *   ppc        its physical address (-1 if it could not be peeked)
 *   inst, len  the raw bits as fetched (16-bit for a compressed one), 2 or 4
 *              (0 when the fetch itself faulted)
 *   op         the expanded 32-bit instruction (-1 if unknown)
 *   cls        alu | mul | div | load | store | amo | branch | jal | jalr |
 *              csr | fence | system | trap
 *   rd, rs1, rs2  architectural registers written / read; 0 means "none"
 *              (x0 carries no dependence, so the models need no other flag)
 *   memKind    '' | 'load' | 'store' | 'amo' (a failed SC is '': no write)
 *   memVa, memPa, memSize   the data access (-1 when none / unpeekable)
 *   taken, target   for branch/jal/jalr: whether control transferred, and
 *              where a taken one goes (a not-taken branch's target is still
 *              its encoded target)
 *   nextPc     the pc after the step (the correct path)
 *   priv       privilege the instruction ran at (0 U, 1 S, 3 M)
 *   trap       null, or {cause, interrupt, tval} when the step took a trap
 *              instead of retiring (then cls is 'trap' and nothing retired)
 *
 * A step that retires nothing and takes no trap (the core halted: an exit
 * ecall, a bare ebreak) produces no record.
 *
 * @module
 */

const OP = {LUI: 0x37, AUIPC: 0x17, JAL: 0x6f, JALR: 0x67, BRANCH: 0x63, LOAD: 0x03, STORE: 0x23,
    OPIMM: 0x13, OP: 0x33, MISCMEM: 0x0f, SYSTEM: 0x73, AMO: 0x2f};
const sext = (v, bits) => (v << (32 - bits)) >> (32 - bits);
const TRACED = Symbol('riscv32-retire-trace');

/**
 * Static decode of an expanded 32-bit instruction into what a timing model
 * needs: class, registers written/read (0 = none), memory kind and size, and
 * for control transfers the encoded offset. Pure; no core state.
 * @param {number} op
 */
export function classifyRv32(op) {
    const o = op & 0x7f, rd = (op >>> 7) & 0x1f, f3 = (op >>> 12) & 7;
    const rs1 = (op >>> 15) & 0x1f, rs2 = (op >>> 20) & 0x1f, f7 = op >>> 25;
    switch (o) {
        case OP.LUI: case OP.AUIPC: return {cls: 'alu', rd, rs1: 0, rs2: 0, memKind: '', memSize: 0};
        case OP.JAL: return {cls: 'jal', rd, rs1: 0, rs2: 0, memKind: '', memSize: 0};
        case OP.JALR: return {cls: 'jalr', rd, rs1, rs2: 0, memKind: '', memSize: 0};
        case OP.BRANCH: return {cls: 'branch', rd: 0, rs1, rs2, memKind: '', memSize: 0};
        case OP.LOAD: return {cls: 'load', rd, rs1, rs2: 0, memKind: 'load', memSize: 1 << (f3 & 3)};
        case OP.STORE: return {cls: 'store', rd: 0, rs1, rs2, memKind: 'store', memSize: 1 << (f3 & 3)};
        case OP.OPIMM: return {cls: 'alu', rd, rs1, rs2: 0, memKind: '', memSize: 0};
        case OP.OP: return {cls: f7 === 1 ? (f3 < 4 ? 'mul' : 'div') : 'alu', rd, rs1, rs2, memKind: '', memSize: 0};
        case OP.AMO: {
            const f5 = op >>> 27;
            if (f5 === 0x02) return {cls: 'amo', rd, rs1, rs2: 0, memKind: 'load', memSize: 4};   // LR.W
            if (f5 === 0x03) return {cls: 'amo', rd, rs1, rs2, memKind: 'store', memSize: 4};     // SC.W
            return {cls: 'amo', rd, rs1, rs2, memKind: 'amo', memSize: 4};
        }
        case OP.MISCMEM: return {cls: 'fence', rd: 0, rs1: 0, rs2: 0, memKind: '', memSize: 0};
        case OP.SYSTEM:
            if (f3 === 0) return {cls: 'system', rd: 0, rs1: 0, rs2: 0, memKind: '', memSize: 0};
            return {cls: 'csr', rd, rs1: (f3 & 4) ? 0 : rs1, rs2: 0, memKind: '', memSize: 0};
        default: return {cls: 'system', rd: 0, rs1: 0, rs2: 0, memKind: '', memSize: 0};
    }
}

/** The encoded pc-relative offset of a branch or jal (0 for anything else). */
export function controlOffset(op) {
    const o = op & 0x7f;
    if (o === OP.BRANCH) {
        return sext(((op >>> 31) & 1) << 12 | ((op >>> 7) & 1) << 11 | ((op >>> 25) & 0x3f) << 5 | ((op >>> 8) & 0xf) << 1, 13);
    }
    if (o === OP.JAL) {
        return sext(((op >>> 31) & 1) << 20 | ((op >>> 12) & 0xff) << 12 | ((op >>> 20) & 1) << 11 | ((op >>> 21) & 0x3ff) << 1, 21);
    }
    return 0;
}

const ABI = ['zero', 'ra', 'sp', 'gp', 'tp', 't0', 't1', 't2', 's0', 's1', 'a0', 'a1', 'a2', 'a3', 'a4', 'a5',
    'a6', 'a7', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 's10', 's11', 't3', 't4', 't5', 't6'];

/**
 * A one-line disassembly of an expanded instruction, in the assembler's own
 * syntax (ABI register names), for the pipeline diagram's row labels.
 * `pc` resolves branch/jal targets to absolute addresses.
 */
export function disasmRv32(op, pc = 0) {
    if (op < 0) return '?';
    const o = op & 0x7f, rd = ABI[(op >>> 7) & 0x1f], f3 = (op >>> 12) & 7;
    const rs1 = ABI[(op >>> 15) & 0x1f], rs2 = ABI[(op >>> 20) & 0x1f], f7 = op >>> 25;
    const immI = sext(op >>> 20, 12), hex = v => '0x' + (v >>> 0).toString(16);
    switch (o) {
        case OP.LUI: return `lui ${rd}, ${hex(op >>> 12)}`;
        case OP.AUIPC: return `auipc ${rd}, ${hex(op >>> 12)}`;
        case OP.JAL: return `jal ${rd}, ${hex(pc + controlOffset(op))}`;
        case OP.JALR: return `jalr ${rd}, ${immI}(${rs1})`;
        case OP.BRANCH: return `${['beq', 'bne', '?', '?', 'blt', 'bge', 'bltu', 'bgeu'][f3]} ${rs1}, ${rs2}, ${hex(pc + controlOffset(op))}`;
        case OP.LOAD: return `${['lb', 'lh', 'lw', '?', 'lbu', 'lhu', '?', '?'][f3]} ${rd}, ${immI}(${rs1})`;
        case OP.STORE: return `${['sb', 'sh', 'sw', '?', '?', '?', '?', '?'][f3]} ${rs2}, ${sext(((op >>> 25) << 5) | ((op >>> 7) & 0x1f), 12)}(${rs1})`;
        case OP.OPIMM: {
            if (f3 === 1) return `slli ${rd}, ${rs1}, ${(op >>> 20) & 0x1f}`;
            if (f3 === 5) return `${f7 & 0x20 ? 'srai' : 'srli'} ${rd}, ${rs1}, ${(op >>> 20) & 0x1f}`;
            return `${['addi', '?', 'slti', 'sltiu', 'xori', '?', 'ori', 'andi'][f3]} ${rd}, ${rs1}, ${immI}`;
        }
        case OP.OP: {
            const m = f7 === 1 ? ['mul', 'mulh', 'mulhsu', 'mulhu', 'div', 'divu', 'rem', 'remu']
                : f7 === 0x20 ? ['sub', '?', '?', '?', '?', 'sra', '?', '?']
                    : ['add', 'sll', 'slt', 'sltu', 'xor', 'srl', 'or', 'and'];
            return `${m[f3]} ${rd}, ${rs1}, ${rs2}`;
        }
        case OP.AMO: {
            const f5 = op >>> 27;
            if (f5 === 0x02) return `lr.w ${rd}, (${rs1})`;
            if (f5 === 0x03) return `sc.w ${rd}, ${rs2}, (${rs1})`;
            const n = {0x01: 'swap', 0x00: 'add', 0x04: 'xor', 0x0c: 'and', 0x08: 'or', 0x10: 'min', 0x14: 'max',
                0x18: 'minu', 0x1c: 'maxu'}[f5] ?? '?';
            return `amo${n}.w ${rd}, ${rs2}, (${rs1})`;
        }
        case OP.MISCMEM: return f3 === 1 ? 'fence.i' : 'fence';
        case OP.SYSTEM: {
            if (f3 === 0) {
                const imm = op >>> 20;
                if (f7 === 0x09) return 'sfence.vma';
                return {0: 'ecall', 1: 'ebreak', 0x302: 'mret', 0x102: 'sret', 0x105: 'wfi'}[imm] ?? 'system';
            }
            const n = ['', 'csrrw', 'csrrs', 'csrrc', '', 'csrrwi', 'csrrsi', 'csrrci'][f3];
            const csr = hex(op >>> 20);
            return (f3 & 4) ? `${n} ${rd}, ${csr}, ${(op >>> 15) & 0x1f}` : `${n} ${rd}, ${csr}, ${rs1}`;
        }
        default: return `.word ${hex(op)}`;
    }
}

/**
 * Attach a retire trace to one RiscV32 instance. `sink(record)` is called for
 * every record (fields above); each record is a fresh object the sink may
 * keep. Returns {detach(), count} — `count` is the number of records so far.
 * Attaching twice to one core is refused (detach first).
 * @param {import('./riscv32.js').RiscV32} cpu
 * @param {(rec: object) => void} sink
 */
export function attachRetireTrace(cpu, sink) {
    if (cpu[TRACED]) throw new Error('a retire trace is already attached to this core (detach it first)');
    const classStep = Object.getPrototypeOf(cpu).step;
    let seq = 0;
    const handle = {
        get count() { return seq; },
        detach() {
            if (cpu[TRACED] !== handle) return;
            cpu.step = classStep;            // assign, not delete: keeps the instance's shape stable
            cpu[TRACED] = null;
        }
    };
    cpu[TRACED] = handle;
    cpu.step = function tracedStep() {
        if (this.halted) return 0;
        const pc = this.pc >>> 0, priv = this.priv, traps0 = this._traps;
        // Peek the instruction the step will fetch (the same bytes: nothing
        // between here and its fetch can write memory).
        let ppc = this.peekTranslate(pc, 0), inst = -1, len = 0, op = -1;
        if (ppc !== null) {
            const lo = this.peekRam(ppc, 2);
            if (lo !== null) {
                if ((lo & 3) !== 3) {
                    const x = this._decompress(lo);
                    inst = lo; len = 2; op = x === null ? -1 : x >>> 0;
                } else {
                    const pa2 = (pc & 0xfff) === 0xffe ? this.peekTranslate((pc + 2) >>> 0, 0) : (ppc + 2) >>> 0;
                    const hi = pa2 === null ? null : this.peekRam(pa2, 2);
                    if (hi !== null) { inst = op = (lo | (hi << 16)) >>> 0; len = 4; }
                }
            }
        } else ppc = -1;
        const d = op >= 0 ? classifyRv32(op) : null;
        let memVa = -1, memPa = -1, scOk = true;
        if (d && d.memKind) {
            memVa = d.cls === 'amo' ? this.x[d.rs1] >>> 0
                : (this.x[d.rs1] + (d.cls === 'store' ? sext(((op >>> 25) << 5) | ((op >>> 7) & 0x1f), 12) : sext(op >>> 20, 12))) >>> 0;
            const pa = this.peekTranslate(memVa, d.memKind === 'load' ? 1 : 2);
            memPa = pa === null ? -1 : pa;
            if (d.cls === 'amo' && d.memKind === 'store') scOk = pa !== null && this.resvAddr === pa;
        }
        const r = classStep.call(this);
        if (this._traps !== traps0) {
            const c = this.csr[this.priv === 3 ? 0x342 : 0x142] >>> 0;
            if ((c >>> 31) === 1) { inst = -1; len = 0; op = -1; }    // an interrupt: nothing at pc executed
            sink({seq: seq++, pc, ppc, inst, len, op, cls: 'trap', rd: 0, rs1: 0, rs2: 0,
                memKind: '', memVa: -1, memPa: -1, memSize: 0, taken: false, target: -1,
                nextPc: this.pc >>> 0, priv,
                trap: {cause: c & 0x7fffffff, interrupt: (c >>> 31) === 1, tval: this.csr[this.priv === 3 ? 0x343 : 0x143] >>> 0}});
            return r;
        }
        if (r === 0 || !d) return r;
        const nextPc = this.pc >>> 0;
        let taken = false, target = -1;
        if (d.cls === 'branch') { taken = nextPc !== ((pc + len) >>> 0); target = (pc + controlOffset(op)) >>> 0; }
        else if (d.cls === 'jal' || d.cls === 'jalr') { taken = true; target = nextPc; }
        const memKind = scOk ? d.memKind : '';
        sink({seq: seq++, pc, ppc, inst, len, op, cls: d.cls, rd: d.rd, rs1: d.rs1, rs2: d.rs2,
            memKind, memVa: memKind ? memVa : -1, memPa: memKind ? memPa : -1, memSize: memKind ? d.memSize : 0,
            taken, target, nextPc, priv, trap: null});
        return r;
    };
    return handle;
}

export default attachRetireTrace;
