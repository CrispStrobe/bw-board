// SPDX-License-Identifier: MIT
// Independent architectural-state/cycle-count qualification. No bus-waveform claim.
// Dataset: SingleStepTests/65x02, MIT, Copyright (c) 2024 Thomas Harte et al.
// Exact source revision and its LICENSE are printed with every result.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {NMOS6502, NMOS6502_OPCODES} from '../src/nmos6502.js';
const run = promisify(execFile);
const revision = '2f6980a2d95757486c7bee24355c360e40e2a224';
const root = `https://raw.githubusercontent.com/SingleStepTests/65x02/${revision}`;
const requested = process.argv.slice(2);
const opcodes = requested.length ? requested.map(s => parseInt(s, 16)) : NMOS6502_OPCODES;
const results = [];
const fetchCode = 'import urllib.request,sys\nsys.stdout.buffer.write(urllib.request.urlopen(sys.argv[1],timeout=45).read())';
async function check(opcode) {
  const op = opcode.toString(16).padStart(2, '0');
  const {stdout} = await run('python', ['-c', fetchCode, `${root}/6502/v1/${op}.json`], {maxBuffer: 20 * 1024 * 1024});
  const vectors = JSON.parse(stdout);
  const memory = new Uint8Array(65536), marked = new Uint32Array(65536);
  let epoch = 0, passed = 0;
  const failures = [];
  for (const vector of vectors) {
    epoch++;
    for (const [address, value] of vector.initial.ram) { memory[address] = value; marked[address] = epoch; }
    const cpu = new NMOS6502({
      read(address) { if (marked[address] !== epoch) throw new Error(`unlisted read ${address.toString(16)}`); return memory[address]; },
      write(address, value) { memory[address] = value; marked[address] = epoch; }
    });
    for (const key of ['pc', 'a', 'x', 'y', 'p']) cpu[key] = vector.initial[key];
    cpu.s = vector.initial.s;
    try {
      const cycles = cpu.step();
      const mismatches = [];
      for (const key of ['pc', 'a', 'x', 'y', 's', 'p']) {
        if (cpu[key] !== vector.final[key]) mismatches.push(`${key}: ${cpu[key]} expected ${vector.final[key]}`);
      }
      if (cycles !== vector.cycles.length) mismatches.push(`cycles: ${cycles} expected ${vector.cycles.length}`);
      for (const [address, value] of vector.final.ram) {
        if (memory[address] !== value) mismatches.push(`RAM ${address.toString(16)}: ${memory[address]} expected ${value}`);
      }
      if (mismatches.length) {
        if (failures.length < 3) failures.push({name: vector.name, initial: vector.initial, mismatches});
      } else passed++;
    } catch (error) { if (failures.length < 3) failures.push({name: vector.name, error: error.message}); }
  }
  const result = {opcode: op, vectors: vectors.length, passed, failed: vectors.length - passed, examples: failures};
  results.push(result); console.log(JSON.stringify(result));
}
for (let start = 0; start < opcodes.length; start += 4) await Promise.all(opcodes.slice(start, start + 4).map(check));
const report = {source: `${root}/6502/v1`, revision, license: `${root}/LICENSE`, scope: 'architectural registers, RAM and instruction cycle totals; no per-cycle bus or asynchronous interrupt grade', opcodes: results.length, vectors: results.reduce((n, r) => n + r.vectors, 0), passed: results.reduce((n, r) => n + r.passed, 0), failed: results.reduce((n, r) => n + r.failed, 0)};
console.log(JSON.stringify({summary: report}));
if (report.failed) process.exitCode = 1;

