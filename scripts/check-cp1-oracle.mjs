#!/usr/bin/env node
// Optional black-box comparison. Neither reference code nor firmware is bundled.
import {readFileSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {Cp1Machine} from '../src/cp1-machine.js';

const [romPath, oraclePath, reportPath] = process.argv.slice(2);
if (!romPath || !oraclePath) {
  console.error('Usage: node scripts/check-cp1-oracle.mjs USER_ROM.bin EXTERNAL_ORACLE.cjs [report.json]');
  process.exit(2);
}
const rom = new Uint8Array(readFileSync(romPath));
const module = await import(pathToFileURL(resolve(oraclePath)));
const Reference = module.KosmosCP1 || module.default?.KosmosCP1;
if (!Reference) throw new Error('External oracle must export KosmosCP1 with its public program/key/port API.');
const digest = (algorithm, bytes) => createHash(algorithm).update(bytes).digest('hex');
const cases = [
  {name: 'display-42', words: [[4,42],[2,0],[9,1]], expectedDisplay: [119,63,191,63,102,91]},
  {name: 'display-73', words: [[4,73],[2,0],[9,1]]},
  {name: 'switch-input-low', words: [[16,1],[18,1],[1,0]], p1: 254, expectedP2: 254},
  {name: 'switch-input-high', words: [[16,1],[18,1],[1,0]], p1: 255, expectedP2: 255},
  {name: 'overflow-error', words: [[4,255],[7,4],[2,0],[1,0],[0,1]], expectedDisplay: [113,0,128,63,63,125]},
  {name: 'underflow-error', words: [[4,0],[8,4],[2,0],[1,0],[0,1]], expectedDisplay: [113,0,128,63,63,125]},
  {name: 'equal-branch', words: [[4,7],[10,9],[11,6],[4,0],[18,0],[1,0],[4,85],[18,0],[1,0],[0,7]], expectedP2: 85},
  {name: 'original-blink', words: [[4,1],[18,1],[3,200],[4,0],[18,1],[3,200],[9,0]], minimumEdges: 10},
  {name: 'cp3-ports', expansion: true, words: [[4,85],[23,0],[4,42],[24,0],[22,0],[18,0],[1,0]],
    p3: 165, expectedP2: 165, expectedP4: 85, expectedP5: 42},
  {name: 'cp3-upper-memory', expansion: true, expectedP2: 99,
    words: [[9,128], ...Array.from({length: 127}, () => [0,0]), [4,99],[18,0],[1,0]]}
];
const results = [];
for (const scenario of cases) {
  const edges = [], referenceEdges = [];
  let recording = false, previous = 255, referencePrevious = 255;
  const machine = new Cp1Machine({rom, expansion: scenario.expansion === true,
    onPortChange(port, state, tMs) {
      if (recording && port === 2 && state.value !== previous) {
        previous = state.value; edges.push({tMs, value: state.value});
      }
    }});
  const reference = new Reference(rom.slice());
  reference.hasExt = scenario.expansion === true;
  reference.onPort2 = value => {
    if (recording && value !== referencePrevious) {
      referencePrevious = value;
      referenceEdges.push({tMs: reference.cycles / 400, value});
    }
  };
  const advance = count => {
    const result = machine.advanceCycles(count, {maxInstructions: 10000000});
    assert.equal(result.reached, true, 'machine instruction budget exhausted');
    reference.run(count);
  };
  advance(800000);
  if (scenario.p1 !== undefined) {
    machine.setPortInput(1, scenario.p1, 255); reference.port1In = scenario.p1;
  }
  if (scenario.p3 !== undefined) {
    machine.setPortInput(3, scenario.p3, 255); reference.port3In = scenario.p3;
  }
  scenario.words.forEach(([opcode, operand], index) => {
    machine.writeCell(index, opcode, operand); reference.writeCell(index, (opcode << 8) | operand);
  });
  recording = true;
  for (const key of ['0', '0', '0', 'PC', 'RUN']) {
    machine.setKey(key, true); reference.keyDown(key); advance(40000);
    machine.setKey(key, false); reference.keyUp(key); advance(40000);
  }
  advance(1200000);
  const ports = machine.getPortStates();
  assert.equal(ports.P1.latch, reference.p1, `${scenario.name}: P1 latch`);
  assert.equal(ports.P2.latch, reference.pid.pb, `${scenario.name}: P2 latch`);
  if (scenario.expansion) {
    assert.equal(ports.P4.latch, reference.ext.pa, `${scenario.name}: P4 latch`);
    assert.equal(ports.P5.latch, reference.ext.pc & 63, `${scenario.name}: P5 latch`);
  }
  for (let index = 0; index < machine.capacity; index++) {
    const cell = machine.readCell(index);
    assert.equal((cell.opcode << 8) | cell.operand, reference.readCell(index), `${scenario.name}: cell ${index}`);
  }
  for (const key of ['pc', 'a', 'psw', 'p1', 'p2']) {
    assert.equal(machine.cpu[key], reference[key], `${scenario.name}: CPU ${key}`);
  }
  for (const port of [2, 4, 5]) {
    const expected = scenario[`expectedP${port}`];
    if (expected !== undefined) assert.equal(ports[`P${port}`].latch, expected, `${scenario.name}: original expected P${port}`);
  }
  if (scenario.expectedDisplay) assert.deepEqual(machine.snapshot().display.digits,
    scenario.expectedDisplay, `${scenario.name}: actual steady display segments`);
  assert.deepEqual(edges.map(edge => edge.value), referenceEdges.map(edge => edge.value), `${scenario.name}: edge values`);
  if (scenario.minimumEdges) assert.ok(edges.length >= scenario.minimumEdges, 'blink must actually toggle');
  const intervals = edges.slice(1).map((edge, index) => edge.tMs - edges[index].tMs);
  intervals.forEach((interval, index) => assert.ok(
    Math.abs(interval - (referenceEdges[index + 1].tMs - referenceEdges[index].tMs)) < 0.000001,
    `${scenario.name}: edge interval ${index}`));
  results.push({name: scenario.name, expansion: !!scenario.expansion, matched: true,
    displaySegments: machine.snapshot().display.digits,
    comparedCells: machine.capacity, edges: edges.length, intervalsMs: intervals,
    edgeTimestampOffsetsUs: edges.map((edge, index) => (edge.tMs - referenceEdges[index].tMs) * 1000)});
}
const report = {format: 'brickwright.cp1-oracle-observation', version: 1,
  romSha1: digest('sha1', rom), oracleSha256: digest('sha256', readFileSync(oraclePath)),
  clockHz: 6000000, cases: results,
  limits: ['External reference is an oracle, not a proof of hardware fidelity.',
    'I/O callbacks use instruction-start timestamps; no oscillator-edge timing is claimed.',
    'The test does not redistribute or derive implementation from reference source.']};
if (reportPath) writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({passed: results.length, romSha1: report.romSha1,
  cases: results.map(result => ({name: result.name, edges: result.edges}))}));
