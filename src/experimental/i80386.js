/**
 * Bounded, opt-in 80386 executor.  This is a fresh 32-bit state model rather
 * than a widened view of the 16-bit production core.
 */
export class UnsupportedI80386 extends Error {}
export class I80386Fault extends Error {
  constructor(vector, errorCode = null, reason = "80386 fault") {
    super(reason);
    this.vector = vector;
    this.errorCode = errorCode;
  }
}

const CF = 1,
  PF = 4,
  AF = 0x10,
  ZF = 0x40,
  SF = 0x80,
  IF = 0x200,
  DF = 0x400,
  OF = 0x800;
const TF = 0x100,
  NT = 0x4000,
  RF = 0x10000;
const SEG_ES = 0,
  SEG_CS = 1,
  SEG_SS = 2,
  SEG_DS = 3,
  SEG_FS = 4,
  SEG_GS = 5;
const REG_NAMES = ["eax", "ecx", "edx", "ebx", "esp", "ebp", "esi", "edi"];

function parity8(v) {
  v &= 255;
  v ^= v >> 4;
  return ((0x6996 >>> (v & 15)) & 1) === 0;
}
function maskFor(width) {
  return width === 32 ? 0xffffffff : 2 ** width - 1;
}

export class ExperimentalI80386 {
  constructor(bus = {}, options = {}) {
    this.read = bus.read ?? (() => 0);
    this.fetch = bus.fetch ?? this.read;
    this.write = bus.write ?? (() => {});
    this.inPort = bus.inPort ?? (() => 0xff);
    this.outPort = bus.outPort ?? (() => {});
    this.deliverFaults = !!options.deliverFaults;
    this.reset();
    if (options.hardwareReset)
      this.hardwareReset({
        coprocessor: options.resetCoprocessor,
        stepping: options.resetStepping,
      });
  }

  hardwareReset({ coprocessor = "none", stepping = 0 } = {}) {
    if (!["none", "80287", "80387"].includes(coprocessor))
      throw new TypeError("reset coprocessor must be none, 80287, or 80387");
    if (!Number.isInteger(stepping) || stepping < 0 || stepping > 0xff)
      throw new TypeError("reset stepping must be an unsigned byte");
    this.reset();
    this._coprocessorProfile = coprocessor;
    // Bits 5..30 are undefined on the original 80386 and are deterministically
    // zero in this model. ERROR# selects ET; all other defined CR0 bits clear.
    this.cr0 = coprocessor === "80387" ? 0x10 : 0;
    this.edx = (0x300 | stepping) >>> 0;
    this.cs = 0xf000;
    this.eip = 0xfff0;
    this.segmentCaches[SEG_CS] = {
      base: 0xffff0000,
      limit: 0xffff,
      default32: false,
      present: true,
      code: true,
      readable: true,
      writable: false,
    };
    return this;
  }

  reset() {
    for (const r of REG_NAMES) this[r] = 0;
    this.eip = 0;
    this.eflags = 2;
    this.cr0 = 0;
    this.cr2 = 0;
    this.cr3 = 0;
    this._coprocessorProfile = "none";
    this.halted = false;
    this.cycles = 0;
    this.cs = 0;
    this.ds = 0;
    this.es = 0;
    this.ss = 0;
    this.fs = 0;
    this.gs = 0;
    this.gdtr = { base: 0, limit: 0 };
    this.idtr = { base: 0, limit: 0x3ff };
    this.ldtr = { selector: 0, base: 0, limit: 0, present: false };
    this.tr = { selector: 0, base: 0, limit: 0, present: false };
    this.shutdown = false;
    this._interruptShadow = 0;
    this._nmiShadow = 0;
    this._debugShadow = 0;
    this._nmiActive = false;
    this._repeatContext = null;
    this.segmentCaches = {};
    for (const id of [SEG_ES, SEG_CS, SEG_SS, SEG_DS, SEG_FS, SEG_GS])
      this.segmentCaches[id] = {
        base: 0,
        limit: 0xffff,
        default32: false,
        present: true,
        code: id === SEG_CS,
        writable: id !== SEG_CS,
      };
  }

  get protectedMode() {
    return !!(this.cr0 & 1);
  }
  get virtual8086() {
    return this.protectedMode && !!(this.eflags & 0x20000);
  }
  get currentPrivilegeLevel() {
    return this.virtual8086 ? 3 : this.protectedMode ? this.cs & 3 : 0;
  }
  get pc() {
    return (this.segmentCaches[SEG_CS].base + this.eip) >>> 0;
  }
  get flags() {
    return this.eflags & 0xffff;
  }
  set flags(v) {
    this.eflags = (this.eflags & 0xffff0000) | (v & 0xffff) | 2;
  }
  get ip() {
    return this.eip & 0xffff;
  }
  set ip(v) {
    this.eip = (this.eip & 0xffff0000) | (v & 0xffff);
  }
  get ax() {
    return this.eax & 0xffff;
  }
  set ax(v) {
    this.eax = ((this.eax & 0xffff0000) | (v & 0xffff)) >>> 0;
  }
  get cx() {
    return this.ecx & 0xffff;
  }
  set cx(v) {
    this.ecx = ((this.ecx & 0xffff0000) | (v & 0xffff)) >>> 0;
  }
  get dx() {
    return this.edx & 0xffff;
  }
  set dx(v) {
    this.edx = ((this.edx & 0xffff0000) | (v & 0xffff)) >>> 0;
  }
  get bx() {
    return this.ebx & 0xffff;
  }
  set bx(v) {
    this.ebx = ((this.ebx & 0xffff0000) | (v & 0xffff)) >>> 0;
  }
  get sp() {
    return this.esp & 0xffff;
  }
  set sp(v) {
    this.esp = ((this.esp & 0xffff0000) | (v & 0xffff)) >>> 0;
  }
  get bp() {
    return this.ebp & 0xffff;
  }
  set bp(v) {
    this.ebp = ((this.ebp & 0xffff0000) | (v & 0xffff)) >>> 0;
  }
  get si() {
    return this.esi & 0xffff;
  }
  set si(v) {
    this.esi = ((this.esi & 0xffff0000) | (v & 0xffff)) >>> 0;
  }
  get di() {
    return this.edi & 0xffff;
  }
  set di(v) {
    this.edi = ((this.edi & 0xffff0000) | (v & 0xffff)) >>> 0;
  }
  get al() {
    return this.eax & 255;
  }
  set al(v) {
    this.eax = ((this.eax & 0xffffff00) | (v & 255)) >>> 0;
  }
  get ah() {
    return (this.eax >>> 8) & 255;
  }
  set ah(v) {
    this.eax = ((this.eax & 0xffff00ff) | ((v & 255) << 8)) >>> 0;
  }
  get cl() {
    return this.ecx & 255;
  }
  set cl(v) {
    this.ecx = ((this.ecx & 0xffffff00) | (v & 255)) >>> 0;
  }
  get ch() {
    return (this.ecx >>> 8) & 255;
  }
  set ch(v) {
    this.ecx = ((this.ecx & 0xffff00ff) | ((v & 255) << 8)) >>> 0;
  }
  get dl() {
    return this.edx & 255;
  }
  set dl(v) {
    this.edx = ((this.edx & 0xffffff00) | (v & 255)) >>> 0;
  }
  get dh() {
    return (this.edx >>> 8) & 255;
  }
  set dh(v) {
    this.edx = ((this.edx & 0xffff00ff) | ((v & 255) << 8)) >>> 0;
  }
  get bl() {
    return this.ebx & 255;
  }
  set bl(v) {
    this.ebx = ((this.ebx & 0xffffff00) | (v & 255)) >>> 0;
  }
  get bh() {
    return (this.ebx >>> 8) & 255;
  }
  set bh(v) {
    this.ebx = ((this.ebx & 0xffff00ff) | ((v & 255) << 8)) >>> 0;
  }

  _reg(index, width) {
    const value = this[REG_NAMES[index]] >>> 0;
    return width === 32 ? value : value & 0xffff;
  }
  _setReg(index, width, value) {
    const n = REG_NAMES[index];
    this[n] =
      width === 32
        ? value >>> 0
        : ((this[n] & 0xffff0000) | (value & 0xffff)) >>> 0;
  }
  _reg8(index) {
    return index < 4
      ? this[REG_NAMES[index]] & 255
      : (this[REG_NAMES[index - 4]] >>> 8) & 255;
  }
  _setReg8(index, value) {
    const n = REG_NAMES[index & 3];
    this[n] =
      (index < 4
        ? (this[n] & 0xffffff00) | (value & 255)
        : (this[n] & 0xffff00ff) | ((value & 255) << 8)) >>> 0;
  }
  _segValue(id) {
    return [this.es, this.cs, this.ss, this.ds, this.fs, this.gs][id] & 0xffff;
  }
  _setSegValue(id, v) {
    const n = ["es", "cs", "ss", "ds", "fs", "gs"][id];
    this[n] = v & 0xffff;
  }
  _virtualSegmentCache(id, selector) {
    return {
      base: ((selector & 0xffff) << 4) >>> 0,
      limit: 0xffff,
      default32: false,
      present: true,
      code: id === SEG_CS,
      readable: true,
      writable: id !== SEG_CS,
    };
  }
  _linear(seg, off, size = 1) {
    const c = this.segmentCaches[seg];
    const end = off + size - 1;
    if (c?.null) throw new I80386Fault(13, 0, "use of null data selector");
    if (!c?.present)
      throw new I80386Fault(
        seg === SEG_SS ? 12 : 11,
        this._segValue(seg),
        "segment not present",
      );
    const outside = c.expandDown
      ? off <= c.limit || end > (c.default32 ? 0xffffffff : 0xffff)
      : end > c.limit;
    if (off < 0 || end < off || outside || end > 0xffffffff)
      throw new I80386Fault(seg === SEG_SS ? 12 : 13, 0, "segment limit fault");
    return (c.base + (off >>> 0)) >>> 0;
  }
  _readPhysical(a, size) {
    let v = 0;
    for (let i = 0; i < size; i++)
      v += (this.read((a + i) >>> 0) & 255) * 2 ** (8 * i);
    return v >>> 0;
  }
  _writePhysical(a, size, v) {
    for (let i = 0; i < size; i++)
      this.write((a + i) >>> 0, (v >>> (8 * i)) & 255);
  }
  _pageFault(linear, write, user, protection) {
    this.cr2 = linear >>> 0;
    throw new I80386Fault(
      14,
      (protection ? 1 : 0) | (write ? 2 : 0) | (user ? 4 : 0),
      protection ? "page protection fault" : "page not present",
    );
  }
  _translate(linear, { write = false, supervisor = false } = {}) {
    linear >>>= 0;
    if (!(this.cr0 & 0x80000000)) return linear;
    const user = !supervisor && this.currentPrivilegeLevel === 3;
    const pdeAddress =
      ((this.cr3 & 0xfffff000) + ((linear >>> 20) & 0xffc)) >>> 0;
    let pde = this._readPhysical(pdeAddress, 4);
    if (!(pde & 1)) this._pageFault(linear, write, user, false);
    if (!(pde & 0x20)) {
      pde |= 0x20;
      this._writePhysical(pdeAddress, 4, pde);
    }
    const pteAddress = ((pde & 0xfffff000) + ((linear >>> 10) & 0xffc)) >>> 0;
    let pte = this._readPhysical(pteAddress, 4);
    if (!(pte & 1)) this._pageFault(linear, write, user, false);
    const userPage = !!(pde & 4) && !!(pte & 4);
    const writable = !!(pde & 2) && !!(pte & 2);
    if ((user && !userPage) || (user && write && !writable))
      this._pageFault(linear, write, user, true);
    if (!(pte & 0x20)) {
      pte |= 0x20;
      this._writePhysical(pteAddress, 4, pte);
    }
    if (write && !(pte & 0x40)) {
      pte |= 0x40;
      this._writePhysical(pteAddress, 4, pte);
    }
    return ((pte & 0xfffff000) | (linear & 0xfff)) >>> 0;
  }
  _readLinear(a, size, options) {
    let value = 0;
    for (let i = 0; i < size; i++)
      value +=
        (this.read(this._translate((a + i) >>> 0, options)) & 255) *
        2 ** (8 * i);
    return value >>> 0;
  }
  _writeLinear(a, size, v, options) {
    const physical = Array.from({ length: size }, (_, i) =>
      this._translate((a + i) >>> 0, { ...options, write: true }),
    );
    for (let i = 0; i < size; i++)
      this.write(physical[i], (v >>> (8 * i)) & 255);
  }
  _read(seg, off, width) {
    const cache = this.segmentCaches[seg];
    if (this.protectedMode && !this.virtual8086 && cache.code && !cache.readable)
      throw new I80386Fault(13, 0, "read from execute-only segment");
    return this._readLinear(this._linear(seg, off, width >>> 3), width >>> 3);
  }
  _write(seg, off, width, v) {
    const cache = this.segmentCaches[seg];
    if (this.protectedMode && !this.virtual8086 && !cache.writable)
      throw new I80386Fault(13, 0, "write to non-writable segment");
    this._writeLinear(this._linear(seg, off, width >>> 3), width >>> 3, v);
  }
  _fetch8() {
    if ((this._instructionBytes ?? 0) >= 15)
      throw new I80386Fault(13, 0, "instruction exceeds 15-byte limit");
    const a = this._linear(SEG_CS, this.eip, 1),
      v = this.fetch(this._translate(a)) & 255;
    this._instructionBytes = (this._instructionBytes ?? 0) + 1;
    this.eip += 1;
    return v;
  }
  _fetchN(size) {
    let v = 0;
    for (let i = 0; i < size; i++) v += this._fetch8() * 2 ** (8 * i);
    return v >>> 0;
  }

