import assert from 'node:assert/strict';
import test from 'node:test';
import {createEmu8051DebugTarget} from '../src/emu8051-debug.js';
import {createEmu8051Adapter} from '../src/emu8051-adapter.js';
import {createDebugTarget} from '../src/debug-target-factory.js';

const CHECKPOINT_SIZE = 443483;
const makeWasm = ({version = 1, buildId = 0x80510101, size = CHECKPOINT_SIZE,
  history = false, historyStart = 0} = {}) => {
  let heap = new Uint8Array(CHECKPOINT_SIZE + 1024);
  let time = 100n;
  let frees = 0;
  let restores = 0;
  let restoreCode = 0;
  let debugState = 0;
  let historyCount = historyStart >>> 0;
  let historyHead = historyStart >>> 0;
  let restoredPayload = null;
  const wasm = {
    get HEAPU8() { return heap; },
    set HEAPU8(value) { heap = value; },
    _malloc: () => 128,
    _free: () => { frees++; },
    _emu_checkpoint_version: () => version,
    _emu_checkpoint_build_id: () => buildId,
    _emu_checkpoint_size: () => size,
    _emu_checkpoint_save: (ptr, len) => {
      for (let i = 0; i < len; i++) heap[ptr + i] = (i * 17) & 0xff;
      return 0;
    },
    _emu_checkpoint_restore: (ptr, len) => {
      restores++;
      restoredPayload = Uint8Array.from(heap.subarray(ptr, ptr + len));
      if (restoreCode === 0) time = 50n;
      return restoreCode;
    },
    _emu_dbg_state: () => debugState,
    _emu_dbg_run: () => { debugState = 1; }, _emu_dbg_halt: () => { debugState = 0; },
    _emu_dbg_step: () => { debugState = 1; return 0; },
    _emu_dbg_reset: () => {}, _emu_dbg_run_until_ns: () => 0,
    _emu_dbg_read_mem: () => 0, _emu_dbg_write_mem: () => {}, _emu_dbg_pc: () => 0,
    _emu_dbg_supports_step: () => 0,
    _emu_dbg_set_bp_code: () => 1, _emu_dbg_clear_bp: () => {},
    _emu_init: () => {}, _emu_reset: () => { time = 0n; },
    _emu_set_part: () => {}, _emu_set_fosc: () => {}, _emu_set_vcc: () => {},
    _emu_get_pin_mode: () => 0, _emu_get_pin_drive: () => 1,
    _emu_set_pin_input: () => {}, _emu_set_adc_voltage: () => {},
    _emu_advance_to_ns: () => 0, _emu_get_sfr: () => 0, _emu_set_sfr: () => {},
    _emu_get_code: () => 1,
    _emu_get_time_ns_lo: () => Number(time & 0xffffffffn),
    _emu_get_time_ns_hi: () => Number(time >> 32n)
  };
  if (history) Object.assign(wasm, {
    _emu_pin_history_enable: () => {}, _emu_pin_event_size: () => 12,
    _emu_pin_history_count: () => historyCount,
    _emu_pin_history_head: () => historyHead,
    _emu_pin_history_get: index => 16 + (index % 4096) * 12
  });
  return {wasm, heap: () => heap, stats: () => ({frees, restores}),
    setRestoreCode: value => { restoreCode = value; },
    setTime: value => { time = BigInt(value); }, setHistory(value) {
      historyCount = historyHead = value >>> 0;
    }, restoredPayload: () => restoredPayload};
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
  fixture.heap()[128] ^= 0xff;
  assert.equal(snapshot.bytes[0], first, 'capture owns a copy, not a live WASM view');
  assert.equal(fixture.stats().frees, 1);

  assert.equal(target.restoreCheckpoint(snapshot), true);
  assert.match(target.time().domain, /reset-1$/, 'every restore opens a new epoch');
  assert.equal(target.restoreCheckpoint(snapshot), true);
  assert.match(target.time().domain, /reset-2$/, 'an equal-time restore also opens a new epoch');
  assert.deepEqual(fixture.stats(), {frees: 3, restores: 2});
});

