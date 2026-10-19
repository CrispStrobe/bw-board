import test from 'node:test';
import assert from 'node:assert/strict';
import I80386 from '../src/experimental/i80386.js';
import {attachI80386FetchCursorEligibility} from
  '../scripts/lib/i80386-fetch-cursor-eligibility.mjs';

function fixture() {
  const reads = [];
  let failAt = -1;
  const cpu = new I80386({fetch(address) {
    reads.push(address >>> 0);
    if (address === failAt) throw new Error('fetch fault');
    return address & 255;
  }});
  cpu.segmentCaches[1] = {base:0, limit:0xffffffff, present:true,
    code:true, readable:true, writable:false, default32:true};
  const machine = {cpu, _a20Configured:true, _a20Enabled:true,
    get a20Enabled() { return this._a20Enabled; }};
  const observer = attachI80386FetchCursorEligibility(machine);
  return {cpu, machine, reads, observer, fail(address) { failAt = address; }};
}

test('counts completed bytes once, including slow cross-page immediate', () => {
  const f = fixture();
  f.cpu.eip = 0xffe;
  assert.equal(f.cpu._fetchN(4), 0x0100fffe);
  assert.deepEqual(f.reads, [0xffe,0xfff,0x1000,0x1001]);
  assert.deepEqual(f.observer.report().ineligibleReasons,
    {cold:1, linearPage:1});
  assert.equal(f.observer.report().completedBytes, 4);
  assert.equal(f.observer.report().eligibleBytes, 2);
  f.observer.detach();
});

test('A20 change revokes hypothetical cursor, with one fetch callback per byte', () => {
  const f = fixture();
  f.cpu._fetch8();
  f.cpu._fetch8();
  f.machine._a20Enabled = false;
  f.cpu._fetch8();
  f.machine._a20Configured = false;
  f.cpu._fetch8();
  assert.deepEqual(f.reads, [0,1,2,3]);
  assert.deepEqual(f.observer.report().ineligibleReasons, {cold:1,a20:2});
  assert.equal(f.observer.report().eligibleBytes, 1);
});

test('CS, CR3, translation generation and page boundary each revoke reuse', () => {
  const f = fixture();
  f.cpu._fetch8();
  f.cpu.segmentCaches[1] = {...f.cpu.segmentCaches[1]};
  f.cpu._fetch8();
  f.cpu.cr3 = 0x1000;
  f.cpu._fetch8();
  f.cpu._translationGeneration = 2;
  f.cpu._fetch8();
  f.cpu.eip = 0x1000;
  f.cpu._fetch8();
  assert.deepEqual(f.observer.report().ineligibleReasons,
    {cold:1,cs:1,cr3:1,generation:1,linearPage:1});
  assert.equal(f.observer.report().eligibleBytes, 0);
});

test('partial fault counts only successful bytes and revokes reuse', () => {
  const f = fixture();
  f.cpu.eip = 0xffe;
  f.fail(0x1000);
  assert.throws(() => f.cpu._fetchN(4), /fetch fault/);
  assert.equal(f.cpu.eip, 0x1000);
  assert.deepEqual(f.reads, [0xffe,0xfff,0x1000]);
  assert.equal(f.observer.report().completedBytes, 2);
  assert.equal(f.observer.report().failedFetchCalls, 1);
  f.fail(-1);
  f.cpu._fetch8();
  assert.deepEqual(f.observer.report().ineligibleReasons,
    {cold:2});
});

test('same-page immediate has no extra bus transactions', () => {
  const f = fixture();
  assert.equal(f.cpu._fetchN(4), 0x03020100);
  assert.deepEqual(f.reads, [0,1,2,3]);
  assert.equal(f.observer.report().completedBytes, 4);
  assert.equal(f.observer.report().eligibleBytes, 3);
});
