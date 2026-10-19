// Use with: AT_FETCH_CURSOR_OBSERVER_OUTPUT=/tmp/report.json node --import
// ./scripts/observe-i80386-fetch-cursor.mjs scripts/run-i80386-at-console.mjs ...
// This preload leaves the runner's source inventory and guest report untouched.
import fs from 'node:fs';
import Machine from '../src/experimental/i80386-at-machine.js';
import {attachI80386FetchCursorEligibility} from './lib/i80386-fetch-cursor-eligibility.mjs';

const output = process.env.AT_FETCH_CURSOR_OBSERVER_OUTPUT;
if (!output) throw new Error('AT_FETCH_CURSOR_OBSERVER_OUTPUT is required');
const originalStep = Machine.prototype.step;
let observer = null;
Machine.prototype.step = function (...args) {
  if (!observer) {
    observer = attachI80386FetchCursorEligibility(this);
    Machine.prototype.step = originalStep;
  }
  return originalStep.apply(this, args);
};
process.on('exit', () => {
  if (!observer) return;
  try {
    fs.writeFileSync(output, `${JSON.stringify(observer.report(), null, 2)}\n`, {flag: 'wx'});
  } finally {
    observer.detach();
  }
});