test('armed step bookkeeping survives while listeners remain live', () => {
  const fixture = makeWasm();
  let nativeHalt;
  fixture.wasm.addFunction = fn => { nativeHalt = fn; return 9; };
  fixture.wasm._emu_dbg_set_on_halt = () => {};
  const target = createEmu8051DebugTarget(fixture.wasm);
  const causes = [];
  target.onHalt(why => causes.push(why.cause));
  target.step('insn');
  const snapshot = target.captureCheckpoint();
  target.run();
  assert.equal(target.restoreCheckpoint(snapshot), true);
  nativeHalt();
  assert.deepEqual(causes, ['step']);

  const completed = target.captureCheckpoint();
  assert.equal(completed.local.stepping, false,
    'direct native completion canonicalizes wrapper lifecycle bookkeeping');
  assert.equal(completed.local.pendingCause, null);
  assert.equal(completed.local.pendingStep, null);
  target.run();
  assert.equal(target.restoreCheckpoint(completed), true,
    'a checkpoint produced after direct completion must accept itself');

  target.step('insn');
  target.halt();
  nativeHalt();
  const cancelled = target.captureCheckpoint();
  assert.deepEqual({stepping: cancelled.local.stepping, cause: cancelled.local.pendingCause,
    step: cancelled.local.pendingStep}, {stepping: false, cause: null, step: null});
  target.run();
  assert.equal(target.restoreCheckpoint(cancelled), true,
    'a checkpoint produced after cancelling a step must accept itself');
});

test('restore re-entered from an active run slice refuses before native mutation', () => {
  const fixture = makeWasm();
  const target = createEmu8051DebugTarget(fixture.wasm);
  const snapshot = target.captureCheckpoint();
  let refusal;
  fixture.wasm._emu_dbg_run_until_ns = () => {
    refusal = target.restoreCheckpoint(snapshot);
    return 0;
  };
  target.run();
  target.runFor(1);
  assert.equal(refusal.code, 'checkpoint-not-quiescent');
  assert.equal(fixture.stats().restores, 0);
});

test('runFor step completion leaves canonical checkpoint bookkeeping', () => {
  const fixture = makeWasm();
  fixture.wasm._emu_dbg_run_until_ns = () => 1;
  const target = createEmu8051DebugTarget(fixture.wasm);
  target.step('insn');
  assert.equal(target.runFor(1), 'halted');
  const snapshot = target.captureCheckpoint();
  assert.deepEqual({stepping: snapshot.local.stepping, cause: snapshot.local.pendingCause,
    step: snapshot.local.pendingStep}, {stepping: false, cause: null, step: null});
  assert.equal(target.restoreCheckpoint(snapshot), true);
});

test('detached adapter state is restored while its input epoch always branches', () => {
  const fixture = makeWasm();
  const adapter = createEmu8051Adapter(fixture.wasm, {mode: 'poll'});
  adapter.applyReplayInput({producer: 'emu8051.pin', payload: {port: 1, bit: 0, level: 1}});
  const saved = adapter.captureCheckpointState();
  adapter.reset();
  adapter.applyReplayInput({producer: 'emu8051.pin', payload: {port: 1, bit: 0, level: 0}});
  const prepared = adapter.prepareCheckpointRestore(saved);
  assert.equal(prepared.accepted, true);
  prepared.commit();
  const restored = adapter.captureCheckpointState();
  assert.deepEqual(restored.observedInputs, saved.observedInputs);
  assert.equal(restored.inputTimeEpoch, 2, 'restore branches from the current input epoch');
});

test('missing or wrong identity stays fail-closed and never calls native restore', () => {
  for (const options of [{version: 2}, {version: -1}, {version: 2 ** 32 + 1},
    {buildId: 0x80510102}, {buildId: NaN}, {size: 0}, {size: CHECKPOINT_SIZE + 1}]) {
    const fixture = makeWasm(options);
    const target = createEmu8051DebugTarget(fixture.wasm);
    assert.deepEqual(target.capabilities().recording, []);
    assert.equal(target.capabilities().extensions.checkpoint.supported, false);
    assert.ok(target.captureCheckpoint().refused);
    assert.equal(fixture.stats().restores, 0);
  }
});

