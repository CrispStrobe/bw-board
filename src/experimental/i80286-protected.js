import I8086, {
    UnsupportedProtectedMode,
} from '../i8086.js';

/** Host-visible protected fault. With delivery disabled it is diagnostic;
 * with delivery enabled the supported IDT subset delivers it architecturally. */
export class ProtectedModeFault extends Error {
    constructor(vector, errorCode, restartIp, reason) {
        super(`80286 protected-mode #${vector} (${reason})`);
        this.name = 'ProtectedModeFault';
        this.vector = vector;
        this.errorCode = errorCode & 0xffff;
        this.restartIp = restartIp & 0xffff;
        this.reason = reason;
    }
}

export const SEG_ES = 0, SEG_CS = 1, SEG_SS = 2, SEG_DS = 3;
const IDS = [SEG_ES, SEG_CS, SEG_SS, SEG_DS];
const CF = 0x0001, PF = 0x0004, ZF = 0x0040, SF = 0x0080;
const TF = 0x0100, IF = 0x0200, DF = 0x0400, OF = 0x0800, NT = 0x4000;
const ERROR_CODE_VECTORS = new Set([10, 11, 12, 13]);

/**
 * Experimental, deliberately bounded 80286 protected-mode executor.
 *
 * It implements expand-up 16-bit code/data segments through the GDT and LDT,
 * restartable strings, and a bounded ring-0/ring-3 interrupt path using a 286
 * TSS stack. Full task switches, task/call gates, conforming and expand-down
 * segments remain explicit unsupported boundaries.
 */
export class ProtectedI80286 extends I8086 {
    constructor(bus, {deliverProtectedFaults = false} = {}) {
        super(bus, {variant: '80286'});
        this._protectedCapable = true;
        this.deliverProtectedFaults = !!deliverProtectedFaults;
        this._deliveringProtected = false;
        this._pmStiShadow = 0;
    }

    reset() {
        super.reset();
        this.cpl = 0; this._pmStiShadow = 0;
        this.ldtr = {selector:0,valid:false,base:0,limit:0};
        this.tr = {selector:0,valid:false,base:0,limit:0};
        this._initRealCaches();
    }

    canTakeInterrupt() {
        if (!(this.msw & 1)) return super.canTakeInterrupt();
        return (this.flags & IF) !== 0 && this.intShadow === 0 && this._pmStiShadow === 0;
    }

    canTakeNmi() { return !(this.msw & 1) || this.intShadow === 0; }

    get pc() {
        if (!(this.msw & 1)) return super.pc;
        return (this.segmentCaches[SEG_CS].base + (this.ip & 0xffff)) & 0xffffff;
    }

    _initRealCaches() {
        this.segmentCaches = Object.fromEntries(IDS.map((id) => [id, {
            selector: [this.es, this.cs, this.ss, this.ds][id] & 0xffff,
            base: ([this.es, this.cs, this.ss, this.ds][id] & 0xffff) << 4,
            limit: 0xffff,
            access: id === SEG_CS ? 0x9b : 0x93,
            code: id === SEG_CS,
            writable: id !== SEG_CS,
            readable: true,
        }]));
    }

    _pmFault(vector, errorCode, reason) {
        throw new ProtectedModeFault(vector, errorCode, this._instrStartIp ?? this.ip, reason);
    }

    _descriptor(selector, target, {ignoreRpl = false, privilegeCpl = this.cpl, systemAsUnsupported = false} = {}) {
        selector &= 0xffff;
        if ((selector & 0xfffc) === 0 && (target === SEG_DS || target === SEG_ES))
            return {selector,base:0,limit:0,access:0,code:false,writable:false,readable:false,usable:false};
        const raw = this._rawDescriptor(selector);
        const {bytes:b,address:a} = raw, access = raw.access;
        const present = !!(access & 0x80), dpl = (access >> 5) & 3;
        const code = !!(access & 8), writable = !code && !!(access & 2);
        const readable = !code || !!(access & 2), expandDown = !code && !!(access & 4);
        if (!(access & 0x10)) {
            const systemType=access&0x0f;
            if (systemAsUnsupported&&(systemType===1||systemType===3||systemType===4||systemType===5))
                throw new UnsupportedProtectedMode('far task or gate transfer');
            this._pmFault(13, selector & 0xfffc, 'system descriptor as segment');
        }
        const rpl = selector & 3;
        if (target === SEG_SS && (rpl !== privilegeCpl || dpl !== privilegeCpl)) this._pmFault(13, selector & 0xfffc, 'SS privilege');
        if ((target === SEG_DS || target === SEG_ES) && Math.max(privilegeCpl,rpl) > dpl)
            this._pmFault(13, selector & 0xfffc, 'data segment privilege');
        if (target === SEG_CS && !ignoreRpl && (dpl !== privilegeCpl || rpl > privilegeCpl))
            this._pmFault(13, selector & 0xfffc, 'code segment privilege');
        if (expandDown) throw new UnsupportedProtectedMode('expand-down segments');
        if (code && (access & 4)) throw new UnsupportedProtectedMode('conforming code segments');
        if (target === SEG_CS && !code) this._pmFault(13, selector & 0xfffc, 'far jump requires code');
        if (target === SEG_SS && (code || !writable)) this._pmFault(13, selector & 0xfffc, 'SS requires writable data');
        if ((target === SEG_DS || target === SEG_ES) && code && !readable) this._pmFault(13, selector & 0xfffc, 'unreadable code data segment');
        if (!present) this._pmFault(target === SEG_SS ? 12 : 11, selector & 0xfffc, 'segment not present');
        return {selector:target === SEG_CS ? (selector & 0xfffc) | privilegeCpl : selector,
            base: (b[2] | (b[3] << 8) | (b[4] << 16)) >>> 0,
            limit: b[0] | (b[1] << 8), access: access | 1, code, writable, readable,
            usable:true,descriptorAccessAddress: a + 5, accessedWasSet: !!(access & 1)};
    }

    _rawDescriptor(selector, {gdtOnly=false} = {}) {
        selector &= 0xffff;
        if ((selector & 0xfffc) === 0) this._pmFault(13, 0, 'null selector');
        const useLdt = !!(selector & 4);
        if (gdtOnly && useLdt) this._pmFault(13, selector & 0xfffc, 'descriptor must be in GDT');
        if (useLdt && !this.ldtr.valid) this._pmFault(13, selector & 0xfffc, 'invalid LDTR');
        const table = useLdt ? this.ldtr : this.gdtr, offset = selector & 0xfff8;
        if (offset + 7 > table.limit) this._pmFault(13, selector & 0xfffc, 'selector outside table');
        const address = (table.base + offset) & 0xffffff;
        const bytes = Array.from({length:8},(_,i)=>{
            const physical=(address+i)&0xffffff;
            if(this.busTrace!==null)this.busTrace.push(1,physical);
            return this.read(physical)&0xff;
        });
        return {selector,address,bytes,access:bytes[5],base:(bytes[2]|bytes[3]<<8|bytes[4]<<16)>>>0,
            limit:bytes[0]|bytes[1]<<8};
    }

