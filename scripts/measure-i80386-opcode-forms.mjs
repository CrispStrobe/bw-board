// Preload for probe-xv6-stock.mjs. Count retired forms of the hot x86 opcode
// families while leaving the JavaScript CPU and guest stepping unchanged.
import {ExperimentalI80386} from '../src/experimental/i80386.js';
import {ExperimentalI80386ATMachine} from '../src/experimental/i80386-at-machine.js';

const prefixes=new Set([0x26,0x2e,0x36,0x3e,0x64,0x65,0x66,0x67,
  0xf0,0xf2,0xf3]);
const groups=new Set([0x81,0x83,0xc1]);
const tracked=new Set([0x81,0x83,0xc1,0xab,0xa4,0xa8,0x25,0x0b]);
const counts=new Map();
const originalFetch8=ExperimentalI80386.prototype._fetch8;
ExperimentalI80386.prototype._fetch8=function() {
  const byte=originalFetch8.call(this);
  if (this._opcodeFormCapture) {
    if (this._opcodeFormOpcode < 0) {
      if (prefixes.has(byte)) {
        if (byte === 0xf2 || byte === 0xf3) this._opcodeFormRepeat=byte;
      } else this._opcodeFormOpcode=byte;
    } else if (this._opcodeFormModrm < 0) this._opcodeFormModrm=byte;
  }
  return byte;
};

const originalInstruction=ExperimentalI80386.prototype._stepInstruction;
ExperimentalI80386.prototype._stepInstruction=function() {
  this._opcodeFormOpcode=-1;
  this._opcodeFormModrm=-1;
  this._opcodeFormRepeat=0;
  this._opcodeFormCapture=true;
  try {return originalInstruction.call(this);}
  finally {this._opcodeFormCapture=false;}
};

const originalStep=ExperimentalI80386ATMachine.prototype.step;
ExperimentalI80386ATMachine.prototype.step=function() {
  const before=this.cpu.cycles;
  const result=originalStep.call(this);
  if (this.cpu.cycles !== before) {
    const op=this.cpu._opcodeFormOpcode;
    if (tracked.has(op)) {
      const modrm=this.cpu._opcodeFormModrm;
      const key=groups.has(op)
        ? `${op.toString(16)}:${modrm >>> 6}:${(modrm >>> 3) & 7}`
        : `${op.toString(16)}:rep${this.cpu._opcodeFormRepeat.toString(16)}`;
      counts.set(key,(counts.get(key) ?? 0)+1);
    }
  }
  return result;
};

process.on('exit',()=>{
  console.error('OPCODE_FORMS',JSON.stringify(Object.fromEntries(
    [...counts].sort((a,b)=>b[1]-a[1]))));
});