  _descriptorBytes(selector) {
    const table = selector & 4 ? this.ldtr : this.gdtr;
    const errorCode = selector & 0xfffc;
    if (selector & 4 && !table.present)
      throw new I80386Fault(13, errorCode, "LDT is not loaded");
    const offset = selector & 0xfff8;
    if (offset + 7 > table.limit)
      throw new I80386Fault(13, errorCode, "selector outside descriptor table");
    const address = (table.base + offset) >>> 0;
    return {
      address,
      bytes: Array.from({ length: 8 }, (_, index) =>
        this._readLinear((address + index) >>> 0, 1, { supervisor: true }),
      ),
    };
  }
  _descriptor(selector) {
    if (!(selector & 0xfffc))
      throw new UnsupportedI80386("null protected selector");
    const { address: a, bytes: b } = this._descriptorBytes(selector);
    const access = b[5],
      flags = b[6],
      dpl = (access >>> 5) & 3;
    if (!(access & 0x80) || !(access & 0x10))
      throw new UnsupportedI80386("non-present or system descriptor");
    if ((selector & 3) !== 0 || dpl !== 0)
      throw new UnsupportedI80386("only ring-0 descriptors are supported");
    if (access & 4)
      throw new UnsupportedI80386(
        access & 8
          ? "conforming code is unsupported"
          : "expand-down data is unsupported",
      );
    let limit = (b[0] | (b[1] << 8) | ((flags & 15) << 16)) >>> 0;
    if (flags & 0x80) limit = ((limit << 12) | 0xfff) >>> 0;
    const code = !!(access & 8);
    return {
      base: (b[2] | (b[3] << 8) | (b[4] << 16) | (b[7] * 0x1000000)) >>> 0,
      limit,
      default32: !!(flags & 0x40),
      present: true,
      code,
      readable: !code || !!(access & 2),
      writable: !code && !!(access & 2),
      access,
      address: a,
    };
  }
  _verifySelector(selector, write) {
    if (!(selector & 0xfffc)) return false;
    let bytes;
    try {
      ({ bytes } = this._descriptorBytes(selector));
    } catch (error) {
      if (error instanceof I80386Fault && error.vector === 13) return false;
      throw error;
    }
    const access = bytes[5];
    // VERR/VERW test type and privilege without testing P.  This permits
    // software to probe access rights before a segment becomes present.
    if (!(access & 0x10)) return false;
    const code = !!(access & 8);
    const conforming = code && !!(access & 4);
    const readableOrWritable = !!(access & 2);
    if (write ? code || !readableOrWritable : code && !readableOrWritable)
      return false;
    if (!conforming) {
      const dpl = (access >>> 5) & 3;
      if (Math.max(this.currentPrivilegeLevel, selector & 3) > dpl)
        return false;
    }
    return true;
  }
  _queryDescriptor(selector, kind) {
    if (!(selector & 0xfffc)) return null;
    let bytes;
    try {
      ({ bytes } = this._descriptorBytes(selector));
    } catch (error) {
      if (error instanceof I80386Fault && error.vector === 13) return null;
      throw error;
    }
    const access = bytes[5];
    const system = !(access & 0x10);
    const type = access & 15;
    const validSystemTypes = kind === "lar"
      ? new Set([1, 2, 3, 4, 5, 6, 7, 9, 11, 12, 14, 15])
      : new Set([1, 2, 3, 9, 11]);
    if (system && !validSystemTypes.has(type)) return null;
    const code = !system && !!(type & 8);
    const conforming = code && !!(type & 4);
    const dpl = (access >>> 5) & 3;
    if (!conforming && Math.max(this.currentPrivilegeLevel, selector & 3) > dpl)
      return null;
    return bytes;
  }
  _markAccessed(descriptor) {
    if (!(descriptor.access & 1)) {
      this._writeLinear(
        (descriptor.address + 5) >>> 0,
        1,
        descriptor.access | 1,
        { supervisor: true },
      );
      descriptor.access |= 1;
    }
  }
  _loadSystemRegister(kind, selector) {
    const errorCode = selector & 0xfffc;
    if (selector & 4)
      throw new I80386Fault(13, errorCode, `${kind} selector must name GDT`);
    if (!(selector & 0xfff8)) {
      if (kind === "ldtr") {
        this.ldtr = {
          selector: selector & 0xffff,
          base: 0,
          limit: 0,
          present: false,
        };
        return;
      }
      throw new I80386Fault(13, 0, "null TSS selector");
    }
    const { address, bytes } = this._descriptorBytes(selector);
    const access = bytes[5];
    const type = access & 15;
    if (access & 0x10)
      throw new I80386Fault(
        13,
        errorCode,
        `${kind} requires system descriptor`,
      );
    if (kind === "ldtr" ? type !== 2 : type !== 1 && type !== 9)
      throw new I80386Fault(13, errorCode, `invalid ${kind} descriptor type`);
    if (!(access & 0x80))
      throw new I80386Fault(11, errorCode, `${kind} descriptor not present`);
    const flags = bytes[6];
    let limit = (bytes[0] | (bytes[1] << 8) | ((flags & 15) << 16)) >>> 0;
    if (flags & 0x80) limit = ((limit << 12) | 0xfff) >>> 0;
    const cache = {
      selector: selector & 0xffff,
      base:
        (bytes[2] |
          (bytes[3] << 8) |
          (bytes[4] << 16) |
          (bytes[7] * 0x1000000)) >>>
        0,
      limit,
      present: true,
      type,
    };
    if (kind === "tr") {
      this._writeLinear((address + 5) >>> 0, 1, (access & 0xf0) | (type | 2), {
        supervisor: true,
      });
    }
    this[kind] = cache;
  }
  _loadSeg(id, selector) {
    if (!this.protectedMode || this.virtual8086) {
      this._setSegValue(id, selector);
      this.segmentCaches[id] = {
        base: (selector << 4) >>> 0,
        limit: 0xffff,
        default32: false,
        present: true,
        code: id === SEG_CS,
        writable: id !== SEG_CS,
      };
      return;
    }
    if (id !== SEG_CS && !(selector & 0xfffc)) {
      if (id === SEG_SS) throw new I80386Fault(13, 0, "null stack selector");
      this._setSegValue(id, selector);
      this.segmentCaches[id] = {
        base: 0,
        limit: 0,
        default32: false,
        present: false,
        null: true,
        code: false,
        readable: false,
        writable: false,
      };
      return;
    }
    if (id !== SEG_CS) {
      const errorCode = selector & 0xfffc;
      const { address, bytes } = this._descriptorBytes(selector);
      const access = bytes[5];
      const flags = bytes[6];
      const dpl = (access >>> 5) & 3;
      const cpl = this.cs & 3;
      const rpl = selector & 3;
      const code = !!(access & 8);
      const conformingOrExpandDown = !!(access & 4);
      const readableOrWritable = !!(access & 2);
      if (!(access & 0x10))
        throw new I80386Fault(13, errorCode, "system segment in data register");
      if (id === SEG_SS) {
        if (code || !readableOrWritable || rpl !== cpl || dpl !== cpl)
          throw new I80386Fault(13, errorCode, "invalid stack descriptor");
      } else {
        if (code && !readableOrWritable)
          throw new I80386Fault(13, errorCode, "execute-only data selector");
        if ((!code || !conformingOrExpandDown) && (rpl > dpl || cpl > dpl))
          throw new I80386Fault(13, errorCode, "data selector privilege");
      }
      if (!(access & 0x80))
        throw new I80386Fault(
          id === SEG_SS ? 12 : 11,
          errorCode,
          "segment not present",
        );
      let limit = (bytes[0] | (bytes[1] << 8) | ((flags & 15) << 16)) >>> 0;
      if (flags & 0x80) limit = ((limit << 12) | 0xfff) >>> 0;
      const descriptor = {
        base:
          (bytes[2] |
            (bytes[3] << 8) |
            (bytes[4] << 16) |
            (bytes[7] * 0x1000000)) >>>
          0,
        limit,
        default32: !!(flags & 0x40),
        present: true,
        code,
        expandDown: !code && conformingOrExpandDown,
        readable: !code || readableOrWritable,
        writable: !code && readableOrWritable,
        access,
        address,
      };
      this._markAccessed(descriptor);
      this._setSegValue(id, selector);
      this.segmentCaches[id] = descriptor;
      return;
    }
    const d = this._descriptor(selector);
    if (id === SEG_CS && !d.code)
      throw new UnsupportedI80386("CS requires code descriptor");
    if (id !== SEG_CS && (d.code || !d.writable))
      throw new UnsupportedI80386(
        "data segment requires writable data descriptor",
      );
    this._markAccessed(d);
    this._setSegValue(id, selector);
    this.segmentCaches[id] = d;
  }

  _decodeEA(address32, override) {
    const modrm = this._fetch8(),
      mod = modrm >>> 6,
      reg = (modrm >>> 3) & 7,
      rm = modrm & 7;
    if (mod === 3) return { reg, rm, isReg: true };
    let off = 0,
      seg = SEG_DS,
      usesEsp = false;
    if (address32) {
      if (rm === 4) {
        const sib = this._fetch8(),
          scale = 2 ** (sib >>> 6),
          index = (sib >>> 3) & 7,
          base = sib & 7;
        if (index !== 4)
          off = (off + Math.imul(this._reg(index, 32), scale)) >>> 0;
        if (base === 5 && mod === 0) off = (off + this._fetchN(4)) >>> 0;
        else {
          off = (off + this._reg(base, 32)) >>> 0;
          usesEsp = base === 4;
          if (base === 4 || base === 5) seg = SEG_SS;
        }
      } else if (rm === 5 && mod === 0) off = this._fetchN(4);
      else {
        off = this._reg(rm, 32);
        if (rm === 5) seg = SEG_SS;
      }
      if (mod === 1) off = (off + ((this._fetch8() << 24) >> 24)) >>> 0;
      if (mod === 2) off = (off + this._fetchN(4)) >>> 0;
    } else {
      const bases = [
        [this.bx + this.si, SEG_DS],
        [this.bx + this.di, SEG_DS],
        [this.bp + this.si, SEG_SS],
        [this.bp + this.di, SEG_SS],
        [this.si, SEG_DS],
        [this.di, SEG_DS],
        [this.bp, SEG_SS],
        [this.bx, SEG_DS],
      ];
      if (mod === 0 && rm === 6) {
        off = this._fetchN(2);
        seg = SEG_DS;
      } else [off, seg] = bases[rm];
      if (mod === 1) off += (this._fetch8() << 24) >> 24;
      if (mod === 2) off += this._fetchN(2);
      off &= 0xffff;
    }
    return {
      reg,
      rm,
      isReg: false,
      off: off >>> 0,
      seg: override ?? seg,
      usesEsp,
    };
  }
  _operandRead(ea, width) {
    return ea.isReg
      ? width === 8
        ? this._reg8(ea.rm)
        : this._reg(ea.rm, width)
      : this._read(ea.seg, ea.off, width);
  }
  _operandWrite(ea, width, v) {
    if (ea.isReg) {
      if (width === 8) this._setReg8(ea.rm, v);
      else this._setReg(ea.rm, width, v);
    } else this._write(ea.seg, ea.off, width, v);
  }
  _operandPreflightWrite(ea, width) {
    if (ea.isReg) return;
    const cache = this.segmentCaches[ea.seg];
    if (this.protectedMode && !this.virtual8086 && !cache.writable)
      throw new I80386Fault(13, 0, "write to non-writable segment");
    const bytes = width >>> 3,
      linear = this._linear(ea.seg, ea.off, bytes);
    for (let i = 0; i < bytes; i++)
      this._translate((linear + i) >>> 0, { write: true });
  }
  _setLogic(v, width) {
    const mask = maskFor(width),
      r = v & mask,
      sign = width === 32 ? 0x80000000 : width === 16 ? 0x8000 : 0x80;
    this.eflags &= ~(CF | PF | AF | ZF | SF | OF);
    if (!r) this.eflags |= ZF;
    if (r & sign) this.eflags |= SF;
    if (parity8(r)) this.eflags |= PF;
    return width === 32 ? r >>> 0 : r;
  }
  _add(a, b, width, subtract = false, carry = 0) {
    const mask = maskFor(width),
      sign = width === 32 ? 0x80000000 : width === 16 ? 0x8000 : 0x80;
    const am = width === 32 ? a >>> 0 : a & mask,
      bm = width === 32 ? b >>> 0 : b & mask;
    const raw = subtract ? am - bm - carry : am + bm + carry,
      r = width === 32 ? raw >>> 0 : raw & mask;
    this.eflags &= ~(CF | PF | AF | ZF | SF | OF);
    if (subtract ? am < bm + carry : raw > mask) this.eflags |= CF;
    if (((am ^ bm ^ r) & 0x10) !== 0) this.eflags |= AF;
    if (!r) this.eflags |= ZF;
    if (r & sign) this.eflags |= SF;
    if (parity8(r)) this.eflags |= PF;
    if (
      subtract
        ? ((am ^ bm) & (am ^ r) & sign) !== 0
        : (~(am ^ bm) & (am ^ r) & sign) !== 0
    )
      this.eflags |= OF;
    return r;
  }
  _alu(operation, left, right, width) {
    if (operation === 0x00) return this._add(left, right, width);
    if (operation === 0x08) return this._setLogic(left | right, width);
    if (operation === 0x10)
      return this._add(left, right, width, false, this.eflags & CF ? 1 : 0);
    if (operation === 0x18)
      return this._add(left, right, width, true, this.eflags & CF ? 1 : 0);
    if (operation === 0x20) return this._setLogic(left & right, width);
    if (operation === 0x28) return this._add(left, right, width, true);
    if (operation === 0x30) return this._setLogic(left ^ right, width);
    if (operation === 0x38) {
      this._add(left, right, width, true);
      return null;
    }
    throw new UnsupportedI80386("ALU operation");
  }
  _push(v, width) {
    const bytes = width >>> 3,
      stack32 = !!this.segmentCaches[SEG_SS].default32;
    const next = stack32
      ? (this.esp - bytes) >>> 0
      : (this.sp - bytes) & 0xffff;
    this._linear(SEG_SS, next, bytes);
    if (stack32) this.esp = next;
    else this.sp = next;
    this._write(SEG_SS, next, width, v);
  }
  _pop(width) {
    const bytes = width >>> 3,
      stack32 = !!this.segmentCaches[SEG_SS].default32,
      off = stack32 ? this.esp : this.sp;
    const v = this._read(SEG_SS, off, width);
    if (stack32) this.esp = (this.esp + bytes) >>> 0;
    else this.sp = (this.sp + bytes) & 0xffff;
    return v;
  }
  _pusha(width) {
    const bytes = width >>> 3;
    const stack32 = !!this.segmentCaches[SEG_SS].default32;
    const originalStack = stack32 ? this.esp : this.sp;
    const savedStack = width === 32 ? this.esp >>> 0 : this.sp;
    if (!this.protectedMode) {
      if (savedStack === 1 || savedStack === 3 || savedStack === 5) {
        this.shutdown = true;
        return;
      }
      if ([7, 9, 11, 13, 15].includes(savedStack))
        throw new I80386Fault(13, 0, "PUSHA real-mode stack boundary");
    }
    const first = stack32
      ? (originalStack - bytes * 8) >>> 0
      : (originalStack - bytes * 8) & 0xffff;
    if (this.protectedMode) this._linear(SEG_SS, first, bytes * 8);
    const values = [
      this._reg(0, width),
      this._reg(1, width),
      this._reg(2, width),
      this._reg(3, width),
      savedStack,
      this._reg(5, width),
      this._reg(6, width),
      this._reg(7, width),
    ];
    for (const value of values) this._push(value, width);
  }
  _popa(width) {
    const bytes = width >>> 3;
    const stack32 = !!this.segmentCaches[SEG_SS].default32;
    const originalStack = stack32 ? this.esp : this.sp;
    if (this.protectedMode) this._linear(SEG_SS, originalStack, bytes * 8);
    for (const register of [7, 6, 5])
      this._setReg(register, width, this._pop(width));
    if (width === 32 && !stack32) {
      const discarded = this._pop(width);
      this.esp = ((discarded & 0xffff0000) | this.sp) >>> 0;
    } else if (stack32) this.esp = (this.esp + bytes) >>> 0;
    else this.sp = (this.sp + bytes) & 0xffff;
    for (const register of [3, 2, 1, 0])
      this._setReg(register, width, this._pop(width));
  }
  _pushSegment(segment, width) {
    if (width === 16) {
      this._push(this._segValue(segment), 16);
      return;
    }
    const stack32 = !!this.segmentCaches[SEG_SS].default32;
    const next = stack32 ? (this.esp - 4) >>> 0 : (this.sp - 4) & 0xffff;
    const linear = this._linear(SEG_SS, next, 2);
    const physical = [0, 1].map((index) =>
      this._translate((linear + index) >>> 0, { write: true }),
    );
    const selector = this._segValue(segment);
    this.write(physical[0], selector & 255);
    this.write(physical[1], selector >>> 8);
    if (stack32) this.esp = next;
    else this.sp = next;
  }
  _popSegment(segment, width) {
    const bytes = width >>> 3;
    const stack32 = !!this.segmentCaches[SEG_SS].default32;
    const old = stack32 ? this.esp : this.sp;
    const selector = this._read(SEG_SS, old, 16) & 0xffff;
    if (stack32) this.esp = (this.esp + bytes) >>> 0;
    else this.sp = (this.sp + bytes) & 0xffff;
    this._loadSeg(segment, selector);
    if (segment === SEG_SS) {
      this._interruptShadow = 2;
      this._nmiShadow = 2;
      this._debugShadow = 1;
    }
  }
  _condition(code) {
    const f = this.eflags;
    const z = !!(f & ZF),
      s = !!(f & SF),
      o = !!(f & OF),
      c = !!(f & CF),
      p = !!(f & PF);
    return [
      o,
      !o,
      c,
      !c,
      z,
      !z,
      c || z,
      !c && !z,
      s,
      !s,
      p,
      !p,
      s !== o,
      s === o,
      z || s !== o,
      !z && s === o,
    ][code];
  }