    _commitDescriptor(target, descriptor) {
        // The 286 sets A in the in-memory descriptor when it loads a segment.
        // All validation has completed before this sole visible side effect.
        if (descriptor.usable === false) {
            this.segmentCaches[target] = {...descriptor};
            if (target === SEG_ES) this.es=descriptor.selector; else this.ds=descriptor.selector;
            return;
        }
        if (!(descriptor.access & 1)) throw new Error('internal descriptor access invariant');
        if (!descriptor.accessedWasSet) {
            const a = descriptor.descriptorAccessAddress & 0xffffff;
            if (this.busTrace !== null) this.busTrace.push(2, a);
            this.write(a, descriptor.access);
        }
        const {descriptorAccessAddress: ignored, accessedWasSet: ignoredToo, ...cache} = descriptor;
        this.segmentCaches[target] = cache;
        switch (target) {
            case SEG_ES: this.es = cache.selector; break;
            case SEG_CS: this.cs = cache.selector; break;
            case SEG_SS: this.ss = cache.selector; break;
            case SEG_DS: this.ds = cache.selector; break;
        }
    }

    _linear(id, off, width, kind) {
        const cache = this.segmentCaches[id];
        if (!cache) this._pmFault(13, 0, 'invalid segment identity');
        if (cache.usable === false) this._pmFault(13, 0, 'null data segment');
        off &= 0xffff;
        if (off + width - 1 > cache.limit) this._pmFault(id === SEG_SS ? 12 : 13, 0, 'segment limit');
        if (kind === 'fetch' && !cache.code) this._pmFault(13, 0, 'execute through non-code segment');
        if (kind === 'write' && (cache.code || !cache.writable)) this._pmFault(13, 0, 'write through non-writable segment');
        if (kind === 'read' && cache.code && !cache.readable) this._pmFault(13, 0, 'read through execute-only segment');
        return (cache.base + off) & 0xffffff;
    }

    _phys(id, off) {
        if (!(this.msw & 1)) return super._phys(id, off);
        return this._linear(id, off, 1, id === SEG_CS ? 'fetch' : 'read');
    }
    _rd8(id, off) {
        if (!(this.msw & 1)) return super._rd8(id, off);
        const a = this._linear(id, off, 1, 'read');
        if (this.busTrace !== null) this.busTrace.push(1, a);
        return this.read(a) & 0xff;
    }
    _wr8(id, off, value) {
        if (!(this.msw & 1)) return super._wr8(id, off, value);
        const a = this._linear(id, off, 1, 'write');
        if (this.busTrace !== null) this.busTrace.push(2, a);
        this.write(a, value & 0xff);
    }
    _rd16(id, off) {
        if (!(this.msw & 1)) return super._rd16(id, off);
        const a = this._linear(id, off, 2, 'read');
        const b = (a + 1) & 0xffffff;
        if (this.busTrace !== null) this.busTrace.push(1, a, 1, b);
        return (this.read(a) & 0xff) | ((this.read(b) & 0xff) << 8);
    }
    _wr16(id, off, value) {
        if (!(this.msw & 1)) return super._wr16(id, off, value);
        const a = this._linear(id, off, 2, 'write');
        const b = (a + 1) & 0xffffff;
        if (this.busTrace !== null) this.busTrace.push(2, a, 2, b);
        this.write(a, value & 0xff); this.write(b, (value >> 8) & 0xff);
    }

    _sregSet(i, value) {
        if (!(this.msw & 1)) return super._sregSet(i, value);
        const target = [SEG_ES, SEG_CS, SEG_SS, SEG_DS][i & 3];
        if (target === SEG_CS) this._pmFault(6, 0, 'MOV cannot load CS');
        const descriptor = this._descriptor(value, target);
        this._commitDescriptor(target, descriptor);
    }

    _exec0F286() {
        const before = this.msw & 1;
        const n = super._exec0F286();
        if (!before && (this.msw & 1)) this._initRealCaches();
        return n;
    }

