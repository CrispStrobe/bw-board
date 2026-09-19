/**
 * Bounded, opt-in 80386 executor.  This is a fresh 32-bit state model rather
 * than a widened view of the 16-bit production core.
 */
export class UnsupportedI80386 extends Error {}

const CF = 1,
  PF = 4,
  AF = 0x10,
  ZF = 0x40,
  SF = 0x80,
  IF = 0x200,
  DF = 0x400,
  OF = 0x800;
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
  constructor(bus = {}) {
    this.read = bus.read ?? (() => 0);
    this.fetch = bus.fetch ?? this.read;
    this.write = bus.write ?? (() => {});
    this.reset();
  }

  reset() {
    for (const r of REG_NAMES) this[r] = 0;
    this.eip = 0;
    this.eflags = 2;
    this.cr0 = 0;
    this.halted = false;
    this.cycles = 0;
    this.cs = 0;
    this.ds = 0;
    this.es = 0;
    this.ss = 0;
    this.fs = 0;
    this.gs = 0;
    this.gdtr = { base: 0, limit: 0 };
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
    if (!c?.present || off < 0 || end > c.limit || end > 0xffffffff)
      throw new UnsupportedI80386("segment limit or presence fault");
    return (c.base + (off >>> 0)) >>> 0;
  }
  _readLinear(a, size) {
    let v = 0;
    for (let i = 0; i < size; i++)
      v += (this.read((a + i) >>> 0) & 255) * 2 ** (8 * i);
    return v >>> 0;
  }
  _writeLinear(a, size, v) {
    for (let i = 0; i < size; i++)
      this.write((a + i) >>> 0, (v >>> (8 * i)) & 255);
  }
  _read(seg, off, width) {
    const cache = this.segmentCaches[seg];
    if (this.protectedMode && cache.code && !cache.readable)
      throw new UnsupportedI80386("read from execute-only segment");
    return this._readLinear(this._linear(seg, off, width >>> 3), width >>> 3);
  }
  _write(seg, off, width, v) {
    const cache = this.segmentCaches[seg];
    if (this.protectedMode && !cache.writable)
      throw new UnsupportedI80386("write to non-writable segment");
    this._writeLinear(this._linear(seg, off, width >>> 3), width >>> 3, v);
  }
  _fetch8() {
    if ((this._instructionBytes ?? 0) >= 15)
      throw new UnsupportedI80386("instruction exceeds 15-byte limit");
    const a = this._linear(SEG_CS, this.eip, 1),
      v = this.fetch(a) & 255;
    this._instructionBytes = (this._instructionBytes ?? 0) + 1;
    this.eip = (this.eip + 1) >>> 0;
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
      b = Array.from({ length: 8 }, (_, i) => this.read((a + i) >>> 0) & 255);
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
      this.write((descriptor.address + 5) >>> 0, descriptor.access | 1);
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

  step() {
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
    if (op >= 0xb0 && op <= 0xb7) this._setReg8(op - 0xb0, this._fetch8());
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
    } else if (op === 0x83) {
      const ea = this._decodeEA(address32, override),
        imm = (this._fetch8() << 24) >> 24,
        dst = this._operandRead(ea, width);
      let out;
      if (ea.reg === 0) out = this._add(dst, imm, width);
      else if (ea.reg === 1) out = this._setLogic(dst | imm, width);
      else if (ea.reg === 5) out = this._add(dst, imm, width, true);
      else if (ea.reg === 7) {
        this._add(dst, imm, width, true);
        out = null;
      } else throw new UnsupportedI80386("83 extension");
      if (out !== null) this._operandWrite(ea, width, out);
    } else if ([0xc0, 0xc1, 0xd0, 0xd1, 0xd2, 0xd3].includes(op)) {
      const byte = (op & 1) === 0;
      const shiftWidth = byte ? 8 : width;
      const ea = this._decodeEA(address32, override);
      const count = op < 0xd0 ? this._fetch8() : op < 0xd2 ? 1 : this.cl;
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
    } else if (op === 0xf4) this.halted = true;
    else if (op === 0x8e) {
      const ea = this._decodeEA(address32, override),
        ids = [SEG_ES, SEG_CS, SEG_SS, SEG_DS, SEG_FS, SEG_GS];
      if (ea.reg === 1 || ea.reg > 5)
        throw new UnsupportedI80386("invalid MOV segment register");
      this._loadSeg(ids[ea.reg], this._operandRead(ea, 16));
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
      if (ea.isReg || ea.reg !== 2)
        throw new UnsupportedI80386("only LGDT is supported");
      const a = this._linear(ea.seg, ea.off, 6),
        base = this._readLinear((a + 2) >>> 0, 4);
      this.gdtr = {
        limit: this._readLinear(a, 2),
        base: width === 16 ? base & 0xffffff : base,
      };
      return;
    }
    if (op === 0x20 || op === 0x22) {
      const m = this._fetch8();
      if (m !== 0xc0)
        throw new UnsupportedI80386("only MOV EAX,CR0 / MOV CR0,EAX");
      if (op === 0x20) this.eax = this.cr0 >>> 0;
      else {
        if (this.eax & 0x80000000)
          throw new UnsupportedI80386("paging is not implemented");
        this.cr0 = this.eax >>> 0;
      }
      return;
    }
    throw new UnsupportedI80386(`0f ${op.toString(16).padStart(2, "0")}`);
  }
}

export { SEG_ES, SEG_CS, SEG_SS, SEG_DS, SEG_FS, SEG_GS };
export default ExperimentalI80386;