  _checkIo(port, width) {
    if (!this.protectedMode) return;
    if (
      !this.virtual8086 &&
      this.currentPrivilegeLevel <= ((this.eflags >>> 12) & 3)
    )
      return;
    if (!this.tr.present || (this.tr.type !== 9 && this.tr.type !== 11))
      throw new I80386Fault(13, 0, "I/O requires a current 386 TSS");
    if (this.tr.limit < 0x67)
      throw new I80386Fault(13, 0, "TSS lacks I/O bitmap offset");
    const bitmap = this._readLinear((this.tr.base + 0x66) >>> 0, 2, {
      supervisor: true,
    });
    if (bitmap >= this.tr.limit)
      throw new I80386Fault(13, 0, "I/O bitmap has no trailing deny byte");
    for (let byte = 0; byte < (width >>> 3); byte++) {
      const numberedPort = (port & 0xffff) + byte;
      const offset = bitmap + (numberedPort >>> 3);
      if (offset > this.tr.limit)
        throw new I80386Fault(13, 0, "I/O bitmap ends before port permission");
      const permissions = this._readLinear((this.tr.base + offset) >>> 0, 1, {
        supervisor: true,
      });
      if (permissions & (1 << (numberedPort & 7)))
        throw new I80386Fault(13, 0, "I/O bitmap denies port");
    }
  }

  _checkVmIopl(name) {
    if (this.virtual8086 && ((this.eflags >>> 12) & 3) !== 3)
      throw new I80386Fault(13, 0, `VM86 ${name} requires IOPL3`);
  }

  _popFlags(width) {
    const value = this._pop(width);
    const old = this.eflags >>> 0;
    const cpl = this.currentPrivilegeLevel;
    const iopl = (old >>> 12) & 3;
    let writable = 0x7fd5;
    if (cpl !== 0) writable &= ~0x3000;
    if (cpl > iopl) writable &= ~IF;
    this.eflags = ((old & ~writable) | (value & writable) | 2) >>> 0;
    this._preserveRf = true;
  }

  _group3(op, width, address32, override) {
    const operandWidth = op === 0xf6 ? 8 : width;
    const ea = this._decodeEA(address32, override);
    if (ea.reg === 1)
      throw new I80386Fault(6, null, "invalid group-3 extension");
    if (ea.reg === 0) {
      const immediate = this._fetchN(operandWidth >>> 3);
      this._setLogic(
        this._operandRead(ea, operandWidth) & immediate,
        operandWidth,
      );
      return;
    }
    if (ea.reg === 2 || ea.reg === 3)
      this._operandPreflightWrite(ea, operandWidth);
    const operand = this._operandRead(ea, operandWidth);
    if (ea.reg === 2) {
      this._operandWrite(ea, operandWidth, ~operand);
      return;
    }
    if (ea.reg === 3) {
      this._operandWrite(
        ea,
        operandWidth,
        this._add(0, operand, operandWidth, true),
      );
      return;
    }

    const bits = BigInt(operandWidth);
    const unsignedOperand = BigInt.asUintN(operandWidth, BigInt(operand));
    const signedOperand = BigInt.asIntN(operandWidth, BigInt(operand));
    if (ea.reg === 4 || ea.reg === 5) {
      const accumulator =
        operandWidth === 8 ? this.al : this._reg(0, operandWidth);
      const product =
        ea.reg === 4
          ? BigInt.asUintN(operandWidth, BigInt(accumulator)) * unsignedOperand
          : BigInt.asIntN(operandWidth, BigInt(accumulator)) * signedOperand;
      const raw = BigInt.asUintN(operandWidth * 2, product);
      const low = Number(BigInt.asUintN(operandWidth, raw));
      const high = Number(BigInt.asUintN(operandWidth, raw >> bits));
      if (operandWidth === 8) this.ax = Number(BigInt.asUintN(16, raw));
      else {
        this._setReg(0, operandWidth, low);
        this._setReg(2, operandWidth, high);
      }
      const fits =
        ea.reg === 4
          ? high === 0
          : product === BigInt.asIntN(operandWidth, product);
      this.eflags = fits ? this.eflags & ~(CF | OF) : this.eflags | CF | OF;
      return;
    }

    if (unsignedOperand === 0n)
      throw new I80386Fault(0, null, "division by zero");
    let dividend;
    if (operandWidth === 8) dividend = BigInt(this.ax);
    else {
      const low = BigInt.asUintN(
        operandWidth,
        BigInt(this._reg(0, operandWidth)),
      );
      const high = BigInt.asUintN(
        operandWidth,
        BigInt(this._reg(2, operandWidth)),
      );
      dividend = (high << bits) | low;
    }
    if (ea.reg === 7) dividend = BigInt.asIntN(operandWidth * 2, dividend);
    const divisor = ea.reg === 7 ? signedOperand : unsignedOperand;
    if (divisor === 0n) throw new I80386Fault(0, null, "division by zero");
    const quotient = dividend / divisor;
    const remainder = dividend % divisor;
    const fits =
      ea.reg === 7
        ? quotient === BigInt.asIntN(operandWidth, quotient)
        : quotient === BigInt.asUintN(operandWidth, quotient);
    if (!fits) throw new I80386Fault(0, null, "division quotient overflow");
    const q = Number(BigInt.asUintN(operandWidth, quotient));
    const r = Number(BigInt.asUintN(operandWidth, remainder));
    if (operandWidth === 8) {
      this.al = q;
      this.ah = r;
    } else {
      this._setReg(0, operandWidth, q);
      this._setReg(2, operandWidth, r);
    }
  }

  _group5(op, width, address32, override) {
    const operandWidth = op === 0xfe ? 8 : width;
    const ea = this._decodeEA(address32, override);
    if (ea.reg === 0 || ea.reg === 1) {
      this._operandPreflightWrite(ea, operandWidth);
      const carry = this.eflags & CF;
      const value = this._operandRead(ea, operandWidth);
      const result = this._add(value, 1, operandWidth, ea.reg === 1);
      this.eflags = (this.eflags & ~CF) | carry;
      this._operandWrite(ea, operandWidth, result);
      return;
    }
    if (op === 0xfe || ea.reg === 7)
      throw new I80386Fault(6, null, "invalid FE/FF extension");
    if (ea.reg === 3 || ea.reg === 5) {
      if (ea.isReg)
        throw new I80386Fault(6, null, "far indirect transfer requires memory");
      const bytes = width >>> 3;
      const sourceCache = this.segmentCaches[ea.seg];
      if (this.protectedMode && !this.virtual8086 && sourceCache.code && !sourceCache.readable)
        throw new I80386Fault(13, 0, "read from execute-only segment");
      const address = this._linear(ea.seg, ea.off, bytes + 2);
      const target = this._readLinear(address, bytes);
      const selector = this._readLinear((address + bytes) >>> 0, 2);
      if (this.protectedMode && !this.virtual8086)
        this._protectedFarTransfer(selector, target, width, ea.reg === 3);
      else this._farRealTransfer(selector, target, width, ea.reg === 3);
      return;
    }
    if (ea.reg === 6) {
      const value = this._operandRead(ea, width);
      this._push(value, width);
      return;
    }
    const target = this._operandRead(ea, width);
    const normalized = width === 32 ? target >>> 0 : target & 0xffff;
    this._linear(SEG_CS, normalized, 1);
    if (ea.reg === 2) this._push(this.eip, width);
    this.eip = normalized;
  }

  _farRealTransfer(selector, target, width, call) {
    const normalized = width === 32 ? target >>> 0 : target & 0xffff;
    if (normalized > 0xffff)
      throw new I80386Fault(13, 0, "real far target exceeds CS limit");
    if (call) this._stackFrame(width, [this.eip, this.cs]);
    this._loadSeg(SEG_CS, selector);
    this.eip = normalized;
  }

  _farRealReturn(width, discard) {
    if (this.protectedMode && !this.virtual8086)
      return this._protectedFarReturn(width, discard);
    const bytes = width >>> 3;
    const stack32 = !!this.segmentCaches[SEG_SS].default32;
    const old = stack32 ? this.esp : this.sp;
    const address = this._linear(SEG_SS, old, bytes * 2);
    const target = this._readLinear(address, bytes);
    const selector = this._readLinear((address + bytes) >>> 0, bytes) & 0xffff;
    if (target > 0xffff)
      throw new I80386Fault(13, 0, "real far return exceeds CS limit");
    const next = stack32
      ? (old + bytes * 2 + discard) >>> 0
      : (old + bytes * 2 + discard) & 0xffff;
    this._loadSeg(SEG_CS, selector);
    if (stack32) this.esp = next;
    else this.sp = next;
    this.eip = target;
  }

  _taskDescriptor(selector, { returning = false, checkPrivilege = true } = {}) {
    const code = selector & 0xfffc;
    if (!code || (selector & 4))
      throw new I80386Fault(returning ? 10 : 13, code, "invalid TSS selector");
    let raw;
    try {
      raw = this._descriptorBytes(selector);
    } catch (error) {
      if (returning && error instanceof I80386Fault && error.vector === 13)
        error.vector = 10;
      throw error;
    }
    const access = raw.bytes[5];
    const type = access & 15, expected = returning ? 11 : 9;
    if ((access & 0x10) || type !== expected)
      throw new I80386Fault(returning ? 10 : 13, code,
        returning ? "task return requires busy 386 TSS" : "task switch requires available 386 TSS");
    if (checkPrivilege && Math.max(this.currentPrivilegeLevel, selector & 3) > ((access >>> 5) & 3))
      throw new I80386Fault(13, code, "TSS privilege");
    if (!(access & 0x80)) throw new I80386Fault(11, code, "TSS not present");
    const flags = raw.bytes[6];
    let limit = (raw.bytes[0] | raw.bytes[1] << 8 | (flags & 15) << 16) >>> 0;
    if (flags & 0x80) limit = ((limit << 12) | 0xfff) >>> 0;
    return { selector: selector & 0xffff, address: raw.address, access, type,
      base: (raw.bytes[2] | raw.bytes[3] << 8 | raw.bytes[4] << 16 |
        raw.bytes[7] * 0x1000000) >>> 0, limit, present: true };
  }

  _taskRead(base, offset, bytes) {
    return this._readLinear((base + offset) >>> 0, bytes, { supervisor: true });
  }

  _taskWrite(base, offset, bytes, value) {
    this._writeLinear((base + offset) >>> 0, bytes, value, { supervisor: true });
  }

  _taskImage(descriptor) {
    if (descriptor.limit < 0x67)
      throw new I80386Fault(10, descriptor.selector & 0xfffc, "incoming 386 TSS limit");
    const d = descriptor.base, dword = o => this._taskRead(d, o, 4), word = o => this._taskRead(d, o, 2);
    return { backlink: word(0), cr3: dword(0x1c), eip: dword(0x20), eflags: dword(0x24),
      eax: dword(0x28), ecx: dword(0x2c), edx: dword(0x30), ebx: dword(0x34),
      esp: dword(0x38), ebp: dword(0x3c), esi: dword(0x40), edi: dword(0x44),
      es: word(0x48), cs: word(0x4c), ss: word(0x50), ds: word(0x54),
      fs: word(0x58), gs: word(0x5c), ldt: word(0x60) };
  }

  _saveCurrentTask(flags, incomingSelector, savedEip = this.eip) {
    if (!this.tr.present || this.tr.limit < 0x5d)
      throw new I80386Fault(10, incomingSelector & 0xfffc, "current 386 TSS limit");
    const d = this.tr.base;
    for (const [o, v] of [[0x20,savedEip],[0x24,flags],[0x28,this.eax],
      [0x2c,this.ecx],[0x30,this.edx],[0x34,this.ebx],[0x38,this.esp],[0x3c,this.ebp],
      [0x40,this.esi],[0x44,this.edi]]) this._taskWrite(d, o, 4, v);
    for (const [o, v] of [[0x48,this.es],[0x4c,this.cs],[0x50,this.ss],[0x54,this.ds],
      [0x58,this.fs],[0x5c,this.gs]]) this._taskWrite(d, o, 2, v);
  }

  _setTaskBusy(descriptor, busy) {
    const access = this._readLinear((descriptor.address + 5) >>> 0, 1, {
      supervisor: true,
    });
    this._writeLinear((descriptor.address + 5) >>> 0, 1,
      (access & ~2) | (busy ? 2 : 0), { supervisor: true });
  }

  _taskSwitch(selector, kind, options = {}) {
    try {
      return this._taskSwitchCore(selector, kind, options);
    } catch (error) {
      if (options.external && error instanceof I80386Fault &&
          [10, 11, 12, 13].includes(error.vector))
        error.errorCode = ((error.errorCode ?? 0) | 1) >>> 0;
      throw error;
    }
  }