    _execProtected(op) {
        if (op === 0x0f) return this._pmSystem(this._pmFetch8());
        if (op >= 0xa4 && op <= 0xaf && op !== 0xa8 && op !== 0xa9) return this._pmString(op);
        if (op === 0x06 || op === 0x0e || op === 0x16 || op === 0x1e) {
            this._pmPush([this.es, this.cs, this.ss, this.ds][op >> 3]);
            return 10;
        }
        if (op === 0x07 || op === 0x17 || op === 0x1f) {
            const register = op === 0x07 ? 0 : op === 0x17 ? 2 : 3;
            const value = this._rd16(SEG_SS, this.sp);
            const descriptor = this._descriptor(value, [SEG_ES, SEG_CS, SEG_SS, SEG_DS][register]);
            this._commitDescriptor([SEG_ES, SEG_CS, SEG_SS, SEG_DS][register], descriptor);
            this.sp = (this.sp + 2) & 0xffff;
            if (register === 2) this.intShadow = 1;
            return 8;
        }
        if (op === 0x68 || op === 0x6a) {
            const value = op === 0x68 ? this._pmFetch16() : (this._pmFetchS8() & 0xffff);
            this._pmPush(value);
            return 3;
        }
        // The eight classic ALU operations, excluding the BCD-adjust holes.
        if (op < 0x40 && (op & 7) < 6) {
            const kind = op >> 3, form = op & 7, word = !!(form & 1);
            if (form < 4) {
                const ea = this._pmModRM(), toReg = form >= 2;
                if (!toReg && kind !== 7) this._pmPreflightWrite(ea, word);
                const memoryValue = this._pmOperandRead(ea, word);
                const regValue = word ? this._r16(ea.reg) : this._r8(ea.reg);
                const result = this._alu(kind, toReg ? regValue : memoryValue,
                    toReg ? memoryValue : regValue, word);
                if (kind !== 7) {
                    if (toReg) word ? this._r16set(ea.reg,result) : this._r8set(ea.reg,result);
                    else this._pmOperandWrite(ea, word, result);
                }
                return ea.isReg ? 3 : (toReg ? 9 : 16);
            }
            const immediate = word ? this._pmFetch16() : this._pmFetch8();
            const result = this._alu(kind, word ? this.ax : this.al, immediate, word);
            if (kind !== 7) { if (word) this.ax=result; else this.al=result; }
            return 4;
        }
        if (op === 0xcc) { this._deliverProtected(3, {software:true, returnIp:this.ip}); return 23; }
        if (op === 0xcd) {
            const vector = this._pmFetch8();
            this._deliverProtected(vector, {software:true, returnIp:this.ip}); return 23;
        }
        if (op === 0xce) {
            if (this.flags & OF) this._deliverProtected(4, {software:true, returnIp:this.ip});
            return 4;
        }
        if (op === 0xcf) { this._iretProtected(); return 17; }
        if (op === 0x9a) {
            const ip=this._pmFetch16(),selector=this._pmFetch16();
            this._farTransfer(ip,selector,true);
            return 28;
        }
        if (op === 0xca || op === 0xcb) {
            const discard=op===0xca?this._pmFetch16():0;
            this._farReturn(discard);
            return 25;
        }
        if (op === 0xea) {
            const ip = this._pmFetch16(), selector = this._pmFetch16();
            this._farTransfer(ip,selector,false);
            return 15;
        }
        if (op === 0x8e) {
            const ea=this._pmModRM();
            if (ea.reg > 3 || ea.reg === 1) this._pmFault(6, 0, 'invalid MOV segment register');
            const target = [SEG_ES, SEG_CS, SEG_SS, SEG_DS][ea.reg];
            this._sregSet(ea.reg, this._pmOperandRead(ea,true));
            if (target === SEG_SS) this.intShadow = 1;
            return ea.isReg ? 2 : 8;
        }
        if (op === 0xe9 || op === 0xeb) {
            const delta = op === 0xe9 ? this._pmFetch16() : this._pmFetchS8();
            const signed = op === 0xe9 && (delta & 0x8000) ? delta - 0x10000 : delta;
            const destination = (this.ip + signed) & 0xffff;
            if (destination > this.segmentCaches[SEG_CS].limit) this._pmFault(13, 0, 'near jump outside code segment');
            this.ip = destination;
            return op === 0xe9 ? 15 : 15;
        }
        if (op >= 0xb0 && op <= 0xb7) { this._r8set(op & 7, this._pmFetch8()); return 4; }
        if (op >= 0xb8 && op <= 0xbf) { this._r16set(op & 7, this._pmFetch16()); return 4; }
        if (op >= 0x40 && op <= 0x47) { this._r16set(op&7,this._inc(this._r16(op&7),1)); return 2; }
        if (op >= 0x48 && op <= 0x4f) { this._r16set(op&7,this._dec(this._r16(op&7),1)); return 2; }
        if (op >= 0x50 && op <= 0x57) { this._pmPush(this._r16(op & 7)); return 11; }
        if (op >= 0x58 && op <= 0x5f) { this._r16set(op & 7, this._pmPop()); return 8; }
        if (op >= 0x88 && op <= 0x8b) {
            const ea=this._pmModRM();
            const word = !!(op & 1), toReg = !!(op & 2);
            if (toReg) {
                const value=this._pmOperandRead(ea,word);
                if(word)this._r16set(ea.reg,value);else this._r8set(ea.reg,value);
            } else {
                const value=word?this._r16(ea.reg):this._r8(ea.reg);
                this._pmOperandWrite(ea,word,value);
            }
            return ea.isReg?2:10;
        }
        if (op === 0x86 || op === 0x87) {
            const word = !!(op & 1), ea = this._pmModRM();
            this._pmPreflightWrite(ea, word);
            const memory = this._pmOperandRead(ea, word);
            const register = word ? this._r16(ea.reg) : this._r8(ea.reg);
            this._pmOperandWrite(ea, word, register);
            if (word) this._r16set(ea.reg, memory); else this._r8set(ea.reg, memory);
            return ea.isReg ? 3 : 17;
        }
        if (op === 0x8c) {
            const ea = this._pmModRM();
            if (ea.reg > 3) this._pmFault(6, 0, 'invalid MOV from segment register');
            this._pmOperandWrite(ea, true, [this.es, this.cs, this.ss, this.ds][ea.reg]);
            return ea.isReg ? 2 : 9;
        }
        if (op === 0x8d) {
            const ea = this._pmModRM();
            if (ea.isReg) this._pmFault(6, 0, 'LEA requires memory operand');
            this._r16set(ea.reg, ea.off);
            return 3;
        }
        if (op === 0x84 || op === 0x85) {
            const word=!!(op&1),ea=this._pmModRM();
            this._logic(this._pmOperandRead(ea,word)&(word?this._r16(ea.reg):this._r8(ea.reg)),word);return ea.isReg?3:9;
        }
        if (op === 0xa8 || op === 0xa9) {
            const word=!!(op&1),immediate=word?this._pmFetch16():this._pmFetch8();
            this._logic((word?this.ax:this.al)&immediate,word);return 4;
        }
        if (op >= 0x91 && op <= 0x97) {
            const register = op & 7, value = this._r16(register);
            this._r16set(register, this.ax); this.ax = value;
            return 3;
        }
        if (op === 0x98) { this.ax = (this.al & 0x80) ? 0xff00 | this.al : this.al; return 2; }
        if (op === 0x99) { this.dx = (this.ax & 0x8000) ? 0xffff : 0; return 5; }
        if (op === 0x9c) { this._pmPush(this.flags); return 10; }
        if (op === 0x9d) {
            const value = this._rd16(SEG_SS, this.sp);
            const oldFlags = this.flags, oldIopl = (oldFlags >> 12) & 3;
            let next = (value | 2) & ~0x8028;
            if (this.cpl !== 0) next = (next & ~0x3000) | (oldFlags & 0x3000);
            if (this.cpl > oldIopl) next = (next & ~IF) | (oldFlags & IF);
            this.flags = next;
            this.sp = (this.sp + 2) & 0xffff;
            return 8;
        }
        if (op === 0x9e) { this.flags = (this.flags & 0xff00) | (this.ah & 0xd5) | 2; return 3; }
        if (op === 0x9f) { this.ah = (this.flags & 0xd5) | 2; return 2; }
        if (op >= 0xa0 && op <= 0xa3) {
            const word=!!(op&1),write=!!(op&2),off=this._pmFetch16(),id=this._pmOverride??SEG_DS;
            if(write)word?this._wr16(id,off,this.ax):this._wr8(id,off,this.al);
            else if(word)this.ax=this._rd16(id,off);else this.al=this._rd8(id,off);
            return 10;
        }
        if (op === 0xc6 || op === 0xc7) {
            const word = !!(op & 1), ea = this._pmModRM();
            if (ea.reg !== 0) this._pmFault(6, 0, 'invalid MOV immediate group');
            const value = word ? this._pmFetch16() : this._pmFetch8();
            this._pmOperandWrite(ea, word, value);
            return ea.isReg ? 4 : 10;
        }
        if (op === 0x80 || op === 0x81 || op === 0x83) {
            const word = !!(op & 1);
            const ea = this._pmModRM();
            // Finish decoding before touching a data operand. In particular,
            // an immediate fetch fault must not read an MMIO destination.
            const immediate = op === 0x81 ? this._pmFetch16() :
                op === 0x83 ? (this._pmFetchS8() & 0xffff) : this._pmFetch8();
            if (ea.reg !== 7) this._pmPreflightWrite(ea, word);
            const operand = this._pmOperandRead(ea, word);
            const result = this._alu(ea.reg, operand, immediate, word);
            if (ea.reg !== 7) this._pmOperandWrite(ea, word, result);
            return ea.isReg ? 4 : 17;
        }
        if (op === 0xfe || op === 0xff) {
            const word = !!(op & 1), ea = this._pmModRM();
            if (ea.reg <= 1) {
                this._pmPreflightWrite(ea, word);
                const value = this._pmOperandRead(ea, word);
                this._pmOperandWrite(ea, word, ea.reg ? this._dec(value, word) : this._inc(value, word));
                return ea.isReg ? 3 : 15;
            }
            if (word && ea.reg === 2) {
                const target = this._pmOperandRead(ea, true);
                this._pmCheckCodeOffset(target);
                this._pmPush(this.ip);
                this.ip = target;
                return 16;
            }
            if (word && ea.reg === 4) {
                const target = this._pmOperandRead(ea, true);
                this._pmCheckCodeOffset(target);
                this.ip = target;
                return 11;
            }
            if (word && ea.reg === 6) {
                this._pmPush(this._pmOperandRead(ea, true));
                return 11;
            }
            if(word&&(ea.reg===3||ea.reg===5)){
                if(ea.isReg)this._pmFault(6,0,'far control transfer requires memory pointer');
                this._linear(ea.id,ea.off,4,'read');
                const ip=this._rd16(ea.id,ea.off),selector=this._rd16(ea.id,(ea.off+2)&0xffff);
                this._farTransfer(ip,selector,ea.reg===3);
                return ea.reg===3?28:15;
            }
            this._pmFault(6, 0, 'unsupported FE/FF group');
        }
        if (op === 0xf6 || op === 0xf7) {
            const word = !!(op & 1), ea = this._pmModRM();
            if (ea.reg === 0) {
                const immediate = word ? this._pmFetch16() : this._pmFetch8();
                this._logic(this._pmOperandRead(ea, word) & immediate, word);
                return ea.isReg ? 5 : 11;
            }
            if (ea.reg === 2 || ea.reg === 3) {
                if (ea.reg === 3) this._pmPreflightWrite(ea, word);
                else this._pmPreflightWrite(ea, word);
                const value = this._pmOperandRead(ea, word);
                const result = ea.reg === 2 ? ~value : this._sub(0, value, 0, word);
                this._pmOperandWrite(ea, word, result);
                return ea.isReg ? 3 : 16;
            }
            throw new UnsupportedProtectedMode('F6/F7 multiply/divide group');
        }
        if (op === 0xd0 || op === 0xd1 || op === 0xd2 || op === 0xd3 || op === 0xc0 || op === 0xc1) {
            const word = !!(op & 1), ea = this._pmModRM();
            const count = op === 0xc0 || op === 0xc1 ? this._pmFetch8() & 31 :
                op === 0xd2 || op === 0xd3 ? this.cl & 31 : 1;
            this._pmPreflightWrite(ea, word);
            const value = this._pmOperandRead(ea, word);
            this._pmOperandWrite(ea, word, this._shift(ea.reg, value, count, word));
            return ea.isReg ? 2 : 15;
        }
        if (op === 0xe8) {
            const displacement = this._pmFetch16();
            const signed = displacement & 0x8000 ? displacement - 0x10000 : displacement;
            const target = (this.ip + signed) & 0xffff;
            this._pmCheckCodeOffset(target);
            this._pmPush(this.ip);
            this.ip = target;
            return 19;
        }
        if (op === 0xc3 || op === 0xc2) {
            const extra = op === 0xc2 ? this._pmFetch16() : 0;
            const target = this._pmPop();
            this._pmCheckCodeOffset(target);
            this.sp = (this.sp + extra) & 0xffff;
            this.ip = target;
            return 16;
        }
        if (op >= 0x70 && op <= 0x7f) {
            const displacement = this._pmFetchS8();
            if (this._pmCondition(op & 15)) {
                const target = (this.ip + displacement) & 0xffff;
                this._pmCheckCodeOffset(target);
                this.ip = target;
            }
            return 4;
        }
        if (op >= 0xe0 && op <= 0xe3) {
            const displacement = this._pmFetchS8();
            let take;
            if (op === 0xe3) take = this.cx === 0;
            else {
                this.cx = (this.cx - 1) & 0xffff;
                take = this.cx !== 0 && (op === 0xe2 || (op === 0xe1 ? !!(this.flags & ZF) : !(this.flags & ZF)));
            }
            if (take) {
                const target = (this.ip + displacement) & 0xffff;
                this._pmCheckCodeOffset(target);
                this.ip = target;
            }
            return 5;
        }
        if (op === 0x90) return 3;
        if (op === 0xf5) { this.flags ^= CF; return 2; }
        if (op === 0xf8) { this.flags &= ~CF; return 2; }
        if (op === 0xf9) { this.flags |= CF; return 2; }
        if (op === 0xfa || op === 0xfb) {
            this._pmCheckIOPrivilege(op === 0xfa ? 'CLI' : 'STI');
            if (op === 0xfa) this.flags &= ~IF;
            else { this.flags |= IF; this._pmStiShadow = 1; }
            return 2;
        }
        if (op === 0xfc) { this.flags &= ~DF; return 2; }
        if (op === 0xfd) { this.flags |= DF; return 2; }
        if (op >= 0xe4 && op <= 0xe7) {
            const port = this._pmFetch8(); this._pmIO(op, port); return 10;
        }
        if (op >= 0xec && op <= 0xef) { this._pmIO(op, this.dx); return 8; }
        if (op === 0xf4) {
            if (this.cpl !== 0) this._pmFault(13, 0, 'HLT requires CPL 0');
            this.halted = true;
            return 2;
        }
        throw new UnsupportedProtectedMode(`opcode ${op.toString(16).padStart(2, '0')}`);
    }

