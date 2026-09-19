import I8086, {
    UnsupportedProtectedMode,
} from '../i8086.js';

/** Host-visible diagnostic fault.  IDT gate delivery is outside this first
 * protected-mode slice, so callers must not mistake this for architectural
 * exception delivery. */
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
const TF = 0x0100, IF = 0x0200, OF = 0x0800, NT = 0x4000;
const ERROR_CODE_VECTORS = new Set([11, 12, 13]);

/**
 * Experimental, deliberately bounded 80286 protected-mode executor.
 *
 * It implements ring-0, GDT-only, expand-up 16-bit code/data segments. It
 * executes enough real instructions to enter protected mode, prove cached
 * 24-bit addressing, and optionally deliver same-ring interrupt/trap gates.
 * Tasks, LDT, privilege changes, expand-down segments, and REP fail before
 * execution.
 */
export class ProtectedI80286 extends I8086 {
    constructor(bus, {deliverProtectedFaults = false} = {}) {
        super(bus, {variant: '80286'});
        this._protectedCapable = true;
        this.deliverProtectedFaults = !!deliverProtectedFaults;
        this._deliveringProtected = false;
    }

    reset() { super.reset(); this.cpl = 0; this._initRealCaches(); }

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

    _descriptor(selector, target, {ignoreRpl = false} = {}) {
        selector &= 0xffff;
        if (selector & 4) throw new UnsupportedProtectedMode('LDT selectors');
        const offset = selector & 0xfff8;
        if (!offset && target !== SEG_CS && target !== SEG_SS) throw new UnsupportedProtectedMode('null data selectors');
        if (!offset || offset + 7 > this.gdtr.limit) this._pmFault(13, selector & 0xfffc, 'selector outside GDT');
        const a = (this.gdtr.base + offset) & 0xffffff;
        const b = Array.from({length: 8}, (_, i) => {
            const address = (a + i) & 0xffffff;
            if (this.busTrace !== null) this.busTrace.push(1, address);
            return this.read(address) & 0xff;
        });
        const access = b[5];
        const present = !!(access & 0x80), dpl = (access >> 5) & 3;
        const code = !!(access & 8), writable = !code && !!(access & 2);
        const readable = !code || !!(access & 2), expandDown = !code && !!(access & 4);
        if (!(access & 0x10)) throw new UnsupportedProtectedMode('system descriptors');
        if (dpl !== 0 || (!ignoreRpl && (selector & 3) !== 0) || this.cpl !== 0) throw new UnsupportedProtectedMode('privilege levels other than ring 0');
        if (expandDown) throw new UnsupportedProtectedMode('expand-down segments');
        if (target === SEG_CS && (access & 4)) throw new UnsupportedProtectedMode('conforming code segments');
        if (target === SEG_CS && !code) this._pmFault(13, selector & 0xfffc, 'far jump requires code');
        if (target === SEG_SS && (code || !writable)) this._pmFault(13, selector & 0xfffc, 'SS requires writable data');
        if ((target === SEG_DS || target === SEG_ES) && code && !readable) this._pmFault(13, selector & 0xfffc, 'unreadable code data segment');
        if (!present) this._pmFault(target === SEG_SS ? 12 : 11, selector & 0xfffc, 'segment not present');
        return {selector:ignoreRpl ? (selector & 0xfffc) | this.cpl : selector,
            base: (b[2] | (b[3] << 8) | (b[4] << 16)) >>> 0,
            limit: b[0] | (b[1] << 8), access: access | 1, code, writable, readable,
            descriptorAccessAddress: a + 5, accessedWasSet: !!(access & 1)};
    }