  _taskSwitchCore(selector, kind, {
    checkPrivilege = true,
    errorCode = null,
    external = false,
    saveEip = this.eip,
    saveFlags = this.eflags,
  } = {}) {
    const returning = kind === "iret";
    const incoming = this._taskDescriptor(selector, { returning, checkPrivilege });
    if (incoming.limit < 0x67)
      throw new I80386Fault(10, incoming.selector & 0xfffc, "incoming 386 TSS limit");
    if ((this.cr0 & 0x80000000) && (incoming.base & 0xfff) + 0x67 >= 0x1000)
      throw new UnsupportedI80386(
        "page-straddling incoming TSS images are outside the bounded task profile",
      );
    const outgoing = this.tr.present
      ? {
          ...this.tr,
          address: (this.gdtr.base + (this.tr.selector & 0xfff8)) >>> 0,
        }
      : null;
    this._saveCurrentTask(returning ? saveFlags & ~NT : saveFlags, selector, saveEip);
    if (!returning) this._setTaskBusy(incoming, true);
    if (kind === "call") this._taskWrite(incoming.base, 0, 2, this.tr.selector);
    if ((kind === "jmp" || returning) && outgoing) this._setTaskBusy(outgoing, false);
    this.tr = { ...incoming, type: 11 };
    try {
      const image = this._taskImage(incoming);
      if (image.eflags & 0x20000)
        throw new UnsupportedI80386("VM86 task entry is outside the bounded task profile");
      if (this._taskRead(incoming.base, 0x64, 2) & 1)
        throw new UnsupportedI80386("TSS debug-trap task entry is outside the bounded task profile");
      this.cr3 = image.cr3 >>> 0;
      this.cr0 |= 8;
      Object.assign(this, image);
      for (const id of [SEG_ES, SEG_CS, SEG_SS, SEG_DS, SEG_FS, SEG_GS])
        this.segmentCaches[id] = {
          base: 0,
          limit: 0,
          present: false,
          null: true,
          code: id === SEG_CS,
          readable: false,
          writable: false,
        };
      const flags = (image.eflags & 0x00037fd7) | 2;
      this.eflags = kind === "call" ? flags | NT : kind === "jmp" ? flags & ~NT : flags;
      this.ldtr = { selector: image.ldt, base: 0, limit: 0, present: false };
      if (image.ldt & 0xfffc) {
        try {
          this._loadSystemRegister("ldtr", image.ldt);
        } catch (error) {
          if (error instanceof I80386Fault && [11, 13].includes(error.vector)) {
            error.vector = 10;
            error.errorCode = image.ldt & 0xfffc;
          }
          throw error;
        }
      }
      let code;
      try {
        code = this._ringCodeDescriptor(image.cs, false, true);
      } catch (error) {
        if (error instanceof I80386Fault && error.vector === 13)
          error.vector = 10;
        throw error;
      }
      const cpl = image.cs & 3;
      if (code.conforming ? code.dpl > cpl : code.dpl !== cpl)
        throw new I80386Fault(10, image.cs & 0xfffc, "task code privilege");
      if (!code.present)
        throw new I80386Fault(11, image.cs & 0xfffc, "task code not present");
      this._markAccessed(code);
      this.segmentCaches[SEG_CS] = code;
      try {
        this._loadSeg(SEG_SS, image.ss);
      } catch (error) {
        if (error instanceof I80386Fault && error.vector === 13) error.vector = 10;
        throw error;
      }
      for (const [id, value] of [[SEG_DS,image.ds],[SEG_ES,image.es],[SEG_FS,image.fs],[SEG_GS,image.gs]]) {
        try {
          this._loadSeg(id, value);
        } catch (error) {
          if (error instanceof I80386Fault && error.vector === 13) error.vector = 10;
          throw error;
        }
      }
      if (image.eip > code.limit) throw new I80386Fault(13, 0, "task EIP outside code segment");
      if (errorCode !== null) this._push(errorCode, 32);
      this.halted = false;
      this._interruptShadow = this._nmiShadow = this._debugShadow = 0;
      this._suppressTrace = true;
    } catch (error) {
      if (error instanceof I80386Fault || error instanceof UnsupportedI80386)
        error.taskCommitted = true;
      throw error;
    }
  }

  _protectedFarTransfer(selector, offset, operandWidth, call) {
    const cpl = this.cs & 3,
      errorCode = selector & 0xfffc;
    if (!errorCode) throw new I80386Fault(13, 0, "null far selector");
    const raw = this._descriptorBytes(selector),
      access = raw.bytes[5],
      type = access & 15;
    if (access & 0x10) {
      const descriptor = this._ringCodeDescriptor(selector, false, true);
      if (descriptor.conforming
        ? descriptor.dpl > cpl
        : (selector & 3) > cpl || descriptor.dpl !== cpl)
        throw new I80386Fault(13, errorCode, "far code privilege");
      if (!descriptor.present)
        throw new I80386Fault(11, errorCode, "far code not present");
      const target = operandWidth === 32 ? offset >>> 0 : offset & 0xffff;
      let frame = null;
      if (call)
        frame = this._prepareStackFrame(operandWidth, [this.eip, this.cs]);
      if (target > descriptor.limit)
        throw new I80386Fault(13, 0, "far target outside code segment");
      this._markAccessed(descriptor);
      if (frame) this._commitStackFrame(frame);
      this.cs = (selector & 0xfffc) | cpl;
      this.segmentCaches[SEG_CS] = descriptor;
      this.eip = target;
      return;
    }
    if (![4, 12].includes(type)) {
      if (type === 9) {
        this._taskSwitch(selector, call ? "call" : "jmp");
        return;
      }
      if (type === 11)
        throw new I80386Fault(13, errorCode, "task switch target is busy");
      if (type === 5) {
        const gateDpl = (access >>> 5) & 3;
        if (Math.max(cpl, selector & 3) > gateDpl)
          throw new I80386Fault(13, errorCode, "task gate privilege");
        if (!(access & 0x80))
          throw new I80386Fault(11, errorCode, "task gate not present");
        const target = raw.bytes[2] | raw.bytes[3] << 8;
        this._taskSwitch(target, call ? "call" : "jmp", { checkPrivilege: false });
        return;
      }
      if ([1, 3].includes(type))
        throw new UnsupportedI80386(
          "protected task transfer is outside the bounded 386 profile",
        );
      throw new I80386Fault(13, errorCode, "invalid protected far descriptor");
    }
    const gateDpl = (access >>> 5) & 3;
    if (cpl > gateDpl || (selector & 3) > gateDpl)
      throw new I80386Fault(13, errorCode, "call gate privilege");
    if (!(access & 0x80))
      throw new I80386Fault(11, errorCode, "call gate not present");
    const gateWidth = type === 12 ? 32 : 16,
      bytes = gateWidth >>> 3;
    const targetSelector = raw.bytes[2] | (raw.bytes[3] << 8);
    const targetOffset =
      (raw.bytes[0] |
        (raw.bytes[1] << 8) |
        (gateWidth === 32
          ? (raw.bytes[6] | (raw.bytes[7] << 8)) * 0x10000
          : 0)) >>>
      0;
    const count = raw.bytes[4] & 31;
    const descriptor = this._ringCodeDescriptor(targetSelector, false, true);
    const targetCpl = descriptor.conforming ? cpl : descriptor.dpl;
    if (descriptor.dpl > cpl)
      throw new I80386Fault(
        13,
        targetSelector & 0xfffc,
        "call gate target privilege",
      );
    if (!call) {
      if (targetCpl !== cpl)
        throw new I80386Fault(
          13,
          targetSelector & 0xfffc,
          "call gate JMP cannot change privilege",
        );
      if (!descriptor.present)
        throw new I80386Fault(
          11,
          targetSelector & 0xfffc,
          "call gate code not present",
        );
      if (targetOffset > descriptor.limit)
        throw new I80386Fault(13, 0, "call gate offset outside code segment");
      this._markAccessed(descriptor);
      this.cs = (targetSelector & 0xfffc) | cpl;
      this.segmentCaches[SEG_CS] = descriptor;
      this.eip = targetOffset;
      return;
    }
    if (!descriptor.present)
      throw new I80386Fault(
        11,
        targetSelector & 0xfffc,
        "call gate code not present",
      );
    if (targetCpl === cpl) {
      const frame = this._prepareStackFrame(gateWidth, [this.eip, this.cs]);
      if (targetOffset > descriptor.limit)
        throw new I80386Fault(13, 0, "call gate offset outside code segment");
      this._markAccessed(descriptor);
      this._commitStackFrame(frame);
      this.cs = (targetSelector & 0xfffc) | cpl;
      this.segmentCaches[SEG_CS] = descriptor;
      this.eip = targetOffset;
      return;
    }
    const oldStack = !!this.segmentCaches[SEG_SS].default32
      ? this.esp
      : this.sp;
    const values = [
      this.eip,
      this.cs,
      ...Array(count).fill(0),
      this.esp,
      this.ss,
    ];
    const frame = this._innerInterruptStack(
      targetCpl,
      gateWidth,
      values,
      false,
      true,
    );
    if (targetOffset > descriptor.limit)
      throw new I80386Fault(13, 0, "call gate offset outside code segment");
    if (count) this._linear(SEG_SS, oldStack, count * bytes);
    for (let index = 0; index < count; index++)
      values[2 + index] = this._read(
        SEG_SS,
        (oldStack + index * bytes) >>> 0,
        gateWidth,
      );
    this._markAccessed(descriptor);
    this._markAccessed(frame.descriptor);
    this._commitInnerInterruptStack(frame);
    this.cs = (targetSelector & 0xfffc) | targetCpl;
    this.segmentCaches[SEG_CS] = descriptor;
    this.eip = targetOffset;
  }

  _protectedFarReturn(width, discard) {
    const bytes = width >>> 3,
      stack32 = !!this.segmentCaches[SEG_SS].default32;
    const old = stack32 ? this.esp : this.sp;
    this._linear(SEG_SS, old, bytes * 2);
    const address = this._linear(SEG_SS, old, bytes * 2);
    const target = this._readLinear(address, bytes);
    const selector = this._readLinear(address + bytes, bytes) & 0xffff;
    const currentCpl = this.cs & 3,
      returnCpl = selector & 3;
    if (returnCpl < currentCpl)
      throw new I80386Fault(13, selector & 0xfffc, "far return privilege");
    const outer = returnCpl > currentCpl;
    if (outer) this._linear(SEG_SS, old, bytes * 4 + (discard & 0xffff));
    const descriptor = this._ringCodeDescriptor(selector, false, true);
    if (descriptor.conforming
      ? descriptor.dpl > returnCpl
      : descriptor.dpl !== returnCpl)
      throw new I80386Fault(13, selector & 0xfffc, "far return code privilege");
    if (!descriptor.present)
      throw new I80386Fault(
        11,
        selector & 0xfffc,
        "far return code not present",
      );
    let newSp, newSs, stackDescriptor;
    if (outer) {
      newSp = this._readLinear(address + bytes * 2 + (discard & 0xffff), bytes);
      newSs =
        this._readLinear(address + bytes * 3 + (discard & 0xffff), bytes) &
        0xffff;
      stackDescriptor = this._ringStackDescriptor(newSs, returnCpl, {
        returnPath: true,
      });
    }
    if (target > descriptor.limit)
      throw new I80386Fault(13, 0, "far return target outside code segment");
    this._markAccessed(descriptor);
    if (stackDescriptor) this._markAccessed(stackDescriptor);
    this.cs = selector;
    this.segmentCaches[SEG_CS] = descriptor;
    this.eip = width === 32 ? target >>> 0 : target & 0xffff;
    if (outer) {
      this.ss = newSs;
      this.segmentCaches[SEG_SS] = stackDescriptor;
      if (width === 32) this.esp = newSp >>> 0;
      else this.sp = newSp & 0xffff;
      if (stackDescriptor.default32)
        this.esp = (this.esp + (discard & 0xffff)) >>> 0;
      else this.sp = (this.sp + (discard & 0xffff)) & 0xffff;
      this._invalidateOuterDataSegments(returnCpl);
    } else {
      const next = stack32
        ? (old + bytes * 2 + (discard & 0xffff)) >>> 0
        : (old + bytes * 2 + (discard & 0xffff)) & 0xffff;
      if (stack32) this.esp = next;
      else this.sp = next;
    }
  }

  _invalidateOuterDataSegments(cpl) {
    for (const id of [SEG_ES, SEG_DS, SEG_FS, SEG_GS]) {
      const cache = this.segmentCaches[id];
      if (cache.null) continue;
      const dpl = (cache.access >>> 5) & 3,
        conformingCode = cache.code && !!(cache.access & 4);
      if (!conformingCode && (cpl > dpl || (this._segValue(id) & 3) > dpl)) {
        this._setSegValue(id, 0);
        this.segmentCaches[id] = {
          base: 0,
          limit: 0,
          default32: false,
          present: false,
          null: true,
          code: false,
          readable: false,
          writable: false,
        };
      }
    }
  }

  _farPointerLoad(segment, width, address32, override) {
    const ea = this._decodeEA(address32, override);
    if (ea.isReg)
      throw new I80386Fault(6, null, "far pointer load requires memory");
    const cache = this.segmentCaches[ea.seg];
    if (this.protectedMode && !this.virtual8086 && cache.code && !cache.readable)
      throw new I80386Fault(13, 0, "read from execute-only segment");
    const bytes = width >>> 3;
    const address = this._linear(ea.seg, ea.off, bytes + 2);
    const offset = this._readLinear(address, bytes);
    const selector = this._readLinear((address + bytes) >>> 0, 2);
    this._loadSeg(segment, selector);
    this._setReg(ea.reg, width, offset);
    if (segment === SEG_SS) {
      this._interruptShadow = 2;
      this._nmiShadow = 2;
      this._debugShadow = 1;
    }
  }

  _string(op, width, address32, override) {
    const byte = !(op & 1);
    const operandWidth = byte ? 8 : width;
    const bytes = operandWidth >>> 3;
    const sourceOffset = address32 ? this.esi : this.si;
    const destinationOffset = address32 ? this.edi : this.di;
    if (op === 0xa4 || op === 0xa5) {
      const value = this._read(override ?? SEG_DS, sourceOffset, operandWidth);
      this._write(SEG_ES, destinationOffset, operandWidth, value);
    } else if (op === 0xa6 || op === 0xa7) {
      const source = this._read(override ?? SEG_DS, sourceOffset, operandWidth);
      const destination = this._read(SEG_ES, destinationOffset, operandWidth);
      this._add(source, destination, operandWidth, true);
    } else if (op === 0xaa || op === 0xab) {
      this._write(
        SEG_ES,
        destinationOffset,
        operandWidth,
        byte ? this.al : this._reg(0, operandWidth),
      );
    } else if (op === 0xac || op === 0xad) {
      const value = this._read(override ?? SEG_DS, sourceOffset, operandWidth);
      if (byte) this.al = value;
      else this._setReg(0, operandWidth, value);
    } else {
      const value = this._read(SEG_ES, destinationOffset, operandWidth);
      this._add(
        byte ? this.al : this._reg(0, operandWidth),
        value,
        operandWidth,
        true,
      );
    }
    const delta = this.eflags & DF ? -bytes : bytes;
    if ([0xa4, 0xa5, 0xa6, 0xa7, 0xac, 0xad].includes(op)) {
      if (address32) this.esi = (this.esi + delta) >>> 0;
      else this.si = (this.si + delta) & 0xffff;
    }
    if ([0xa4, 0xa5, 0xa6, 0xa7, 0xaa, 0xab, 0xae, 0xaf].includes(op)) {
      if (address32) this.edi = (this.edi + delta) >>> 0;
      else this.di = (this.di + delta) & 0xffff;
    }
  }

  _stringIo(op, width, address32, override) {
    const input = op === 0x6c || op === 0x6d;
    const byte = op === 0x6c || op === 0x6e;
    const ioWidth = byte ? 8 : width;
    const bytes = ioWidth >>> 3;
    const port = this.dx;
    this._checkIo(port, ioWidth);
    if (input) {
      const offset = address32 ? this.edi : this.di;
      const cache = this.segmentCaches[SEG_ES];
      if (this.protectedMode && !this.virtual8086 && !cache.writable)
        throw new I80386Fault(13, 0, "INS destination is not writable");
      const linear = this._linear(SEG_ES, offset, bytes);
      const physical = Array.from({ length: bytes }, (_, index) =>
        this._translate((linear + index) >>> 0, { write: true }),
      );
      const value = this.inPort(port, ioWidth) >>> 0;
      for (let index = 0; index < bytes; index++)
        this.write(physical[index], (value >>> (index * 8)) & 0xff);
      const delta = this.eflags & DF ? -bytes : bytes;
      if (address32) this.edi = (this.edi + delta) >>> 0;
      else this.di = (this.di + delta) & 0xffff;
      return;
    }
    const offset = address32 ? this.esi : this.si;
    const value = this._read(override ?? SEG_DS, offset, ioWidth);
    this.outPort(port, value, ioWidth);
    const delta = this.eflags & DF ? -bytes : bytes;
    if (address32) this.esi = (this.esi + delta) >>> 0;
    else this.si = (this.si + delta) & 0xffff;
  }

  _repeatIo(op, width, address32, override, instructionStart) {
    const count = address32 ? this.ecx : this.cx;
    if (count === 0) return;
    this._stringIo(op, width, address32, override);
    if (address32) this.ecx = (this.ecx - 1) >>> 0;
    else this.cx = (this.cx - 1) & 0xffff;
    if ((address32 ? this.ecx : this.cx) !== 0) this.eip = instructionStart;
  }