    _pmFetch8() {
        if (this._pmBytes++ >= 10) this._pmFault(13, 0, 'instruction exceeds 10 bytes');
        // IP is a 16-bit register, but wrapping it while decoding one
        // instruction would turn the byte after CS:FFFF into CS:0000.  The
        // 286 checks the logical instruction-stream offset against the cached
        // CS limit instead and faults before that wrapped fetch occurs.
        const logicalOffset = this._instrStartIp + this._pmBytes - 1;
        if (logicalOffset > 0xffff) this._pmFault(13, 0, 'instruction crosses segment end');
        const a = this._linear(SEG_CS, logicalOffset, 1, 'fetch');
        if (this.busTrace !== null) this.busTrace.push(0, a);
        const value = this.fetch(a) & 0xff; this.ip = (logicalOffset + 1) & 0xffff; return value;
    }
    _pmFetch16() { return this._pmFetch8() | (this._pmFetch8() << 8); }
    _pmFetchS8() { const v = this._pmFetch8(); return v & 0x80 ? v - 0x100 : v; }

    _pmString(op) {
        const word = !!(op & 1), width = word ? 2 : 1;
        if (this._pmRep && this.cx === 0) return 5;
        const sourceId = this._pmOverride ?? SEG_DS;
        const kind = op & 0xfe;
        if (kind === 0xa4) {
            this._linear(sourceId, this.si, width, 'read');
            this._linear(SEG_ES, this.di, width, 'write');
            const value = word ? this._rd16(sourceId, this.si) : this._rd8(sourceId, this.si);
            if (word) this._wr16(SEG_ES, this.di, value); else this._wr8(SEG_ES, this.di, value);
        } else if (kind === 0xa6) {
            this._linear(sourceId, this.si, width, 'read');
            this._linear(SEG_ES, this.di, width, 'read');
            const source = word ? this._rd16(sourceId, this.si) : this._rd8(sourceId, this.si);
            const target = word ? this._rd16(SEG_ES, this.di) : this._rd8(SEG_ES, this.di);
            this._sub(source, target, 0, word);
        } else if (kind === 0xaa) {
            this._linear(SEG_ES, this.di, width, 'write');
            if (word) this._wr16(SEG_ES, this.di, this.ax); else this._wr8(SEG_ES, this.di, this.al);
        } else if (kind === 0xac) {
            this._linear(sourceId, this.si, width, 'read');
            const value = word ? this._rd16(sourceId, this.si) : this._rd8(sourceId, this.si);
            if (word) this.ax = value; else this.al = value;
        } else {
            this._linear(SEG_ES, this.di, width, 'read');
            const target = word ? this._rd16(SEG_ES, this.di) : this._rd8(SEG_ES, this.di);
            this._sub(word ? this.ax : this.al, target, 0, word);
        }
        const delta = this.flags & DF ? -width : width;
        if (kind === 0xa4 || kind === 0xa6 || kind === 0xac) this.si = (this.si + delta) & 0xffff;
        if (kind === 0xa4 || kind === 0xa6 || kind === 0xaa || kind === 0xae) this.di = (this.di + delta) & 0xffff;
        if (this._pmRep) {
            this.cx = (this.cx - 1) & 0xffff;
            const compare = kind === 0xa6 || kind === 0xae;
            const condition = !compare || (this._pmRep === 0xf3 ? !!(this.flags & ZF) : !(this.flags & ZF));
            if (this.cx !== 0 && condition) {
                this.ip = this._instrStartIp;
                this._pmRepContinues = true;
            }
        }
        return 5;
    }