test('every native status is mapped and an unknown status remains a structured refusal', () => {
  const fixture = makeWasm();
  const target = createEmu8051DebugTarget(fixture.wasm);
  const snapshot = target.captureCheckpoint();
  const expected = new Map([[-1, 'not-initialized'], [-2, 'null-buffer'],
    [-3, 'wrong-length'], [-4, 'malformed'], [-5, 'unsupported-version'],
    [-6, 'incompatible-build'], [-7, 'invalid-state'], [-8, 'allocation-failed']]);
  for (const [status, reason] of expected) {
    fixture.setRestoreCode(status);
    assert.equal(target.restoreCheckpoint(snapshot).reason, reason);
  }
  fixture.setRestoreCode(-99);
  assert.equal(target.restoreCheckpoint(snapshot).reason, 'unknown-native-error');
});

test('attached poll and push boards refuse dynamically through the same capability gate', () => {
  for (const mode of ['poll', 'push']) {
    const fixture = makeWasm();
    let attached = true;
    const adapter = {
      checkpointSupport: () => attached ? {supported: false,
        code: 'live-board-checkpoint-unsupported', reason: `${mode} board attached`} :
        {supported: true},
      captureCheckpointState: () => ({schema: 1}),
      prepareCheckpointRestore: () => ({accepted: true, commit() {}})
    };
    const target = createEmu8051DebugTarget(fixture.wasm, {adapter});
    assert.deepEqual(target.capabilities().recording, []);
    assert.equal(target.captureCheckpoint().code, 'live-board-checkpoint-unsupported');
    attached = false;
    assert.deepEqual(target.capabilities().recording, ['checkpoint', 'restore']);
  }
});

test('real poll/push adapters and the factory path fail closed once a board is attached', async () => {
  const board = {advanceTo() {}, setPin() {}, readPin() { return 0; }, readAnalog() { return 0; }};
  for (const mode of ['poll', 'push']) {
    const fixture = makeWasm();
    if (mode === 'push') {
      fixture.wasm.addFunction = () => 7;
      fixture.wasm.removeFunction = () => {};
      fixture.wasm._emu_set_board_callbacks = () => {};
    }
    const adapter = createEmu8051Adapter(fixture.wasm, {mode});
    adapter.attachBoard(board);
    const target = createEmu8051DebugTarget(fixture.wasm, {adapter});
    assert.equal(target.capabilities().extensions.checkpoint.code,
      'live-board-checkpoint-unsupported', `${mode} attachment`);
    assert.equal(target.captureCheckpoint().code, 'live-board-checkpoint-unsupported');
  }

  const fixture = makeWasm();
  const {target} = await createDebugTarget('emulator', {wasm: fixture.wasm, board});
  assert.deepEqual(target.capabilities().recording, []);
  assert.equal(target.captureCheckpoint().code, 'live-board-checkpoint-unsupported');
});

test('restore copies a heap alias before malloc growth and rejects cross-target identity', () => {
  const fixture = makeWasm();
  const target = createEmu8051DebugTarget(fixture.wasm);
  const snapshot = target.captureCheckpoint();
  const aliased = {...snapshot, bytes: fixture.wasm.HEAPU8.subarray(0, CHECKPOINT_SIZE)};
  aliased.bytes.set(snapshot.bytes);
  const oldMalloc = fixture.wasm._malloc;
  fixture.wasm._malloc = () => {
    const grown = new Uint8Array(CHECKPOINT_SIZE + 2048);
    fixture.wasm.HEAPU8 = grown;
    return 256;
  };
  assert.equal(target.restoreCheckpoint(aliased), true);
  assert.deepEqual(fixture.restoredPayload(), snapshot.bytes,
    'the exact aliased subarray payload reaches native after heap growth');
  const other = createEmu8051DebugTarget(fixture.wasm);
  assert.equal(other.restoreCheckpoint(snapshot).code, 'invalid-checkpoint-envelope');
  fixture.wasm._malloc = oldMalloc;
});

