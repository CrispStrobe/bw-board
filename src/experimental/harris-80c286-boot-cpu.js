/**
 * Explicitly limited, generator-resumable real-mode boot executor. All byte
 * fetches and memory operations use the external phase board. No prefetch,
 * instruction timing, protection, exception delivery or bus-HLT claim.
 */
import {CircuitFault} from './digital-circuit.js';

const REGS = ['ax', 'cx', 'dx', 'bx', 'sp', 'bp', 'si', 'di'];
const BYTES = ['al', 'cl', 'dl', 'bl', 'ah', 'ch', 'dh', 'bh'];
const SEGMENTS = ['es', 'cs', 'ss', 'ds'];
const FLAGS = 0x8d5; // OF SF ZF AF PF CF; other bits preserved

function logicalFlags(value, width, flags) {
    let parity = 0;
    for (let i = 0; i < 8; i++) parity ^= (value >> i) & 1;
    // AF is undefined for logical instructions; this model preserves it.
    return (flags & ~0x8c5) | (!parity ? 4 : 0) | (value === 0 ? 0x40 : 0) |
        (value & (width === 1 ? 0x80 : 0x8000) ? 0x80 : 0) | 2;
}

function arithmetic(a, b, flags, width, subtract) {
    if (width === 2) return (subtract ? bootSub16 : bootAdd16)(a, b, flags);
    const result = (subtract ? a - b : a + b) & 255;
    const carry = subtract ? a < b : a + b > 255;
    const overflow = (subtract ? (a ^ b) : ~(a ^ b)) & (a ^ result) & 0x80;
    return {result, flags: (logicalFlags(result, 1, flags) & ~0x10) |
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
    constructor({enabled = false, board, historyLimit = 64} = {}) {
        if (enabled !== true) throw new CircuitFault('EXPERIMENT_DISABLED', 'enabled:true required');
        if (!board?.submit || !board?.clock || !board?.initialize) throw new TypeError('wired phase board required');
        if (!Number.isSafeInteger(historyLimit) || historyLimit < 1) throw new RangeError('historyLimit');
        this.board = board; this.historyLimit = historyLimit;
        this.status = 'uninitialized'; this.retired = 0; this.history = []; this.dropped = 0;
        this.capabilities = Object.freeze({experimental: true, instructionExecution: true,
            cpuModel: 'harris-286-boot-subset', general80286: false, protectedMode: false,
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
        this.retired = 0; this.history = []; this.dropped = 0; this.fault = null;
        this.status = 'running';
        this.iterator = this._instructions();
        this._pump();
    }

    *_byte() {
        if (this.ip >= 0xffff) throw new CircuitFault('UNSUPPORTED_SEGMENT_WRAP', 'instruction fetch at segment end');
        const byte = yield {kind: 'code-read', address: this.csBase + this.ip, width: 1};
        this.ip++;
        return byte;
    }
    *_word() { const low = yield* this._byte(); return low | ((yield* this._byte()) << 8); }
    *_memory(offset, write = false, value = 0, segment = this.segmentOverride ?? this.ds, width = 2) {
        if (offset + width > 0x10000) throw new CircuitFault('UNSUPPORTED_SEGMENT_WRAP', 'operand crosses segment end');
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
    _alu(kind, a, b, width) {
        if (kind === 0 || kind === 5 || kind === 7) return arithmetic(a, b, this.flags, width, kind !== 0);
        let result;
        if (kind === 1) result = a | b;
        else if (kind === 4) result = a & b;
        else if (kind === 6) result = a ^ b;
        else throw new CircuitFault('UNSUPPORTED_ALU', `group ${kind}`);
        return {result, flags: logicalFlags(result, width, this.flags)};
    }
    _condition(code) {
        const f = this.flags, cf = !!(f & 1), pf = !!(f & 4), zf = !!(f & 64), sf = !!(f & 128), of = !!(f & 2048);
        return [of, !of, cf, !cf, zf, !zf, cf || zf, !cf && !zf,
            sf, !sf, pf, !pf, sf !== of, sf === of, zf || sf !== of, !zf && sf === of][code];
    }
    _branch(displacement) {
        const target = this.ip + displacement;
        if (target < 0 || target >= 0xffff) throw new CircuitFault('UNSUPPORTED_SEGMENT_WRAP', 'branch target outside supported fetch range');
        this.ip = target;
    }
    *_instructions() {
        while (this.status === 'running') {
            this.instructionBoundary = true;
            const start = {cs: this.cs, ip: this.ip, physical: this.csBase + this.ip};
            this.segmentOverride = undefined;
            let opcode = yield* this._byte();
            let prefixes = 0;
            while ([0x26, 0x2e, 0x36, 0x3e].includes(opcode)) {
                if (++prefixes > 4) throw new CircuitFault('UNSUPPORTED_PREFIX_SEQUENCE', 'more than four segment prefixes');
                this.segmentOverride = this[SEGMENTS[(opcode >> 3) & 3]];
                opcode = yield* this._byte();
            }
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
            case 0x06: case 0x0e: case 0x16: case 0x1e: yield* this._push(this[SEGMENTS[(opcode >> 3) & 3]]); break;
            case 0x07: case 0x17: case 0x1f: this[SEGMENTS[(opcode >> 3) & 3]] = yield* this._pop(); break;
            case 0x88: case 0x8a: {
                const {reg, operand} = yield* this._operand(1);
                if (opcode === 0x88) yield* this._writeOperand(operand, this._get(reg), 1);
                else this._set(reg, yield* this._readOperand(operand, 1));
                break;
            }
            case 0x8c: case 0x8e: {
                const {reg, operand} = yield* this._operand(); const index = REGS.indexOf(reg);
                if (index > 3 || (opcode === 0x8e && index === 1)) throw new CircuitFault('INVALID_SEGMENT_REGISTER', `${index}`);
                if (opcode === 0x8c) yield* this._writeOperand(operand, this[SEGMENTS[index]]);
                else this[SEGMENTS[index]] = yield* this._readOperand(operand);
                break;
            }
            case 0xc6: case 0xc7: {
                const width = opcode & 1 ? 2 : 1;
                const {reg, operand} = yield* this._operand(width);
                if (reg !== (width === 1 ? 'al' : 'ax')) throw new CircuitFault('UNSUPPORTED_OPCODE_EXTENSION', 'MOV immediate requires /0');
                const value = width === 1 ? yield* this._byte() : yield* this._word();
                yield* this._writeOperand(operand, value, width); break;
            }
            case 0x80: case 0x81: case 0x83: {
                const width = opcode === 0x80 ? 1 : 2;
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
                if (reg !== (width === 1 ? 'al' : 'ax')) throw new CircuitFault('UNSUPPORTED_OPCODE_EXTENSION', 'only TEST in F6/F7 supported');
                const immediate = width === 1 ? yield* this._byte() : yield* this._word();
                this.flags = logicalFlags((yield* this._readOperand(operand, width)) & immediate, width, this.flags); break;
            }
            case 0xd0: case 0xd1: {
                const width = opcode & 1 ? 2 : 1; const {reg, operand} = yield* this._operand(width);
                const kind = (width === 1 ? BYTES : REGS).indexOf(reg);
                if (kind !== 4 && kind !== 5) throw new CircuitFault('UNSUPPORTED_OPCODE_EXTENSION', 'only single-bit SHL/SHR supported');
                const value = yield* this._readOperand(operand, width), sign = width === 1 ? 128 : 32768;
                const carry = kind === 4 ? Number(!!(value & sign)) : value & 1;
                const result = kind === 4 ? (value << 1) & (width === 1 ? 255 : 65535) : value >>> 1;
                const overflow = kind === 4 ? Number(!!(result & sign)) ^ carry : Number(!!(value & sign));
                const flags = logicalFlags(result, width, this.flags) | carry | (overflow << 11);
                yield* this._writeOperand(operand, result, width); this.flags = flags; break;
            }
            case 0xe8: {
                let displacement = yield* this._word(); if (displacement & 32768) displacement -= 65536;
                const returnIP = this.ip; this._branch(displacement); const target = this.ip; this.ip = returnIP;
                yield* this._push(returnIP); this.ip = target; break;
            }
            case 0xc2: case 0xc3: {
                const adjustment = opcode === 0xc2 ? yield* this._word() : 0;
                this.ip = yield* this._pop(); this.regs.sp = (this.regs.sp + adjustment) & 65535; break;
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
            case 0xeb: case 0xe9: case 0xe2: {
                let displacement = opcode === 0xe9 ? yield* this._word() : yield* this._byte();
                const sign = opcode === 0xe9 ? 0x8000 : 0x80;
                if (displacement & sign) displacement -= sign * 2;
                if (opcode === 0xe2) {
                    const count = (this.regs.cx - 1) & 0xffff;
                    // Validate the taken target before committing CX.
                    if (count) this._branch(displacement);
                    this.regs.cx = count;
                } else this._branch(displacement);
                break;
            }
            case 0x90: break;
            case 0xfa: this.flags &= ~0x200; break;
            case 0xf4: this.status = 'halted'; break;
            default: throw new CircuitFault('UNSUPPORTED_OPCODE', `0x${opcode.toString(16)} at ${start.cs.toString(16)}:${start.ip.toString(16)}`);
            }
            this.retired++;
            if (this.history.length === this.historyLimit) { this.history.shift(); this.dropped++; }
            this.history.push(Object.freeze({...start, opcode, retired: this.retired}));
        }
    }
    _pump(value) {
        const next = this.iterator.next(value);
        if (!next.done) this.board.submit(next.value);
    }
    stepClock(ready_n = 0) {
        if (this.status !== 'running') throw new CircuitFault('CPU_NOT_RUNNING', this.status);
        try {
            this.instructionBoundary = false;
            const transfer = this.board.clock({ready_n});
            if (transfer?.last) this._pump(transfer.operand);
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
    cancel() { if (this.status === 'running') this.status = 'cancelled'; }
    inspect() {
        return {status: this.status, registers: {...this.regs}, cs: this.cs, csBase: this.csBase, ip: this.ip,
            instructionBoundary: this.status === 'running' && this.instructionBoundary === true,
            ds: this.ds, es: this.es, ss: this.ss, flags: this.flags, msw: this.msw,
            retired: this.retired, fault: this.fault ? {...this.fault} : null,
            history: this.history.map(e => ({...e})), dropped: this.dropped};
    }
}
