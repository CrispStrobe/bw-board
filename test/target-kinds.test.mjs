import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { getTargetKinds, LABWIRED_KIND } from '../src/target-kinds.js';
import {
  getTargetKinds as getFactoryTargetKinds,
  LABWIRED_KIND as FACTORY_LABWIRED_KIND,
} from '../src/debug-target-factory.js';

const EXPECTED_KINDS = [
  'emulator', 'avr8js', 'atmega2560', 'attiny85', 'z80', 'i8086',
  'attiny88', 'eater6502', 'rp2040js', 'stm32f0', 'serial',
];

test('target picker metadata preserves the established kinds and factory API', () => {
  assert.deepEqual(getTargetKinds().map(entry => entry.kind), EXPECTED_KINDS);
  assert.deepEqual(getFactoryTargetKinds(), getTargetKinds());
  assert.equal(FACTORY_LABWIRED_KIND, LABWIRED_KIND);
  assert.equal(LABWIRED_KIND.kind, 'labwired');
  assert.ok(!EXPECTED_KINDS.includes(LABWIRED_KIND.kind),
    'the optional heavy target must remain probe-gated by its host');
});

test('target picker metadata has no factory, adapter or CPU dependency edge', () => {
  const metadata = readFileSync(new URL('../src/target-kinds.js', import.meta.url), 'utf8');
  const imports = [...metadata.matchAll(
    /\b(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g,
  )].map(match => match[1]);
  assert.deepEqual(imports, [], 'target-kinds.js must remain dependency-free');
  assert.doesNotMatch(metadata, /\b(?:import\s*\(|require\s*\(|createRequire\b)/,
    'metadata must not hide a dynamic dependency edge');

  const index = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  assert.match(index, /export \{ getTargetKinds, LABWIRED_KIND \} from '\.\/target-kinds\.js'/);
  assert.doesNotMatch(index,
    /export \{[^}]*getTargetKinds[^}]*\} from '\.\/debug-target-factory\.js'/);

  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.exports['./target-kinds'], './src/target-kinds.js');
});