test('capture reacquires a heap grown by native save', () => {
  const fixture = makeWasm();
  fixture.wasm._emu_checkpoint_save = (ptr, len) => {
    fixture.wasm.HEAPU8 = new Uint8Array(CHECKPOINT_SIZE + 4096);
    fixture.wasm.HEAPU8.fill(0x5a, ptr, ptr + len);
    return 0;
  };
  const snapshot = createEmu8051DebugTarget(fixture.wasm).captureCheckpoint();
  assert.equal(snapshot.bytes.length, CHECKPOINT_SIZE);
  assert.equal(snapshot.bytes[0], 0x5a);
  assert.equal(snapshot.bytes.at(-1), 0x5a);
});

test('absolute pin-history cursors survive >capacity values and uint32 wrap', () => {
  const fixture = makeWasm({history: true, historyStart: 0xfffffffe});
  const target = createEmu8051DebugTarget(fixture.wasm);
  const facts = [];
  target.onDebugEvent(fact => facts.push(fact));
  fixture.setHistory(1); // three absolute events across uint32 wrap
  target.writeMem('iram', 0, new Uint8Array());
  assert.equal(facts.filter(fact => fact.phase === 'pin-change').length, 3);
  assert.equal(facts.filter(fact => fact.phase === 'history-gap').length, 0);
  const snapshot = target.captureCheckpoint();
  assert.equal(snapshot.local.pinHistoryReadHead, 1);
  assert.equal(target.restoreCheckpoint(snapshot), true);
  const incoherent = {...snapshot, local: {...snapshot.local, pinHistoryReadHead: 2}};
  assert.equal(target.restoreCheckpoint(incoherent).code, 'invalid-checkpoint-envelope');
});

test('envelope validation precedes mutation and native errors stay structured', () => {
  const fixture = makeWasm();
  const target = createEmu8051DebugTarget(fixture.wasm);
  const snapshot = target.captureCheckpoint();
  target.setBreakpoint({kind: 'code', addr: 64});
  const withBreakpoint = target.captureCheckpoint();
  const malformedLocals = [
    {...snapshot.local, symbols: {bad() {}}},
    {...snapshot.local, breakpoints: [['bad']]},
    {...snapshot.local, taskIndex: [['task', 0], ['task', 1]]},
    {...snapshot.local, breakpoints: [[33, {kind: 'code', addr: 0, pc: 0}],
      [33, {kind: 'code', addr: 1, pc: 1}]]},
    {...snapshot.local, pendingStep: {kind: 'insn', pcBefore: -1}, stepping: true,
      pendingCause: 'step'},
    {...withBreakpoint.local, breakpoints: [[1, {kind: 'code', addr: 64, pc: 65}]]}
  ];
  for (const local of malformedLocals) {
    const malformed = {...snapshot, local};
    assert.equal(target.restoreCheckpoint(malformed).code, 'invalid-checkpoint-envelope');
  }
  assert.equal(fixture.stats().restores, 0);

  fixture.setRestoreCode(-7);
  const domainBefore = target.time().domain;
  const nativeBefore = target.captureCheckpoint().bytes;
  const refusal = target.restoreCheckpoint(snapshot);
  assert.deepEqual({code: refusal.code, nativeCode: refusal.nativeCode, reason: refusal.reason},
    {code: 'native-checkpoint-refused', nativeCode: -7, reason: 'invalid-state'});
  assert.equal(fixture.stats().restores, 1);
  assert.equal(target.time().domain, domainBefore, 'a failed native restore does not branch JS time');
  assert.deepEqual(target.captureCheckpoint().bytes, nativeBefore,
    'native rejection leaves machine bytes unchanged');
});

test('adapter restore commits exactly once after native success and never on refusal', () => {
  const fixture = makeWasm();
  let commits = 0;
  const adapter = {checkpointSupport: () => ({supported: true}),
    captureCheckpointState: () => ({schema: 1}),
    prepareCheckpointRestore: () => ({accepted: true, commit() { commits++; }})};
  const target = createEmu8051DebugTarget(fixture.wasm, {adapter});
  const snapshot = target.captureCheckpoint();
  fixture.setRestoreCode(-7);
  assert.ok(target.restoreCheckpoint(snapshot).refused);
  assert.equal(commits, 0);
  fixture.setRestoreCode(0);
  assert.equal(target.restoreCheckpoint(snapshot), true);
  assert.equal(commits, 1);
});