    _pmCheckIOPrivilege(operation) {
        const iopl = (this.flags >> 12) & 3;
        if (this.cpl > iopl) this._pmFault(13, 0, `${operation} exceeds IOPL`);
    }

    _pmIO(op, port) {
        this._pmCheckIOPrivilege('I/O');
        const word = !!(op & 1), output = !!(op & 2);
        port &= 0xffff;
        if (output) {
            this.outPort(port, this.al);
            if (word) this.outPort((port + 1) & 0xffff, this.ah);
        } else if (word) {
            this.ax = (this.inPort(port) & 0xff) | ((this.inPort((port + 1) & 0xffff) & 0xff) << 8);
        } else this.al = this.inPort(port) & 0xff;
    }

    _pmSystem(op) {
        if (op !== 0x00 && op !== 0x01) throw new UnsupportedProtectedMode(`0F ${op.toString(16).padStart(2,'0')}`);
        const ea = this._pmModRM();
        if (op === 0x00) {
            if (ea.reg === 0 || ea.reg === 1) {
                this._pmOperandWrite(ea, true, ea.reg === 0 ? this.ldtr.selector : this.tr.selector);
                return ea.isReg ? 2 : 3;
            }
            if (ea.reg !== 2 && ea.reg !== 3) throw new UnsupportedProtectedMode('0F 00 verification operation');
            if (this.cpl !== 0) this._pmFault(13, 0, ea.reg === 2 ? 'LLDT privilege' : 'LTR privilege');
            const selector = this._pmOperandRead(ea, true);
            if (ea.reg === 2 && (selector & 0xfffc) === 0) {
                this.ldtr = {selector:selector&0xffff,valid:false,base:0,limit:0};
                return 17;
            }
            const raw = this._rawDescriptor(selector,{gdtOnly:true});
            const type = raw.access & 0x1f;
            if (ea.reg === 2) {
                if (type !== 2) this._pmFault(13, selector & 0xfffc, 'LLDT requires LDT descriptor');
                if (!(raw.access & 0x80)) this._pmFault(11, selector & 0xfffc, 'LDT not present');
                this.ldtr={selector:selector&0xffff,valid:true,base:raw.base,limit:raw.limit};
            } else {
                if (type !== 1) this._pmFault(13, selector & 0xfffc, 'LTR requires available 286 TSS');
                if (!(raw.access & 0x80)) this._pmFault(11, selector & 0xfffc, 'TSS not present');
                const accessAddress=(raw.address+5)&0xffffff;
                if(this.busTrace!==null)this.busTrace.push(2,accessAddress);
                this.write(accessAddress,raw.access|2);
                this.tr={selector:selector&0xffff,valid:true,base:raw.base,limit:raw.limit};
            }
            return 17;
        }
        if (ea.reg === 4) { this._pmOperandWrite(ea,true,this.msw); return 2; }
        if (ea.reg === 6) {
            if (this.cpl !== 0) this._pmFault(13,0,'LMSW privilege');
            this.msw=(this._pmOperandRead(ea,true)|(this.msw&1))&0xffff;return 3;
        }
        if (ea.reg > 3) this._pmFault(6,0,'invalid 0F 01 group');
        if (ea.isReg) this._pmFault(6,0,'descriptor table instruction requires memory');
        const load=ea.reg>=2;
        if (load&&this.cpl!==0)this._pmFault(13,0,ea.reg===2?'LGDT privilege':'LIDT privilege');
        this._linear(ea.id,ea.off,6,load?'read':'write');
        if (load) {
            const limit=this._rd16(ea.id,ea.off),base=this._rd16(ea.id,(ea.off+2)&0xffff)|this._rd8(ea.id,(ea.off+4)&0xffff)<<16;
            if(ea.reg===2)this.gdtr={limit,base:base>>>0};else this.idtr={limit,base:base>>>0};
        } else {
            const table=ea.reg===0?this.gdtr:this.idtr;
            this._wr16(ea.id,ea.off,table.limit);this._wr16(ea.id,(ea.off+2)&0xffff,table.base);this._wr8(ea.id,(ea.off+4)&0xffff,table.base>>16);
            this._wr8(ea.id,(ea.off+5)&0xffff,0xff);
        }
        return 11;
    }