  _repeatString(op, width, address32, override, repeat, instructionStart) {
    const count = address32 ? this.ecx : this.cx;
    if (count === 0) {
      this._repeatContext = null;
      return;
    }
    if (
      !this._repeatContext ||
      this._repeatContext.cs !== this.cs ||
      this._repeatContext.eip !== instructionStart
    )
      this._repeatContext = {
        cs: this.cs,
        eip: instructionStart,
        flags: this.eflags >>> 0,
      };
    try {
      this._string(op, width, address32, override);
    } catch (error) {
      if (error instanceof I80386Fault)
        error.repeatFlags = this._repeatContext.flags;
      throw error;
    }
    if (address32) this.ecx = (this.ecx - 1) >>> 0;
    else this.cx = (this.cx - 1) & 0xffff;
    const remaining = address32 ? this.ecx : this.cx;
    const compare = op === 0xa6 || op === 0xa7 || op === 0xae || op === 0xaf;
    const condition =
      !compare ||
      (repeat === 0xf3 ? !!(this.eflags & ZF) : !(this.eflags & ZF));
    if (remaining !== 0 && condition) this.eip = instructionStart;
    else this._repeatContext = null;
  }

  _snapshotInstruction() {
    return {
      eax: this.eax,
      ecx: this.ecx,
      edx: this.edx,
      ebx: this.ebx,
      esp: this.esp,
      ebp: this.ebp,
      esi: this.esi,
      edi: this.edi,
      eip: this.eip,
      eflags: this.eflags,
      cs: this.cs,
      ds: this.ds,
      es: this.es,
      ss: this.ss,
      fs: this.fs,
      gs: this.gs,
      halted: this.halted,
      interruptShadow: this._interruptShadow,
      nmiShadow: this._nmiShadow,
      debugShadow: this._debugShadow,
      nmiActive: this._nmiActive,
      segmentCaches: [
        { ...this.segmentCaches[0] },
        { ...this.segmentCaches[1] },
        { ...this.segmentCaches[2] },
        { ...this.segmentCaches[3] },
        { ...this.segmentCaches[4] },
        { ...this.segmentCaches[5] },
      ],
      repeatContext: this._repeatContext ? { ...this._repeatContext } : null,
      ldtr: { ...this.ldtr },
      tr: { ...this.tr },
    };
  }

  _restoreInstruction(state) {
    this.eax = state.eax;
    this.ecx = state.ecx;
    this.edx = state.edx;
    this.ebx = state.ebx;
    this.esp = state.esp;
    this.ebp = state.ebp;
    this.esi = state.esi;
    this.edi = state.edi;
    this.eip = state.eip;
    this.eflags = state.eflags;
    this.cs = state.cs;
    this.ds = state.ds;
    this.es = state.es;
    this.ss = state.ss;
    this.fs = state.fs;
    this.gs = state.gs;
    this.halted = state.halted;
    this._interruptShadow = state.interruptShadow;
    this._nmiShadow = state.nmiShadow;
    this._debugShadow = state.debugShadow;
    this._nmiActive = state.nmiActive;
    this.segmentCaches = {
      0: { ...state.segmentCaches[0] },
      1: { ...state.segmentCaches[1] },
      2: { ...state.segmentCaches[2] },
      3: { ...state.segmentCaches[3] },
      4: { ...state.segmentCaches[4] },
      5: { ...state.segmentCaches[5] },
    };
    this._repeatContext = state.repeatContext
      ? { ...state.repeatContext }
      : null;
    this.ldtr = { ...state.ldtr };
    this.tr = { ...state.tr };
  }

  _faultClass(vector) {
    if (vector === 14) return "page";
    if ([0, 9, 10, 11, 12, 13].includes(vector)) return "contributory";
    return "benign";
  }

  _formsDoubleFault(first, second) {
    const a = this._faultClass(first),
      b = this._faultClass(second);
    return (
      (a === "contributory" && b === "contributory") ||
      (a === "page" && (b === "contributory" || b === "page"))
    );
  }

  _stackFrame(width, values) {
    const frame = this._prepareStackFrame(width, values);
    this._commitStackFrame(frame);
  }

  _prepareStackFrame(width, values) {
    const bytes = width >>> 3,
      stack32 = !!this.segmentCaches[SEG_SS].default32,
      old = stack32 ? this.esp : this.sp,
      next = stack32
        ? (old - bytes * values.length) >>> 0
        : (old - bytes * values.length) & 0xffff;
    const address = this._linear(SEG_SS, next, bytes * values.length);
    const physical = Array.from({ length: bytes * values.length }, (_, i) =>
      this._translate((address + i) >>> 0, { write: true }),
    );
    return { bytes, stack32, next, physical, values };
  }

  _commitStackFrame(frame) {
    for (let i = 0; i < frame.values.length; i++)
      for (let byte = 0; byte < frame.bytes; byte++)
        this.write(
          frame.physical[i * frame.bytes + byte],
          (frame.values[i] >>> (8 * byte)) & 255,
        );
    if (frame.stack32) this.esp = frame.next;
    else this.sp = frame.next;
  }

  _protectedCodeDescriptor(selector, external) {
    const code = (selector & 0xfffc) | (external ? 1 : 0);
    if (!(selector & 0xfffc))
      throw new I80386Fault(13, code, "null handler selector");
    const table = selector & 4 ? this.ldtr : this.gdtr;
    if (selector & 4 && !table.present)
      throw new I80386Fault(13, code, "LDT is not loaded");
    const off = selector & 0xfff8;
    if (off + 7 > table.limit)
      throw new I80386Fault(
        13,
        code,
        "handler selector outside descriptor table",
      );
    const a = (table.base + off) >>> 0;
    const b = Array.from({ length: 8 }, (_, i) =>
      this._readLinear((a + i) >>> 0, 1, { supervisor: true }),
    );
    const access = b[5],
      flags = b[6];
    if (!(access & 0x10) || !(access & 8))
      throw new I80386Fault(13, code, "unsupported handler code descriptor");
    if (access & 4)
      throw new UnsupportedI80386(
        "conforming handler code is outside the bounded profile",
      );
    if (((access >>> 5) & 3) !== 0)
      throw new I80386Fault(
        13,
        code,
        "handler code is less privileged than CPL",
      );
    if (!(access & 0x80))
      throw new I80386Fault(11, code, "handler code not present");
    let limit = (b[0] | (b[1] << 8) | ((flags & 15) << 16)) >>> 0;
    if (flags & 0x80) limit = ((limit << 12) | 0xfff) >>> 0;
    return {
      base: (b[2] | (b[3] << 8) | (b[4] << 16) | (b[7] * 0x1000000)) >>> 0,
      limit,
      default32: !!(flags & 0x40),
      present: true,
      code: true,
      readable: !!(access & 2),
      writable: false,
      access,
      address: a,
    };
  }

  _ringCodeDescriptor(selector, external = false, deferPresent = false) {
    const code = (selector & 0xfffc) | (external ? 1 : 0);
    if (!(selector & 0xfffc))
      throw new I80386Fault(13, code, "null code selector");
    let raw;
    try {
      raw = this._descriptorBytes(selector);
    } catch (error) {
      if (external && error instanceof I80386Fault && error.errorCode)
        error.errorCode |= 1;
      throw error;
    }
    const { address, bytes } = raw;
    const access = bytes[5],
      flags = bytes[6];
    if (!(access & 0x10) || !(access & 8))
      throw new I80386Fault(13, code, "selector does not name code");
    if (!(access & 0x80) && !deferPresent)
      throw new I80386Fault(11, code, "code segment not present");
    let limit = (bytes[0] | (bytes[1] << 8) | ((flags & 15) << 16)) >>> 0;
    if (flags & 0x80) limit = ((limit << 12) | 0xfff) >>> 0;
    return {
      base:
        (bytes[2] |
          (bytes[3] << 8) |
          (bytes[4] << 16) |
          (bytes[7] * 0x1000000)) >>>
        0,
      limit,
      default32: !!(flags & 0x40),
      code: true,
      readable: !!(access & 2),
      writable: false,
      access,
      address,
      dpl: (access >>> 5) & 3,
      conforming: !!(access & 4),
      present: !!(access & 0x80),
    };
  }

  _ringStackDescriptor(
    selector,
    cpl,
    { external = false, returnPath = false } = {},
  ) {
    const code = (selector & 0xfffc) | (external ? 1 : 0);
    if (!(selector & 0xfffc))
      throw new I80386Fault(
        13,
        returnPath ? 0 : external ? 1 : 0,
        "null stack selector",
      );
    let raw;
    try {
      raw = this._descriptorBytes(selector);
    } catch (error) {
      if (error instanceof I80386Fault) {
        if (!returnPath && error.vector === 13) error.vector = 10;
        if (external && error.errorCode) error.errorCode |= 1;
      }
      throw error;
    }
    const { address, bytes } = raw;
    const access = bytes[5],
      flags = bytes[6],
      dpl = (access >>> 5) & 3;
    if (
      !(access & 0x10) ||
      access & 8 ||
      !(access & 2) ||
      (selector & 3) !== cpl ||
      dpl !== cpl
    )
      throw new I80386Fault(
        returnPath ? 13 : 10,
        code,
        "invalid privilege stack descriptor",
      );
    if (!(access & 0x80))
      throw new I80386Fault(
        returnPath ? 11 : 12,
        code,
        "privilege stack not present",
      );
    let limit = (bytes[0] | (bytes[1] << 8) | ((flags & 15) << 16)) >>> 0;
    if (flags & 0x80) limit = ((limit << 12) | 0xfff) >>> 0;
    return {
      base:
        (bytes[2] |
          (bytes[3] << 8) |
          (bytes[4] << 16) |
          (bytes[7] * 0x1000000)) >>>
        0,
      limit,
      default32: !!(flags & 0x40),
      present: true,
      code: false,
      expandDown: !!(access & 4),
      readable: true,
      writable: true,
      access,
      address,
    };
  }

  _innerInterruptStack(cpl, width, values, external, callGate = false) {
    const trCode = (this.tr.selector & 0xfffc) | (external ? 1 : 0);
    if (this.tr.type !== 9 && this.tr.type !== 11)
      throw new UnsupportedI80386(
        "286 TSS privilege stacks are outside the bounded 386 profile",
      );
    const stackEnd = 9 + cpl * 8;
    if (!this.tr.present || this.tr.limit < stackEnd)
      throw new I80386Fault(10, trCode, "TSS lacks privilege stack");
    const esp = this._readLinear((this.tr.base + 4 + cpl * 8) >>> 0, 4, {
      supervisor: true,
    });
    const ss = this._readLinear((this.tr.base + 8 + cpl * 8) >>> 0, 2, {
      supervisor: true,
    });
    if (callGate && !(ss & 0xfffc))
      throw new I80386Fault(10, 0, "null call-gate stack selector");
    const descriptor = this._ringStackDescriptor(ss, cpl, { external });
    const bytes = width >>> 3;
    const next = descriptor.default32
      ? (esp - bytes * values.length) >>> 0
      : ((esp & 0xffff) - bytes * values.length) & 0xffff;
    const end = next + bytes * values.length - 1;
    const outside = descriptor.expandDown
      ? next <= descriptor.limit || end > (descriptor.default32 ? 0xffffffff : 0xffff)
      : end > descriptor.limit;
    if (end < next || outside || end > 0xffffffff)
      throw new I80386Fault(12, 0, "new privilege stack limit");
    const linear = (descriptor.base + next) >>> 0;
    const physical = Array.from({ length: bytes * values.length }, (_, index) =>
      this._translate((linear + index) >>> 0, {
        write: true,
        supervisor: true,
      }),
    );
    const committedEsp = descriptor.default32
      ? next
      : ((esp & 0xffff0000) | next) >>> 0;
    return { ss, esp: committedEsp, descriptor, physical, bytes, values };
  }

  _commitInnerInterruptStack(frame) {
    for (let index = 0; index < frame.values.length; index++)
      for (let byte = 0; byte < frame.bytes; byte++)
        this.write(
          frame.physical[index * frame.bytes + byte],
          (frame.values[index] >>> (8 * byte)) & 0xff,
        );
    this.ss = frame.ss;
    this.segmentCaches[SEG_SS] = frame.descriptor;
    this.esp = frame.esp;
  }

  _deliverReal(vector, returnEip) {
    const entry = vector * 4;
    if (entry + 3 > this.idtr.limit)
      throw new I80386Fault(13, 0, "real-mode interrupt outside IDT");
    const address = (this.idtr.base + entry) >>> 0;
    const ip = this._readLinear(address, 2, { supervisor: true }),
      cs = this._readLinear(address + 2, 2, { supervisor: true });
    this._stackFrame(16, [returnEip & 0xffff, this.cs, this.eflags]);
    this.eflags &= ~(IF | TF);
    this._loadSeg(SEG_CS, cs);
    this.eip = ip;
  }

  _deliverProtected(
    vector,
    returnEip,
    errorCode,
    { software = false, external = false, fault = false } = {},
  ) {
    const idtCode = (vector << 3) | 2 | (external ? 1 : 0),
      entry = vector * 8;
    if (entry + 7 > this.idtr.limit)
      throw new I80386Fault(13, idtCode, "interrupt outside IDT");
    const a = (this.idtr.base + entry) >>> 0;
    const b = Array.from({ length: 8 }, (_, i) =>
      this._readLinear((a + i) >>> 0, 1, { supervisor: true }),
    );
    const access = b[5],
      type = access & 31,
      dpl = (access >>> 5) & 3;
    if (type === 5) {
      if (software && dpl < this.currentPrivilegeLevel)
        throw new I80386Fault(13, idtCode, "software task gate privilege");
      if (!(access & 0x80))
        throw new I80386Fault(11, idtCode, "IDT task gate not present");
      this._taskSwitch(b[2] | b[3] << 8, "call", {
        checkPrivilege: false,
        errorCode,
        external,
        saveEip: returnEip,
        saveFlags: fault ? this.eflags | RF : this.eflags,
      });
      return;
    }
    if (![6, 7, 14, 15].includes(type) || b[4] !== 0)
      throw new I80386Fault(13, idtCode, "unsupported IDT gate");
    const vm86 = this.virtual8086;
    if (software && dpl < this.currentPrivilegeLevel)
      throw new I80386Fault(13, idtCode, "software interrupt gate privilege");
    if (!(access & 0x80))
      throw new I80386Fault(11, idtCode, "IDT gate not present");
    const selector = b[2] | (b[3] << 8),
      descriptor = this._ringCodeDescriptor(selector, external),
      oldCpl = this.currentPrivilegeLevel,
      targetCpl = descriptor.conforming ? oldCpl : descriptor.dpl;
    if (descriptor.dpl > oldCpl)
      throw new I80386Fault(
        13,
        (selector & 0xfffc) | (external ? 1 : 0),
        "interrupt target privilege",
      );
    const width = type >= 14 ? 32 : 16;
    if (vm86 && (descriptor.conforming || descriptor.dpl !== 0))
      throw new I80386Fault(
        13,
        (selector & 0xfffc) | (external ? 1 : 0),
        "VM86 interrupt target must be nonconforming ring 0 code",
      );
    if (vm86 && width !== 32)
      throw new UnsupportedI80386(
        "16-bit VM86 interrupt gates are outside the bounded profile",
      );
    const offset =
      (b[0] |
        (b[1] << 8) |
        (width === 32 ? (b[6] | (b[7] << 8)) * 0x10000 : 0)) >>>
      0;
    const savedFlags = fault ? this.eflags | RF : this.eflags;
    const values = [returnEip, this.cs, savedFlags];
    let innerFrame = null,
      sameFrame = null;
    if (targetCpl < oldCpl) {
      values.push(this.esp, this.ss);
      if (vm86) values.push(this.es, this.ds, this.fs, this.gs);
      if (errorCode !== null) values.unshift(errorCode);
      innerFrame = this._innerInterruptStack(
        targetCpl,
        width,
        values,
        external,
      );
    } else {
      if (errorCode !== null) values.unshift(errorCode);
      sameFrame = this._prepareStackFrame(width, values);
    }
    if (offset > descriptor.limit)
      throw new I80386Fault(13, 0, "handler offset outside code segment");
    this._markAccessed(descriptor);
    if (innerFrame) this._markAccessed(innerFrame.descriptor);
    if (innerFrame) this._commitInnerInterruptStack(innerFrame);
    else this._commitStackFrame(sameFrame);
    this.cs = (selector & 0xfffc) | targetCpl;
    this.segmentCaches[SEG_CS] = descriptor;
    if (vm86) {
      for (const id of [SEG_ES, SEG_DS, SEG_FS, SEG_GS]) {
        this._setSegValue(id, 0);
        this.segmentCaches[id] = {
          base: 0,
          limit: 0,
          default32: false,
          present: false,
          null: true,
          code: false,
          readable: false,
          writable: false,
        };
      }
    }
    this.eip = width === 32 ? offset : offset & 0xffff;
    this.eflags &= ~(TF | NT | RF | 0x20000);
    if (type === 6 || type === 14) this.eflags &= ~IF;
  }

