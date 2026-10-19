/**
 * Explicitly limited, generator-resumable real-mode boot executor. All byte
 * fetches and memory operations use the external phase board. No prefetch,
 * instruction timing, protection, external interrupt handshake or bus-HLT claim.
 */
import {CircuitFault} from './digital-circuit.js';

const REGS = ['ax', 'cx', 'dx', 'bx', 'sp', 'bp', 'si', 'di'];
const BYTES = ['al', 'cl', 'dl', 'bl', 'ah', 'ch', 'dh', 'bh'];
const SEGMENTS = ['es', 'cs', 'ss', 'ds'];
const FLAGS = 0x8d5; // OF SF ZF AF PF CF; other bits preserved
class RealModeFault extends Error {
    constructor(vector) {super(`real-mode fault ${vector}`); this.vector = vector;}
}

// Harris byte-IDIV overflow anomaly, discussed in SingleStepTests/80286#1.
// Only the exceptional path runs this 8-bit restoring divider. Lost high bits
// can yield magnitude 128, which this silicon accepts when the sign is negative.
// This is an operand algorithm, not a list of vector hashes or expected states.
export function harrisByteDivideOverflow(numerator, divisor) {
    if (!divisor || (numerator < 0) === (divisor < 0)) return null;
    let remainder = Math.abs(numerator) >>> 8, quotient = Math.abs(numerator) & 255;
    const denominator = Math.abs(divisor);
    for (let bit = 0; bit < 8; bit++) {
        remainder = ((remainder << 1) | (quotient >>> 7)) & 255;
        quotient = (quotient << 1) & 255;
        if (remainder >= denominator) {remainder -= denominator; quotient |= 1;}
    }
    return quotient === 128 ? {quotient:-128,remainder:numerator < 0 ? -remainder : remainder} : null;
}

function logicalFlags(value, width, flags) {
    let parity = 0;
    for (let i = 0; i < 8; i++) parity ^= (value >> i) & 1;
    // AF is undefined for logical instructions; this model preserves it.
    return (flags & ~0x8c5) | (!parity ? 4 : 0) | (value === 0 ? 0x40 : 0) |
        (value & (width === 1 ? 0x80 : 0x8000) ? 0x80 : 0) | 2;
}

function arithmetic(a, b, flags, width, subtract, carryIn = 0) {
    const mask = width === 1 ? 255 : 65535, sign = width === 1 ? 128 : 32768;
    const raw = subtract ? a - b - carryIn : a + b + carryIn;
    const result = raw & mask;
    const carry = subtract ? raw < 0 : raw > mask;
    const overflow = (subtract ? (a ^ b) : ~(a ^ b)) & (a ^ result) & sign;
    return {result, flags: (logicalFlags(result, width, flags) & ~0x10) |
        Number(carry) | ((a ^ b ^ result) & 0x10) | (overflow ? 0x800 : 0)};
}

export function bootAdd16(a, b, flags) {
    const sum = a + b;
    const result = sum & 0xffff;
    let parity = 0;
    for (let i = 0; i < 8; i++) parity ^= (result >> i) & 1;
    const status = Number(sum > 0xffff) | (!parity ? 4 : 0) |
        (((a ^ b ^ result) & 0x10) ? 0x10 : 0) | (result === 0 ? 0x40 : 0) |
        (result & 0x8000 ? 0x80 : 0) | ((~(a ^ b) & (a ^ result) & 0x8000) ? 0x800 : 0);
    return {result, flags: (flags & ~FLAGS) | status | 2};
}

export function bootSub16(a, b, flags) {
    const result = (a - b) & 0xffff;
    let parity = 0;
    for (let i = 0; i < 8; i++) parity ^= (result >> i) & 1;
    const status = Number(a < b) | (!parity ? 4 : 0) |
        (((a ^ b ^ result) & 0x10) ? 0x10 : 0) | (result === 0 ? 0x40 : 0) |
        (result & 0x8000 ? 0x80 : 0) | (((a ^ b) & (a ^ result) & 0x8000) ? 0x800 : 0);
    return {result, flags: (flags & ~FLAGS) | status | 2};
}

export class HarrisBootCPU {
    constructor({enabled = false, board, historyLimit = 64, coprocessor = 'unsupported'} = {}) {
        if (enabled !== true) throw new CircuitFault('EXPERIMENT_DISABLED', 'enabled:true required');
        if (!board?.submit || !board?.clock || !board?.initialize) throw new TypeError('wired phase board required');
        if (!Number.isSafeInteger(historyLimit) || historyLimit < 1) throw new RangeError('historyLimit');
        if (!['unsupported','inactive-lines'].includes(coprocessor)) throw new RangeError('coprocessor profile');
        this.coprocessor = coprocessor;
        this.board = board; this.historyLimit = historyLimit;
        // GDTR power-on contents are unspecified: zero is model policy.
        this.gdtr = {base:0,limit:0}; this.idtr = {base:0,limit:0x3ff};
        this.nmiBlocked = false; this.ssShadow = 0; this.nmiCount = 0;
        this.stiShadow = 0; this.intrCount = 0; this.lastINTR = null;
        this.status = 'uninitialized'; this.retired = 0; this.history = []; this.dropped = 0;
        this.capabilities = Object.freeze({experimental: true, instructionExecution: true,
            cpuModel: 'harris-286-boot-subset', general80286: false, protectedMode: false,
            nmi: board.capabilities?.nmi === true,
            intr: board.capabilities?.intr === true,
            prefetch: false, instructionTiming: false, busHaltSignalling: false, snapshots: false});
    }

    initialize() {
        if (this.status === 'faulted') throw new CircuitFault('CPU_FAULTED', 'reconstruct CPU/board after a fault');
        try { this._initialize(); } catch (error) {
            this.status = 'faulted';
            this.fault = Object.freeze({code: error.code || 'ERROR', message: error.message});
            throw error;
        }
    }
    _initialize() {
        this.board.initialize();
        // Unspecified general registers use a deterministic model value, NOT
        // a claim about silicon power-on contents. Architecturally defined
        // reset values and hidden code base are separate from those registers.
        this.regs = Object.fromEntries(REGS.map(r => [r, 0]));
        this.cs = 0xf000; this.csBase = 0xff0000; this.ip = 0xfff0;
        this.ds = 0; this.es = 0; this.ss = 0; this.flags = 2; this.msw = 0xfff0;
        this.gdtr = {base:0,limit:0}; this.idtr = {base:0,limit:0x3ff};
        this.nmiBlocked = false; this.ssShadow = 0; this.nmiCount = 0;
        this.stiShadow = 0; this.intrCount = 0; this.lastINTR = null;
        this.retired = 0; this.history = []; this.dropped = 0; this.fault = null;
        this.status = 'running';
        this.iterator = this._instructions();
        this._pump();
    }

