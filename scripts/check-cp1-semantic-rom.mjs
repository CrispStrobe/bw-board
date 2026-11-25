// SPDX-License-Identifier: MIT
// Original acceptance programs on the independent machine. No firmware is bundled or fetched.
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createCp1Adapter} from '../src/cp1-adapter.js';
import {createCp1DebugTarget} from '../src/cp1-debug.js';
import {identifyCp1Rom} from '../src/cp1-rom-profiles.js';

if (!process.argv[2]) throw new Error('Usage: node scripts/check-cp1-semantic-rom.mjs /path/to/user-monitor.bin [report.json]');
const rom = new Uint8Array(readFileSync(process.argv[2]));
const identity = identifyCp1Rom(rom);
assert.equal(identity.sha1, 'ff4befcf82a664950186d3af1843fdef70d2209f', 'this check qualifies only the exact 2716 ROM');
const cases = [
  {name: 'loads-stores-full-accumulator', words: [[5, 90], [6, 91], [4, 73], [1, 0]], data: [[90, 17, 231]],
    pcs: [1, 2, 3, 4], acc: [[17, 231], [17, 231], [0, 73], [0, 73]]},
  {name: 'compare-and-branch', words: [[4, 7], [10, 90], [11, 6], [4, 99], [18, 0], [1, 0], [4, 85], [18, 0], [1, 0]],
    data: [[90, 0, 7]], pcs: [1, 2, 6, 7, 8, 9], acc: [[0, 7], [0, 7], [0, 7], [0, 85], [0, 85], [0, 85]]},
  {name: 'greater-comparison', words: [[4, 8], [12, 90], [11, 5], [4, 99], [1, 0], [4, 85], [1, 0]],
    data: [[90, 0, 7]], pcs: [1, 2, 5, 6, 7], acc: [[0, 8], [0, 8], [0, 8], [0, 85], [0, 85]], comparison: [false, true, true, true, false]},
  {name: 'less-comparison', words: [[4, 6], [13, 90], [11, 5], [4, 99], [1, 0], [4, 85], [1, 0]],
    data: [[90, 0, 7]], pcs: [1, 2, 5, 6, 7], acc: [[0, 6], [0, 6], [0, 6], [0, 85], [0, 85]], comparison: [false, true, true, true, false]},
  {name: 'comparison-clears', words: [[4, 7], [10, 90], [4, 8], [10, 90], [1, 0]], data: [[90, 0, 7]],
    pcs: [1, 2, 3, 4, 5], acc: [[0, 7], [0, 7], [0, 8], [0, 8], [0, 8]], comparison: [false, true, true, false, false]},
  {name: 'nonzero-start', start: 37, words: [[4, 91], [1, 0]], pcs: [38, 39], acc: [[0, 91], [0, 91]]},
  {name: 'cp3-branch', expansion: true, words: [[9, 128]], data: [[128, 4, 231], [129, 1, 0]], pcs: [128, 129, 130], acc: [[0, 0], [0, 231], [0, 231]]},
  {name: 'delay-budget-and-resume', words: [[4, 73], [3, 200], [4, 17], [1, 0]], pcs: [1, 2, 3, 4], acc: [[0, 73], [0, 73], [0, 17], [0, 17]], budgetAt: 1},
  {name: 'overflow', words: [[4, 255], [7, 90], [1, 0]], data: [[90, 0, 1]], pcs: [1, 1], acc: [[0, 255], [0, 255]], error: 6},
  {name: 'invalid-opcode', words: [[25, 0]], pcs: [0], acc: [[0, 0]], error: 2},
  {name: 'loop-breakpoint-reentry', words: [[4, 42], [9, 0]], pcs: [1, 0], acc: [[0, 42], [0, 42]], loop: true},
];
const results = [];
for (const scenario of cases) {
  const adapter = createCp1Adapter({rom, expansion: !!scenario.expansion});
  const target = createCp1DebugTarget(adapter);
  const machine = adapter.machine;
  const events = [], halts = [], observations = [];
  target.onEvent(event => events.push(event)); target.onHalt(why => halts.push(why));
  const pump = () => {
    for (let i = 0; i < 100 && target.state() === 'running'; i++) target.runFor(100e6);
    assert.equal(target.state(), 'halted', 'bounded pump must reach an explicit stop');
  };
  const key = name => {
    machine.setKey(name, true); adapter.advanceNs(100e6);
    machine.setKey(name, false); adapter.advanceNs(100e6);
  };
  adapter.advanceNs(2e9);
  const start = scenario.start ?? 0;
  machine.loadProgram(scenario.words.map(([opcode, operand]) => ({opcode, operand})), {start});
  for (const [addr, opcode, operand] of scenario.data ?? []) machine.writeCell(addr, opcode, operand);
  for (const name of [...String(start).padStart(3, '0'), 'PC']) key(name);
  assert.ok(target.step('cp1').unsupported, 'monitor-idle step must refuse immediately');
  assert.equal(typeof target.setBreakpoint({kind: 'cp1', space: 'program', addr: start}), 'number');
  target.run(); machine.setKey('RUN', true); pump(); machine.setKey('RUN', false);
  assert.equal(halts.at(-1).bpKind, 'cp1'); assert.equal(target.semanticState().pc, start);
  for (let index = 0; index < scenario.pcs.length; index++) {
    if (index === scenario.budgetAt) {
      assert.equal(target.step('cp1', 1, {maxInstructions: 100}), undefined); pump();
      assert.equal(target.semanticState().step.status, 'limit');
      assert.equal(target.semanticState().step.completed, 0);
      assert.equal(target.semanticState().step.instructions, 100);
      observations.push({limited: target.semanticState().step});
    }
    assert.equal(target.step('cp1'), undefined); pump();
    const state = target.semanticState();
    assert.equal(state.pc, scenario.pcs[index], `${scenario.name} command ${index} PC`);
    assert.deepEqual([state.accumulator.opcode, state.accumulator.operand], scenario.acc[index], `${scenario.name} accumulator`);
    if (scenario.comparison) assert.equal(state.comparison.value, scenario.comparison[index], `${scenario.name} comparison`);
    observations.push({pc: state.pc, accumulator: state.accumulator, comparison: state.comparison?.value, execution: state.execution, step: state.step});
  }
  if (scenario.name === 'loads-stores-full-accumulator') assert.deepEqual(machine.readCell(91), {opcode: 17, operand: 231});
  if (scenario.error) {
    assert.equal(target.semanticState().execution, 'error'); assert.equal(events.at(-1).error.code, scenario.error);
  }
  if (scenario.loop) {
    target.run(); pump(); assert.equal(halts.at(-1).bpKind, 'cp1'); assert.equal(target.semanticState().pc, 0);
  }
  results.push({name: scenario.name, matched: true, expansion: !!scenario.expansion, program: scenario.words,
    data: scenario.data ?? [], start, observations,
    events: events.map(({type, sequence, rawPc, cycles, tNs, pc, accumulator, command, outcome, reason, error}) =>
      ({type, sequence, rawPc, cycles, tNs, pc, accumulator, command, outcome, reason, error})),
    halts: halts.map(({cause, bpKind, cp1Pc}) => ({cause, bpKind, cp1Pc}))});
  target.destroy();
}
const sourcePaths = ['src/cp1-machine.js', 'src/cp1-adapter.js', 'src/cp1-debug.js', 'src/cp1-semantics.js',
  'src/cp1-semantic-profiles.js', 'src/cp1-rom-profiles.js', 'src/mcs48.js', 'src/i8155.js', 'scripts/check-cp1-semantic-rom.mjs'];
const sourceSha256 = Object.fromEntries(sourcePaths.map(path => [path,
  createHash('sha256').update(readFileSync(new URL(`../${path}`, import.meta.url))).digest('hex')]));
const report = {format: 'brickwright.cp1-semantic-observation', version: 1, romSha1: identity.sha1,
  node: process.version, clockHz: 6000000, sourceSha256, cases: results,
  limits: ['Original programs executed on the independent machine, not physical-hardware qualification.',
    'No GPL reference emulator, annotated source, firmware bytes, or downloads are included.',
    'Only the named 2716 image is qualified; mask ROM B remains raw-only.']};
if (process.argv[3]) writeFileSync(process.argv[3], JSON.stringify(report, (_, value) => typeof value === 'bigint' ? value.toString() : value, 2) + '\n');
console.log(JSON.stringify({passed: results.length, romSha1: identity.sha1,
  cases: results.map(result => ({name: result.name, commandEvents: result.events.filter(event => event.type === 'cp1.command').length}))}));