    _pmModRM() {
        const byte=this._pmFetch8(),mod=byte>>6,reg=(byte>>3)&7,rm=byte&7;
        if(mod===3)return{mod,reg,rm,isReg:true,id:null,off:0};
        let base=0,id=SEG_DS;
        switch(rm){
            case 0:base=this.bx+this.si;break;case 1:base=this.bx+this.di;break;
            case 2:base=this.bp+this.si;id=SEG_SS;break;case 3:base=this.bp+this.di;id=SEG_SS;break;
            case 4:base=this.si;break;case 5:base=this.di;break;
            case 6:if(mod===0)base=this._pmFetch16();else{base=this.bp;id=SEG_SS;}break;
            default:base=this.bx;
        }
        if(mod===1)base+=this._pmFetchS8();else if(mod===2)base+=this._pmFetch16();
        return{mod,reg,rm,isReg:false,id:this._pmOverride??id,off:base&0xffff};
    }
    _pmOperandRead(ea,word){return ea.isReg?(word?this._r16(ea.rm):this._r8(ea.rm)):
        (word?this._rd16(ea.id,ea.off):this._rd8(ea.id,ea.off));}
    _pmOperandWrite(ea,word,value){if(ea.isReg){if(word)this._r16set(ea.rm,value);else this._r8set(ea.rm,value);}
        else if(word)this._wr16(ea.id,ea.off,value);else this._wr8(ea.id,ea.off,value);}
    _pmPreflightWrite(ea,word){if(!ea.isReg)this._linear(ea.id,ea.off,word?2:1,'write');}
    _pmCheckCodeOffset(offset){if(offset>this.segmentCaches[SEG_CS].limit)this._pmFault(13,0,'near control transfer outside code segment');}
    _pmCondition(kind){const f=this.flags,cf=!!(f&CF),zf=!!(f&ZF),sf=!!(f&SF),of=!!(f&OF),pf=!!(f&PF);
        return [of,!of,cf,!cf,zf,!zf,cf||zf,!cf&&!zf,sf,!sf,pf,!pf,sf!==of,sf===of,zf||(sf!==of),!zf&&(sf===of)][kind];}
    _pmPush(value) { const sp = (this.sp - 2) & 0xffff; this._wr16(SEG_SS, sp, value); this.sp = sp; }
    _pmPop() { const value = this._rd16(SEG_SS, this.sp); this.sp = (this.sp + 2) & 0xffff; return value; }

    _readPhysical16(address) {
        address &= 0xffffff;
        if (this.busTrace !== null) this.busTrace.push(1, address, 1, (address + 1) & 0xffffff);
        return (this.read(address) & 0xff) | ((this.read((address + 1) & 0xffffff) & 0xff) << 8);
    }

    _callGate(selector,raw=this._rawDescriptor(selector)) {
        const type=raw.access&0x0f;
        if((raw.access&0x10)||type!==4)this._pmFault(13,selector&0xfffc,'far CALL requires code or 286 call gate');
        if(Math.max(this.cpl,selector&3)>((raw.access>>5)&3))this._pmFault(13,selector&0xfffc,'call gate privilege');
        if(!(raw.access&0x80))this._pmFault(11,selector&0xfffc,'call gate not present');
        if(raw.bytes[6]||raw.bytes[7])
            this._pmFault(13,selector&0xfffc,'malformed 286 call gate');
        return{offset:raw.bytes[0]|raw.bytes[1]<<8,selector:raw.bytes[2]|raw.bytes[3]<<8,
            words:raw.bytes[4]&31};
    }

    _farTransfer(offset,selector,call) {
        let descriptor,gate=null;
        const raw=this._rawDescriptor(selector);
        if(!(raw.access&0x10)) {
            gate=this._callGate(selector,raw);
            descriptor=this._descriptor(gate.selector,SEG_CS,{ignoreRpl:true});
            offset=gate.offset;
        } else descriptor=this._descriptor(selector,SEG_CS);
        const targetCpl=(descriptor.access>>5)&3;
        if(targetCpl>this.cpl||(!gate&&targetCpl!==this.cpl))
            this._pmFault(13,(gate?.selector??selector)&0xfffc,'far transfer privilege');
        if(!call){
            if(targetCpl!==this.cpl)this._pmFault(13,gate?.selector??selector,'far JMP cannot change privilege');
            if(offset>descriptor.limit)this._pmFault(13,0,'far transfer offset outside code segment');
            this._commitDescriptor(SEG_CS,descriptor);this.ip=offset;return;
        }
        const oldIp=this.ip,oldCs=this.cs,oldSs=this.ss,oldSp=this.sp;
        if(targetCpl===this.cpl){
            const newSp=(oldSp-4)&0xffff,frame=this._cacheAddress(this.segmentCaches[SEG_SS],newSp,4,12);
            if(offset>descriptor.limit)this._pmFault(13,0,'far transfer offset outside code segment');
            this._commitDescriptor(SEG_CS,descriptor);
            this._writeFrameWord(frame+2,oldCs);this._writeFrameWord(frame,oldIp);
            this.sp=newSp;this.ip=offset;return;
        }
        const stack=this._tssStack(targetCpl);
        let stackDescriptor;
        try{stackDescriptor=this._descriptor(stack.ss,SEG_SS,{privilegeCpl:targetCpl});}
        catch(e){if(e instanceof ProtectedModeFault){if(e.vector===11)e.vector=12;else if(e.vector===13)e.vector=10;}throw e;}
        const words=gate.words,bytes=8+words*2,newSp=(stack.sp-bytes)&0xffff;
        const frame=this._cacheAddress(stackDescriptor,newSp,bytes,12);
        if(words)this._linear(SEG_SS,oldSp,words*2,'read');
        const params=Array.from({length:words},(_,i)=>this._rd16(SEG_SS,(oldSp+i*2)&0xffff));
        if(offset>descriptor.limit)this._pmFault(13,0,'far transfer offset outside code segment');
        descriptor.selector=(gate.selector&0xfffc)|targetCpl;
        this._commitDescriptor(SEG_SS,stackDescriptor);this._commitDescriptor(SEG_CS,descriptor);
        this._writeFrameWord(frame+bytes-2,oldSs);this._writeFrameWord(frame+bytes-4,oldSp);
        for(let i=0;i<words;i++)this._writeFrameWord(frame+4+i*2,params[i]);
        this._writeFrameWord(frame+2,oldCs);this._writeFrameWord(frame,oldIp);
        this.cpl=targetCpl;this.sp=newSp;this.ip=offset;
    }

    _farReturn(discard) {
        discard&=0xffff;
        this._linear(SEG_SS,this.sp,4,'read');
        const ip=this._rd16(SEG_SS,this.sp),selector=this._rd16(SEG_SS,(this.sp+2)&0xffff);
        const newCpl=selector&3;
        if(newCpl<this.cpl)this._pmFault(13,selector&0xfffc,'far RET cannot return inward');
        if(newCpl===this.cpl){
            const descriptor=this._descriptor(selector,SEG_CS,{privilegeCpl:newCpl});
            if(ip>descriptor.limit)this._pmFault(13,0,'far RET offset outside code segment');
            this._commitDescriptor(SEG_CS,descriptor);this.ip=ip;this.sp=(this.sp+4+discard)&0xffff;return;
        }
        const frameBytes=8+discard;
        this._linear(SEG_SS,this.sp,frameBytes,'read');
        const outerSp=this._rd16(SEG_SS,(this.sp+4+discard)&0xffff);
        const outerSs=this._rd16(SEG_SS,(this.sp+6+discard)&0xffff);
        const descriptor=this._descriptor(selector,SEG_CS,{privilegeCpl:newCpl});
        if(ip>descriptor.limit)this._pmFault(13,0,'far RET offset outside code segment');
        let stackDescriptor;
        try{stackDescriptor=this._descriptor(outerSs,SEG_SS,{privilegeCpl:newCpl});}
        catch(e){if(e instanceof ProtectedModeFault&&e.vector===11)e.vector=12;throw e;}
        this._commitDescriptor(SEG_CS,descriptor);this._commitDescriptor(SEG_SS,stackDescriptor);
        this.cpl=newCpl;this.ip=ip;this.sp=(outerSp+discard)&0xffff;
        this._invalidateOuterDataSegments(newCpl);
    }

