// Preload for probe-xv6-stock.mjs. Classifies retired instruction opcode runs
// without changing the CPU source or the guest's execution path. The broader
// sets deliberately overestimate executable blocks: they ignore operand,
// fault, code-page and device exits.
import {ExperimentalI80386} from '../src/experimental/i80386.js';
import {ExperimentalI80386ATMachine} from '../src/experimental/i80386-at-machine.js';

const prefixes = new Set([0x26,0x2e,0x36,0x3e,0x64,0x65,0x66,0x67,0xf0,0xf2,0xf3]);
const originalFetch8 = ExperimentalI80386.prototype._fetch8;
ExperimentalI80386.prototype._fetch8 = function() {
  const byte = originalFetch8.call(this);
  if (this._hotRunCapture) {
    if (this._hotRunOpcode < 0) {
      if (!prefixes.has(byte)) this._hotRunOpcode = byte;
    } else if (this._hotRunModrm < 0) this._hotRunModrm = byte;
  }
  return byte;
};
const originalInstruction = ExperimentalI80386.prototype._stepInstruction;
ExperimentalI80386.prototype._stepInstruction = function() {
  this._hotRunOpcode = -1;
  this._hotRunModrm = -1;
  this._hotRunCapture = true;
  try { return originalInstruction.call(this); }
  finally { this._hotRunCapture = false; }
};

const hist = new Uint32Array(256);
const sets = ['register', 'memoryBranchString', 'memoryNoString', 'wideOpcode', 'wideNoString'].map(name => ({
  name, current: 0, instructions: 0, runs: 0, singles: 0, longest: 0,
  complete64: 0, complete256: 0, log2Runs: new Array(22).fill(0),
}));
let retired = 0, unclassified = 0;

function eligible(op, modrm) {
  const register = (op === 0x89 || op === 0x39 || op === 0x85) && modrm >= 0xc0;
  const memoryBranchString = register ||
    [0x8b,0x8d,0xab,0x74,0x75,0x89,0x39,0x85,0x81,0x83,0xc1].includes(op);
  const wideOpcode = memoryBranchString ||
    (op >= 0x50 && op <= 0x5f) || (op >= 0xb8 && op <= 0xbf) ||
    [0x01,0x03,0x29,0x2b,0x31,0x33,0x3b,0x68,0x6a,0x70,0x71,0x72,0x73,
      0x76,0x77,0x78,0x79,0x7a,0x7b,0x7c,0x7d,0x7e,0x7f,0x84,0x88,0x8a,
      0x8c,0x8e,0x90,0xa1,0xa3,0xa4,0xa5,0xa9,0xaa,0xac,0xad,0xe8,0xe9,
      0xeb,0xc2,0xc3,0xc6,0xc7,0xff].includes(op);
  const stringOpcode = op >= 0xa4 && op <= 0xaf;
  return [register, memoryBranchString, memoryBranchString && !stringOpcode,
    wideOpcode, wideOpcode && !stringOpcode];
}

function closeRun(set) {
  const length = set.current;
  if (!length) return;
  set.runs++;
  if (length === 1) set.singles++;
  if (length > set.longest) set.longest = length;
  set.complete64 += Math.floor(length / 64) * 64;
  set.complete256 += Math.floor(length / 256) * 256;
  set.log2Runs[Math.min(21, Math.floor(Math.log2(length)))]++;
  set.current = 0;
}

const originalStep = ExperimentalI80386ATMachine.prototype.step;
ExperimentalI80386ATMachine.prototype.step = function() {
  const before = this.cpu.cycles;
  const result = originalStep.call(this);
  if (this.cpu.cycles !== before) {
    retired++;
    const op = this.cpu._hotRunOpcode;
    if (op < 0) unclassified++;
    else hist[op]++;
    const flags = eligible(op, this.cpu._hotRunModrm);
    for (let i = 0; i < sets.length; i++) {
      if (flags[i]) { sets[i].instructions++; sets[i].current++; }
      else closeRun(sets[i]);
    }
  }
  return result;
};

process.on('exit', () => {
  for (const set of sets) closeRun(set);
  const topOpcodes = [...hist.entries()].sort((a,b) => b[1] - a[1]).slice(0,24)
    .map(([opcode,count]) => ({opcode: opcode.toString(16).padStart(2,'0'), count}));
  console.error('HOT_RUNS', JSON.stringify({retired, unclassified, sets, topOpcodes}));
});
