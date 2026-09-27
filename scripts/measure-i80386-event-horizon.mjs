// Opt-in preload for scripts/probe-xv6-stock.mjs. Measures retired guest
// instructions between AT chip settlements, without changing the machine.
// Run with: node --import ./scripts/measure-i80386-event-horizon.mjs ...
import {I8086Machine} from '../src/i8086-machine.js';

const original = I8086Machine.prototype._flushChips;
const last = new Map();
const bins = new Array(22).fill(0);
let intervals = 0, instructions = 0, zero = 0, deadline = 0, eager = 0;
let atLeast64 = 0, atLeast256 = 0, atLeast1024 = 0, maximum = 0;
let full64 = 0, full256 = 0, resets = 0;

function record(length) {
  if (length === 0) { zero++; return; }
  intervals++;
  instructions += length;
  bins[Math.min(21, Math.floor(Math.log2(length)))]++;
  if (length >= 64) atLeast64 += length;
  if (length >= 256) atLeast256 += length;
  if (length >= 1024) atLeast1024 += length;
  full64 += Math.floor(length / 64) * 64;
  full256 += Math.floor(length / 256) * 256;
  if (length > maximum) maximum = length;
}

I8086Machine.prototype._flushChips = function() {
  if (this.variant === '80386' && this.cpu) {
    const now = this.cpu.cycles;
    const previous = last.get(this) ?? 0;
    if (now >= previous) {
      record(now - previous);
      if (this._chipDebt >= this._chipDeadline) deadline++;
      else eager++;
    } else { resets++; record(now); }
    last.set(this, now);
  }
  return original.call(this);
};

process.on('exit', () => {
  // The guest may stop between chip settlements. Include that final interval.
  for (const [machine, previous] of last) {
    const now = machine.cpu?.cycles;
    if (now > previous) record(now - previous);
  }
  console.error('HORIZON', JSON.stringify({
    intervals,instructions,zero,deadline,eager,maximum,resets,
    atLeast64,atLeast256,atLeast1024,full64,full256,
    tail64:instructions-full64,tail256:instructions-full256,bins,
  }));
});