    _gate(vector, software, external) {
        vector &= 0xff;
        const errorCode = (vector << 3) | 2 | (external ? 1 : 0), offset = vector << 3;
        if (offset + 7 > this.idtr.limit) this._pmFault(13, errorCode, 'IDT vector outside limit');
        const address = (this.idtr.base + offset) & 0xffffff;
        const targetOffset = this._readPhysical16(address);
        const selector = this._readPhysical16(address + 2);
        const reserved = this._readPhysical16(address + 4);
        const tail = this._readPhysical16(address + 6);
        const access = (reserved >> 8) & 0xff, type = access & 0x1f, dpl = (access >> 5) & 3;
        if ((reserved & 0xff) || tail) throw new UnsupportedProtectedMode('nonzero 286 IDT gate reserved fields');
        if (type === 5) throw new UnsupportedProtectedMode('task gates');
        if (type !== 6 && type !== 7) this._pmFault(13, errorCode, 'unsupported IDT gate type');
        if (software && this.cpl > dpl) this._pmFault(13, errorCode, 'software interrupt gate privilege');
        if (!(access & 0x80)) this._pmFault(11, errorCode, 'IDT gate not present');
        return {selector, offset:targetOffset, interrupt:type === 6};
    }

    _writeFrameWord(address, value) {
        address &= 0xffffff;
        if (this.busTrace !== null) this.busTrace.push(2, address, 2, (address + 1) & 0xffffff);
        this.write(address, value & 0xff); this.write((address + 1) & 0xffffff, (value >> 8) & 0xff);
    }

    _cacheAddress(cache, offset, width, vector=12) {
        offset &= 0xffff;
        if (cache.usable === false || offset + width - 1 > cache.limit)
            this._pmFault(vector, 0, 'privilege stack frame outside limit');
        return (cache.base + offset) & 0xffffff;
    }

    _tssStack(level,external=false) {
        const ext=external?1:0;
        if (!this.tr.valid) this._pmFault(10, ext, 'invalid task register for privilege entry');
        const offset=2+4*level;
        if(offset+3>this.tr.limit)this._pmFault(10,(this.tr.selector&0xfffc)|ext,'TSS stack pointer outside limit');
        const sp=this._readPhysical16(this.tr.base+offset),ss=this._readPhysical16(this.tr.base+offset+2);
        return{sp,ss};
    }

    _deliverProtected(vector, {software=false, external=false, returnIp=this.ip, errorCode=null} = {}) {
        if (!this.deliverProtectedFaults) throw new UnsupportedProtectedMode('interrupt/IDT delivery');
        if (this._deliveringProtected) throw new UnsupportedProtectedMode('nested exception/double-fault delivery');
        this._deliveringProtected = true;
        try {
            const gate = this._gate(vector, software, external);
            let descriptor;
            try { descriptor = this._descriptor(gate.selector, SEG_CS, {ignoreRpl:true}); }
            catch (e) {
                if (external && e instanceof ProtectedModeFault) e.errorCode |= 1;
                throw e;
            }
            const targetCpl=(descriptor.access>>5)&3;
            if(targetCpl>this.cpl)this._pmFault(13,(gate.selector&0xfffc)|(external?1:0),'gate target less privileged than caller');
            descriptor.selector=(gate.selector&0xfffc)|targetCpl;
            const pushesError = errorCode !== null, inner=targetCpl<this.cpl;
            const bytes = (inner ? 10 : 6) + (pushesError ? 2 : 0);
            let stackDescriptor=this.segmentCaches[SEG_SS],stackSelector=this.ss,stackTop=this.sp;
            if(inner){
                const stack=this._tssStack(targetCpl,external);stackSelector=stack.ss;stackTop=stack.sp;
                try{stackDescriptor=this._descriptor(stack.ss,SEG_SS,{privilegeCpl:targetCpl});}
                catch(e){if(e instanceof ProtectedModeFault){
                    if(e.vector===11)e.vector=12;else if(e.vector===13)e.vector=10;
                    e.errorCode=(stack.ss&0xfffc)|(external?1:0);
                }throw e;}
            }
            const newSp=(stackTop-bytes)&0xffff;
            const frameAddress=this._cacheAddress(stackDescriptor,newSp,bytes,12);
            if (gate.offset > descriptor.limit) this._pmFault(13, 0, 'gate offset outside code segment');
            const savedFlags = this.flags, savedCs = this.cs, savedSs=this.ss, savedSp=this.sp;
            let nextFlags = savedFlags & ~(TF | NT);
            if (gate.interrupt) nextFlags &= ~IF;
            if(inner)this._commitDescriptor(SEG_SS,stackDescriptor);
            this._commitDescriptor(SEG_CS, descriptor);
            // Preserve the architectural bus order after the whole frame has
            // been preflighted: FLAGS, CS, IP, then the optional error code.
            if(inner){this._writeFrameWord(frameAddress+bytes-2,savedSs);this._writeFrameWord(frameAddress+bytes-4,savedSp);}
            const commonTop=inner?bytes-4:bytes;
            this._writeFrameWord(frameAddress + commonTop - 2, savedFlags);
            this._writeFrameWord(frameAddress + commonTop - 4, savedCs);
            this._writeFrameWord(frameAddress + commonTop - 6, returnIp);
            if (pushesError) this._writeFrameWord(frameAddress, errorCode);
            this.cpl=targetCpl;this.sp = newSp; this.ip = gate.offset; this.flags = nextFlags;
            this.halted = false; this.intShadow = 0; this._pmStiShadow = 0;
        } finally { this._deliveringProtected = false; }
    }

    _iretProtected() {
        if (!this.deliverProtectedFaults) throw new UnsupportedProtectedMode('IRET/IDT delivery');
        if (this.flags & NT) throw new UnsupportedProtectedMode('nested-task IRET');
        if (this.sp > 0xfffa) this._pmFault(12, 0, 'IRET frame wraps stack');
        this._linear(SEG_SS, this.sp, 6, 'read');
        const ip = this._rd16(SEG_SS, this.sp);
        const selector = this._rd16(SEG_SS, this.sp + 2);
        const flags = this._rd16(SEG_SS, this.sp + 4);
        const oldCpl=this.cpl,newCpl=selector&3;
        if(newCpl<oldCpl)this._pmFault(13,selector&0xfffc,'IRET cannot return inward');
        if(newCpl>oldCpl)this._linear(SEG_SS,this.sp,10,'read');
        const descriptor = this._descriptor(selector, SEG_CS,{privilegeCpl:newCpl});
        if (ip > descriptor.limit) this._pmFault(13, 0, 'IRET offset outside code segment');
        if(newCpl>oldCpl){
            const outerSp=this._rd16(SEG_SS,this.sp+6),outerSs=this._rd16(SEG_SS,this.sp+8);
            let stackDescriptor;
            try{stackDescriptor=this._descriptor(outerSs,SEG_SS,{privilegeCpl:newCpl});}
            catch(e){if(e instanceof ProtectedModeFault&&e.vector===11)e.vector=12;throw e;}
            this._commitDescriptor(SEG_CS,descriptor);this._commitDescriptor(SEG_SS,stackDescriptor);
            this.cpl=newCpl;this.sp=outerSp;this.ip=ip;
            this.flags=this._pmReturnFlags(flags,oldCpl);
            this._invalidateOuterDataSegments(newCpl);
            return;
        }
        this._commitDescriptor(SEG_CS, descriptor);
        this.sp = (this.sp + 6) & 0xffff; this.ip = ip;
        this.flags = this._pmReturnFlags(flags,oldCpl);
    }

