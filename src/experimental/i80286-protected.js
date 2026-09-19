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

/**
 * Experimental, deliberately bounded 80286 protected-mode executor.
 *
 * It implements ring-0, GDT-only, expand-up 16-bit code/data segments.  It
 * executes enough real instructions to enter protected mode and prove cached
 * 24-bit addressing.  Gates, tasks, LDT, privilege changes, expand-down
 * segments, REP, and protected interrupt delivery fail before execution.
 */
export class ProtectedI80286 extends I8086 {
    constructor(bus) {
        super(bus, {variant: '80286'});
        this._protectedCapable = true;
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

    _descriptor(selector, target) {
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
        if (dpl !== 0 || (selector & 3) !== 0 || this.cpl !== 0) throw new UnsupportedProtectedMode('privilege levels other than ring 0');
        if (expandDown) throw new UnsupportedProtectedMode('expand-down segments');
        if (target === SEG_CS && (access & 4)) throw new UnsupportedProtectedMode('conforming code segments');
        if (target === SEG_CS && !code) this._pmFault(13, selector & 0xfffc, 'far jump requires code');
        if (target === SEG_SS && (code || !writable)) this._pmFault(13, selector & 0xfffc, 'SS requires writable data');
        if ((target === SEG_DS || target === SEG_ES) && code && !readable) this._pmFault(13, selector & 0xfffc, 'unreadable code data segment');
        if (!present) this._pmFault(target === SEG_SS ? 12 : 11, selector & 0xfffc, 'segment not present');
        return {selector, base: (b[2] | (b[3] << 8) | (b[4] << 16)) >>> 0,
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
        if (op === 0xea) {
            const ip = this._pmFetch16(), selector = this._pmFetch16();
            const descriptor = this._descriptor(selector, SEG_CS);
            if (ip > descriptor.limit) this._pmFault(13, 0, 'far-jump offset outside code segment');
            this._commitDescriptor(SEG_CS, descriptor);
            this.ip = ip;
            return 15;
        }
        if (op === 0x8e) {
            const modrm = this._pmFetch8(), mod = modrm >> 6, reg = (modrm >> 3) & 7, rm = modrm & 7;
            if (reg > 3 || reg === 1) this._pmFault(6, 0, 'invalid MOV segment register');
            if (mod !== 3) throw new UnsupportedProtectedMode('memory-form MOV segment');
            const target = [SEG_ES, SEG_CS, SEG_SS, SEG_DS][reg];
            this._sregSet(reg, this._r16(rm));
            if (target === SEG_SS) this.intShadow = 1;
            return 2;
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
        if (op >= 0x50 && op <= 0x57) { this._pmPush(this._r16(op & 7)); return 11; }
        if (op >= 0x58 && op <= 0x5f) { this._r16set(op & 7, this._pmPop()); return 8; }
        if (op >= 0x88 && op <= 0x8b) {
            const modrm = this._pmFetch8(), mod = modrm >> 6, reg = (modrm >> 3) & 7, rm = modrm & 7;
            const word = !!(op & 1), toReg = !!(op & 2);
            if (mod === 3) {
                const value = word ? this._r16(toReg ? rm : reg) : this._r8(toReg ? rm : reg);
                if (word) this._r16set(toReg ? reg : rm, value); else this._r8set(toReg ? reg : rm, value);
                return 2;
            }
            if (mod !== 0 || rm !== 6) throw new UnsupportedProtectedMode('non-direct ModR/M addressing');
            const offset = this._pmFetch16(), id = this._pmOverride ?? SEG_DS;
            if (toReg) {
                const value = word ? this._rd16(id, offset) : this._rd8(id, offset);
                if (word) this._r16set(reg, value); else this._r8set(reg, value);
            } else {
                const value = word ? this._r16(reg) : this._r8(reg);
                if (word) this._wr16(id, offset, value); else this._wr8(id, offset, value);
            }
            return 10;
        }
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
    _pmPush(value) { const sp = (this.sp - 2) & 0xffff; this._wr16(SEG_SS, sp, value); this.sp = sp; }
    _pmPop() { const value = this._rd16(SEG_SS, this.sp); this.sp = (this.sp + 2) & 0xffff; return value; }

    step() {
        if (!(this.msw & 1)) return super.step();
        if (this.halted) return 0;
        const snapshot = this.getProtectedState();
        if ((this.msw & 1) && (this.flags & 0x0100)) {
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
            const cycles = this._execProtected(op); this.cycles += cycles; return cycles;
        }
        catch (e) {
            if (e instanceof ProtectedModeFault || e instanceof UnsupportedProtectedMode) {
                this.setProtectedState(snapshot);
                if (e instanceof ProtectedModeFault) e.restartIp = snapshot.ip;
            }
            throw e;
        }
    }

    _fault(vector) {
        if (!(this.msw & 1)) return super._fault(vector);
        if (vector === 1) throw new UnsupportedProtectedMode('trap/IDT delivery after PE transition');
        this._pmFault(vector, 0, 'IDT exception delivery is not implemented');
    }

    _interrupt(n) {
        if (!(this.msw & 1)) return super._interrupt(n);
        throw new UnsupportedProtectedMode('interrupt/IDT delivery after PE transition');
    }

    interrupt(n) {
        if (!(this.msw & 1)) return super.interrupt(n);
        throw new UnsupportedProtectedMode('interrupt/IDT delivery');
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
