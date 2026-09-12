import assert from 'node:assert/strict';
import test from 'node:test';
import {createEmu8051DebugTarget} from '../src/emu8051-debug.js';

const makeWasm = ({version = 1, buildId = 0x80510101, size = 64} = {}) => {
  const heap = new Uint8Array(4096);
  let time = 100n;
  let frees = 0;
  let restores = 0;
  let restoreCode = 0;
  const wasm = {
    HEAPU8: heap,
    _malloc: () => 128,
    _free: () => { frees++; },
    _emu_checkpoint_version: () => version,
    _emu_checkpoint_build_id: () => buildId,
    _emu_checkpoint_size: () => size,
    _emu_checkpoint_save: (ptr, len) => {
      for (let i = 0; i < len; i++) heap[ptr + i] = (i * 17) & 0xff;
      return 0;
    },
    _emu_checkpoint_restore: () => { restores++; time = 50n; return restoreCode; },
    _emu_dbg_state: () => 0,
    _emu_dbg_run: () => {}, _emu_dbg_halt: () => {}, _emu_dbg_step: () => 0,
    _emu_dbg_reset: () => {}, _emu_dbg_run_until_ns: () => 0,
    _emu_dbg_read_mem: () => 0, _emu_dbg_write_mem: () => {}, _emu_dbg_pc: () => 0,
    _emu_dbg_supports_step: () => 0,
    _emu_get_time_ns_lo: () => Number(time & 0xffffffffn),
    _emu_get_time_ns_hi: () => Number(time >> 32n)
  };
  return {wasm, heap, stats: () => ({frees, restores}), setRestoreCode: value => { restoreCode = value; }};
};

test('exact ABI advertises checkpoint/restore, copies bytes, and never claims reverse', () => {
  const fixture = makeWasm();
  const target = createEmu8051DebugTarget(fixture.wasm);
  assert.deepEqual(target.capabilities().recording, ['checkpoint', 'restore']);
  assert.equal(target.capabilities().extensions.checkpoint.buildId, 0x80510101);
  assert.equal(target.capabilities().reverse, undefined);

  const snapshot = target.captureCheckpoint();
  assert.ok(snapshot.bytes instanceof Uint8Array);
  const first = snapshot.bytes[0];
  fixture.heap[128] ^= 0xff;
  assert.equal(snapshot.bytes[0], first, 'capture owns a copy, not a live WASM view');
  assert.equal(fixture.stats().frees, 1);

  assert.equal(target.restoreCheckpoint(snapshot), true);
  assert.match(target.time().domain, /reset-1$/, 'backward native time opens a new epoch');
  assert.deepEqual(fixture.stats(), {frees: 2, restores: 1});
});

test('missing or wrong identity stays fail-closed and never calls native restore', () => {
  for (const options of [{version: 2}, {buildId: 0x80510102}, {size: 0}]) {
    const fixture = makeWasm(options);
    const target = createEmu8051DebugTarget(fixture.wasm);
    assert.deepEqual(target.capabilities().recording, []);
    assert.equal(target.capabilities().extensions.checkpoint.supported, false);
    assert.ok(target.captureCheckpoint().refused);
    assert.equal(fixture.stats().restores, 0);
  }
});

test('envelope validation precedes mutation and native errors stay structured', () => {
  const fixture = makeWasm();
  const target = createEmu8051DebugTarget(fixture.wasm);
  const snapshot = target.captureCheckpoint();
  const malformed = {...snapshot, local: {...snapshot.local, breakpoints: [['bad']]}};
  assert.equal(target.restoreCheckpoint(malformed).code, 'invalid-checkpoint-envelope');
  assert.equal(fixture.stats().restores, 0);

  fixture.setRestoreCode(-7);
  const refusal = target.restoreCheckpoint(snapshot);
  assert.deepEqual({code: refusal.code, nativeCode: refusal.nativeCode, reason: refusal.reason},
    {code: 'native-checkpoint-refused', nativeCode: -7, reason: 'invalid-state'});
  assert.equal(fixture.stats().restores, 1);
});