test('capture owns nested symbols and breakpoint metadata independently of callers', () => {
  const fixture = makeWasm();
  const symbols = {scheduler: {tasks: [], bw_ms: {addr: 4}}};
  const target = createEmu8051DebugTarget(fixture.wasm, {symbols});
  const bp = {kind: 'code', addr: 64, label: {text: 'original'}};
  target.setBreakpoint(bp);
  const snapshot = target.captureCheckpoint();
  symbols.scheduler.bw_ms.addr = 99;
  bp.label.text = 'mutated';
  assert.equal(snapshot.local.symbols.scheduler.bw_ms.addr, 4);
  assert.equal(snapshot.local.breakpoints[0][1].label.text, 'original');
});

test('opaque provenance binds all local continuation state to exact native byte values', () => {
  const fixture = makeWasm();
  let generation = 1;
  fixture.wasm._emu_checkpoint_save = (ptr, len) => {
    fixture.wasm.HEAPU8.fill(generation, ptr, ptr + len);
    return 0;
  };
  const target = createEmu8051DebugTarget(fixture.wasm);
  const first = target.captureCheckpoint();
  generation = 2;
  const second = target.captureCheckpoint();
  assert.equal(target.restoreCheckpoint({...first, bytes: second.bytes.slice()}).code,
    'invalid-checkpoint-envelope', 'same metadata cannot authenticate other native state');

  target.setBreakpoint({kind: 'code', addr: 64});
  generation = 3;
  const bp64 = target.captureCheckpoint();
  target.clearBreakpoint(1);
  target.setBreakpoint({kind: 'code', addr: 128});
  generation = 4;
  const bp128 = target.captureCheckpoint();
  assert.equal(target.restoreCheckpoint({...bp64, bytes: bp128.bytes.slice()}).code,
    'invalid-checkpoint-envelope');
  const hostileBytes = bp128.bytes.slice();
  hostileBytes.every = () => true;
  assert.equal(target.restoreCheckpoint({...bp64, bytes: hostileBytes}).code,
    'invalid-checkpoint-envelope', 'an own every override cannot choose seal comparison');
  const hostileIterator = bp64.bytes.slice();
  hostileIterator[Symbol.iterator] = function* () { yield* bp128.bytes; };
  assert.equal(target.restoreCheckpoint({...bp64, bytes: hostileIterator}), true,
    'an iterator override cannot change the indexed bytes copied after validation');
  assert.deepEqual(fixture.restoredPayload(), bp64.bytes,
    'native receives the same indexed values which passed the seal');
  assert.equal(target.restoreCheckpoint({...bp128, local: bp64.local}).code,
    'invalid-checkpoint-envelope');
  const invented = {...bp64, local: {...bp64.local, stepping: true, pendingCause: 'step',
    pendingStep: {kind: 'insn', pcBefore: 777}}};
  assert.equal(target.restoreCheckpoint(invented).code, 'invalid-checkpoint-envelope');

  assert.equal(target.restoreCheckpoint({...bp64, bytes: bp64.bytes.slice()}), true,
    'a value-identical owned copy remains valid');
  const backing = new Uint8Array(bp64.bytes.length + 9);
  const offsetView = backing.subarray(5, 5 + bp64.bytes.length);
  offsetView.set(bp64.bytes);
  assert.equal(target.restoreCheckpoint({...bp64, bytes: offsetView}), true,
    'byteOffset and ArrayBuffer identity are not part of the seal');
});

test('an alternating local accessor is read once and cannot change staged restore state', () => {
  const fixture = makeWasm();
  const target = createEmu8051DebugTarget(fixture.wasm);
  const snapshot = target.captureCheckpoint();
  const local = {...snapshot.local};
  let reads = 0;
  Object.defineProperty(local, 'symbols', {enumerable: true, configurable: true, get() {
    reads++;
    return reads === 1 ? snapshot.local.symbols : {scheduler: {tasks: [{name: 'invented'}]}};
  }});
  assert.equal(target.restoreCheckpoint({...snapshot, local}), true);
  assert.equal(reads, 1, 'local continuation getters are consumed only by the one staging clone');
  assert.deepEqual(target.captureCheckpoint().local.symbols, snapshot.local.symbols,
    'the proof-matching staged value, not a later accessor value, was committed');
});
