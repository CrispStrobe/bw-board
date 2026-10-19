import test from 'node:test';
import assert from 'node:assert/strict';
import {expandI80386SourceInventory} from
  '../scripts/lib/i80386-source-inventory.mjs';

test('measurement source inventory includes transitive board chips and observer grammar',()=>{
  const paths=expandI80386SourceInventory([
    '../src/experimental/i80386-at-machine.js',
    '../src/experimental/i80386-cross-mode-potential-trace-observer.js',
    './lib/i80386-source-inventory.mjs'],
  new URL('../scripts/probe-xv6-stock.mjs',import.meta.url));
  for(const file of ['../src/i8086-machine.js','../src/i8259.js',
    '../src/ns16c550.js','../src/experimental/i80386-broad-block-census.js',
    '../src/experimental/i80386-expanded-grouped-admission.js',
    '../src/experimental/i80386-register-stack-admission.js',
    './lib/i80386-source-inventory.mjs'])
    assert.ok(paths.includes(file),file);
  assert.equal(new Set(paths).size,paths.length);
});