    *_byte() {
        if (this.ip > 0xffff || this.instructionBytes >= 10) throw new RealModeFault(13);
        const byte = yield {kind: 'code-read', address: this.csBase + this.ip, width: 1};
        this.ip++; this.instructionBytes++;
        return byte;
    }
    *_word() { const low = yield* this._byte(); return low | ((yield* this._byte()) << 8); }
    *_memory(offset, write = false, value = 0, segment = this.segmentOverride ?? this.ds, width = 2) {
        if (offset < 0 || offset + width > 0x10000) throw new RealModeFault(13);
        return yield {kind: write ? 'memory-write' : 'memory-read', address: segment * 16 + offset, width, value};
    }
    _get(name) {
        const index = BYTES.indexOf(name);
        return index < 0 ? this.regs[name] : (this.regs[REGS[index & 3]] >> (index < 4 ? 0 : 8)) & 255;
    }
    _set(name, value) {
        const index = BYTES.indexOf(name);
        if (index < 0) this.regs[name] = value & 65535;
        else {
            const reg = REGS[index & 3], shift = index < 4 ? 0 : 8;
            this.regs[reg] = (this.regs[reg] & ~(255 << shift)) | ((value & 255) << shift);
        }
    }
    *_operand(width = 2) {
        const modrm = yield* this._byte();
        const mod = modrm >> 6, rm = modrm & 7;
        const names = width === 1 ? BYTES : REGS;
        const reg = names[(modrm >> 3) & 7];
        if (mod === 3) return {reg, operand: {register: names[rm]}};
        if (mod === 0 && rm === 6) return {reg, operand: {offset: yield* this._word(), segment: this.segmentOverride ?? this.ds}};
        const r = this.regs;
        const base = [r.bx + r.si, r.bx + r.di, r.bp + r.si, r.bp + r.di, r.si, r.di, r.bp, r.bx][rm];
        let displacement = 0;
        if (mod === 1) { displacement = yield* this._byte(); if (displacement & 0x80) displacement -= 256; }
        if (mod === 2) displacement = yield* this._word();
        return {reg, operand: {offset: (base + displacement) & 0xffff,
            segment: this.segmentOverride ?? ([2, 3, 6].includes(rm) ? this.ss : this.ds)}};
    }
    *_readOperand(operand, width = 2) {
        if (operand.register) return this._get(operand.register);
        return yield* this._memory(operand.offset, false, 0, operand.segment, width);
    }
    *_writeOperand(operand, value, width = 2) {
        if (operand.register) this._set(operand.register, value);
        else yield* this._memory(operand.offset, true, value, operand.segment, width);
    }
    *_push(value) {
        const sp = (this.regs.sp - 2) & 65535;
        yield* this._memory(sp, true, value, this.ss);
        this.regs.sp = sp; // SP changes only when the external write completes.
    }
    *_pop() {
        const value = yield* this._memory(this.regs.sp, false, 0, this.ss);
        this.regs.sp = (this.regs.sp + 2) & 65535;
        return value;
    }
    *_interrupt(vector, returnIP) {
        const offset = vector * 4;
        if (offset + 3 > this.idtr.limit) throw new RealModeFault(13);
        // Harris trace order: FLAGS, CS, IP writes precede the IVT reads.
        // This matters if a guest places its stack over the IVT.
        this.interruptTaken = vector;
        yield* this._push(this.flags);
        yield* this._push(this.cs);
        yield* this._push(returnIP);
        this.flags &= ~0x300;
        const ip = yield* this._physicalWord(this.idtr.base + offset);
        const segment = yield* this._physicalWord(this.idtr.base + offset + 2);
        this.cs = segment; this.csBase = segment * 16; this.ip = ip;
        this.flowTransfer = true;
    }
    *_physicalWord(address) {
        address &= 0xffffff;
        if (address !== 0xffffff) return yield {kind:'memory-read',address,width:2};
        const low = yield {kind:'memory-read',address,width:1};
        const high = yield {kind:'memory-read',address:0,width:1};
        return low | (high << 8);
    }
    _nmiReady() {return !this.nmiBlocked && !this.ssShadow && this.board.hasPendingNMI?.();}
    _intrReady() {return !!(this.flags & 0x200) && !this.ssShadow && !this.stiShadow && this.board.hasPendingINTR?.();}
    _externalReady() {return this._nmiReady() || this._intrReady();}
    *_acceptINTR() {
        if (!this._intrReady()) return;
        const vector = yield {kind:'interrupt-acknowledge',address:0,width:1};
        try {yield* this._interrupt(vector,this.ip);}
        catch (error) {
            if (!(error instanceof RealModeFault)) throw error;
            throw new CircuitFault('UNSUPPORTED_NESTED_FAULT','INTR delivery failed; double-fault/shutdown not implemented');
        }
        this.intrCount++; this.lastINTR = vector;
    }
    *_acceptNMI() {
        if (!this._nmiReady() || !this.board.takeNMI()) return;
        this.nmiBlocked = true;
        try {yield* this._interrupt(2,this.ip);}
        catch (error) {
            if (!(error instanceof RealModeFault)) throw error;
            throw new CircuitFault('UNSUPPORTED_NESTED_FAULT','NMI delivery failed; double-fault/shutdown not implemented');
        }
        this.nmiCount++;
    }
    *_systemInstruction() {
        const opcode = yield* this._byte();
        // SLDT/STR/LLDT/LTR/VERR/VERW, LAR and LSL are protected-only.
        if ([0x00,0x02,0x03].includes(opcode)) throw new RealModeFault(6);
        if (opcode === 0x06) {this.msw &= ~8; return;}
        if (opcode !== 0x01)
            throw new CircuitFault('UNSUPPORTED_OPCODE',`0F ${opcode.toString(16)} (including undocumented LOADALL)`);
        const {reg,operand} = yield* this._operand();
        const operation = REGS.indexOf(reg);
        if (operation === 4) {yield* this._writeOperand(operand,this.msw); return;}
        if (operation === 6) {
            const value = yield* this._readOperand(operand);
            if (value & 1) throw new CircuitFault('UNSUPPORTED_PROTECTED_MODE','LMSW PE transition requires protected-mode execution');
            this.msw = (this.msw & 0xfff1) | (value & 14); return;
        }
        if (operation > 3 || operand.register) throw new RealModeFault(6);
        const table = operation & 1 ? 'idtr' : 'gdtr';
        const offsets = [0,2,4].map(n=>(operand.offset+n)&65535);
        // Each transfer is a word; do not turn a final-word segment fault
        // into a partially committed descriptor-table register.
        if (offsets.includes(65535)) throw new RealModeFault(13);
        if (operation & 2) {
            const limit = yield* this._memory(offsets[0],false,0,operand.segment);
            const low = yield* this._memory(offsets[1],false,0,operand.segment);
            const high = yield* this._memory(offsets[2],false,0,operand.segment);
            this[table] = {limit,base:low | ((high & 255) << 16)};
        } else {
            const {base,limit} = this[table];
            yield* this._memory(offsets[0],true,limit,operand.segment);
            yield* this._memory(offsets[1],true,base & 65535,operand.segment);
            // Sixth byte is architecturally undefined on 286; FF is model
            // policy, not a silicon-verified observation from SST286.
            yield* this._memory(offsets[2],true,0xff00 | (base >>> 16),operand.segment);
        }
    }
    *_port(port, width, write = false, value = 0) {
        // Word accesses at FFFF wrap within the 16-bit I/O space.
        if (width === 2 && port === 65535) {
            const low = yield* this._port(port,1,write,value & 255);
            const high = yield* this._port(0,1,write,value >>> 8);
            return low | (high << 8);
        }
        return yield {kind:write ? 'io-write' : 'io-read',address:port,width,value};
    }
    *_string(opcode) {
        const width = opcode & 1 ? 2 : 1, r = this.regs;
        const delta = this.flags & 0x400 ? -width : width;
        const source = this.segmentOverride ?? this.ds;
        const repeated = !!this.repeatPrefix;
        let remaining = repeated ? r.cx : 1;
        const cpu = this;
        function* access(index, segment, write = false, value = 0) {
            const offset = r[index];
            let result;
            try {result = yield* cpu._memory(offset,write,value,segment,width);}
            catch (error) {
                if (!(error instanceof RealModeFault)) throw error;
                // Measured Harris fault microcode: a failed repeated string
                // write consumes another count; CMPS's first (ES) read faults
                // before its count decrement. No successful access uses this.
                if (repeated && write) r.cx = (r.cx - 1) & 65535;
                if (repeated && (opcode & 0xfe) === 0xa6 && index === 'di') r.cx = (r.cx + 1) & 65535;
                r[index] = (offset + delta) & 65535; cpu.restartRegisters = {...r}; throw error;
            }
            r[index] = (offset + delta) & 65535; cpu.restartRegisters = {...r};
            return result;
        }
        while (remaining > 0) {
            let left, right;
            // Harris decrements REP and advances the applicable index even
            // when that element raises a segment fault. CMPS reads ES first.
            if (repeated) r.cx = (r.cx - 1) & 65535;
            this.restartRegisters = {...r};
            switch (opcode & 0xfe) {
            case 0x6c:
                if (r.di + width > 65536) yield* access('di',this.es,true,0);
                left = yield* this._port(r.dx,width);
                yield* access('di',this.es,true,left); break;
            case 0x6e:
                left = yield* access('si',source);
                yield* this._port(r.dx,width,true,left); break;
            case 0xa4:
                left = yield* access('si',source);
                yield* access('di',this.es,true,left); break;
            case 0xa6:
                right = yield* access('di',this.es);
                left = yield* access('si',source);
                this.flags = arithmetic(left,right,this.flags,width,true).flags;
                break;
            case 0xaa:
                yield* access('di',this.es,true,this._get(width === 1 ? 'al' : 'ax')); break;
            case 0xac:
                this._set(width === 1 ? 'al' : 'ax',yield* access('si',source)); break;
            case 0xae:
                right = yield* access('di',this.es);
                this.flags = arithmetic(this._get(width === 1 ? 'al' : 'ax'),right,this.flags,width,true).flags;
                break;
            }
            this.restartRegisters = {...r};
            remaining--;
            if (repeated && [0xa6,0xae].includes(opcode & 0xfe) &&
                (!!(this.flags & 64) !== (this.repeatPrefix === 0xf3))) break;
            if (repeated && remaining > 0 && this._externalReady()) {
                // The completed element stays committed. IRET re-fetches the
                // first prefix with the remaining CX and advanced SI/DI.
                this.ip = this.currentStart.ip; this.suspendedRepeat = true; return;
            }
        }
    }
    _alu(kind, a, b, width) {
        if (kind === 0 || kind === 5 || kind === 7) return arithmetic(a, b, this.flags, width, kind !== 0);
        if (kind === 2 || kind === 3) return arithmetic(a, b, this.flags, width, kind === 3, this.flags & 1);
        let result;
        if (kind === 1) result = a | b;
        else if (kind === 4) result = a & b;
        else if (kind === 6) result = a ^ b;
        else throw new CircuitFault('UNSUPPORTED_ALU', `group ${kind}`);
        return {result, flags: logicalFlags(result, width, this.flags)};
    }
    _shift(kind, value, count, width) {
        count &= 31;
        if (!count) return {result:value, flags:this.flags};
        if (kind === 6) kind = 4;
        const mask = width === 1 ? 255 : 65535, sign = width === 1 ? 128 : 32768;
        let result = value, carry = this.flags & 1, before = value;
        for (let i = 0; i < count; i++) {
            before = result;
            const high = Number(!!(result & sign)), low = result & 1;
            switch (kind) {
            case 0: result = ((result << 1) | high) & mask; carry = high; break;
            case 1: result = (result >>> 1) | (low ? sign : 0); carry = low; break;
            case 2: result = ((result << 1) | carry) & mask; carry = high; break;
            case 3: result = (result >>> 1) | (carry ? sign : 0); carry = low; break;
            case 4: result = (result << 1) & mask; carry = high; break;
            case 5: result >>>= 1; carry = low; break;
            case 7: result = (result >>> 1) | (result & sign); carry = low; break;
            default: throw new CircuitFault('UNSUPPORTED_SHIFT', `${kind}`);
            }
        }
        const high = Number(!!(result & sign));
        const overflow = [0,2,4].includes(kind) ? high ^ carry :
            [1,3].includes(kind) ? high ^ Number(!!(result & (sign >> 1))) :
                kind === 5 ? Number(!!(before & sign)) : 0;
        const flags = kind < 4 ? this.flags & ~0x801 : logicalFlags(result,width,this.flags);
        return {result,flags:flags | carry | (overflow << 11)};
    }
    _condition(code) {
        const f = this.flags, cf = !!(f & 1), pf = !!(f & 4), zf = !!(f & 64), sf = !!(f & 128), of = !!(f & 2048);
        return [of, !of, cf, !cf, zf, !zf, cf || zf, !cf && !zf,
            sf, !sf, pf, !pf, sf !== of, sf === of, zf || sf !== of, !zf && sf === of][code];
    }
    _branch(displacement) {
        this.ip = (this.ip + displacement) & 65535;
        this.flowTransfer = true;
    }
    *_instructions() {
        while (this.status === 'running') {
            if (this.msw & 1) throw new CircuitFault('UNSUPPORTED_PROTECTED_MODE','protected-mode state cannot execute as real mode');
            if (this._nmiReady()) yield* this._acceptNMI();
            else if (this._intrReady()) yield* this._acceptINTR();
            this.instructionBoundary = true;
            const start = {cs: this.cs, ip: this.ip, physical: this.csBase + this.ip};
            this.currentStart = start; this.suspendedRepeat = false;
            const saved = {...this.regs};
            this.instructionBytes = 0; this.flowTransfer = false; this.interruptTaken = null;
            this.restartRegisters = null;
            this.segmentOverride = undefined;
            this.repeatPrefix = 0; this.lockPrefix = false;
            this.busLocked = false;
            let opcode;
            try {
            opcode = yield* this._byte();
            while ([0x26, 0x2e, 0x36, 0x3e, 0xf0, 0xf2, 0xf3].includes(opcode)) {
                if (opcode === 0xf0) this.lockPrefix = true;
                else if (opcode >= 0xf2) this.repeatPrefix = opcode;
                else this.segmentOverride = this[SEGMENTS[(opcode >> 3) & 3]];
                opcode = yield* this._byte();
            }
            if (this.lockPrefix && !this.board.semanticTestAdapter)
                throw new CircuitFault('UNSUPPORTED_LOCK_BUS','physical LOCK signalling not implemented');
            if (opcode >= 0xb0 && opcode <= 0xb7) this._set(BYTES[opcode - 0xb0], yield* this._byte());
            else if (opcode >= 0xb8 && opcode <= 0xbf) this.regs[REGS[opcode - 0xb8]] = yield* this._word();
            else if (opcode >= 0x50 && opcode <= 0x57) yield* this._push(this.regs[REGS[opcode & 7]]);
            else if (opcode >= 0x58 && opcode <= 0x5f) this.regs[REGS[opcode & 7]] = yield* this._pop();
            else if (opcode >= 0x70 && opcode <= 0x7f) {
                const displacement = yield* this._byte();
                if (this._condition(opcode & 15)) this._branch(displacement < 128 ? displacement : displacement - 256);
            }
            else if (opcode < 0x40 && (opcode & 7) <= 5) {
                const width = opcode & 1 ? 2 : 1, kind = opcode >> 3;
                let operand, destination, a, b;
                if ((opcode & 7) >= 4) {
                    destination = width === 1 ? 'al' : 'ax'; a = this._get(destination);
                    b = width === 1 ? yield* this._byte() : yield* this._word();
                } else {
                    const decoded = yield* this._operand(width); operand = decoded.operand;
                    const value = yield* this._readOperand(operand, width);
                    if (opcode & 2) { destination = decoded.reg; a = this._get(destination); b = value; }
                    else { a = value; b = this._get(decoded.reg); }
                }
                const result = this._alu(kind, a, b, width);
                if (kind !== 7) {
                    if (destination) this._set(destination, result.result);
                    else yield* this._writeOperand(operand, result.result, width);
                }
                this.flags = result.flags;
            }
            else if (opcode >= 0x40 && opcode <= 0x4f) {
                const register = REGS[opcode & 7];
                const result = (opcode < 0x48 ? bootAdd16 : bootSub16)(this.regs[register], 1, this.flags);
                this.regs[register] = result.result;
                this.flags = (result.flags & ~1) | (this.flags & 1); // INC/DEC preserve CF
            }
            else switch (opcode) {
            case 0x0f: yield* this._systemInstruction(); break;
            case 0x63: throw new RealModeFault(6); // ARPL is protected-only.
            case 0x27: case 0x2f: {
                const old = this._get('al'), cf = this.flags & 1, af = this.flags & 16, sub = opcode === 0x2f;
                let value = old, carry = 0, adjust = 0;
                if ((old & 15) > 9 || af) {value = (old + (sub ? -6 : 6)) & 255; adjust = 16; carry = Number(sub ? old < 6 : old > 249) | cf;}
                if (old > 0x99 || cf) {value = (value + (sub ? -96 : 96)) & 255; carry = 1;}
                this._set('al',value); this.flags = (logicalFlags(value,1,this.flags) & ~16) | adjust | carry; break;
            }
            case 0x37: case 0x3f: {
                const adjust = (this._get('al') & 15) > 9 || !!(this.flags & 16);
                if (adjust) this.regs.ax = (this.regs.ax + (opcode === 0x37 ? 0x106 : -0x106)) & 65535;
                this._set('al',this._get('al') & 15);
                this.flags = (this.flags & ~17) | (adjust ? 17 : 0); break;
            }
            case 0x06: case 0x0e: case 0x16: case 0x1e: yield* this._push(this[SEGMENTS[(opcode >> 3) & 3]]); break;
            case 0x07: case 0x17: case 0x1f:
                this[SEGMENTS[(opcode >> 3) & 3]] = yield* this._pop();
                if (opcode === 0x17) this.ssShadow = 2;
                break;
            case 0x88: case 0x8a: {
                const {reg, operand} = yield* this._operand(1);
                if (opcode === 0x88) yield* this._writeOperand(operand, this._get(reg), 1);
                else this._set(reg, yield* this._readOperand(operand, 1));
                break;
            }
            case 0x8c: case 0x8e: {
                const {reg, operand} = yield* this._operand(); const index = REGS.indexOf(reg);
                if (index > 3 || (opcode === 0x8e && index === 1)) throw new RealModeFault(6);
                if (opcode === 0x8c) yield* this._writeOperand(operand, this[SEGMENTS[index]]);
                else {this[SEGMENTS[index]] = yield* this._readOperand(operand); if (index === 2) this.ssShadow = 2;}
                break;
            }
            case 0xc6: case 0xc7: {
                const width = opcode & 1 ? 2 : 1;
                const {reg, operand} = yield* this._operand(width);
                if (reg !== (width === 1 ? 'al' : 'ax')) throw new RealModeFault(6);
                const value = width === 1 ? yield* this._byte() : yield* this._word();
                yield* this._writeOperand(operand, value, width); break;
            }
            case 0x80: case 0x81: case 0x82: case 0x83: {
                const width = opcode === 0x80 || opcode === 0x82 ? 1 : 2;
                const {reg, operand} = yield* this._operand(width);
                const kind = (width === 1 ? BYTES : REGS).indexOf(reg);
                let immediate = opcode === 0x81 ? yield* this._word() : yield* this._byte();
                if (opcode === 0x83 && immediate & 128) immediate |= 0xff00;
                const result = this._alu(kind, yield* this._readOperand(operand, width), immediate, width);
                if (kind !== 7) yield* this._writeOperand(operand, result.result, width);
                this.flags = result.flags; break;
            }
            case 0x84: case 0x85: {
                const width = opcode & 1 ? 2 : 1; const {reg, operand} = yield* this._operand(width);
                this.flags = logicalFlags((yield* this._readOperand(operand, width)) & this._get(reg), width, this.flags); break;
            }
            case 0xf6: case 0xf7: {
                const width = opcode & 1 ? 2 : 1; const {reg, operand} = yield* this._operand(width);
                const kind = (width === 1 ? BYTES : REGS).indexOf(reg);
                if (kind <= 1) {
                    const immediate = width === 1 ? yield* this._byte() : yield* this._word();
                    this.flags = logicalFlags((yield* this._readOperand(operand, width)) & immediate, width, this.flags);
                } else {
                    const value = yield* this._readOperand(operand,width), mask = width === 1 ? 255 : 65535;
                    if (kind === 2) yield* this._writeOperand(operand,~value & mask,width);
                    else if (kind === 3) {
                        const result = arithmetic(0,value,this.flags,width,true);
                        yield* this._writeOperand(operand,result.result,width); this.flags = result.flags;
                    } else {
                        const size = width === 1 ? 256 : 65536, sign = size / 2;
                        const signed = v => v >= sign ? v - size : v;
                        const accumulator = width === 1 ? this._get('al') : this.regs.ax;
                        if (kind <= 5) {
                            const product = kind === 4 ? accumulator * value : signed(accumulator) * signed(value);
                            const overflow = kind === 4 ? product >= size : product < -sign || product >= sign;
                            this.regs.ax = product & 65535;
                            if (width === 2) this.regs.dx = (product >>> 16) & 65535;
                            this.flags = (this.flags & ~0x801) | (overflow ? 0x801 : 0);
                        } else {
                            let numerator = width === 1 ? this.regs.ax : this.regs.dx * 65536 + this.regs.ax;
                            if (kind === 7 && numerator >= size * size / 2) numerator -= size * size;
                            const divisor = kind === 7 ? signed(value) : value;
                            let quotient = Math.trunc(numerator / divisor), remainder = numerator % divisor;
                            if (!divisor || quotient < (kind === 7 ? -sign : 0) || quotient >= (kind === 7 ? sign : size)) {
                                const anomaly = width === 1 && kind === 7 ? harrisByteDivideOverflow(numerator,divisor) : null;
                                if (!anomaly) throw new RealModeFault(0);
                                ({quotient,remainder} = anomaly);
                            }
                            if (width === 1) this.regs.ax = (quotient & 255) | ((remainder & 255) << 8);
                            else {this.regs.ax = quotient & 65535; this.regs.dx = remainder & 65535;}
                        }
                    }
                }
                break;
            }
            case 0xc0: case 0xc1: case 0xd0: case 0xd1: case 0xd2: case 0xd3: {
                const width = opcode & 1 ? 2 : 1; const {reg, operand} = yield* this._operand(width);
                const kind = (width === 1 ? BYTES : REGS).indexOf(reg);
                const count = (opcode < 0xd0 ? yield* this._byte() : opcode < 0xd2 ? 1 : this._get('cl')) & 31;
                const result = this._shift(kind,yield* this._readOperand(operand,width),count,width);
                if (count) yield* this._writeOperand(operand,result.result,width);
                this.flags = result.flags; break;
            }
            case 0xe8: {
                let displacement = yield* this._word(); if (displacement & 32768) displacement -= 65536;
                const returnIP = this.ip; this._branch(displacement); const target = this.ip; this.ip = returnIP;
                yield* this._push(returnIP); this.ip = target; break;
            }
            case 0xc2: case 0xc3: case 0xca: case 0xcb: {
                const adjustment = opcode === 0xc2 || opcode === 0xca ? yield* this._word() : 0;
                const ip = yield* this._pop();
                if (opcode >= 0xca) {this.cs = yield* this._pop(); this.csBase = this.cs * 16;}
                this.ip = ip; this.flowTransfer = true; this.regs.sp = (this.regs.sp + adjustment) & 65535; break;
            }
            case 0xa0: this._set('al', yield* this._memory(yield* this._word(), false, 0, this.segmentOverride ?? this.ds, 1)); break;
            case 0xa2: yield* this._memory(yield* this._word(), true, this._get('al'), this.segmentOverride ?? this.ds, 1); break;
            case 0xea: {
                const offset = yield* this._word();
                const segment = yield* this._word();
                this.cs = segment; this.csBase = segment * 16; this.ip = offset;
                break;
            }
            case 0xa1: this.regs.ax = yield* this._memory(yield* this._word()); break;
            case 0xa3: yield* this._memory(yield* this._word(), true, this.regs.ax); break;
            case 0x89: case 0x8b: {
                const {reg, operand} = yield* this._operand();
                if (opcode === 0x89) yield* this._writeOperand(operand, this.regs[reg]);
                else this.regs[reg] = yield* this._readOperand(operand);
                break;
            }
            case 0xeb: case 0xe9: case 0xe0: case 0xe1: case 0xe2: case 0xe3: {
                let displacement = opcode === 0xe9 ? yield* this._word() : yield* this._byte();
                const sign = opcode === 0xe9 ? 0x8000 : 0x80;
                if (displacement & sign) displacement -= sign * 2;
                if (opcode >= 0xe0 && opcode <= 0xe2) {
                    const count = (this.regs.cx - 1) & 0xffff;
                    // Validate the taken target before committing CX.
                    if (count && (opcode === 0xe2 || (!!(this.flags & 64) === (opcode === 0xe1)))) this._branch(displacement);
                    this.regs.cx = count;
                } else if (opcode !== 0xe3 || this.regs.cx === 0) this._branch(displacement);
                break;
            }
            case 0x60: {
                const sp = this.regs.sp;
                for (let i = 1; i <= 8; i++) if (((sp - i*2) & 65535) === 65535) throw new RealModeFault(13);
                for (const r of REGS) yield* this._push(r === 'sp' ? sp : this.regs[r]);
                break;
            }
            case 0x61:
                for (const r of [...REGS].reverse()) {const value = yield* this._pop(); if (r !== 'sp') this.regs[r] = value;}
                break;
            case 0x68: yield* this._push(yield* this._word()); break;
            case 0x6a: {const value = yield* this._byte(); yield* this._push(value & 128 ? value | 0xff00 : value); break;}
            case 0x69: case 0x6b: {
                const {reg,operand} = yield* this._operand();
                const immediate = opcode === 0x69 ? (yield* this._word()) << 16 >> 16 : (yield* this._byte()) << 24 >> 24;
                const value = (yield* this._readOperand(operand)) << 16 >> 16, product = value * immediate;
                this.regs[reg] = product & 65535;
                // Harris immediate-IMUL exposes SZP of the high product word.
                // AF remains masked by upstream metadata.
                this.flags = logicalFlags((product >>> 16) & 65535,2,this.flags) | (product < -32768 || product > 32767 ? 0x801 : 0); break;
            }
            case 0x62: {
                const {reg,operand} = yield* this._operand();
                if (operand.register) throw new RealModeFault(6);
                const lo = (yield* this._readOperand(operand)) << 16 >> 16;
                const hi = (yield* this._memory((operand.offset + 2) & 65535,false,0,operand.segment)) << 16 >> 16;
                const value = this.regs[reg] << 16 >> 16;
                if (value < lo || value > hi) throw new RealModeFault(5);
                break;
            }
            case 0x6c: case 0x6d: case 0x6e: case 0x6f:
            case 0xa4: case 0xa5: case 0xa6: case 0xa7: case 0xaa: case 0xab: case 0xac: case 0xad: case 0xae: case 0xaf:
                yield* this._string(opcode); break;
            case 0x86: case 0x87: {
                this.busLocked = true;
                const width = opcode & 1 ? 2 : 1, {reg,operand} = yield* this._operand(width);
                const value = yield* this._readOperand(operand,width);
                yield* this._writeOperand(operand,this._get(reg),width); this._set(reg,value); break;
            }
            case 0x8d: {
                const {reg,operand} = yield* this._operand();
                if (operand.register) throw new RealModeFault(6);
                this.regs[reg] = operand.offset; break;
            }
            case 0x8f: {
                const {reg,operand} = yield* this._operand();
                if (reg !== 'ax') throw new RealModeFault(6);
                const value = yield* this._pop();
                this.restartRegisters = {...this.regs}; // A destination fault does not undo the stack read.
                yield* this._writeOperand(operand,value); break;
            }
            case 0x90: break;
            case 0x91: case 0x92: case 0x93: case 0x94: case 0x95: case 0x96: case 0x97: {
                const reg = REGS[opcode & 7], value = this.regs[reg];
                this.regs[reg] = this.regs.ax; this.regs.ax = value; break;
            }
            case 0x98: this.regs.ax = this._get('al') & 128 ? this._get('al') | 0xff00 : this._get('al'); break;
            case 0x99: this.regs.dx = this.regs.ax & 32768 ? 65535 : 0; break;
            case 0x9b:
                if (this.coprocessor !== 'inactive-lines') throw new CircuitFault('UNSUPPORTED_COPROCESSOR','WAIT requires explicit coprocessor line profile');
                if ((this.msw & 10) === 10) throw new RealModeFault(7);
                break; // Explicit BUSY/ERROR inactive: no wait or pending error.
            case 0x9a: {
                const ip = yield* this._word(), cs = yield* this._word();
                yield* this._push(this.cs); yield* this._push(this.ip);
                this.cs = cs; this.csBase = cs * 16; this.ip = ip; this.flowTransfer = true; break;
            }
            case 0x9c: yield* this._push(this.flags); break;
            case 0x9d: this.flags = ((yield* this._pop()) & 0x0fd5) | 2; break;
            case 0x9e: this.flags = (this.flags & ~0xd5) | (this._get('ah') & 0xd5) | 2; break;
            case 0x9f: this._set('ah',(this.flags & 0xd5) | 2); break;
            case 0xa8: case 0xa9: {
                const width = opcode & 1 ? 2 : 1, immediate = width === 1 ? yield* this._byte() : yield* this._word();
                this.flags = logicalFlags(this._get(width === 1 ? 'al' : 'ax') & immediate,width,this.flags); break;
            }
            case 0xcc: yield* this._interrupt(3,this.ip); break;
            case 0xcd: {const vector = yield* this._byte(); yield* this._interrupt(vector,this.ip); break;}
            case 0xce: if (this.flags & 0x800) yield* this._interrupt(4,this.ip); break;
            case 0xcf: {
                this.nmiBlocked = false; // IRET unblocks NMI even if its operand faults.
                const ip = yield* this._pop(), cs = yield* this._pop(), flags = yield* this._pop();
                this.ip = ip; this.cs = cs; this.csBase = cs * 16; this.flags = (flags & 0x0fd5) | 2; break;
            }
            case 0xc4: case 0xc5: {
                const {reg,operand} = yield* this._operand();
                if (operand.register) throw new RealModeFault(6);
                const value = yield* this._readOperand(operand);
                const segment = yield* this._memory((operand.offset + 2) & 65535,false,0,operand.segment);
                this.regs[reg] = value; this[opcode === 0xc4 ? 'es' : 'ds'] = segment; break;
            }
            case 0xc8: {
                const allocation = yield* this._word(), level = (yield* this._byte()) & 31;
                yield* this._push(this.regs.bp); const frame = this.regs.sp;
                if (level) {
                    let bp = this.regs.bp;
                    for (let i = 1; i < level; i++) {bp = (bp - 2) & 65535; yield* this._push(yield* this._memory(bp,false,0,this.ss));}
                    yield* this._push(frame);
                }
                this.regs.bp = frame; this.regs.sp = (this.regs.sp - allocation) & 65535; break;
            }
            case 0xc9: {
                const value = yield* this._memory(this.regs.bp,false,0,this.ss);
                this.regs.sp = (this.regs.bp + 2) & 65535; this.regs.bp = value; break;
            }
            case 0xd4: case 0xd5: {
                const base = yield* this._byte();
                if (opcode === 0xd4) {
                    // Harris divider leaves flags from the pre-final-shift
                    // remainder on AAM 0; AX itself remains restartable.
                    if (!base) {this.flags = logicalFlags(this._get('al') >>> 1,1,this.flags); throw new RealModeFault(0);}
                    const value = this._get('al'); this._set('ah',Math.floor(value/base)); this._set('al',value%base);
                } else this.regs.ax = (this._get('al') + this._get('ah') * base) & 255;
                this.flags = (this.flags & ~0xc4) | (logicalFlags(this._get('al'),1,this.flags) & 0xc4); break;
            }
            case 0xd6: this._set('al',this.flags & 1 ? 255 : 0); break;
            case 0xd7: this._set('al',yield* this._memory((this.regs.bx + this._get('al')) & 65535,false,0,this.segmentOverride ?? this.ds,1)); break;
            case 0xd8: case 0xd9: case 0xda: case 0xdb: case 0xdc: case 0xdd: case 0xde: case 0xdf: {
                if (this.coprocessor !== 'inactive-lines') throw new CircuitFault('UNSUPPORTED_COPROCESSOR','ESC protocol not wired');
                if (this.msw & 12) throw new RealModeFault(7);
                const {operand} = yield* this._operand();
                if (!operand.register && operand.offset === 65535) throw new RealModeFault(13);
                // No PEREQ in this explicitly selected environment: no operand
                // transfer or floating-point execution. Not a 287 emulator.
                break;
            }
            case 0xe4: case 0xe5: case 0xe6: case 0xe7: case 0xec: case 0xed: case 0xee: case 0xef: {
                const width = opcode & 1 ? 2 : 1, port = opcode < 0xe8 ? yield* this._byte() : this.regs.dx;
                const name = width === 1 ? 'al' : 'ax';
                if (opcode & 2) yield* this._port(port,width,true,this._get(name));
                else this._set(name,yield* this._port(port,width)); break;
            }
            case 0xfe: case 0xff: {
                const width = opcode & 1 ? 2 : 1, {reg,operand} = yield* this._operand(width);
                const kind = (width === 1 ? BYTES : REGS).indexOf(reg);
                if (kind === 7 || (width === 1 && kind > 1)) throw new RealModeFault(6);
                if ((kind === 3 || kind === 5) && operand.register) throw new RealModeFault(6);
                const value = yield* this._readOperand(operand,width);
                if (kind <= 1) {
                    const result = arithmetic(value,1,this.flags,width,kind === 1);
                    yield* this._writeOperand(operand,result.result,width);
                    this.flags = (result.flags & ~1) | (this.flags & 1);
                } else if (kind === 6) yield* this._push(value);
                else {
                    const segment = kind === 3 || kind === 5 ? yield* this._memory((operand.offset + 2) & 65535,false,0,operand.segment) : this.cs;
                    if (kind === 3) yield* this._push(this.cs);
                    if (kind === 2 || kind === 3) yield* this._push(this.ip);
                    this.cs = segment; this.csBase = segment * 16; this.ip = value; this.flowTransfer = true;
                }
                break;
            }
            case 0xf5: this.flags ^= 1; break;
            case 0xf8: this.flags &= ~1; break;
            case 0xf9: this.flags |= 1; break;
            case 0xfa: this.flags &= ~0x200; break;
            case 0xfb:
                if (!(this.flags & 0x200)) this.stiShadow = 2;
                this.flags |= 0x200; break;
            case 0xfc: this.flags &= ~0x400; break;
            case 0xfd: this.flags |= 0x400; break;
            case 0xf4: this.status = 'halted'; break;
            default: throw new CircuitFault('UNSUPPORTED_OPCODE', `0x${opcode.toString(16)} at ${start.cs.toString(16)}:${start.ip.toString(16)}`);
            }
            } catch (error) {
                if (!(error instanceof RealModeFault)) throw error;
                // Faults restart at the first prefix, not the following IP.
                this.regs = this.restartRegisters ?? saved;
                this.cs = start.cs; this.csBase = start.physical - start.ip;
                try {yield* this._interrupt(error.vector,start.ip);}
                catch (nested) {
                    if (!(nested instanceof RealModeFault)) throw nested;
                    throw new CircuitFault('UNSUPPORTED_NESTED_FAULT','fault delivery failed; double-fault/shutdown not implemented');
                }
            }
            if (this.suspendedRepeat) continue;
            if (this.ssShadow) this.ssShadow--;
            if (this.stiShadow) this.stiShadow--;
            this.retired++;
            this.lastRetirement = {flowTransfer:this.flowTransfer,interrupt:this.interruptTaken};
            if (this.history.length === this.historyLimit) { this.history.shift(); this.dropped++; }
            this.history.push(Object.freeze({...start, opcode, retired: this.retired}));
        }
    }
    _pump(value) {
        const next = this.iterator.next(value);
        if (!next.done) this.board.submit({...next.value,locked:this.busLocked===true});
    }
    stepClock(ready_n = 0) {
        if (this.status !== 'running' && !(this.status === 'halted' && (this.board.capabilities?.nmi || this.board.capabilities?.intr)))
            throw new CircuitFault('CPU_NOT_RUNNING', this.status);
        try {
            this.instructionBoundary = false;
            const transfer = this.board.clock({ready_n});
            if (this.status === 'halted') {
                if (this._externalReady()) {this.status = 'running'; this.iterator = this._instructions(); this._pump();}
            } else if (transfer?.last) this._pump(transfer.operand);
            return transfer;
        } catch (error) {
            this.status = 'faulted';
            this.fault = Object.freeze({code: error.code || 'ERROR', message: error.message});
            throw error;
        }
    }
    run(maxClocks = 512) {
        if (!Number.isSafeInteger(maxClocks) || maxClocks < 1) throw new RangeError('maxClocks');
        let clocks = 0;
        while (this.status === 'running' && clocks < maxClocks) { this.stepClock(); clocks++; }
        return {status: this.status === 'running' ? 'budget-exhausted' : this.status, clocks, retired: this.retired};
    }
    // Explicit memory-only hybrid path. Each native call still executes every
    // electrical period. Callers must yield to their event loop between budgets;
    // this synchronous method does not make a large total budget responsive.
    runTransactions(options = {}) {
        if (!options || typeof options !== 'object' || Array.isArray(options) ||
            Object.keys(options).some(key => !['maxPeriods', 'maxBatchPeriods', 'ready_n', 'signal'].includes(key)))
            throw new TypeError('unsupported transaction runner options');
        const {maxPeriods, maxBatchPeriods = 256, ready_n = 0, signal} = options;
        if (!Number.isSafeInteger(maxPeriods) || maxPeriods < 1) throw new RangeError('maxPeriods');
        if (!Number.isSafeInteger(maxBatchPeriods) || maxBatchPeriods < 1 || maxBatchPeriods > 8192)
            throw new RangeError('maxBatchPeriods 1..8192');
        if (ready_n !== 0 && ready_n !== 1) throw new RangeError('ready_n 0 or 1');
        if (signal !== undefined && (!signal || typeof signal !== 'object' || typeof signal.aborted !== 'boolean'))
            throw new TypeError('signal must expose an aborted boolean');
        if (this.board.capabilities?.transactionBatching !== true ||
            this.board.capabilities?.nativeMemoryBus !== true || typeof this.board.runUntilCompletion !== 'function' ||
            this.board.capabilities?.nmi || this.board.capabilities?.intr)
            throw new CircuitFault('UNSUPPORTED_TRANSACTION_BATCHING', 'explicit native memory-only board required');
        let periods = 0;
        const completions = [];
        const invalid = () => new CircuitFault('INVALID_BATCH_RESULT', 'invalid bounded transaction progress');
        const validProgress = (receipt, budget, fault = false) => {
            if (!receipt || !Number.isSafeInteger(receipt.periods) || receipt.periods < (fault ? 0 : 1) ||
                receipt.periods > budget || !Array.isArray(receipt.completions) ||
                receipt.completions.length > receipt.periods || receipt.completions.length > (fault ? 1 : 2)) return false;
            const transfers = receipt.completions, last = transfers.at(-1);
            if (Array.from(transfers).some((transfer, index) => !transfer || typeof transfer.last !== 'boolean' ||
                (transfer.last && (fault || index !== transfers.length - 1)))) return false;
            // A logical word has at most two physical beats; the second ends it.
            if (transfers.length === 2 && !last.last) return false;
            if (fault) return true; // native runner stops before any final completion on failure
            return typeof receipt.completed === 'boolean' && receipt.completed === (last?.last === true) &&
                (!receipt.completed || (Number.isInteger(last.operand) && last.operand >= 0 && last.operand <= 65535));
        };
        try {
            while (this.status === 'running' && periods < maxPeriods) {
                if (signal?.aborted) { this.cancel(); break; }
                this.instructionBoundary = false;
                const budget = Math.min(maxBatchPeriods, maxPeriods - periods);
                let result;
                try { result = this.board.runUntilCompletion({maxPeriods: budget, inputs: {ready_n}}); }
                catch (error) {
                    // A native fault can follow successful boundaries, including
                    // the first half of an odd word. Never pump on this path.
                    const progress = error.progress;
                    if (progress !== undefined) {
                        if (!validProgress(progress, budget, true)) throw invalid();
                        periods += progress.periods;
                        completions.push(...progress.completions);
                    }
                    throw error;
                }
                if (!validProgress(result, budget)) throw invalid();
                const last = result.completions.at(-1);
                periods += result.periods;
                completions.push(...result.completions);
                if (result.completed) this._pump(last.operand);
            }
        } catch (error) {
            this.status = 'faulted';
            this.fault = Object.freeze({code: error.code || 'ERROR', message: error.message});
            // Retain the original native busClock: a faulting partial period
            // may advance it, but is not a successfully completed period.
            error.progress = Object.freeze({...error.progress, stopReason: 'fault', periods,
                completions: Object.freeze(completions), retired: this.retired});
            throw error;
        }
        return {status: this.status === 'running' ? 'budget-exhausted' : this.status,
            periods, retired: this.retired, completions};
    }
    cancel() { if (this.status === 'running') this.status = 'cancelled'; }
    inspect() {
        return {status: this.status, registers: {...this.regs}, cs: this.cs, csBase: this.csBase, ip: this.ip,
            instructionBoundary: this.status === 'running' && this.instructionBoundary === true,
            ds: this.ds, es: this.es, ss: this.ss, flags: this.flags, msw: this.msw,
            gdtr: {...this.gdtr}, idtr: {...this.idtr},
            nmi: {blocked:this.nmiBlocked,count:this.nmiCount,ssShadow:this.ssShadow},
            intr: {count:this.intrCount,lastVector:this.lastINTR,stiShadow:this.stiShadow},
            retired: this.retired, fault: this.fault ? {...this.fault} : null,
            history: this.history.map(e => ({...e})), dropped: this.dropped};
    }
}
