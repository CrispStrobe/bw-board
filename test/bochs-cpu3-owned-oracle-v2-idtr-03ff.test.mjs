import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {assertOwnedIdtr03ff} from '../scripts/bochs-cpu3-owned-oracle-v2-idtr-03ff/contract.mjs';

const prior=JSON.parse(readFileSync(new URL('../docs/receipts/2026-09-30-i80386-bochs-cpu3-owned-memory-v2.json',import.meta.url)));

test('preserves the published unaligned v2 checkpoint as a negative case',()=>{
  assert.equal(prior.checkpoint.tables.idtrBase,0);
  assert.equal(prior.checkpoint.tables.idtrLimit,0xffff);
  assert.throws(()=>assertOwnedIdtr03ff(prior.checkpoint),/IDTR 0:03ff/);
});

test('requires exactly base zero and limit 03ff in the new checkpoint',()=>{
  const aligned={tables:{...prior.checkpoint.tables,idtrLimit:0x03ff}};
  assert.doesNotThrow(()=>assertOwnedIdtr03ff(aligned));
  assert.throws(()=>assertOwnedIdtr03ff({tables:{...aligned.tables,idtrBase:1}}));
  assert.throws(()=>assertOwnedIdtr03ff({tables:{...aligned.tables,idtrLimit:0x0400}}));
});
