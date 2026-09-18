/**
 * FORK — dispatch-only optimization of rp2040js's Cortex-M0+ core.
 *
 * PROVENANCE
 *   Upstream: rp2040js@1.3.3 (MIT), dist/esm/cortex-m0-core.js,
 *   method `CortexM0Core.prototype.executeInstruction`.
 *   Upstream decodes each Thumb halfword through an 82-branch *linear*
 *   `if / else if (opcode >> N === 0b…)` chain ordered ALPHABETICALLY by
 *   mnemonic. Hot ops sit deep in the chain (MOVS ≈ #45, LDR ≈ #22,
 *   POP ≈ #50), so V8 scans dozens of failed compares before the handler
 *   runs. Profiled at ~57% of total emulation time on a tight loop; the
 *   RP2040 is the slowest core on the dev box (~0.2x real time @125 MHz).
 *
 * WHAT CHANGED — and ONLY this:
 *   The single linear chain is re-expressed as a two-level dispatch:
 *   an outer `switch (opcode >> 12)` (16 groups, one per top nibble) that
 *   V8 lowers to a jump table (O(1)), and inside each case the *few*
 *   original branches whose fixed opcode pattern lands in that nibble,
 *   kept as an if/else-if chain. We deliberately use a dense `switch`,
 *   NOT a function-pointer/handler table: in V8 a dense switch is
 *   jump-tabled AND keeps the handler bodies inlinable, whereas a
 *   megamorphic handler-array call is slower (lesson carried from this
 *   project's 8086 dispatch work).
 *
 * CORRECTNESS — why this is behavior-identical, not a rewrite:
 *   Every original branch tests `opcode >> N === P` (or `opcode === C`)
 *   with N ≤ 12, so each branch fixes bits 15..12 and therefore matches
 *   exactly ONE top-nibble value. Partitioning by `opcode >> 12` is thus
 *   a lossless bucketing: no branch straddles two buckets. Within each
 *   bucket the branches are kept in their ORIGINAL relative order, so
 *   first-match precedence is preserved where conditions overlap (e.g.
 *   0xf3bf satisfies BL's `opcode>>11===0b11110` prefix but its opcode2
 *   guard fails and it must fall through to DMB/DSB/ISB — order matters).
 *   Each branch body, the interrupt check, `wideInstruction`/`opcode2`,
 *   `deltaCycles`, the not-implemented `logger.warn` default, and the
 *   `this.cycles += deltaCycles; return deltaCycles` tail are copied
 *   VERBATIM. The default warn fires in exactly the same cases: an opcode
 *   misses iff the branch in its own nibble bucket misses.
 *
 * WIRING
 *   src/rp2040js-adapter.js assigns this function to the constructed
 *   core instance: `core.executeInstruction = fastExecuteInstruction`.
 *   Called as `core.executeInstruction()`, `this` is the core, so every
 *   `this.*` (registers, PC/SP/LR accessors, readUint16, addUpdateFlags,
 *   blTaken, logger, …) resolves identically to the stock method. No
 *   prototype of the shared class is mutated; only this instance is
 *   pointed at the fork.
 *
 * IDEAL END STATE: upstream this restructuring as a PR to rp2040js
 *   (wilsonianb/rp2040js). This file is a local fork until then.
 *
 * Module-scope constants below are copied verbatim from
 * cortex-m0-core.js so the body reads `this`-free names identically.
 */

// --- copied verbatim from rp2040js cortex-m0-core.js module scope ---
function signExtend8(value) {
  return (value << 24) >> 24;
}
function signExtend16(value) {
  return (value << 16) >> 16;
}
const spRegister = 13;
const pcRegister = 15;
const LOG_NAME = 'CortexM0Core';
// --------------------------------------------------------------------

/**
 * Drop-in replacement for CortexM0Core.prototype.executeInstruction.
 * Assign to a core INSTANCE; must be called with `this` === the core.
 * @returns {number} deltaCycles (identical to the stock method)
 */
