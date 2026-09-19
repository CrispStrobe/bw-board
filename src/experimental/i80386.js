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
    this.shutdown = false;
    this._interruptShadow = 0;
    this._nmiShadow = 0;
    this._debugShadow = 0;
    this._nmiActive = false;
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
  _linear(seg, off, size = 1) {
    const c = this.segmentCaches[seg];
    const end = off + size - 1;
    if (!c?.present)
      throw new I80386Fault(
        seg === SEG_SS ? 12 : 11,
        this._segValue(seg),
        "segment not present",
      );
    if (off < 0 || end > c.limit || end > 0xffffffff)
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
    const user = !supervisor && (this.cs & 3) === 3;
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
    if (this.protectedMode && cache.code && !cache.readable)
      throw new I80386Fault(13, 0, "read from execute-only segment");
    return this._readLinear(this._linear(seg, off, width >>> 3), width >>> 3);
  }
  _write(seg, off, width, v) {
    const cache = this.segmentCaches[seg];
    if (this.protectedMode && !cache.writable)
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

  _descriptor(selector) {
    if (!(selector & 0xfff8))
      throw new UnsupportedI80386("null protected selector");
    if (selector & 4)
      throw new UnsupportedI80386(
        "LDT selectors are outside the bounded 386 profile",
      );
    const off = selector & 0xfff8;
    if (off + 7 > this.gdtr.limit)
      throw new UnsupportedI80386("selector outside GDT");
    const a = (this.gdtr.base + off) >>> 0,
      b = Array.from({ length: 8 }, (_, i) =>
        this._readLinear((a + i) >>> 0, 1, { supervisor: true }),
      );
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
  _loadSeg(id, selector) {
    if (!this.protectedMode) {
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
      seg = SEG_DS;
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
    return { reg, rm, isReg: false, off: off >>> 0, seg: override ?? seg };
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
    if (this.protectedMode && !cache.writable)
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
  _add(a, b, width, subtract = false) {
    const mask = maskFor(width),
      sign = width === 32 ? 0x80000000 : width === 16 ? 0x8000 : 0x80;
    const am = width === 32 ? a >>> 0 : a & mask,
      bm = width === 32 ? b >>> 0 : b & mask;
    const raw = subtract ? am - bm : am + bm,
      r = width === 32 ? raw >>> 0 : raw & mask;
    this.eflags &= ~(CF | PF | AF | ZF | SF | OF);
    if (subtract ? am < bm : raw > mask) this.eflags |= CF;
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

  _checkIo() {
    if (!this.protectedMode) return;
    if ((this.cs & 3) > ((this.eflags >>> 12) & 3))
      throw new UnsupportedI80386(
        "protected I/O bitmap admission is outside the bounded profile",
      );
  }

  _popFlags(width) {
    const value = this._pop(width);
    const old = this.eflags >>> 0;
    const cpl = this.protectedMode ? this.cs & 3 : 0;
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
      this._operandWrite(ea, operandWidth, this._add(0, operand, operandWidth, true));
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
      this.eflags = fits
        ? this.eflags & ~(CF | OF)
        : this.eflags | CF | OF;
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
    if (ea.reg === 7)
      dividend = BigInt.asIntN(operandWidth * 2, dividend);
    const divisor = ea.reg === 7 ? signedOperand : unsignedOperand;
    if (divisor === 0n)
      throw new I80386Fault(0, null, "division by zero");
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

  _snapshotInstruction() {
    const state = {};
    for (const name of REG_NAMES) state[name] = this[name];
    for (const name of [
      "eip",
      "eflags",
      "cs",
      "ds",
      "es",
      "ss",
      "fs",
      "gs",
      "halted",
      "_interruptShadow",
      "_nmiShadow",
      "_debugShadow",
      "_nmiActive",
    ])
      state[name] = this[name];
    state.segmentCaches = Object.fromEntries(
      Object.entries(this.segmentCaches).map(([id, cache]) => [
        id,
        { ...cache },
      ]),
    );
    return state;
  }

  _restoreInstruction(state) {
    for (const name of REG_NAMES) this[name] = state[name];
    for (const name of [
      "eip",
      "eflags",
      "cs",
      "ds",
      "es",
      "ss",
      "fs",
      "gs",
      "halted",
      "_interruptShadow",
      "_nmiShadow",
      "_debugShadow",
      "_nmiActive",
    ])
      this[name] = state[name];
    this.segmentCaches = Object.fromEntries(
      Object.entries(state.segmentCaches).map(([id, cache]) => [
        id,
        { ...cache },
      ]),
    );
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
    for (let i = 0; i < values.length; i++)
      for (let byte = 0; byte < bytes; byte++)
        this.write(
          physical[i * bytes + byte],
          (values[i] >>> (8 * byte)) & 255,
        );
    if (stack32) this.esp = next;
    else this.sp = next;
  }

  _protectedCodeDescriptor(selector, external) {
    const code = (selector & 0xfffc) | (external ? 1 : 0);
    if (!(selector & 0xfff8))
      throw new I80386Fault(13, code, "null handler selector");
    if (selector & 4)
      throw new UnsupportedI80386(
        "LDT handler selectors are outside the bounded profile",
      );
    const off = selector & 0xfff8;
    if (off + 7 > this.gdtr.limit)
      throw new I80386Fault(13, code, "handler selector outside GDT");
    const a = (this.gdtr.base + off) >>> 0;
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
    if (type === 5)
      throw new UnsupportedI80386(
        "IDT task gates are outside the bounded profile",
      );
    if (![6, 7, 14, 15].includes(type) || b[4] !== 0)
      throw new I80386Fault(13, idtCode, "unsupported IDT gate");
    if (software && dpl < (this.cs & 3))
      throw new I80386Fault(13, idtCode, "software interrupt gate privilege");
    if (!(access & 0x80))
      throw new I80386Fault(11, idtCode, "IDT gate not present");
    const selector = b[2] | (b[3] << 8),
      descriptor = this._protectedCodeDescriptor(selector, external);
    if ((this.cs & 3) !== 0)
      throw new UnsupportedI80386(
        "privilege-changing interrupt gates are outside the bounded profile",
      );
    const width = type >= 14 ? 32 : 16;
    const offset =
      (b[0] |
        (b[1] << 8) |
        (width === 32 ? (b[6] | (b[7] << 8)) * 0x10000 : 0)) >>>
      0;
    if (offset > descriptor.limit)
      throw new I80386Fault(13, 0, "handler offset outside code segment");
    const savedFlags = fault ? this.eflags | RF : this.eflags;
    const values = [returnEip, this.cs, savedFlags];
    if (errorCode !== null) values.unshift(errorCode);
    this._markAccessed(descriptor);
    this._stackFrame(width, values);
    this.cs = selector & 0xfffc;
    this.segmentCaches[SEG_CS] = descriptor;
    this.eip = width === 32 ? offset : offset & 0xffff;
    this.eflags &= ~(TF | NT | RF);
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

  _iret(width) {
    if (this.protectedMode && this.eflags & NT)
      throw new UnsupportedI80386(
        "nested-task IRET is outside the bounded profile",
      );
    const bytes = width >>> 3,
      stack32 = !!this.segmentCaches[SEG_SS].default32;
    const old = stack32 ? this.esp : this.sp;
    const address = this._linear(SEG_SS, old, bytes * 3);
    const target = this._readLinear(address, bytes);
    const selector = this._readLinear(address + bytes, bytes) & 0xffff;
    const flags = this._readLinear(address + bytes * 2, bytes);
    if (this.protectedMode && flags & 0x20000)
      throw new UnsupportedI80386("VM86 IRET is outside the bounded profile");
    if (this.protectedMode) {
      if ((selector & 3) !== (this.cs & 3))
        throw new UnsupportedI80386(
          "privilege-changing IRET is outside the bounded profile",
        );
      const descriptor = this._protectedCodeDescriptor(selector, false);
      if (target > descriptor.limit)
        throw new I80386Fault(13, 0, "IRET target outside code segment");
      this._markAccessed(descriptor);
      this.cs = selector;
      this.segmentCaches[SEG_CS] = descriptor;
    } else {
      if (target > 0xffff)
        throw new I80386Fault(13, 0, "real-mode IRET target exceeds CS limit");
      this._loadSeg(SEG_CS, selector);
    }
    if (stack32) this.esp = (old + bytes * 3) >>> 0;
    else this.sp = (old + bytes * 3) & 0xffff;
    this.eip = width === 32 ? target >>> 0 : target & 0xffff;
    this.eflags =
      width === 32
        ? (flags | 2) >>> 0
        : ((this.eflags & 0xffff0000) | flags | 2) >>> 0;
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
        this._deliverFault(new I80386Fault(1, null, "single-step"), this.eip, {
          trap: true,
        });
      return result;
    } catch (error) {
      if (error instanceof UnsupportedI80386) {
        this._restoreInstruction(state);
        throw error;
      }
      if (!(error instanceof I80386Fault)) throw error;
      this._restoreInstruction(state);
      if (!this.deliverFaults) throw error;
      this._deliverFault(error, restartEip);
      return 0;
    }
  }

  _stepInstruction() {
    if (this.halted) return 0;
    this._instructionBytes = 0;
    const default32 = !!this.segmentCaches[SEG_CS].default32;
    let operand32 = default32,
      address32 = default32,
      override = null,
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
      else break;
    } while (true);
    const width = operand32 ? 32 : 16;
    if (
      [
        0x04, 0x05, 0x0c, 0x0d, 0x24, 0x25, 0x2c, 0x2d, 0x34, 0x35, 0x3c, 0x3d,
      ].includes(op)
    ) {
      const byte = !(op & 1),
        operation = op & 0x38,
        operandWidth = byte ? 8 : width,
        left = byte ? this.al : this._reg(0, operandWidth),
        right = this._fetchN(operandWidth >>> 3);
      let result = null;
      if (operation === 0) result = this._add(left, right, operandWidth);
      else if (operation === 8)
        result = this._setLogic(left | right, operandWidth);
      else if (operation === 0x20)
        result = this._setLogic(left & right, operandWidth);
      else if (operation === 0x28)
        result = this._add(left, right, operandWidth, true);
      else if (operation === 0x30)
        result = this._setLogic(left ^ right, operandWidth);
      else this._add(left, right, operandWidth, true);
      if (result !== null) {
        if (byte) this.al = result;
        else this._setReg(0, operandWidth, result);
      }
    } else if (op === 0xa8 || op === 0xa9) {
      const testWidth = op === 0xa8 ? 8 : width;
      const left = testWidth === 8 ? this.al : this._reg(0, testWidth);
      this._setLogic(left & this._fetchN(testWidth >>> 3), testWidth);
    } else if (op >= 0xb0 && op <= 0xb7)
      this._setReg8(op - 0xb0, this._fetch8());
    else if (op >= 0xb8 && op <= 0xbf)
      this._setReg(op - 0xb8, width, this._fetchN(width >>> 3));
    else if (op >= 0x50 && op <= 0x57)
      this._push(this._reg(op - 0x50, width), width);
    else if (op >= 0x58 && op <= 0x5f)
      this._setReg(op - 0x58, width, this._pop(width));
    else if (op >= 0x40 && op <= 0x47) {
      const n = op - 0x40,
        cf = this.eflags & CF;
      this._setReg(n, width, this._add(this._reg(n, width), 1, width));
      this.eflags = (this.eflags & ~CF) | cf;
    } else if (op >= 0x48 && op <= 0x4f) {
      const n = op - 0x48,
        cf = this.eflags & CF;
      this._setReg(n, width, this._add(this._reg(n, width), 1, width, true));
      this.eflags = (this.eflags & ~CF) | cf;
    } else if (
      [0x00, 0x02, 0x28, 0x2a, 0x30, 0x32, 0x38, 0x3a, 0x88, 0x8a].includes(op)
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
      if (!toReg && op !== 0x38) this._operandPreflightWrite(ea, 8);
      const src = toReg ? this._operandRead(ea, 8) : this._reg8(ea.reg),
        dst = toReg ? this._reg8(ea.reg) : this._operandRead(ea, 8);
      let out = src;
      if (op < 0x20) out = this._add(dst, src, 8);
      else if (op < 0x30) out = this._add(dst, src, 8, true);
      else if (op < 0x38) out = this._setLogic(dst ^ src, 8);
      else {
        this._add(dst, src, 8, true);
        out = null;
      }
      if (out !== null) {
        if (toReg) this._setReg8(ea.reg, out);
        else this._operandWrite(ea, 8, out);
      }
    } else if (
      [0x01, 0x03, 0x29, 0x2b, 0x31, 0x33, 0x39, 0x3b, 0x89, 0x8b].includes(op)
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
      if (!toReg && op !== 0x39) this._operandPreflightWrite(ea, width);
      const src = toReg
          ? this._operandRead(ea, width)
          : this._reg(ea.reg, width),
        dst = toReg ? this._reg(ea.reg, width) : this._operandRead(ea, width);
      let out = src;
      if (op < 0x20) out = this._add(dst, src, width);
      else if (op < 0x30) out = this._add(dst, src, width, true);
      else if (op < 0x38) out = this._setLogic(dst ^ src, width);
      else if (op < 0x40) {
        this._add(dst, src, width, true);
        out = null;
      }
      if (out !== null) {
        if (toReg) this._setReg(ea.reg, width, out);
        else this._operandWrite(ea, width, out);
      }
    } else if (op === 0xc6) {
      const ea = this._decodeEA(address32, override);
      if (ea.reg !== 0) throw new UnsupportedI80386("C6 extension");
      this._operandWrite(ea, 8, this._fetch8());
    } else if (op === 0xc7) {
      const ea = this._decodeEA(address32, override);
      if (ea.reg !== 0) throw new UnsupportedI80386("C7 extension");
      this._operandWrite(ea, width, this._fetchN(width >>> 3));
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
        const target = width === 32
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
    } else if (op === 0xc3) {
      const stack32 = !!this.segmentCaches[SEG_SS].default32,
        off = stack32 ? this.esp : this.sp,
        target = this._read(SEG_SS, off, width) >>> 0;
      this._linear(SEG_CS, target, 1);
      if (stack32) this.esp = (this.esp + (width >>> 3)) >>> 0;
      else this.sp = (this.sp + (width >>> 3)) & 0xffff;
      this.eip = target;
    } else if (op === 0x9e)
      this.eflags = (this.eflags & ~0xd5) | (this.ah & 0xd5) | 2;
    else if (op === 0x9f) this.ah = (this.eflags | 2) & 0xff;
    else if (op === 0x9c)
      this._push((this.eflags & 0x7fd5) | 2, width);
    else if (op === 0x9d) this._popFlags(width);
    else if ([0xe4, 0xe5, 0xec, 0xed].includes(op)) {
      this._checkIo();
      const port = op < 0xec ? this._fetch8() : this.dx,
        ioWidth = op === 0xe4 || op === 0xec ? 8 : width;
      const value = this.inPort(port, ioWidth) >>> 0;
      if (ioWidth === 8) this._setReg8(0, value);
      else this._setReg(0, ioWidth, value);
    } else if ([0xe6, 0xe7, 0xee, 0xef].includes(op)) {
      this._checkIo();
      const port = op < 0xee ? this._fetch8() : this.dx,
        ioWidth = op === 0xe6 || op === 0xee ? 8 : width;
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
      this._suppressTrace = true;
      this._deliver(vector, this.eip, null, { software: true });
    } else if (op === 0xcf) this._iret(width);
    else if (op === 0xfa) {
      if (this.protectedMode && (this.cs & 3) > ((this.eflags >>> 12) & 3))
        throw new I80386Fault(13, 0, "CLI requires CPL <= IOPL");
      this.eflags &= ~IF;
    }
    else if (op === 0xfb) {
      if (this.protectedMode && (this.cs & 3) > ((this.eflags >>> 12) & 3))
        throw new I80386Fault(13, 0, "STI requires CPL <= IOPL");
      this.eflags |= IF;
      this._interruptShadow = 2;
    } else if (op === 0x17) {
      this._loadSeg(SEG_SS, this._pop(width) & 0xffff);
      this._interruptShadow = 2;
      this._nmiShadow = 2;
      this._debugShadow = 1;
    } else if (op === 0xf4) {
      if (this.protectedMode && (this.cs & 3) !== 0)
        throw new I80386Fault(13, 0, "HLT requires CPL 0");
      this.halted = true;
    }
    else if (op === 0x8e) {
      const ea = this._decodeEA(address32, override),
        ids = [SEG_ES, SEG_CS, SEG_SS, SEG_DS, SEG_FS, SEG_GS];
      if (ea.reg === 1 || ea.reg > 5)
        throw new I80386Fault(6, null, "invalid MOV segment register");
      this._loadSeg(ids[ea.reg], this._operandRead(ea, 16));
      if (ea.reg === 2) {
        this._interruptShadow = 2;
        this._nmiShadow = 2;
        this._debugShadow = 1;
      }
    } else if (op === 0xea) {
      const raw = this._fetchN(width >>> 3),
        off = width === 32 ? raw : raw & 0xffff,
        sel = this._fetchN(2);
      if (this.protectedMode) {
        const descriptor = this._descriptor(sel);
        if (!descriptor.code)
          throw new UnsupportedI80386("CS requires code descriptor");
        if (off > descriptor.limit)
          throw new UnsupportedI80386("far target exceeds CS limit");
        this._markAccessed(descriptor);
        this._setSegValue(SEG_CS, sel);
        this.segmentCaches[SEG_CS] = descriptor;
      } else {
        if (off > 0xffff)
          throw new UnsupportedI80386("real-mode far target exceeds CS limit");
        this._loadSeg(SEG_CS, sel);
      }
      this.eip = off;
    } else if (op === 0x0f) this._step0f(address32, override, width);
    else
      throw new UnsupportedI80386(`opcode ${op.toString(16).padStart(2, "0")}`);
    this.cycles++;
    return 1;
  }

  _step0f(address32, override, width) {
    const op = this._fetch8();
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
      if (ea.isReg || (ea.reg !== 2 && ea.reg !== 3))
        throw new UnsupportedI80386("only LGDT and LIDT are supported");
      if (this.protectedMode && (this.cs & 3) !== 0)
        throw new I80386Fault(13, 0, "LGDT/LIDT require CPL0");
      const a = this._linear(ea.seg, ea.off, 6),
        base = this._readLinear((a + 2) >>> 0, 4);
      const table = {
        limit: this._readLinear(a, 2),
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
      if (this.protectedMode && (this.cs & 3) !== 0)
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