  _deliver(vector, returnEip, errorCode = null, options = {}) {
    if (this.protectedMode)
      this._deliverProtected(vector, returnEip, errorCode, options);
    else this._deliverReal(vector, returnEip);
    this.halted = false;
  }

  _deliverFault(fault, returnEip, { trap = false, external = false } = {}) {
    let first = fault.vector,
      current = fault,
      currentIsTrap = trap;
    for (;;) {
      try {
        this._deliver(current.vector, returnEip, current.errorCode, {
          external,
          fault: !currentIsTrap && current.vector !== 8,
        });
        return;
      } catch (next) {
        if (!(next instanceof I80386Fault)) throw next;
        if (next.taskCommitted) returnEip = this.eip;
        if (current.vector === 8) {
          this.shutdown = true;
          return;
        }
        if (this._formsDoubleFault(first, next.vector)) {
          current = new I80386Fault(8, 0, "double fault");
          first = 8;
        } else {
          current = next;
          first = next.vector;
        }
        currentIsTrap = false;
      }
    }
  }

  interrupt(vector, { nmi = false } = {}) {
    if (
      this.shutdown ||
      (nmi
        ? this._nmiShadow || this._nmiActive
        : !(this.eflags & IF) || this._interruptShadow)
    )
      return false;
    if (nmi) this._nmiActive = true;
    this._repeatContext = null;
    try {
      this._deliver(vector & 255, this.eip, null, { external: true });
      return true;
    } catch (error) {
      if (!(error instanceof I80386Fault)) {
        if (nmi) this._nmiActive = false;
        throw error;
      }
      this._deliverFault(error, this.eip, { external: true });
      return !this.shutdown;
    }
  }

  _shift(value, width, operation, count) {
    count &= 31;
    if (count === 0) return value;
    const mask = maskFor(width);
    const sign = width === 32 ? 0x80000000 : width === 16 ? 0x8000 : 0x80;
    const original = value & mask;
    if (operation <= 3) {
      const maskedCount = count;
      if (operation <= 1) count %= width;
      else if (width < 32) count %= width + 1;
      if (count === 0) {
        if (operation === 0)
          this.eflags = (this.eflags & ~CF) | (original & 1 ? CF : 0);
        else if (operation === 1)
          this.eflags = (this.eflags & ~CF) | (original & sign ? CF : 0);
        return width === 32 ? original >>> 0 : original;
      }
      let result = original;
      let carry = this.eflags & CF ? 1 : 0;
      for (let index = 0; index < count; index++) {
        if (operation === 0) {
          carry = result & sign ? 1 : 0;
          result = ((result << 1) | carry) & mask;
        } else if (operation === 1) {
          carry = result & 1;
          result = (result >>> 1) | (carry ? sign : 0);
        } else if (operation === 2) {
          const nextCarry = result & sign ? 1 : 0;
          result = ((result << 1) | carry) & mask;
          carry = nextCarry;
        } else {
          const nextCarry = result & 1;
          result = (result >>> 1) | (carry ? sign : 0);
          carry = nextCarry;
        }
      }
      this.eflags = (this.eflags & ~CF) | (carry ? CF : 0);
      if (maskedCount === 1) {
        this.eflags &= ~OF;
        const overflow =
          operation === 1 || operation === 3
            ? !!(result & sign) !== !!(result & (sign >>> 1))
            : !!(result & sign) !== !!carry;
        if (overflow) this.eflags |= OF;
      }
      return width === 32 ? result >>> 0 : result;
    }
    let result;
    let carry;
    if (operation === 4) {
      carry = count <= width ? (original >>> (width - count)) & 1 : 0;
      result = (original * 2 ** count) & mask;
    } else if (operation === 5) {
      carry = count <= width ? (original >>> (count - 1)) & 1 : 0;
      result = count >= width ? 0 : original >>> count;
    } else if (operation === 7) {
      const signed =
        width === 32
          ? original | 0
          : width === 16
            ? (original << 16) >> 16
            : (original << 24) >> 24;
      carry =
        count <= width
          ? (original >>> (count - 1)) & 1
          : original & sign
            ? 1
            : 0;
      result = count >= width ? (signed < 0 ? mask : 0) : signed >> count;
      result &= mask;
    } else {
      throw new UnsupportedI80386(`shift extension ${operation}`);
    }
    this.eflags &= ~(CF | PF | ZF | SF | OF);
    if (carry) this.eflags |= CF;
    if (!result) this.eflags |= ZF;
    if (result & sign) this.eflags |= SF;
    if (parity8(result)) this.eflags |= PF;
    if (count === 1) {
      if (operation === 4 && !!(result & sign) !== !!carry) this.eflags |= OF;
      if (operation === 5 && original & sign) this.eflags |= OF;
    }
    return width === 32 ? result >>> 0 : result;
  }

  _doubleShift(destination, source, width, count, right) {
    count &= 31;
    if (count === 0) return destination;
    const bits = BigInt(width);
    const mask = (1n << bits) - 1n;
    const dst = BigInt.asUintN(width, BigInt(destination));
    const src = BigInt.asUintN(width, BigInt(source));
    const shift = BigInt(count);
    const joined = right ? (src << bits) | dst : (dst << bits) | src;
    const raw = right
      ? joined >> shift
      : (joined << shift) >> bits;
    const result = Number(raw & mask);
    const carry = right
      ? Number((joined >> (shift - 1n)) & 1n)
      : Number((joined >> (bits * 2n - shift)) & 1n);
    const sign = width === 32 ? 0x80000000 : 0x8000;
    this.eflags &= ~(CF | PF | ZF | SF | OF);
    if (carry) this.eflags |= CF;
    if (result === 0) this.eflags |= ZF;
    if (result & sign) this.eflags |= SF;
    if (parity8(result)) this.eflags |= PF;
    if (count === 1) {
      const overflow = right
        ? !!(destination & sign) !== !!(result & sign)
        : !!(result & sign) !== !!carry;
      if (overflow) this.eflags |= OF;
    }
    return width === 32 ? result >>> 0 : result;
  }

  _iret(width) {
    if (this.protectedMode && !this.virtual8086 && this.eflags & NT) {
      if (!this.tr.present || this.tr.limit < 1)
        throw new I80386Fault(10, this.tr.selector & 0xfffc, "current TSS backlink");
      this._taskSwitch(this._taskRead(this.tr.base, 0, 2), "iret", {
        checkPrivilege: false,
      });
      return;
    }
    if (this.virtual8086 && ((this.eflags >>> 12) & 3) !== 3)
      throw new I80386Fault(13, 0, "VM86 IRET requires IOPL3");
    const bytes = width >>> 3,
      stack32 = !!this.segmentCaches[SEG_SS].default32;
    const old = stack32 ? this.esp : this.sp;
    const currentCpl = this.currentPrivilegeLevel;
    const address = this._linear(SEG_SS, old, bytes * 3);
    const target = this._readLinear(address, bytes);
    const selector = this._readLinear(address + bytes, bytes) & 0xffff;
    const flags = this._readLinear(address + bytes * 2, bytes);
    if (this.virtual8086) {
      if (target > 0xffff)
        throw new I80386Fault(13, 0, "VM86 IRET target exceeds 16 bits");
      this._loadSeg(SEG_CS, selector);
      if (stack32) this.esp = (old + bytes * 3) >>> 0;
      else this.sp = (old + bytes * 3) & 0xffff;
      this.eip = width === 32 ? target >>> 0 : target & 0xffff;
      const writable = width === 32 ? 0x14fd5 : 0x4fd5;
      this.eflags = ((this.eflags & ~writable) | (flags & writable) | 2) >>> 0;
      this._preserveRf = true;
      this._nmiActive = false;
      return;
    }
    if (this.protectedMode && currentCpl === 0 && flags & 0x20000) {
      if (width !== 32)
        throw new I80386Fault(13, 0, "VM86 return requires IRETD");
      this._linear(SEG_SS, old, 9 * 4);
      if (target > 0xffff)
        throw new I80386Fault(13, 0, "VM86 return EIP exceeds 16 bits");
      const newEsp = this._readLinear(address + 12, 4);
      const selectors = [
        this._readLinear(address + 20, 4) & 0xffff,
        selector,
        this._readLinear(address + 16, 4) & 0xffff,
        this._readLinear(address + 24, 4) & 0xffff,
        this._readLinear(address + 28, 4) & 0xffff,
        this._readLinear(address + 32, 4) & 0xffff,
      ];
      const restored = ((flags & 0x00037fd7) | 2 | 0x20000) >>> 0;
      this.eip = target >>> 0;
      this.esp = newEsp >>> 0;
      this.eflags = restored;
      for (let id = 0; id < selectors.length; id++) {
        this._setSegValue(id, selectors[id]);
        this.segmentCaches[id] = this._virtualSegmentCache(id, selectors[id]);
      }
      this._preserveRf = true;
      this._nmiActive = false;
      return;
    }
    if (this.protectedMode) {
      const returnCpl = selector & 3;
      if (returnCpl < currentCpl)
        throw new I80386Fault(13, selector & 0xfffc, "IRET return privilege");
      const outer = returnCpl > currentCpl;
      if (outer) this._linear(SEG_SS, old, bytes * 5);
      const descriptor = this._ringCodeDescriptor(selector, false, true);
      const invalidCodePrivilege = descriptor.conforming
        ? descriptor.dpl > returnCpl || (outer && descriptor.dpl <= currentCpl)
        : descriptor.dpl !== returnCpl;
      if (invalidCodePrivilege)
        throw new I80386Fault(13, selector & 0xfffc, "IRET code privilege");
      if (!descriptor.present)
        throw new I80386Fault(11, selector & 0xfffc, "IRET code not present");
      let newEsp, newSs, stackDescriptor;
      if (outer) {
        newEsp = this._readLinear(address + bytes * 3, bytes);
        newSs = this._readLinear(address + bytes * 4, bytes) & 0xffff;
        stackDescriptor = this._ringStackDescriptor(newSs, returnCpl, {
          returnPath: true,
        });
      }
      if (target > descriptor.limit)
        throw new I80386Fault(13, 0, "IRET target outside code segment");
      this._markAccessed(descriptor);
      if (stackDescriptor) this._markAccessed(stackDescriptor);
      this.cs = selector;
      this.segmentCaches[SEG_CS] = descriptor;
      if (outer) {
        this.ss = newSs;
        this.segmentCaches[SEG_SS] = stackDescriptor;
        if (width === 32) this.esp = newEsp >>> 0;
        else this.sp = newEsp & 0xffff;
        this._invalidateOuterDataSegments(returnCpl);
      }
    } else {
      if (target > 0xffff)
        throw new I80386Fault(13, 0, "real-mode IRET target exceeds CS limit");
      this._loadSeg(SEG_CS, selector);
    }
    if (!this.protectedMode || (selector & 3) === currentCpl) {
      if (stack32) this.esp = (old + bytes * 3) >>> 0;
      else this.sp = (old + bytes * 3) & 0xffff;
    }
    this.eip = width === 32 ? target >>> 0 : target & 0xffff;
    let restored =
      width === 32 ? flags >>> 0 : ((this.eflags & 0xffff0000) | flags) >>> 0;
    restored &= 0x00037fd7;
    if (this.protectedMode) {
      const oldIopl = (this.eflags >>> 12) & 3;
      if (currentCpl !== 0)
        restored = (restored & ~0x3000) | (this.eflags & 0x3000);
      if (currentCpl > oldIopl)
        restored = (restored & ~IF) | (this.eflags & IF);
      restored &= ~0x20000;
    }
    this.eflags = (restored | 2) >>> 0;
    this._preserveRf = true;
    this._nmiActive = false;
  }

  step() {
    if (this.halted || this.shutdown) return 0;
    const state = this._snapshotInstruction(),
      restartEip = this.eip >>> 0;
    const trace = !!(this.eflags & TF),
      debugInhibited = this._debugShadow > 0;
    this._suppressTrace = false;
    this._preserveRf = false;
    try {
      const result = this._stepInstruction();
      this.eip >>>= 0;
      const suppressDebug = debugInhibited || this._debugShadow > 0;
      if (this._interruptShadow) this._interruptShadow--;
      if (this._nmiShadow) this._nmiShadow--;
      if (this._debugShadow) this._debugShadow--;
      if (!this._preserveRf) this.eflags &= ~RF;
      if (trace && !suppressDebug && !this._suppressTrace)
        this._repeatContext = null;
      if (trace && !suppressDebug && !this._suppressTrace)
        this._deliverFault(new I80386Fault(1, null, "single-step"), this.eip, {
          trap: true,
        });
      return result;
    } catch (error) {
      if (error instanceof UnsupportedI80386) {
        if (!error.taskCommitted) this._restoreInstruction(state);
        throw error;
      }
      if (!(error instanceof I80386Fault)) throw error;
      const repeatFlags =
        error.repeatFlags ??
        (state.repeatContext?.cs === state.cs &&
        state.repeatContext?.eip === restartEip
          ? state.repeatContext.flags
          : null);
      if (!error.taskCommitted) this._restoreInstruction(state);
      if (repeatFlags !== null) {
        this.eflags = repeatFlags >>> 0;
        this._repeatContext = null;
      }
      if (!this.deliverFaults) throw error;
      this._deliverFault(error, error.taskCommitted ? this.eip : restartEip);
      return 0;
    }
  }

