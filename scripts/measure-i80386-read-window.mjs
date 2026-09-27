// Preload for the full xv6 probe. Count attempted MOV 8B memory operands
// whose mapping is already present in the 386 TLB and qualifies for a
// side-effect-free native RAM window. This changes no guest execution.
import './measure-i80386-hot-runs.mjs';
import {ExperimentalI80386} from '../src/experimental/i80386.js';
import {ExperimentalI80386ATMachine} from '../src/experimental/i80386-at-machine.js';
import {prevalidateI80386ReadWindow} from '../src/experimental/i80386-read-window.js';

let currentMachine = null;
const originalStep = ExperimentalI80386ATMachine.prototype.step;
ExperimentalI80386ATMachine.prototype.step = function() {
  currentMachine = this;
  try { return originalStep.call(this); }
  finally { currentMachine = null; }
};

const counts = {mov8bMemoryAttempts: 0, dsAttempts: 0, ssAttempts: 0,
  admitted: 0, admittedDs: 0, admittedSs: 0};
const originalOperandRead = ExperimentalI80386.prototype._operandRead;
ExperimentalI80386.prototype._operandRead = function(ea, width) {
  if (!ea.isReg && this._hotRunOpcode === 0x8b) {
    counts.mov8bMemoryAttempts++;
    if (ea.seg === 3) counts.dsAttempts++;
    if (ea.seg === 2) counts.ssAttempts++;
    const window = currentMachine &&
      prevalidateI80386ReadWindow(currentMachine, ea.off, ea.seg);
    if (window) {
      counts.admitted++;
      if (ea.seg === 3) counts.admittedDs++;
      if (ea.seg === 2) counts.admittedSs++;
    }
  }
  return originalOperandRead.call(this, ea, width);
};

process.on('exit', () => console.error('READ_WINDOW', JSON.stringify(counts)));