    _commitDescriptor(target, descriptor) {
        // The 286 sets A in the in-memory descriptor when it loads a segment.
        // All validation has completed before this sole visible side effect.
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
        if (op === 0xea) {
            const ip = this._pmFetch16(), selector = this._pmFetch16();
            const descriptor = this._descriptor(selector, SEG_CS);
            if (ip > descriptor.limit) this._pmFault(13, 0, 'far-jump offset outside code segment');
            this._commitDescriptor(SEG_CS, descriptor);
            this.ip = ip;
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
        if (op === 0x8c) {
            const ea=this._pmModRM();if(ea.reg>3)this._pmFault(6,0,'invalid MOV from segment register');
            this._pmOperandWrite(ea,true,[this.es,this.cs,this.ss,this.ds][ea.reg]);return ea.isReg?2:9;
        }
        if (op === 0x8d) {
            const ea=this._pmModRM();if(ea.isReg)this._pmFault(6,0,'LEA requires memory operand');
            this._r16set(ea.reg,ea.off);return 3;
        }
        if (op === 0x84 || op === 0x85) {
            const word=!!(op&1),ea=this._pmModRM();
            this._logic(this._pmOperandRead(ea,word)&(word?this._r16(ea.reg):this._r8(ea.reg)),word);return ea.isReg?3:9;
        }
        if (op === 0xa8 || op === 0xa9) {
            const word=!!(op&1),immediate=word?this._pmFetch16():this._pmFetch8();
            this._logic((word?this.ax:this.al)&immediate,word);return 4;
        }
        if (op >= 0xa0 && op <= 0xa3) {
            const word=!!(op&1),write=!!(op&2),off=this._pmFetch16(),id=this._pmOverride??SEG_DS;
            if(write)word?this._wr16(id,off,this.ax):this._wr8(id,off,this.al);
            else if(word)this.ax=this._rd16(id,off);else this.al=this._rd8(id,off);
            return 10;
        }
        if (op === 0xc6 || op === 0xc7) {
            const word=!!(op&1),ea=this._pmModRM();if(ea.reg!==0)this._pmFault(6,0,'invalid MOV immediate group');
            const value=word?this._pmFetch16():this._pmFetch8();this._pmOperandWrite(ea,word,value);return ea.isReg?4:10;
        }
        if (op === 0x80 || op === 0x81 || op === 0x83) {
            const word=!!(op&1),ea=this._pmModRM();
            if(ea.reg!==7)this._pmPreflightWrite(ea,word);
            const a=this._pmOperandRead(ea,word);
            const b=op===0x81?this._pmFetch16():op===0x83?(this._pmFetchS8()&0xffff):this._pmFetch8();
            const result=this._alu(ea.reg,a,b,word);if(ea.reg!==7)this._pmOperandWrite(ea,word,result);
            return ea.isReg?4:17;
        }
        if (op === 0xfe || op === 0xff) {
            const word=!!(op&1),ea=this._pmModRM();
            if(ea.reg<=1){this._pmPreflightWrite(ea,word);const v=this._pmOperandRead(ea,word);
                this._pmOperandWrite(ea,word,ea.reg?this._dec(v,word):this._inc(v,word));return ea.isReg?3:15;}
            if(word&&ea.reg===2){const target=this._pmOperandRead(ea,true);this._pmCheckCodeOffset(target);this._pmPush(this.ip);this.ip=target;return 16;}
            if(word&&ea.reg===4){const target=this._pmOperandRead(ea,true);this._pmCheckCodeOffset(target);this.ip=target;return 11;}
            if(word&&ea.reg===6){this._pmPush(this._pmOperandRead(ea,true));return 11;}
            if(word&&(ea.reg===3||ea.reg===5))throw new UnsupportedProtectedMode('far FE/FF control transfer');
            this._pmFault(6,0,'unsupported FE/FF group');
        }
        if (op === 0xe8) {const d=this._pmFetch16(),s=d&0x8000?d-0x10000:d,target=(this.ip+s)&0xffff;
            this._pmCheckCodeOffset(target);this._pmPush(this.ip);this.ip=target;return 19;}
        if (op === 0xc3 || op === 0xc2) {const extra=op===0xc2?this._pmFetch16():0,target=this._pmPop();
            this._pmCheckCodeOffset(target);this.sp=(this.sp+extra)&0xffff;this.ip=target;return 16;}
        if (op >= 0x70 && op <= 0x7f) {const d=this._pmFetchS8();if(this._pmCondition(op&15)){const target=(this.ip+d)&0xffff;
            this._pmCheckCodeOffset(target);this.ip=target;}return 4;}
        if (op >= 0xe0 && op <= 0xe3) {const d=this._pmFetchS8();let take;
            if(op===0xe3)take=this.cx===0;else{this.cx=(this.cx-1)&0xffff;take=this.cx!==0&&(op===0xe2||(op===0xe1?!!(this.flags&ZF):!(this.flags&ZF)));}
            if(take){const target=(this.ip+d)&0xffff;this._pmCheckCodeOffset(target);this.ip=target;}return 5;}
        if (op === 0x90) return 3;
        if (op === 0xf4) { this.halted = true; return 2; }
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
            const pushesError = errorCode !== null;
            const bytes = pushesError ? 8 : 6;
            const newSp = (this.sp - bytes) & 0xffff;
            const frameAddress = this._linear(SEG_SS, newSp, bytes, 'write');
            if (gate.offset > descriptor.limit) this._pmFault(13, 0, 'gate offset outside code segment');
            const savedFlags = this.flags, savedCs = this.cs;
            let nextFlags = savedFlags & ~(TF | NT);
            if (gate.interrupt) nextFlags &= ~IF;
            this._commitDescriptor(SEG_CS, descriptor);
            // Preserve the architectural bus order after the whole frame has
            // been preflighted: FLAGS, CS, IP, then the optional error code.
            this._writeFrameWord(frameAddress + bytes - 2, savedFlags);
            this._writeFrameWord(frameAddress + bytes - 4, savedCs);
            this._writeFrameWord(frameAddress + bytes - 6, returnIp);
            if (pushesError) this._writeFrameWord(frameAddress, errorCode);
            this.sp = newSp; this.ip = gate.offset; this.flags = nextFlags;
            this.halted = false;
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
        const descriptor = this._descriptor(selector, SEG_CS);
        if (ip > descriptor.limit) this._pmFault(13, 0, 'IRET offset outside code segment');
        this._commitDescriptor(SEG_CS, descriptor);
        this.sp = (this.sp + 6) & 0xffff; this.ip = ip;
        this.flags = (flags | 0x0002) & ~0x8028;
    }

    step() {
        if (!(this.msw & 1)) return super.step();
        if (this.halted) return 0;
        const snapshot = this.getProtectedState();
        if ((this.msw & 1) && (this.flags & TF)) {
            throw new UnsupportedProtectedMode('trap/IDT delivery');
        }
        try {
            this._instrStartIp = this.ip; this.intShadow = 0; this._pmOverride = null; this._pmBytes = 0;
            let op = this._pmFetch8();
            while (op === 0x26 || op === 0x2e || op === 0x36 || op === 0x3e || op === 0xf2 || op === 0xf3) {
                if (op === 0xf2 || op === 0xf3) throw new UnsupportedProtectedMode('REP partial-progress semantics');
                this._pmOverride = op === 0x26 ? SEG_ES : op === 0x2e ? SEG_CS : op === 0x36 ? SEG_SS : SEG_DS;
                op = this._pmFetch8();
            }
            const cycles = this._execProtected(op);
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
        state.segmentCaches = Object.fromEntries(Object.entries(this.segmentCaches ?? {}).map(([id, cache]) => [id, {...cache}]));
        state.halted = this.halted; state.cycles = this.cycles; state.intShadow = this.intShadow;
        return state;
    }

    setProtectedState(state) {
        for (const key of ['ax','bx','cx','dx','sp','bp','si','di','ip','cs','ds','es','ss','flags','msw']) this[key] = state[key];
        this.gdtr = {...state.gdtr}; this.idtr = {...state.idtr}; this.cpl = state.cpl;
        this.segmentCaches = Object.fromEntries(Object.entries(state.segmentCaches).map(([id, cache]) => [id, {...cache}]));
        this.halted = state.halted; this.cycles = state.cycles; this.intShadow = state.intShadow;
    }
}

export default ProtectedI80286;
