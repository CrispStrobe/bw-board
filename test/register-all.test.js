// The registry needs a caller — this pins that registerAllDevices actually
// fills the registry with the kinds consumers depend on, so the "17 register
// functions, zero callers" hole (2026-08-10) cannot silently reopen.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerAllDevices, registeredKinds } from '../src/index.js';
import { BoardImpl } from '../src/board.js';

test('registerAllDevices fills the registry with the load-bearing kinds', () => {
  registerAllDevices();
  const kinds = new Set(registeredKinds());
  for (const k of ['servo', 'timer_555', 'relay', 'dc_motor']) {
    assert.ok(kinds.has(k), `registry missing "${k}" after registerAllDevices()`);
  }
  assert.ok(kinds.size >= 40, `expected a full registry, got ${kinds.size} kinds`);
});

test('a servo netlist validates after registration', () => {
  registerAllDevices();
  const b = new BoardImpl(5);
  b.setNetlist(
    [{ id: 's1', kind: 'servo', params: {}, terminals: ['signal', 'vcc', 'gnd'] },
     { id: 'v1', kind: 'vcc', params: {}, terminals: ['vcc'] },
     { id: 'g1', kind: 'gnd', params: {}, terminals: ['gnd'] }],
    [{ id: 'n1', terminals: [{ part: 'v1', terminal: 'vcc' }, { part: 's1', terminal: 'vcc' }] },
     { id: 'n2', terminals: [{ part: 'g1', terminal: 'gnd' }, { part: 's1', terminal: 'gnd' }] }]
  );
  assert.ok(true, 'setNetlist accepted servo');
});