  _stepInstruction() {
    if (this.halted) return 0;
    this._instructionBytes = 0;
    const instructionStart = this.eip >>> 0;
    const default32 = !!this.segmentCaches[SEG_CS].default32;
    let operand32 = default32,
      address32 = default32,
      override = null,
      repeat = null,
      lock = false,
      op;
    do {
      op = this._fetch8();
      if (op === 0x66) operand32 = !default32;
      else if (op === 0x67) address32 = !default32;
      else if (op === 0x26) override = SEG_ES;
      else if (op === 0x2e) override = SEG_CS;
      else if (op === 0x36) override = SEG_SS;
      else if (op === 0x3e) override = SEG_DS;
      else if (op === 0x64) override = SEG_FS;
      else if (op === 0x65) override = SEG_GS;
      else if (op === 0xf2 || op === 0xf3) repeat = op;
      else if (op === 0xf0) {
        this._checkVmIopl("LOCK");
        lock = true;
      }
      else break;
    } while (true);
    if (lock)
      throw new UnsupportedI80386(
        "LOCK execution is outside the bounded 386 profile",
      );
    const width = operand32 ? 32 : 16;
    const stringOpcodes = [
      0xa4, 0xa5, 0xa6, 0xa7, 0xaa, 0xab, 0xac, 0xad, 0xae, 0xaf,
    ];
    const repeatIoOpcodes = [0x6c, 0x6d, 0x6e, 0x6f];
    if (
      repeat !== null &&
      !stringOpcodes.includes(op) &&
      !repeatIoOpcodes.includes(op)
    )
      throw new I80386Fault(6, null, "REP prefix on non-string instruction");
    if (op < 0x40 && (op & 7) >= 4 && (op & 7) <= 5) {
      const byte = !(op & 1),
        operation = op & 0x38,
        operandWidth = byte ? 8 : width,
        left = byte ? this.al : this._reg(0, operandWidth),
        right = this._fetchN(operandWidth >>> 3);
      const result = this._alu(operation, left, right, operandWidth);
      if (result !== null) {
        if (byte) this.al = result;
        else this._setReg(0, operandWidth, result);
      }
    } else if (repeatIoOpcodes.includes(op)) {
      if (repeat === null) this._stringIo(op, width, address32, override);
      else this._repeatIo(op, width, address32, override, instructionStart);
    } else if (stringOpcodes.includes(op)) {
      if (repeat === null) this._string(op, width, address32, override);
      else
        this._repeatString(
          op,
          width,
          address32,
          override,
          repeat,
          instructionStart,
        );
    } else if (op === 0xa8 || op === 0xa9) {
      const testWidth = op === 0xa8 ? 8 : width;
      const left = testWidth === 8 ? this.al : this._reg(0, testWidth);
      this._setLogic(left & this._fetchN(testWidth >>> 3), testWidth);
    } else if (op === 0xd7) {
      const base = address32 ? this.ebx >>> 0 : this.bx;
      const offset = address32 ? (base + this.al) >>> 0 : (base + this.al) & 0xffff;
      this.al = this._read(override ?? SEG_DS, offset, 8);
    } else if (op >= 0xa0 && op <= 0xa3) {
      const moveWidth = op & 1 ? width : 8;
      const offset = this._fetchN(address32 ? 4 : 2);
      const segment = override ?? SEG_DS;
      if (op & 2) {
        const value = moveWidth === 8 ? this.al : this._reg(0, moveWidth);
        this._write(segment, offset, moveWidth, value);
      } else {
        const value = this._read(segment, offset, moveWidth);
        if (moveWidth === 8) this.al = value;
        else this._setReg(0, moveWidth, value);
      }
    } else if (op >= 0xb0 && op <= 0xb7)
      this._setReg8(op - 0xb0, this._fetch8());
    else if (op >= 0xb8 && op <= 0xbf)
      this._setReg(op - 0xb8, width, this._fetchN(width >>> 3));
    else if (op >= 0x50 && op <= 0x57)
      this._push(this._reg(op - 0x50, width), width);
    else if (op >= 0x58 && op <= 0x5f)
      this._setReg(op - 0x58, width, this._pop(width));
    else if ([0x06, 0x0e, 0x16, 0x1e].includes(op))
      this._pushSegment([SEG_ES, SEG_CS, SEG_SS, SEG_DS][op >>> 3], width);
    else if ([0x07, 0x17, 0x1f].includes(op))
      this._popSegment(
        op === 0x07 ? SEG_ES : op === 0x17 ? SEG_SS : SEG_DS,
        width,
      );
    else if (op === 0x60) this._pusha(width);
    else if (op === 0x61) this._popa(width);
    else if (op === 0x62) {
      const ea = this._decodeEA(address32, override);
      if (ea.isReg)
        throw new I80386Fault(6, null, "BOUND requires a memory operand");
      const cache = this.segmentCaches[ea.seg];
      if (
        this.protectedMode &&
        !this.virtual8086 &&
        cache.code &&
        !cache.readable
      )
        throw new I80386Fault(13, 0, "BOUND source is execute-only");
      const bytes = width >>> 3;
      const address = this._linear(ea.seg, ea.off, bytes * 2);
      const signed = (value) =>
        width === 32 ? value | 0 : (value << 16) >> 16;
      const lower = signed(this._readLinear(address, bytes));
      const upper = signed(this._readLinear((address + bytes) >>> 0, bytes));
      const value = signed(this._reg(ea.reg, width));
      if (value < lower || value > upper)
        throw new I80386Fault(5, null, "BOUND range exceeded");
    } else if (op === 0x63) {
      if (!this.protectedMode || this.virtual8086)
        throw new I80386Fault(6, null, "ARPL is undefined outside protected mode");
      const ea = this._decodeEA(address32, override);
      this._operandPreflightWrite(ea, 16);
      const destination = this._operandRead(ea, 16);
      const sourceRpl = this._reg(ea.reg, 16) & 3;
      if ((destination & 3) < sourceRpl) {
        this._operandWrite(ea, 16, (destination & ~3) | sourceRpl);
        this.eflags |= ZF;
      } else {
        this.eflags &= ~ZF;
      }
    } else if (op === 0x69 || op === 0x6b) {
      const ea = this._decodeEA(address32, override);
      const source = BigInt.asIntN(width, BigInt(this._operandRead(ea, width)));
      const rawImmediate = op === 0x69
        ? this._fetchN(width >>> 3)
        : (this._fetch8() << 24) >> 24;
      const immediate = BigInt.asIntN(width, BigInt(rawImmediate));
      const product = source * immediate;
      this._setReg(ea.reg, width, Number(BigInt.asUintN(width, product)));
      this.eflags &= ~(CF | OF);
      if (product !== BigInt.asIntN(width, product)) this.eflags |= CF | OF;
    } else if (op >= 0x90 && op <= 0x97) {
      const register = op - 0x90;
      const accumulator = this._reg(0, width);
      this._setReg(0, width, this._reg(register, width));
      this._setReg(register, width, accumulator);
    } else if (op === 0x98) {
      if (width === 32) this.eax = ((this.ax << 16) >> 16) >>> 0;
      else this.ax = (this.al << 24) >> 24;
    } else if (op === 0x99) {
      if (width === 32) this.edx = this.eax & 0x80000000 ? 0xffffffff : 0;
      else this.dx = this.ax & 0x8000 ? 0xffff : 0;
    } else if (op === 0x9b) {
      if ((this.cr0 & 0x0a) === 0x0a)
        throw new I80386Fault(7, null, "WAIT with MP and TS set");
    } else if (op >= 0xd8 && op <= 0xdf) {
      if (this.cr0 & 0x0c)
        throw new I80386Fault(7, null, "ESC with EM or TS set");
      const operand = this._decodeEA(address32, override);
      if (this._coprocessorProfile !== "none")
        throw new UnsupportedI80386(
          "x87 execution requires an external coprocessor backend",
        );
      // With no external NPX, the CPU decodes the ESC and its effective
      // address but no coprocessor exists to consume or produce operand data.
      // In particular, store-form ESC instructions leave memory unchanged.
      void operand;
    } else if (op >= 0x40 && op <= 0x47) {
      const n = op - 0x40,
        cf = this.eflags & CF;
      this._setReg(n, width, this._add(this._reg(n, width), 1, width));
      this.eflags = (this.eflags & ~CF) | cf;
    } else if (op >= 0x48 && op <= 0x4f) {
      const n = op - 0x48,
        cf = this.eflags & CF;
      this._setReg(n, width, this._add(this._reg(n, width), 1, width, true));
      this.eflags = (this.eflags & ~CF) | cf;
    } else if (op === 0x84 || op === 0x85) {
      const testWidth = op === 0x84 ? 8 : width;
      const ea = this._decodeEA(address32, override);
      const source = testWidth === 8
        ? this._reg8(ea.reg)
        : this._reg(ea.reg, testWidth);
      this._setLogic(this._operandRead(ea, testWidth) & source, testWidth);
    } else if (op === 0x86 || op === 0x87) {
      const exchangeWidth = op === 0x86 ? 8 : width;
      const ea = this._decodeEA(address32, override);
      this._operandPreflightWrite(ea, exchangeWidth);
      const memoryOrRegister = this._operandRead(ea, exchangeWidth);
      const register =
        exchangeWidth === 8
          ? this._reg8(ea.reg)
          : this._reg(ea.reg, exchangeWidth);
      this._operandWrite(ea, exchangeWidth, register);
      if (exchangeWidth === 8) this._setReg8(ea.reg, memoryOrRegister);
      else this._setReg(ea.reg, exchangeWidth, memoryOrRegister);
    } else if (op === 0x8f) {
      const oldEsp = this.esp >>> 0;
      const ea = this._decodeEA(address32, override);
      if (ea.reg !== 0)
        throw new I80386Fault(6, null, "invalid POP r/m extension");
      const value = this._pop(width);
      if (ea.usesEsp) ea.off = (ea.off - oldEsp + this.esp) >>> 0;
      this._operandWrite(ea, width, value);
    } else if (op === 0x8d) {
      const ea = this._decodeEA(address32, override);
      if (ea.isReg)
        throw new I80386Fault(6, null, "LEA requires a memory encoding");
      this._setReg(ea.reg, width, ea.off);
    } else if (
      (op < 0x40 && (op & 7) <= 3 && !(op & 1)) ||
      op === 0x88 ||
      op === 0x8a
    ) {
      const ea = this._decodeEA(address32, override),
        toReg = !!(op & 2);
      if (op === 0x88) {
        this._operandWrite(ea, 8, this._reg8(ea.reg));
        this.cycles++;
        return 1;
      }
      if (op === 0x8a) {
        this._setReg8(ea.reg, this._operandRead(ea, 8));
        this.cycles++;
        return 1;
      }
      const operation = op & 0x38;
      if (!toReg && operation !== 0x38) this._operandPreflightWrite(ea, 8);
      const src = toReg ? this._operandRead(ea, 8) : this._reg8(ea.reg),
        dst = toReg ? this._reg8(ea.reg) : this._operandRead(ea, 8);
      const out = this._alu(operation, dst, src, 8);
      if (out !== null) {
        if (toReg) this._setReg8(ea.reg, out);
        else this._operandWrite(ea, 8, out);
      }
    } else if (
      (op < 0x40 && (op & 7) <= 3 && op & 1) ||
      op === 0x89 ||
      op === 0x8b
    ) {
      const ea = this._decodeEA(address32, override),
        toReg = !!(op & 2);
      if (op === 0x89) {
        this._operandWrite(ea, width, this._reg(ea.reg, width));
        this.cycles++;
        return 1;
      }
      if (op === 0x8b) {
        this._setReg(ea.reg, width, this._operandRead(ea, width));
        this.cycles++;
        return 1;
      }
      const operation = op & 0x38;
      if (!toReg && operation !== 0x38) this._operandPreflightWrite(ea, width);
      const src = toReg
          ? this._operandRead(ea, width)
          : this._reg(ea.reg, width),
        dst = toReg ? this._reg(ea.reg, width) : this._operandRead(ea, width);
      const out = this._alu(operation, dst, src, width);
      if (out !== null) {
        if (toReg) this._setReg(ea.reg, width, out);
        else this._operandWrite(ea, width, out);
      }
    } else if (op === 0xc4 || op === 0xc5) {
      this._farPointerLoad(
        op === 0xc4 ? SEG_ES : SEG_DS,
        width,
        address32,
        override,
      );
    } else if (op === 0xc6) {
      const ea = this._decodeEA(address32, override);
      if (ea.reg !== 0) throw new UnsupportedI80386("C6 extension");
      this._operandWrite(ea, 8, this._fetch8());
    } else if (op === 0xc7) {
      const ea = this._decodeEA(address32, override);
      if (ea.reg !== 0) throw new UnsupportedI80386("C7 extension");
      this._operandWrite(ea, width, this._fetchN(width >>> 3));
    } else if (op === 0xfe || op === 0xff) {
      this._group5(op, width, address32, override);
    } else if (op === 0xf6 || op === 0xf7) {
      this._group3(op, width, address32, override);
    } else if (op === 0x80 || op === 0x81 || op === 0x83) {
      const groupWidth = op === 0x80 ? 8 : width;
      const ea = this._decodeEA(address32, override),
        imm =
          op === 0x83
            ? (this._fetch8() << 24) >> 24
            : this._fetchN(groupWidth >>> 3);
      if (ea.reg !== 7) this._operandPreflightWrite(ea, groupWidth);
      const dst = this._operandRead(ea, groupWidth);
      let out;
      if (ea.reg === 0) out = this._add(dst, imm, groupWidth);
      else if (ea.reg === 1) out = this._setLogic(dst | imm, groupWidth);
      else if (ea.reg === 2)
        out = this._add(dst, imm, groupWidth, false, this.eflags & CF ? 1 : 0);
      else if (ea.reg === 3)
        out = this._add(dst, imm, groupWidth, true, this.eflags & CF ? 1 : 0);
      else if (ea.reg === 4) out = this._setLogic(dst & imm, groupWidth);
      else if (ea.reg === 5) out = this._add(dst, imm, groupWidth, true);
      else if (ea.reg === 6) out = this._setLogic(dst ^ imm, groupWidth);
      else if (ea.reg === 7) {
        this._add(dst, imm, groupWidth, true);
        out = null;
      } else throw new UnsupportedI80386("group-1 extension");
      if (out !== null) this._operandWrite(ea, groupWidth, out);
    } else if ([0xc0, 0xc1, 0xd0, 0xd1, 0xd2, 0xd3].includes(op)) {
      const byte = (op & 1) === 0;
      const shiftWidth = byte ? 8 : width;
      const ea = this._decodeEA(address32, override);
      const count = op < 0xd0 ? this._fetch8() : op < 0xd2 ? 1 : this.cl;
      this._operandPreflightWrite(ea, shiftWidth);
      const original = this._operandRead(ea, shiftWidth);
      if ((count & 31) !== 0)
        this._operandWrite(
          ea,
          shiftWidth,
          this._shift(original, shiftWidth, ea.reg, count),
        );
    } else if (op === 0x68) this._push(this._fetchN(width >>> 3), width);
    else if (op === 0x6a) this._push((this._fetch8() << 24) >> 24, width);
    else if (op === 0xe8) {
      const d = this._fetchN(width >>> 3),
        next = this.eip,
        target =
          width === 32
            ? (next + (d | 0)) >>> 0
            : (next + ((d << 16) >> 16)) & 0xffff;
      this._linear(SEG_CS, target, 1);
      this._push(next, width);
      this.eip = target;
    } else if (op === 0xe9) {
      const d = this._fetchN(width >>> 3),
        target =
          width === 32
            ? (this.eip + (d | 0)) >>> 0
            : (this.eip + ((d << 16) >> 16)) & 0xffff;
      this._linear(SEG_CS, target, 1);
      this.eip = target;
    } else if (op >= 0xe0 && op <= 0xe3) {
      const displacement = (this._fetch8() << 24) >> 24;
      let taken;
      if (op === 0xe3) taken = (address32 ? this.ecx : this.cx) === 0;
      else {
        if (address32) this.ecx = (this.ecx - 1) >>> 0;
        else this.cx = (this.cx - 1) & 0xffff;
        const nonzero = (address32 ? this.ecx : this.cx) !== 0;
        taken =
          nonzero &&
          (op === 0xe2 ||
            (op === 0xe1 ? !!(this.eflags & ZF) : !(this.eflags & ZF)));
      }
      if (taken) {
        const target =
          width === 32
            ? (this.eip + displacement) >>> 0
            : (this.eip + displacement) & 0xffff;
        this._linear(SEG_CS, target, 1);
        this.eip = target;
      }
    } else if (op === 0xeb) {
      const d = (this._fetch8() << 24) >> 24,
        target = width === 32 ? (this.eip + d) >>> 0 : (this.eip + d) & 0xffff;
      this._linear(SEG_CS, target, 1);
      this.eip = target;
    } else if (op >= 0x70 && op <= 0x7f) {
      const d = (this._fetch8() << 24) >> 24;
      if (this._condition(op & 15)) {
        const target =
          width === 32 ? (this.eip + d) >>> 0 : (this.eip + d) & 0xffff;
        this._linear(SEG_CS, target, 1);
        this.eip = target;
      }
    } else if (op === 0xca || op === 0xcb) {
      this._farRealReturn(width, op === 0xca ? this._fetchN(2) : 0);
    } else if (op === 0xc3) {
      const stack32 = !!this.segmentCaches[SEG_SS].default32,
        off = stack32 ? this.esp : this.sp,
        target = this._read(SEG_SS, off, width) >>> 0;
      this._linear(SEG_CS, target, 1);
      if (stack32) this.esp = (this.esp + (width >>> 3)) >>> 0;
      else this.sp = (this.sp + (width >>> 3)) & 0xffff;
      this.eip = target;
    } else if (op === 0xd4 || op === 0xd5) {
      const base = this._fetch8();
      if (op === 0xd4) {
        if (base === 0) throw new I80386Fault(0, null, "AAM divisor is zero");
        const value = this.al;
        this.ah = Math.floor(value / base);
        this.al = value % base;
      } else {
        this.al = (this.ah * base + this.al) & 0xff;
        this.ah = 0;
      }
      this.eflags &= ~(PF | ZF | SF);
      if (this.al === 0) this.eflags |= ZF;
      if (this.al & 0x80) this.eflags |= SF;
      if (parity8(this.al)) this.eflags |= PF;
    } else if (op === 0x9e)
      this.eflags = (this.eflags & ~0xd5) | (this.ah & 0xd5) | 2;
    else if (op === 0x9f) this.ah = (this.eflags | 2) & 0xff;
    else if (op === 0x9c) {
      this._checkVmIopl("PUSHF");
      this._push((this.eflags & 0x7fd5) | 2, width);
    } else if (op === 0x9d) {
      this._checkVmIopl("POPF");
      this._popFlags(width);
    }
    else if ([0xe4, 0xe5, 0xec, 0xed].includes(op)) {
      const port = op < 0xec ? this._fetch8() : this.dx,
        ioWidth = op === 0xe4 || op === 0xec ? 8 : width;
      this._checkIo(port, ioWidth);
      const value = this.inPort(port, ioWidth) >>> 0;
      if (ioWidth === 8) this._setReg8(0, value);
      else this._setReg(0, ioWidth, value);
    } else if ([0xe6, 0xe7, 0xee, 0xef].includes(op)) {
      const port = op < 0xee ? this._fetch8() : this.dx,
        ioWidth = op === 0xe6 || op === 0xee ? 8 : width;
      this._checkIo(port, ioWidth);
      this.outPort(
        port,
        ioWidth === 8 ? this._reg8(0) : this._reg(0, ioWidth),
        ioWidth,
      );
    } else if (op === 0xcc) {
      this._suppressTrace = true;
      this._deliver(3, this.eip, null, { software: true });
    } else if (op === 0xcd) {
      const vector = this._fetch8();
      this._checkVmIopl("INT");
      this._suppressTrace = true;
      this._deliver(vector, this.eip, null, { software: true });
    } else if (op === 0xcf) this._iret(width);
    else if (op === 0xfa) {
      if (this.protectedMode && this.currentPrivilegeLevel > ((this.eflags >>> 12) & 3))
        throw new I80386Fault(13, 0, "CLI requires CPL <= IOPL");
      this.eflags &= ~IF;
    } else if (op === 0xfb) {
      if (this.protectedMode && this.currentPrivilegeLevel > ((this.eflags >>> 12) & 3))
        throw new I80386Fault(13, 0, "STI requires CPL <= IOPL");
      this.eflags |= IF;
      this._interruptShadow = 2;
    } else if (op === 0xfc) this.eflags &= ~DF;
    else if (op === 0xfd) this.eflags |= DF;
    else if (op === 0xf8) this.eflags &= ~CF;
    else if (op === 0xf9) this.eflags |= CF;
    else if (op === 0xf5) this.eflags ^= CF;
    else if (op === 0xf4) {
      if (this.protectedMode && this.currentPrivilegeLevel !== 0)
        throw new I80386Fault(13, 0, "HLT requires CPL 0");
      this.halted = true;
    } else if (op === 0x8c || op === 0x8e) {
      const ea = this._decodeEA(address32, override),
        ids = [SEG_ES, SEG_CS, SEG_SS, SEG_DS, SEG_FS, SEG_GS];
      if (ea.reg > 5 || (op === 0x8e && ea.reg === 1))
        throw new I80386Fault(6, null, "invalid MOV segment register");
      if (op === 0x8c)
        this._operandWrite(
          ea,
          ea.isReg ? width : 16,
          this._segValue(ids[ea.reg]),
        );
      else {
        this._loadSeg(ids[ea.reg], this._operandRead(ea, 16));
        if (ea.reg === 2) {
          this._interruptShadow = 2;
          this._nmiShadow = 2;
          this._debugShadow = 1;
        }
      }
    } else if (op === 0x9a) {
      const target = this._fetchN(width >>> 3);
      const selector = this._fetchN(2);
      if (this.protectedMode && !this.virtual8086)
        this._protectedFarTransfer(selector, target, width, true);
      else this._farRealTransfer(selector, target, width, true);
    } else if (op === 0xea) {
      const raw = this._fetchN(width >>> 3),
        off = width === 32 ? raw : raw & 0xffff,
        sel = this._fetchN(2);
      if (this.protectedMode && !this.virtual8086) {
        this._protectedFarTransfer(sel, off, width, false);
      } else {
        if (off > 0xffff)
          throw new UnsupportedI80386("real-mode far target exceeds CS limit");
        this._loadSeg(SEG_CS, sel);
      }
      if (!this.protectedMode || this.virtual8086) this.eip = off;
    } else if (op === 0x0f) this._step0f(address32, override, width);
    else
      throw new UnsupportedI80386(`opcode ${op.toString(16).padStart(2, "0")}`);
    this.cycles++;
    return 1;
  }