    _pmReturnFlags(value,oldCpl){
        const old=this.flags,oldIopl=(old>>12)&3;let next=(value|2)&~0x8028;
        if(oldCpl!==0)next=(next&~0x3000)|(old&0x3000);
        if(oldCpl>oldIopl)next=(next&~IF)|(old&IF);
        return next;
    }

    _invalidateOuterDataSegments(newCpl){
        for(const id of [SEG_DS,SEG_ES]){
            const cache=this.segmentCaches[id];if(!cache||cache.usable===false)continue;
            const dpl=(cache.access>>5)&3,rpl=cache.selector&3;
            const table=(cache.selector&4)?this.ldtr:this.gdtr,offset=cache.selector&0xfff8;
            const outsideTable=!table.valid&&!!(cache.selector&4)||offset+7>table.limit;
            if(outsideTable||((!cache.code||!(cache.access&4))&&Math.max(newCpl,rpl)>dpl))this._commitDescriptor(id,{selector:0,base:0,limit:0,access:0,
                code:false,writable:false,readable:false,usable:false});
        }
    }

    step() {
        if (!(this.msw & 1)) return super.step();
        if (this.halted) return 0;
        const snapshot = this.getProtectedState();
        if ((this.msw & 1) && (this.flags & TF)) {
            throw new UnsupportedProtectedMode('trap/IDT delivery');
        }
        try {
            this._instrStartIp = this.ip;
            const priorShadow = this.intShadow;
            const priorStiShadow = this._pmStiShadow;
            this.intShadow = 0;
            this._pmStiShadow = 0;
            this._pmOverride = null;
            this._pmRep = 0;
            this._pmRepContinues = false;
            this._pmBytes = 0;
            let op = this._pmFetch8();
            while (op === 0x26 || op === 0x2e || op === 0x36 || op === 0x3e || op === 0xf2 || op === 0xf3) {
                if (op === 0xf2 || op === 0xf3) this._pmRep = op;
                else this._pmOverride = op === 0x26 ? SEG_ES : op === 0x2e ? SEG_CS : op === 0x36 ? SEG_SS : SEG_DS;
                op = this._pmFetch8();
            }
            if (this._pmRep && (op < 0xa4 || op > 0xaf || op === 0xa8 || op === 0xa9))
                throw new UnsupportedProtectedMode('REP on non-string instruction');
            if (this._pmRep && this.cx !== 0 && (this.flags & IF) && !priorShadow && !priorStiShadow && this.intPending()) {
                this.ip = this._instrStartIp;
                return 0;
            }
            const cycles = this._execProtected(op);
            if (this._pmRepContinues) this.intShadow = priorShadow;
            this.cycles += cycles; return cycles;
        }
        catch (e) {
            if (e instanceof ProtectedModeFault) {
                this.setProtectedState(snapshot);
                e.restartIp = snapshot.ip;
                if (this.deliverProtectedFaults) {
                    try {
                        this._deliverProtected(e.vector, {returnIp:snapshot.ip,
                            errorCode:ERROR_CODE_VECTORS.has(e.vector) ? e.errorCode : null});
                        return 0;
                    } catch (nested) {
                        this.setProtectedState(snapshot);
                        throw new UnsupportedProtectedMode(`nested exception/double-fault delivery after #${e.vector}: ${nested.message}`);
                    }
                }
            } else if (e instanceof UnsupportedProtectedMode) {
                this.setProtectedState(snapshot);
            }
            throw e;
        }
    }

    _fault(vector) {
        if (!(this.msw & 1)) return super._fault(vector);
        if (vector === 1) throw new UnsupportedProtectedMode('trap/IDT delivery after PE transition');
        if (this.deliverProtectedFaults) return this._deliverProtected(vector, {returnIp:this.ip});
        this._pmFault(vector, 0, 'IDT exception delivery is not implemented');
    }

    _interrupt(n) {
        if (!(this.msw & 1)) return super._interrupt(n);
        if (this.deliverProtectedFaults) return this._deliverExternal(n);
        throw new UnsupportedProtectedMode('interrupt/IDT delivery after PE transition');
    }

    interrupt(n) {
        if (!(this.msw & 1)) return super.interrupt(n);
        if (this.deliverProtectedFaults) return this._deliverExternal(n);
        throw new UnsupportedProtectedMode('interrupt/IDT delivery');
    }

    _deliverExternal(n) {
        const resumeIp = this.ip;
        try { return this._deliverProtected(n, {external:true, returnIp:resumeIp}); }
        catch (e) {
            // External entry occurs between instructions. A malformed gate is
            // surfaced diagnostically, so its restart context is the currently
            // suspended IP rather than the last decoder's _instrStartIp.
            if (e instanceof ProtectedModeFault) e.restartIp = resumeIp;
            throw e;
        }
    }

    getProtectedState() {
        const words = ['ax','bx','cx','dx','sp','bp','si','di','ip','cs','ds','es','ss','flags','msw'];
        const state = Object.fromEntries(words.map((key) => [key, this[key]]));
        state.gdtr = {...this.gdtr}; state.idtr = {...this.idtr}; state.cpl = this.cpl;
        state.ldtr = {...this.ldtr}; state.tr = {...this.tr};
        state.segmentCaches = Object.fromEntries(Object.entries(this.segmentCaches ?? {}).map(([id, cache]) => [id, {...cache}]));
        state.halted = this.halted; state.cycles = this.cycles; state.intShadow = this.intShadow;
        state.pmStiShadow = this._pmStiShadow;
        return state;
    }

    setProtectedState(state) {
        for (const key of ['ax','bx','cx','dx','sp','bp','si','di','ip','cs','ds','es','ss','flags','msw']) this[key] = state[key];
        this.gdtr = {...state.gdtr}; this.idtr = {...state.idtr}; this.cpl = state.cpl;
        this.ldtr = {...(state.ldtr??{selector:0,valid:false,base:0,limit:0})};
        this.tr = {...(state.tr??{selector:0,valid:false,base:0,limit:0})};
        this.segmentCaches = Object.fromEntries(Object.entries(state.segmentCaches).map(([id, cache]) => [id, {...cache}]));
        this.halted = state.halted; this.cycles = state.cycles; this.intShadow = state.intShadow;
        this._pmStiShadow = state.pmStiShadow ?? 0;
    }
}

export default ProtectedI80286;