export function fastExecuteInstruction() {
  if (this.interruptsUpdated) {
    if (this.checkForInterrupts()) {
      this.waiting = false;
    }
  }
  // ARM Thumb instruction encoding - 16 bits / 2 bytes
  const opcodePC = this.PC & ~1; //ensure no LSB set PC are executed
  const opcode = this.readUint16(opcodePC);
  const wideInstruction = opcode >> 12 === 0b1111 || opcode >> 11 === 0b11101;
  const opcode2 = wideInstruction ? this.readUint16(opcodePC + 2) : 0;
  this.PC += 2;
  let deltaCycles = 1;

  switch (opcode >> 12) {
    case 0b0000: {
      // LSLS (immediate)
      if (opcode >> 11 === 0b00000) {
        const imm5 = (opcode >> 6) & 0x1f;
        const Rm = (opcode >> 3) & 0x7;
        const Rd = opcode & 0x7;
        const input = this.registers[Rm];
        const result = input << imm5;
        this.registers[Rd] = result;
        this.N = !!(result & 0x80000000);
        this.Z = result === 0;
        this.C = imm5 ? !!(input & (1 << (32 - imm5))) : this.C;
      }
      // LSRS (immediate)
      else if (opcode >> 11 === 0b00001) {
        const imm5 = (opcode >> 6) & 0x1f;
        const Rm = (opcode >> 3) & 0x7;
        const Rd = opcode & 0x7;
        const input = this.registers[Rm];
        const result = imm5 ? input >>> imm5 : 0;
        this.registers[Rd] = result;
        this.N = !!(result & 0x80000000);
        this.Z = result === 0;
        this.C = !!((input >>> (imm5 ? imm5 - 1 : 31)) & 0x1);
      } else {
        this.logger.warn(LOG_NAME, `Warning: Instruction at ${opcodePC.toString(16)} is not implemented yet!`);
        this.logger.warn(LOG_NAME, `Opcode: 0x${opcode.toString(16)} (0x${opcode2.toString(16)})`);
      }
      break;
    }
    case 0b0001: {
      // ADDS (Encoding T1)
      if (opcode >> 9 === 0b0001110) {
        const imm3 = (opcode >> 6) & 0x7;
        const Rn = (opcode >> 3) & 0x7;
        const Rd = opcode & 0x7;
        this.registers[Rd] = this.addUpdateFlags(this.registers[Rn], imm3);
      }
      // ADDS (register)
      else if (opcode >> 9 === 0b0001100) {
        const Rm = (opcode >> 6) & 0x7;
        const Rn = (opcode >> 3) & 0x7;
        const Rd = opcode & 0x7;
        this.registers[Rd] = this.addUpdateFlags(this.registers[Rn], this.registers[Rm]);
      }
      // ASRS (immediate)
      else if (opcode >> 11 === 0b00010) {
        const imm5 = (opcode >> 6) & 0x1f;
        const Rm = (opcode >> 3) & 0x7;
        const Rd = opcode & 0x7;
        const input = this.registers[Rm];
        const shiftN = imm5 ? imm5 : 32;
        const result = shiftN < 32 ? input >> shiftN : (input & 0x80000000) >> 31;
        this.registers[Rd] = result;
        this.N = !!(result & 0x80000000);
        this.Z = (result & 0xffffffff) === 0;
        this.C = input & (1 << (shiftN - 1)) ? true : false;
      }
      // SUBS (Encoding T1)
      else if (opcode >> 9 === 0b0001111) {
        const imm3 = (opcode >> 6) & 0x7;
        const Rn = (opcode >> 3) & 0x7;
        const Rd = opcode & 0x7;
        this.registers[Rd] = this.substractUpdateFlags(this.registers[Rn], imm3);
      }
      // SUBS (register)
      else if (opcode >> 9 === 0b0001101) {
        const Rm = (opcode >> 6) & 0x7;
        const Rn = (opcode >> 3) & 0x7;
        const Rd = opcode & 0x7;
        this.registers[Rd] = this.substractUpdateFlags(this.registers[Rn], this.registers[Rm]);
      } else {
        this.logger.warn(LOG_NAME, `Warning: Instruction at ${opcodePC.toString(16)} is not implemented yet!`);
        this.logger.warn(LOG_NAME, `Opcode: 0x${opcode.toString(16)} (0x${opcode2.toString(16)})`);
      }
      break;
    }
    case 0b0010: {
      // CMP immediate
      if (opcode >> 11 === 0b00101) {
        const Rn = (opcode >> 8) & 0x7;
        const imm8 = opcode & 0xff;
        this.substractUpdateFlags(this.registers[Rn], imm8);
      }
      // MOVS
      else if (opcode >> 11 === 0b00100) {
        const value = opcode & 0xff;
        const Rd = (opcode >> 8) & 7;
        this.registers[Rd] = value;
        this.N = !!(value & 0x80000000);
        this.Z = value === 0;
      } else {
        this.logger.warn(LOG_NAME, `Warning: Instruction at ${opcodePC.toString(16)} is not implemented yet!`);
        this.logger.warn(LOG_NAME, `Opcode: 0x${opcode.toString(16)} (0x${opcode2.toString(16)})`);
      }
      break;
    }
    case 0b0011: {
      // ADDS (Encoding T2)
      if (opcode >> 11 === 0b00110) {
        const imm8 = opcode & 0xff;
        const Rdn = (opcode >> 8) & 0x7;
        this.registers[Rdn] = this.addUpdateFlags(this.registers[Rdn], imm8);
      }
      // SUBS (Encoding T2)
      else if (opcode >> 11 === 0b00111) {
        const imm8 = opcode & 0xff;
        const Rdn = (opcode >> 8) & 0x7;
        this.registers[Rdn] = this.substractUpdateFlags(this.registers[Rdn], imm8);
      } else {
        this.logger.warn(LOG_NAME, `Warning: Instruction at ${opcodePC.toString(16)} is not implemented yet!`);
        this.logger.warn(LOG_NAME, `Opcode: 0x${opcode.toString(16)} (0x${opcode2.toString(16)})`);
      }
      break;
    }
    case 0b0100: {
      // ADCS
      if (opcode >> 6 === 0b0100000101) {
        const Rm = (opcode >> 3) & 0x7;
        const Rdn = opcode & 0x7;
        this.registers[Rdn] = this.addUpdateFlags(this.registers[Rm], this.registers[Rdn] + (this.C ? 1 : 0));
      }
      // ADD (register)
      else if (opcode >> 8 === 0b01000100) {
        const Rm = (opcode >> 3) & 0xf;
        const Rdn = ((opcode & 0x80) >> 4) | (opcode & 0x7);
        const leftValue = Rdn === pcRegister ? this.PC + 2 : this.registers[Rdn];
        const rightValue = Rm === pcRegister ? this.PC + 2 : this.registers[Rm];
        const result = leftValue + rightValue;
        if (Rdn !== spRegister && Rdn !== pcRegister) {
          this.registers[Rdn] = result;
        }
        else if (Rdn === pcRegister) {
          this.registers[Rdn] = result & ~0x1;
          deltaCycles++;
        }
        else if (Rdn === spRegister) {
          this.registers[Rdn] = result & ~0x3;
        }
      }
      // ANDS (Encoding T2)
      else if (opcode >> 6 === 0b0100000000) {
        const Rm = (opcode >> 3) & 0x7;
        const Rdn = opcode & 0x7;
        const result = this.registers[Rdn] & this.registers[Rm];
        this.registers[Rdn] = result;
        this.N = !!(result & 0x80000000);
        this.Z = (result & 0xffffffff) === 0;
      }
      // ASRS (register)
      else if (opcode >> 6 === 0b0100000100) {
        const Rm = (opcode >> 3) & 0x7;
        const Rdn = opcode & 0x7;
        const input = this.registers[Rdn];
        const shiftN = (this.registers[Rm] & 0xff) < 32 ? this.registers[Rm] & 0xff : 32;
        const result = shiftN < 32 ? input >> shiftN : (input & 0x80000000) >> 31;
        this.registers[Rdn] = result;
        this.N = !!(result & 0x80000000);
        this.Z = (result & 0xffffffff) === 0;
        this.C = input & (1 << (shiftN - 1)) ? true : false;
      }
      // BICS
      else if (opcode >> 6 === 0b0100001110) {
        const Rm = (opcode >> 3) & 0x7;
        const Rdn = opcode & 0x7;
        const result = (this.registers[Rdn] &= ~this.registers[Rm]);
        this.N = !!(result & 0x80000000);
        this.Z = result === 0;
      }
      // BLX
      else if (opcode >> 7 === 0b010001111 && (opcode & 0x7) === 0) {
        const Rm = (opcode >> 3) & 0xf;
        this.LR = this.PC | 0x1;
        this.PC = this.registers[Rm] & ~1;
        deltaCycles++;
        this.blTaken(this, true);
      }
      // BX
      else if (opcode >> 7 === 0b010001110 && (opcode & 0x7) === 0) {
        const Rm = (opcode >> 3) & 0xf;
        this.BXWritePC(this.registers[Rm]);
        deltaCycles++;
      }
      // CMN (register)
      else if (opcode >> 6 === 0b0100001011) {
        const Rm = (opcode >> 3) & 0x7;
        const Rn = opcode & 0x7;
        this.addUpdateFlags(this.registers[Rn], this.registers[Rm]);
      }
      // CMP (register)
      else if (opcode >> 6 === 0b0100001010) {
        const Rm = (opcode >> 3) & 0x7;
        const Rn = opcode & 0x7;
        this.substractUpdateFlags(this.registers[Rn], this.registers[Rm]);
      }
      // CMP (register) encoding T2
      else if (opcode >> 8 === 0b01000101) {
        const Rm = (opcode >> 3) & 0xf;
        const Rn = ((opcode >> 4) & 0x8) | (opcode & 0x7);
        this.substractUpdateFlags(this.registers[Rn], this.registers[Rm]);
      }
      // EORS
      else if (opcode >> 6 === 0b0100000001) {
        const Rm = (opcode >> 3) & 0x7;
        const Rdn = opcode & 0x7;
        const result = this.registers[Rm] ^ this.registers[Rdn];
        this.registers[Rdn] = result;
        this.N = !!(result & 0x80000000);
        this.Z = result === 0;
      }
      // LDR (literal)
      else if (opcode >> 11 === 0b01001) {
        const imm8 = (opcode & 0xff) << 2;
        const Rt = (opcode >> 8) & 7;
        const nextPC = this.PC + 2;
        const addr = (nextPC & 0xfffffffc) + imm8;
        deltaCycles += this.cyclesIO(addr);
        this.registers[Rt] = this.readUint32(addr);
      }
      // LSLS (register)
      else if (opcode >> 6 === 0b0100000010) {
        const Rm = (opcode >> 3) & 0x7;
        const Rdn = opcode & 0x7;
        const input = this.registers[Rdn];
        const shiftCount = this.registers[Rm] & 0xff;
        const result = shiftCount >= 32 ? 0 : input << shiftCount;
        this.registers[Rdn] = result;
        this.N = !!(result & 0x80000000);
        this.Z = result === 0;
        this.C = shiftCount ? !!(input & (1 << (32 - shiftCount))) : this.C;
      }
      // LSRS (register)
      else if (opcode >> 6 === 0b0100000011) {
        const Rm = (opcode >> 3) & 0x7;
        const Rdn = opcode & 0x7;
        const shiftAmount = this.registers[Rm] & 0xff;
        const input = this.registers[Rdn];
        const result = shiftAmount < 32 ? input >>> shiftAmount : 0;
        this.registers[Rdn] = result;
        this.N = !!(result & 0x80000000);
        this.Z = result === 0;
        this.C = shiftAmount <= 32 ? !!((input >>> (shiftAmount - 1)) & 0x1) : false;
      }
      // MOV
      else if (opcode >> 8 === 0b01000110) {
        const Rm = (opcode >> 3) & 0xf;
        const Rd = ((opcode >> 4) & 0x8) | (opcode & 0x7);
        let value = Rm === pcRegister ? this.PC + 2 : this.registers[Rm];
        if (Rd === pcRegister) {
          deltaCycles++;
          value &= ~1;
        }
        else if (Rd === spRegister) {
          value &= ~3;
        }
        this.registers[Rd] = value;
      }
      // MULS
      else if (opcode >> 6 === 0b0100001101) {
        const Rn = (opcode >> 3) & 0x7;
        const Rdm = opcode & 0x7;
        const result = Math.imul(this.registers[Rn], this.registers[Rdm]);
        this.registers[Rdm] = result;
        this.N = !!(result & 0x80000000);
        this.Z = (result & 0xffffffff) === 0;
      }
      // MVNS
      else if (opcode >> 6 === 0b0100001111) {
        const Rm = (opcode >> 3) & 7;
        const Rd = opcode & 7;
        const result = ~this.registers[Rm];
        this.registers[Rd] = result;
        this.N = !!(result & 0x80000000);
        this.Z = result === 0;
      }
      // ORRS (Encoding T2)
      else if (opcode >> 6 === 0b0100001100) {
        const Rm = (opcode >> 3) & 0x7;
        const Rdn = opcode & 0x7;
        const result = this.registers[Rdn] | this.registers[Rm];
        this.registers[Rdn] = result;
        this.N = !!(result & 0x80000000);
        this.Z = (result & 0xffffffff) === 0;
      }
      // ROR
      else if (opcode >> 6 === 0b0100000111) {
        const Rm = (opcode >> 3) & 0x7;
        const Rdn = opcode & 0x7;
        const input = this.registers[Rdn];
        const shift = (this.registers[Rm] & 0xff) % 32;
        const result = (input >>> shift) | (input << (32 - shift));
        this.registers[Rdn] = result;
        this.N = !!(result & 0x80000000);
        this.Z = result === 0;
        this.C = !!(result & 0x80000000);
      }
      // NEGS / RSBS
      else if (opcode >> 6 === 0b0100001001) {
        const Rn = (opcode >> 3) & 0x7;
        const Rd = opcode & 0x7;
        this.registers[Rd] = this.substractUpdateFlags(0, this.registers[Rn]);
      }
      // SBCS (Encoding T1)
      else if (opcode >> 6 === 0b0100000110) {
        const Rm = (opcode >> 3) & 0x7;
        const Rdn = opcode & 0x7;
        this.registers[Rdn] = this.substractUpdateFlags(this.registers[Rdn], this.registers[Rm] + (1 - (this.C ? 1 : 0)));
      }
      // TST
      else if (opcode >> 6 == 0b0100001000) {
        const Rm = (opcode >> 3) & 0x7;
        const Rn = opcode & 0x7;
        const result = this.registers[Rn] & this.registers[Rm];
        this.N = !!(result & 0x80000000);
        this.Z = result === 0;
      } else {
        this.logger.warn(LOG_NAME, `Warning: Instruction at ${opcodePC.toString(16)} is not implemented yet!`);
        this.logger.warn(LOG_NAME, `Opcode: 0x${opcode.toString(16)} (0x${opcode2.toString(16)})`);
      }
      break;
    }
    case 0b0101: {
      // LDR (register)
      if (opcode >> 9 === 0b0101100) {
        const Rm = (opcode >> 6) & 0x7;
        const Rn = (opcode >> 3) & 0x7;
        const Rt = opcode & 0x7;
        const addr = this.registers[Rm] + this.registers[Rn];
        deltaCycles += this.cyclesIO(addr);
        this.registers[Rt] = this.readUint32(addr);
      }
      // LDRB (register)
      else if (opcode >> 9 === 0b0101110) {
        const Rm = (opcode >> 6) & 0x7;
        const Rn = (opcode >> 3) & 0x7;
        const Rt = opcode & 0x7;
        const addr = this.registers[Rm] + this.registers[Rn];
        deltaCycles += this.cyclesIO(addr);
        this.registers[Rt] = this.readUint8(addr);
      }
      // LDRH (register)
      else if (opcode >> 9 === 0b0101101) {
        const Rm = (opcode >> 6) & 0x7;
        const Rn = (opcode >> 3) & 0x7;
        const Rt = opcode & 0x7;
        const addr = this.registers[Rm] + this.registers[Rn];
        deltaCycles += this.cyclesIO(addr);
        this.registers[Rt] = this.readUint16(addr);
      }
      // LDRSB
      else if (opcode >> 9 === 0b0101011) {
        const Rm = (opcode >> 6) & 0x7;
        const Rn = (opcode >> 3) & 0x7;
        const Rt = opcode & 0x7;
        const addr = this.registers[Rm] + this.registers[Rn];
        deltaCycles += this.cyclesIO(addr);
        this.registers[Rt] = signExtend8(this.readUint8(addr));
      }
      // LDRSH
      else if (opcode >> 9 === 0b0101111) {
        const Rm = (opcode >> 6) & 0x7;
        const Rn = (opcode >> 3) & 0x7;
        const Rt = opcode & 0x7;
        const addr = this.registers[Rm] + this.registers[Rn];
        deltaCycles += this.cyclesIO(addr);
        this.registers[Rt] = signExtend16(this.readUint16(addr));
      }
      // STR (register)
      else if (opcode >> 9 === 0b0101000) {
        const Rm = (opcode >> 6) & 0x7;
        const Rn = (opcode >> 3) & 0x7;
        const Rt = opcode & 0x7;
        const address = this.registers[Rm] + this.registers[Rn];
        deltaCycles += this.cyclesIO(address, true);
        this.writeUint32(address, this.registers[Rt]);
      }
      // STRB (register)
      else if (opcode >> 9 === 0b0101010) {
        const Rm = (opcode >> 6) & 0x7;
        const Rn = (opcode >> 3) & 0x7;
        const Rt = opcode & 0x7;
        const address = this.registers[Rm] + this.registers[Rn];
        deltaCycles += this.cyclesIO(address, true);
        this.writeUint8(address, this.registers[Rt]);
      }
      // STRH (register)
      else if (opcode >> 9 === 0b0101001) {
        const Rm = (opcode >> 6) & 0x7;
        const Rn = (opcode >> 3) & 0x7;
        const Rt = opcode & 0x7;
        const address = this.registers[Rm] + this.registers[Rn];
        deltaCycles += this.cyclesIO(address, true);
        this.writeUint16(address, this.registers[Rt]);
      } else {
        this.logger.warn(LOG_NAME, `Warning: Instruction at ${opcodePC.toString(16)} is not implemented yet!`);
        this.logger.warn(LOG_NAME, `Opcode: 0x${opcode.toString(16)} (0x${opcode2.toString(16)})`);
      }
      break;
    }
    case 0b0110: {
      // LDR (immediate)
      if (opcode >> 11 === 0b01101) {
        const imm5 = ((opcode >> 6) & 0x1f) << 2;
        const Rn = (opcode >> 3) & 0x7;
        const Rt = opcode & 0x7;
        const addr = this.registers[Rn] + imm5;
        deltaCycles += this.cyclesIO(addr);
        this.registers[Rt] = this.readUint32(addr);
      }
      // STR (immediate)
      else if (opcode >> 11 === 0b01100) {
        const imm5 = ((opcode >> 6) & 0x1f) << 2;
        const Rn = (opcode >> 3) & 0x7;
        const Rt = opcode & 0x7;
        const address = this.registers[Rn] + imm5;
        deltaCycles += this.cyclesIO(address, true);
        this.writeUint32(address, this.registers[Rt]);
      } else {
        this.logger.warn(LOG_NAME, `Warning: Instruction at ${opcodePC.toString(16)} is not implemented yet!`);
        this.logger.warn(LOG_NAME, `Opcode: 0x${opcode.toString(16)} (0x${opcode2.toString(16)})`);
      }
      break;
    }
    case 0b0111: {
      // LDRB (immediate)
      if (opcode >> 11 === 0b01111) {
        const imm5 = (opcode >> 6) & 0x1f;
        const Rn = (opcode >> 3) & 0x7;
        const Rt = opcode & 0x7;
        const addr = this.registers[Rn] + imm5;
        deltaCycles += this.cyclesIO(addr);
        this.registers[Rt] = this.readUint8(addr);
      }
      // STRB (immediate)
      else if (opcode >> 11 === 0b01110) {
        const imm5 = (opcode >> 6) & 0x1f;
        const Rn = (opcode >> 3) & 0x7;
        const Rt = opcode & 0x7;
        const address = this.registers[Rn] + imm5;
        deltaCycles += this.cyclesIO(address, true);
        this.writeUint8(address, this.registers[Rt]);
      } else {
        this.logger.warn(LOG_NAME, `Warning: Instruction at ${opcodePC.toString(16)} is not implemented yet!`);
        this.logger.warn(LOG_NAME, `Opcode: 0x${opcode.toString(16)} (0x${opcode2.toString(16)})`);
      }
      break;
    }
    case 0b1000: {
      // LDRH (immediate)
      if (opcode >> 11 === 0b10001) {
        const imm5 = (opcode >> 6) & 0x1f;
        const Rn = (opcode >> 3) & 0x7;
        const Rt = opcode & 0x7;
        const addr = this.registers[Rn] + (imm5 << 1);
        deltaCycles += this.cyclesIO(addr);
        this.registers[Rt] = this.readUint16(addr);
      }
      // STRH (immediate)
      else if (opcode >> 11 === 0b10000) {
        const imm5 = ((opcode >> 6) & 0x1f) << 1;
        const Rn = (opcode >> 3) & 0x7;
        const Rt = opcode & 0x7;
        const address = this.registers[Rn] + imm5;
        deltaCycles += this.cyclesIO(address, true);
        this.writeUint16(address, this.registers[Rt]);
      } else {
        this.logger.warn(LOG_NAME, `Warning: Instruction at ${opcodePC.toString(16)} is not implemented yet!`);
        this.logger.warn(LOG_NAME, `Opcode: 0x${opcode.toString(16)} (0x${opcode2.toString(16)})`);
      }
      break;
    }
    case 0b1001: {
      // LDR (sp + immediate)
      if (opcode >> 11 === 0b10011) {
        const Rt = (opcode >> 8) & 0x7;
        const imm8 = opcode & 0xff;
        const addr = this.SP + (imm8 << 2);
        deltaCycles += this.cyclesIO(addr);
        this.registers[Rt] = this.readUint32(addr);
      }
      // STR (sp + immediate)
      else if (opcode >> 11 === 0b10010) {
        const Rt = (opcode >> 8) & 0x7;
        const imm8 = opcode & 0xff;
        const address = this.SP + (imm8 << 2);
        deltaCycles += this.cyclesIO(address, true);
        this.writeUint32(address, this.registers[Rt]);
      } else {
        this.logger.warn(LOG_NAME, `Warning: Instruction at ${opcodePC.toString(16)} is not implemented yet!`);
        this.logger.warn(LOG_NAME, `Opcode: 0x${opcode.toString(16)} (0x${opcode2.toString(16)})`);
      }
      break;
    }
    case 0b1010: {
      // ADD (register = SP plus immediate)
      if (opcode >> 11 === 0b10101) {
        const imm8 = opcode & 0xff;
        const Rd = (opcode >> 8) & 0x7;
        this.registers[Rd] = this.SP + (imm8 << 2);
      }
      // ADR
      else if (opcode >> 11 === 0b10100) {
        const imm8 = opcode & 0xff;
        const Rd = (opcode >> 8) & 0x7;
        this.registers[Rd] = (opcodePC & 0xfffffffc) + 4 + (imm8 << 2);
      } else {
        this.logger.warn(LOG_NAME, `Warning: Instruction at ${opcodePC.toString(16)} is not implemented yet!`);
        this.logger.warn(LOG_NAME, `Opcode: 0x${opcode.toString(16)} (0x${opcode2.toString(16)})`);
      }
      break;
    }
    case 0b1011: {
      // ADD (SP plus immediate)
      if (opcode >> 7 === 0b101100000) {
        const imm32 = (opcode & 0x7f) << 2;
        this.SP += imm32;
      }
      // BKPT
      else if (opcode >> 8 === 0b10111110) {
        const imm8 = opcode & 0xff;
        this.breakRewind = 2;
        this.rp2040.onBreak(imm8);
      }
      // CPSID i
      else if (opcode === 0xb672) {
        this.PM = true;
      }
      // CPSIE i
      else if (opcode === 0xb662) {
        this.PM = false;
        this.interruptsUpdated = true;
      }
      // POP
      else if (opcode >> 9 === 0b1011110) {
        const P = (opcode >> 8) & 1;
        let address = this.SP;
        for (let i = 0; i <= 7; i++) {
          if (opcode & (1 << i)) {
            this.registers[i] = this.readUint32(address);
            address += 4;
            deltaCycles++;
          }
        }
        if (P) {
          this.SP = address + 4;
          this.BXWritePC(this.readUint32(address));
          deltaCycles += 2;
        }
        else {
          this.SP = address;
        }
      }
      // PUSH
      else if (opcode >> 9 === 0b1011010) {
        let bitCount = 0;
        for (let i = 0; i <= 8; i++) {
          if (opcode & (1 << i)) {
            bitCount++;
          }
        }
        let address = this.SP - 4 * bitCount;
        for (let i = 0; i <= 7; i++) {
          if (opcode & (1 << i)) {
            this.writeUint32(address, this.registers[i]);
            deltaCycles++;
            address += 4;
          }
        }
        if (opcode & (1 << 8)) {
          this.writeUint32(address, this.registers[14]);
        }
        this.SP -= 4 * bitCount;
      }
      // REV
      else if (opcode >> 6 === 0b1011101000) {
        const Rm = (opcode >> 3) & 0x7;
        const Rd = opcode & 0x7;
        const input = this.registers[Rm];
        this.registers[Rd] =
          ((input & 0xff) << 24) |
            (((input >> 8) & 0xff) << 16) |
            (((input >> 16) & 0xff) << 8) |
            ((input >> 24) & 0xff);
      }
      // REV16
      else if (opcode >> 6 === 0b1011101001) {
        const Rm = (opcode >> 3) & 0x7;
        const Rd = opcode & 0x7;
        const input = this.registers[Rm];
        this.registers[Rd] =
          (((input >> 16) & 0xff) << 24) |
            (((input >> 24) & 0xff) << 16) |
            ((input & 0xff) << 8) |
            ((input >> 8) & 0xff);
      }
      // REVSH
      else if (opcode >> 6 === 0b1011101011) {
        const Rm = (opcode >> 3) & 0x7;
        const Rd = opcode & 0x7;
        const input = this.registers[Rm];
        this.registers[Rd] = signExtend16(((input & 0xff) << 8) | ((input >> 8) & 0xff));
      }
      // NOP
      else if (opcode === 0b1011111100000000) {
        // Do nothing!
      }
      // SEV
      else if (opcode === 0b1011111101000000) {
        this.logger.info(LOG_NAME, 'SEV');
      }
      // SUB (SP minus immediate)
      else if (opcode >> 7 === 0b101100001) {
        const imm32 = (opcode & 0x7f) << 2;
        this.SP -= imm32;
      }
      // SXTB
      else if (opcode >> 6 === 0b1011001001) {
        const Rm = (opcode >> 3) & 0x7;
        const Rd = opcode & 0x7;
        this.registers[Rd] = signExtend8(this.registers[Rm]);
      }
      // SXTH
      else if (opcode >> 6 === 0b1011001000) {
        const Rm = (opcode >> 3) & 0x7;
        const Rd = opcode & 0x7;
        this.registers[Rd] = signExtend16(this.registers[Rm]);
      }
      // UXTB
      else if (opcode >> 6 == 0b1011001011) {
        const Rm = (opcode >> 3) & 0x7;
        const Rd = opcode & 0x7;
        this.registers[Rd] = this.registers[Rm] & 0xff;
      }
      // UXTH
      else if (opcode >> 6 == 0b1011001010) {
        const Rm = (opcode >> 3) & 0x7;
        const Rd = opcode & 0x7;
        this.registers[Rd] = this.registers[Rm] & 0xffff;
      }
      // WFE
      else if (opcode === 0b1011111100100000) {
        deltaCycles++;
        if (this.eventRegistered) {
          this.eventRegistered = false;
        }
        else {
          this.waiting = true;
        }
      }
      // WFI
      else if (opcode === 0b1011111100110000) {
        deltaCycles++;
        this.waiting = true;
      }
      // YIELD
      else if (opcode === 0b1011111100010000) {
        // do nothing for now. Wait for event!
        this.logger.info(LOG_NAME, 'Yield');
      } else {
        this.logger.warn(LOG_NAME, `Warning: Instruction at ${opcodePC.toString(16)} is not implemented yet!`);
        this.logger.warn(LOG_NAME, `Opcode: 0x${opcode.toString(16)} (0x${opcode2.toString(16)})`);
      }
      break;
    }
    case 0b1100: {
      // LDMIA
      if (opcode >> 11 === 0b11001) {
        const Rn = (opcode >> 8) & 0x7;
        const registers = opcode & 0xff;
        let address = this.registers[Rn];
        for (let i = 0; i < 8; i++) {
          if (registers & (1 << i)) {
            this.registers[i] = this.readUint32(address);
            address += 4;
            deltaCycles++;
          }
        }
        // Write back
        if (!(registers & (1 << Rn))) {
          this.registers[Rn] = address;
        }
      }
      // STMIA
      else if (opcode >> 11 === 0b11000) {
        const Rn = (opcode >> 8) & 0x7;
        const registers = opcode & 0xff;
        let address = this.registers[Rn];
        for (let i = 0; i < 8; i++) {
          if (registers & (1 << i)) {
            this.writeUint32(address, this.registers[i]);
            address += 4;
            deltaCycles++;
          }
        }
        // Write back
        if (!(registers & (1 << Rn))) {
          this.registers[Rn] = address;
        }
      } else {
        this.logger.warn(LOG_NAME, `Warning: Instruction at ${opcodePC.toString(16)} is not implemented yet!`);
        this.logger.warn(LOG_NAME, `Opcode: 0x${opcode.toString(16)} (0x${opcode2.toString(16)})`);
      }
      break;
    }
    case 0b1101: {
      // B (with cond)
      if (opcode >> 12 === 0b1101 && ((opcode >> 9) & 0x7) !== 0b111) {
        let imm8 = (opcode & 0xff) << 1;
        const cond = (opcode >> 8) & 0xf;
        if (imm8 & (1 << 8)) {
          imm8 = (imm8 & 0x1ff) - 0x200;
        }
        if (this.checkCondition(cond)) {
          this.PC += imm8 + 2;
          deltaCycles++;
        }
      }
      // SVC
      else if (opcode >> 8 === 0b11011111) {
        this.pendingSVCall = true;
        this.interruptsUpdated = true;
      }
      // UDF
      else if (opcode >> 8 == 0b11011110) {
        const imm8 = opcode & 0xff;
        this.breakRewind = 2;
        this.rp2040.onBreak(imm8);
      } else {
        this.logger.warn(LOG_NAME, `Warning: Instruction at ${opcodePC.toString(16)} is not implemented yet!`);
        this.logger.warn(LOG_NAME, `Opcode: 0x${opcode.toString(16)} (0x${opcode2.toString(16)})`);
      }
      break;
    }
    case 0b1110: {
      // B
      if (opcode >> 11 === 0b11100) {
        let imm11 = (opcode & 0x7ff) << 1;
        if (imm11 & (1 << 11)) {
          imm11 = (imm11 & 0x7ff) - 0x800;
        }
        this.PC += imm11 + 2;
        deltaCycles++;
      } else {
        this.logger.warn(LOG_NAME, `Warning: Instruction at ${opcodePC.toString(16)} is not implemented yet!`);
        this.logger.warn(LOG_NAME, `Opcode: 0x${opcode.toString(16)} (0x${opcode2.toString(16)})`);
      }
      break;
    }
    case 0b1111: {
      // BL
      if (opcode >> 11 === 0b11110 && opcode2 >> 14 === 0b11 && ((opcode2 >> 12) & 0x1) == 1) {
        const imm11 = opcode2 & 0x7ff;
        const J2 = (opcode2 >> 11) & 0x1;
        const J1 = (opcode2 >> 13) & 0x1;
        const imm10 = opcode & 0x3ff;
        const S = (opcode >> 10) & 0x1;
        const I1 = 1 - (S ^ J1);
        const I2 = 1 - (S ^ J2);
        const imm32 = ((S ? 0b11111111 : 0) << 24) | ((I1 << 23) | (I2 << 22) | (imm10 << 12) | (imm11 << 1));
        this.LR = (this.PC + 2) | 0x1;
        this.PC += 2 + imm32;
        deltaCycles += 2;
        this.blTaken(this, false);
      }
      // DMB SY
      else if (opcode === 0xf3bf && (opcode2 & 0xfff0) === 0x8f50) {
        this.PC += 2;
        deltaCycles += 2;
      }
      // DSB SY
      else if (opcode === 0xf3bf && (opcode2 & 0xfff0) === 0x8f40) {
        this.PC += 2;
        deltaCycles += 2;
      }
      // ISB SY
      else if (opcode === 0xf3bf && (opcode2 & 0xfff0) === 0x8f60) {
        this.PC += 2;
        deltaCycles += 2;
      }
      // MRS
      else if (opcode === 0b1111001111101111 && opcode2 >> 12 == 0b1000) {
        const SYSm = opcode2 & 0xff;
        const Rd = (opcode2 >> 8) & 0xf;
        this.registers[Rd] = this.readSpecialRegister(SYSm);
        this.PC += 2;
        deltaCycles += 2;
      }
      // MSR
      else if (opcode >> 4 === 0b111100111000 && opcode2 >> 8 == 0b10001000) {
        const SYSm = opcode2 & 0xff;
        const Rn = opcode & 0xf;
        this.writeSpecialRegister(SYSm, this.registers[Rn]);
        this.PC += 2;
        deltaCycles += 2;
      }
      // UDF (Encoding T2)
      else if (opcode >> 4 === 0b111101111111 && opcode2 >> 12 === 0b1010) {
        const imm4 = opcode & 0xf;
        const imm12 = opcode2 & 0xfff;
        this.breakRewind = 4;
        this.rp2040.onBreak((imm4 << 12) | imm12);
        this.PC += 2;
      } else {
        this.logger.warn(LOG_NAME, `Warning: Instruction at ${opcodePC.toString(16)} is not implemented yet!`);
        this.logger.warn(LOG_NAME, `Opcode: 0x${opcode.toString(16)} (0x${opcode2.toString(16)})`);
      }
      break;
    }
    default: {
      this.logger.warn(LOG_NAME, `Warning: Instruction at ${opcodePC.toString(16)} is not implemented yet!`);
      this.logger.warn(LOG_NAME, `Opcode: 0x${opcode.toString(16)} (0x${opcode2.toString(16)})`);
      break;
    }
  }

  this.cycles += deltaCycles;
  return deltaCycles;
}