  _step0f(address32, override, width) {
    const op = this._fetch8();
    if (op === 0x02 || op === 0x03) {
      if (!this.protectedMode || this.virtual8086)
        throw new I80386Fault(6, null, "LAR/LSL are undefined outside protected mode");
      const ea = this._decodeEA(address32, override);
      const selector = this._operandRead(ea, 16);
      const descriptor = this._queryDescriptor(selector, op === 0x02 ? "lar" : "lsl");
      if (!descriptor) {
        this.eflags &= ~ZF;
        return;
      }
      let value;
      if (op === 0x02) {
        value = (
          descriptor[5] << 8 |
          (descriptor[6] & 0xf0) << 16
        ) >>> 0;
      } else {
        value = (
          descriptor[0] |
          descriptor[1] << 8 |
          (descriptor[6] & 15) << 16
        ) >>> 0;
        if (descriptor[6] & 0x80) value = ((value << 12) | 0xfff) >>> 0;
      }
      this._setReg(ea.reg, width, value);
      this.eflags |= ZF;
      return;
    }
    if (op === 0xa0 || op === 0xa1 || op === 0xa8 || op === 0xa9) {
      const segment = op < 0xa8 ? SEG_FS : SEG_GS;
      if (op & 1) this._popSegment(segment, width);
      else this._pushSegment(segment, width);
      return;
    }
    if (op === 0x00) {
      if (this.virtual8086)
        throw new I80386Fault(
          6,
          null,
          "system selector instruction is undefined in VM86",
        );
      const ea = this._decodeEA(address32, override);
      if (ea.reg > 5)
        throw new I80386Fault(6, null, "invalid 0F 00 extension");
      if (!this.protectedMode)
        throw new I80386Fault(
          6,
          null,
          "system selector instruction outside protected mode",
        );
      if (ea.reg >= 4) {
        const verified = this._verifySelector(
          this._operandRead(ea, 16),
          ea.reg === 5,
        );
        this.eflags = verified ? this.eflags | ZF : this.eflags & ~ZF;
        return;
      }
      if (ea.reg >= 2) {
        if (this.currentPrivilegeLevel !== 0)
          throw new I80386Fault(13, 0, "LLDT/LTR require CPL0");
        this._loadSystemRegister(
          ea.reg === 2 ? "ldtr" : "tr",
          this._operandRead(ea, 16),
        );
      } else {
        this._operandWrite(
          ea,
          16,
          ea.reg === 0 ? this.ldtr.selector : this.tr.selector,
        );
      }
      return;
    }
    if (op === 0xb2 || op === 0xb4 || op === 0xb5) {
      this._farPointerLoad(
        op === 0xb2 ? SEG_SS : op === 0xb4 ? SEG_FS : SEG_GS,
        width,
        address32,
        override,
      );
      return;
    }
    if (op >= 0x90 && op <= 0x9f) {
      const ea = this._decodeEA(address32, override);
      this._operandWrite(ea, 8, this._condition(op & 15) ? 1 : 0);
      return;
    }
    if (op === 0xa4 || op === 0xa5 || op === 0xac || op === 0xad) {
      const ea = this._decodeEA(address32, override);
      const count = op === 0xa4 || op === 0xac ? this._fetch8() : this.cl;
      this._operandPreflightWrite(ea, width);
      const destination = this._operandRead(ea, width);
      if ((count & 31) !== 0) {
        const result = this._doubleShift(
          destination,
          this._reg(ea.reg, width),
          width,
          count,
          op === 0xac || op === 0xad,
        );
        this._operandWrite(ea, width, result);
      }
      return;
    }
    if (op >= 0x80 && op <= 0x8f) {
      const displacement = this._fetchN(width >>> 3);
      if (this._condition(op & 15)) {
        const target =
          width === 32
            ? (this.eip + (displacement | 0)) >>> 0
            : (this.eip + ((displacement << 16) >> 16)) & 0xffff;
        this._linear(SEG_CS, target, 1);
        this.eip = target;
      }
      return;
    }
    if (op === 0xb6 || op === 0xb7 || op === 0xbe || op === 0xbf) {
      const ea = this._decodeEA(address32, override),
        sourceWidth = op & 1 ? 16 : 8,
        raw = this._operandRead(ea, sourceWidth);
      const value =
        op >= 0xbe
          ? sourceWidth === 8
            ? (raw << 24) >> 24
            : (raw << 16) >> 16
          : raw;
      this._setReg(ea.reg, width, value);
      return;
    }
    if (op === 0xaf) {
      const ea = this._decodeEA(address32, override),
        a =
          width === 32
            ? BigInt.asIntN(32, BigInt(this._reg(ea.reg, width)))
            : BigInt.asIntN(16, BigInt(this._reg(ea.reg, width))),
        b =
          width === 32
            ? BigInt.asIntN(32, BigInt(this._operandRead(ea, width)))
            : BigInt.asIntN(16, BigInt(this._operandRead(ea, width))),
        product = a * b,
        result = Number(BigInt.asUintN(width, product));
      this._setReg(ea.reg, width, result);
      const fits = product === BigInt.asIntN(width, product);
      this.eflags &= ~(CF | OF);
      if (!fits) this.eflags |= CF | OF;
      return;
    }
    if (op === 0x01) {
      const ea = this._decodeEA(address32, override);
      if (ea.reg === 0 || ea.reg === 1) {
        if (ea.isReg)
          throw new I80386Fault(6, null, "SGDT/SIDT require a memory operand");
        const cache = this.segmentCaches[ea.seg];
        if (this.protectedMode && !this.virtual8086 && !cache.writable)
          throw new I80386Fault(13, 0, "write to non-writable segment");
        const linear = this._linear(ea.seg, ea.off, 6);
        const physical = Array.from({ length: 6 }, (_, index) =>
          this._translate((linear + index) >>> 0, { write: true }),
        );
        const table = ea.reg === 0 ? this.gdtr : this.idtr;
        const bytes = [
          table.limit & 0xff,
          (table.limit >>> 8) & 0xff,
          table.base & 0xff,
          (table.base >>> 8) & 0xff,
          (table.base >>> 16) & 0xff,
          (table.base >>> 24) & 0xff,
        ];
        for (let index = 0; index < bytes.length; index++)
          this.write(physical[index], bytes[index]);
        return;
      }
      if (ea.reg === 4) {
        this._operandWrite(ea, 16, this.cr0 & 0xffff);
        return;
      }
      if (ea.reg === 6) {
        if (this.protectedMode && this.currentPrivilegeLevel !== 0)
          throw new I80386Fault(13, 0, "LMSW requires CPL0");
        const value = this._operandRead(ea, 16);
        this.cr0 = ((this.cr0 & ~15) | (value & 15) | (this.cr0 & 1)) >>> 0;
        return;
      }
      if (ea.isReg || (ea.reg !== 2 && ea.reg !== 3))
        throw new UnsupportedI80386("0F 01 system extension");
      if (this.protectedMode && this.currentPrivilegeLevel !== 0)
        throw new I80386Fault(13, 0, "LGDT/LIDT require CPL0");
      const cache = this.segmentCaches[ea.seg];
      if (this.protectedMode && !this.virtual8086 && cache.code && !cache.readable)
        throw new I80386Fault(13, 0, "read from execute-only segment");
      const a = this._linear(ea.seg, ea.off, 6);
      const limit = this._readLinear(a, 2);
      const base = this._readLinear((a + 2) >>> 0, 4);
      const table = {
        limit,
        base: width === 16 ? base & 0xffffff : base,
      };
      if (ea.reg === 2) this.gdtr = table;
      else this.idtr = table;
      return;
    }
    if (op === 0x20 || op === 0x22) {
      const m = this._fetch8();
      if (m >>> 6 !== 3)
        throw new I80386Fault(6, null, "MOV CR requires a register");
      const control = (m >>> 3) & 7,
        register = m & 7;
      if (![0, 2, 3].includes(control))
        throw new I80386Fault(6, null, "invalid control register");
      if (this.protectedMode && this.currentPrivilegeLevel !== 0)
        throw new I80386Fault(13, 0, "MOV CR requires CPL0");
      if (op === 0x20) this._setReg(register, 32, this[`cr${control}`]);
      else {
        const value = this._reg(register, 32);
        if (control === 0 && value & 0x80000000 && !(value & 1))
          throw new I80386Fault(13, 0, "paging requires protected mode");
        this[`cr${control}`] =
          control === 3
            ? (value & 0xfffff000) >>> 0
            : control === 0
              ? (value & 0x8000001f) >>> 0
              : value;
      }
      return;
    }
    throw new UnsupportedI80386(`0f ${op.toString(16).padStart(2, "0")}`);
  }
}

export { SEG_ES, SEG_CS, SEG_SS, SEG_DS, SEG_FS, SEG_GS };
export default ExperimentalI80386;
