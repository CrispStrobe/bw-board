import assert from 'node:assert/strict';
import test from 'node:test';
import I80386, { I80386Fault, UnsupportedI80386 } from '../src/experimental/i80386.js';

const START = 0x20;
const CODE = 0x140000;
const HANDLER = 0x100000;
const MIXED_PROFILE = 'gate14-code16-stack32-same-cpl3.v1';

function fixture({ onRead = null } = {}) {
  const memory = new Map();
  const cpu = new I80386({
    read: address => {
      onRead?.(cpu, address);
      return memory.get(address >>> 0) ?? 0;
    },
    fetch: address => memory.get(address >>> 0) ?? 0,
    write: (address, value) => memory.set(address >>> 0, value & 255),
  });
  const put = (address, bytes) => bytes.forEach((value, index) =>
    memory.set((address + index) >>> 0, value & 255));
  const descriptor = (base, access) =>
    [255, 255, base, base >>> 8, base >>> 16, access, 0xcf, base >>> 24]
      .map(value => value & 255);
  const gate = (offset, selector, type = 14) =>
    [offset, offset >>> 8, selector, selector >>> 8, 0,
      0xe0 | type, offset >>> 16, offset >>> 24]
      .map(value => value & 255);
  cpu.cr0 = 1;
  cpu.gdtr = { base: 0x200, limit: 0x2f };
  cpu.idtr = { base: 0x300, limit: 0x1ff };
  cpu.tr = { selector: 0x30, base: 0x600, limit: 0x67, present: true, type: 11 };
  put(0x208, descriptor(HANDLER, 0x9a));
  put(0x210, descriptor(0x120000, 0x92));
  put(0x218, descriptor(CODE, 0xfa));
  put(0x220, descriptor(0x160000, 0xf2));
  put(0x604, [0, 4, 0, 0, 0x10, 0]);
  put(0x300 + 0x31 * 8, gate(0x100, 8));
  cpu.cs = 0x1b;
  cpu.ss = 0x23;
  cpu.esp = 0x800;
  cpu.eip = START;
  cpu.eflags = 0x202;
  cpu.segmentCaches[1] = cpu._ringCodeDescriptor(0x1b);
  cpu.segmentCaches[2] = cpu._ringStackDescriptor(0x23, 3, { returnPath: true });
  cpu.ax = 0x0501;
  cpu.bx = 0;
  cpu.cx = 4096;
  put(CODE + START, [0xcd, 0x31, 0xf4]);
  put(HANDLER + 0x100, [0xcf]);
  const arm = (extra = {}) => cpu.armOwned0501FrameJournal({
    cs: 0x1b, startEip: START, endEip: START + 3,
    maxActiveSteps: 10, ...extra,
  });
  return { cpu, memory, put, arm };
}

function openedMixedMode() {
  const f = fixture();
  f.memory.set(0x208 + 5, 0xfa);
  f.memory.set(0x208 + 6, 0x8f);
  f.put(0x300 + 0x31 * 8, [0, 1, 0x0b, 0, 0, 0xee, 0, 0]);
  f.put(HANDLER + 0x100, [0x66, 0xcf]);
  const frameToken = f.arm({ profile: MIXED_PROFILE });
  assert.equal(f.cpu.step(), 1);
  assert.equal(f.cpu.owned0501FrameStatus(frameToken).phase, 'open');
  const modeToken = f.cpu.armOwned0501TaskMode(frameToken);
  assert.ok(modeToken);
  return { ...f, frameToken, modeToken };
}

// Synthetic controls exercise CPU authority and event accounting, not guest service.
function terminal({ deliver = 'returned', handoff = true, irqEnabled = false } = {}) {
  const f = openedMixedMode();
  f.cpu.deliverFaults = deliver !== 'disabled';
  f.originalTr = { ...f.cpu.tr };
  f.originalCode = { ...f.cpu.segmentCaches[1] };
  f.originalStack = { ...f.cpu.segmentCaches[2] };
  const core = f.cpu._taskSwitchCore;
  f.cpu._taskSwitchCore = function (selector, kind, options) {
    assert.throws(() => core.call(this, 0, kind, options), I80386Fault);
    this.tr = { selector: 0x38, base: 0x700, limit: 0x67, present: true, type: 11 };
    this.cs = 8; this.ss = 0x10; this.esp = 0x400; this.eip = 0x1234;
    // The authored incoming task EFLAGS must admit the IRQ before PF/anchor
    // capture. The real owned INT gate cleared IF; never alter a live anchor.
    if (irqEnabled) this.eflags |= 0x200;
    this.segmentCaches[1] = { ...f.originalCode, dpl: 0 };
    this.segmentCaches[2] = { ...f.originalStack };
    return 1;
  };
  f.cpu._stepInstruction = function () { this._taskSwitch(0x38, 'jmp'); return 1; };
  assert.equal(f.cpu.step(), 1);
  f.pfToken = f.cpu.armOwned0501FaultOutcome({ maxActiveSteps: 4, postPfHandoff: handoff });
  f.cpu._stepInstruction = function () {
    this.eip = 0x1250; this.cr2 = 0x4a0080;
    throw new I80386Fault(14, 6);
  };
  f.cpu._deliverFault = function () {
    if (deliver === 'threw') throw new Error('delivery refusal');
    this.cs = 8; this.eip = 0x2345; this.ss = 0x10; this.esp = 0x3f0;
    this.segmentCaches[1] = { ...f.originalCode, dpl: 0 };
    this.segmentCaches[2] = { ...f.originalStack };
    if (deliver === 'shutdown') this.shutdown = true;
  };
  if (deliver === 'disabled') assert.throws(() => f.cpu.step(), I80386Fault);
  else if (deliver === 'threw') assert.throws(() => f.cpu.step(), /delivery refusal/);
  else assert.equal(f.cpu.step(), 0);
  assert.equal(!!(f.cpu.eflags & 0x200), irqEnabled);
  assert.equal(f.cpu._interruptShadow, 0);
  f.armPost = (cap = 4) => f.cpu.armOwned0501PostPfContinuation(
    f.pfToken, f.modeToken, { maxActiveSteps: cap });
  return f;
}
function end(f, token, reason = 'observer-step-bound') {
  f.cpu.abortOwned0501PostPfContinuation(token, reason);
  return f.cpu.takeOwned0501PostPfContinuationObservation(token);
}

test('same-session handoff precedes drain and leaves strict observations untouched', () => {
  const f = terminal(), token = f.armPost();
  assert.ok(token);
  const pf = f.cpu.takeOwned0501FaultOutcome(f.pfToken);
  const mode = f.cpu.takeOwned0501TaskModeObservation(f.modeToken);
  const strict = f.cpu.takeOwned0501FrameObservation(f.frameToken);
  assert.equal(pf.delivery.outcome, 'returned');
  assert.equal(mode.firstFailure, 'step-failure');
  assert.equal(strict.failure, 'task-switch-during-owned-frame');
  assert.equal(strict.returned, null);
  f.cpu._stepInstruction = function () { this.eip++; return 1; };
  assert.equal(f.cpu.step(), 1);
  const result = end(f, token);
  assert.equal(result.attemptedSteps, 1);
  assert.equal(result.committedSteps, 1);
  assert.equal(result.transitions.length, 0);
  assert.equal(result.originalOutgoing.selector, 0x38);
  assert.equal(result.frameReturnQualified, false);
  assert.throws(() => f.cpu.owned0501PostPfContinuationStatus(token), /stale/);
});

test('copied, altered, cross-CPU and wrong-profile tokens fail closed', () => {
  const f = terminal(), other = terminal();
  for (const [pf, mode] of [[{}, f.modeToken], [f.pfToken, {}],
      [other.pfToken, f.modeToken], [f.pfToken, other.modeToken],
      [f.pfToken, f.frameToken], [{ ...f.pfToken }, f.modeToken]])
    assert.throws(() => f.cpu.armOwned0501PostPfContinuation(pf, mode,
      { maxActiveSteps: 4 }), /same-session/);
  assert.ok(f.armPost());
});

for (const drain of ['pf', 'mode']) test(`${drain} drained before handoff refuses authority`, () => {
  const f = terminal();
  if (drain === 'pf') f.cpu.takeOwned0501FaultOutcome(f.pfToken);
  else f.cpu.takeOwned0501TaskModeObservation(f.modeToken);
  assert.throws(() => f.armPost(), /same-session/);
});

test('one-shot handoff cannot be replayed after its diagnostic drains', () => {
  const f = terminal(), token = f.armPost();
  assert.throws(() => f.armPost(), /consume previous/);
  end(f, token);
  assert.throws(() => f.armPost(), /same-session/);
});

for (const mode of ['disabled', 'threw', 'shutdown'])
  test(`${mode} PF delivery does not open continuation`, () => {
    const f = terminal({ deliver: mode });
    assert.throws(() => f.armPost(), /same-session/);
  });

test('historical mode session must be observing when the PF recorder arms', () => {
  const f = openedMixedMode();
  f.cpu.abortOwned0501TaskMode(f.modeToken, 'observer-step-bound');
  assert.throws(() => f.cpu.armOwned0501FaultOutcome({ maxActiveSteps: 4,
    postPfHandoff: true }), /retained observing/);
});

test('an incomplete PF recorder cannot authorize continuation', () => {
  const f = openedMixedMode();
  const pf = f.cpu.armOwned0501FaultOutcome({ maxActiveSteps: 4 });
  assert.throws(() => f.cpu.armOwned0501PostPfContinuation(pf, f.modeToken,
    { maxActiveSteps: 4 }), /same-session/);
});

for (const change of ['eax', 'cr2', 'descriptor', 'step', 'interrupt', 'reset'])
  test(`terminal ${change} alteration refuses admission`, () => {
    const f = terminal();
    if (change === 'descriptor') f.cpu.segmentCaches[1].limit--;
    else if (change === 'step') {
      f.cpu._stepInstruction = function () { return 1; };
      f.cpu.step();
    } else if (change === 'interrupt') f.cpu.interrupt(8);
    else if (change === 'reset') f.cpu.reset();
    else f.cpu[change]++;
    assert.throws(() => f.armPost(), /same-session|anchor changed/);
  });

test('accessor admission options are refused without invoking them', () => {
  const f = terminal(); let called = false;
  assert.throws(() => f.cpu.armOwned0501PostPfContinuation(f.pfToken, f.modeToken,
    { get maxActiveSteps() { called = true; return 4; } }), /own data/);
  assert.equal(called, false);
});

test('CPU register accessors are refused without invocation', () => {
  const f = terminal(); let called = false;
  Object.defineProperty(f.cpu, 'eax', { configurable: true,
    get() { called = true; return 0; } });
  assert.throws(() => f.armPost(), /own data/);
  assert.equal(called, false);
});

test('reflection reentry invalidates admission even if scalars agree', () => {
  const f = terminal(), original = Object.getOwnPropertyDescriptor;
  let entered = false;
  Object.getOwnPropertyDescriptor = function (object, key) {
    if (!entered && object === f.cpu.segmentCaches[1]) {
      entered = true;
      assert.equal(f.cpu.armOwned0501PostPfContinuation(f.pfToken,
        f.modeToken, { maxActiveSteps: 4 }), null);
    }
    return original(object, key);
  };
  try { assert.throws(() => f.armPost(), /changed during admission/); }
  finally { Object.getOwnPropertyDescriptor = original; }
});

test('new observer reentry preserves ordinary result but latches refusal', () => {
  const f = terminal(), token = f.armPost();
  f.cpu._stepInstruction = function () {
    assert.equal(this.owned0501PostPfContinuationStatus(token).phase, 'invalid');
    this.eip++; return 1;
  };
  assert.equal(f.cpu.step(), 1);
  const result = f.cpu.takeOwned0501PostPfContinuationObservation(token);
  assert.equal(result.firstFailure, 'observer-reentry');
  assert.equal(result.committedSteps, 0);
});

test('post-PF reset closes its private session', () => {
  const f = terminal(), token = f.armPost();
  f.cpu.reset();
  assert.equal(f.cpu.takeOwned0501PostPfContinuationObservation(token).firstFailure, 'cpu-reset');
});

test('exact step cap retains only its bounded ordinary attempts', () => {
  const f = terminal(), token = f.armPost(2);
  f.cpu._stepInstruction = function () { this.eip++; return 1; };
  assert.equal(f.cpu.step(), 1); assert.equal(f.cpu.step(), 1);
  const result = f.cpu.takeOwned0501PostPfContinuationObservation(token);
  assert.equal(result.firstFailure, 'post-pf-step-cap');
  assert.equal(result.attemptedSteps, 2); assert.equal(result.committedSteps, 2);
});

test('uncommitted task transition retains attempt and earns no credit', () => {
  const f = terminal(), token = f.armPost();
  f.cpu._taskSwitchCore = function () { throw new I80386Fault(13, 0); };
  f.cpu._stepInstruction = function () { this._taskSwitch(0x30, 'jmp'); return 1; };
  assert.equal(f.cpu.step(), 0);
  const result = f.cpu.takeOwned0501PostPfContinuationObservation(token);
  assert.equal(result.transitions.length, 0);
  assert.equal(result.uncommittedTransitions.length, 1);
  assert.equal(result.uncommittedTransitions[0].enclosingStepCommitted, false);
  assert.equal(result.committedSteps, 0);
});

test('candidate uses original outgoing continuity without crediting historical transition', () => {
  const f = terminal(), token = f.armPost();
  f.cpu._taskSwitchCore = function () {
    this.tr = { ...f.originalTr };
    this.cs = 0x0b; this.ss = 0x23; this.eip = 0x100;
    this.esp = 0x7f4; this.cr3 = 0;
    this.segmentCaches[1] = { ...f.originalCode };
    this.segmentCaches[2] = { ...f.originalStack };
    return 1;
  };
  f.cpu._stepInstruction = function () { this._taskSwitch(0x30, 'jmp'); return 1; };
  assert.equal(f.cpu.step(), 1);
  const result = f.cpu.takeOwned0501PostPfContinuationObservation(token);
  assert.equal(result.phase, 'candidate');
  assert.equal(result.transitions.length, 1);
  assert.equal(result.transitions[0].selector, 0x30);
  assert.equal(result.originalOutgoing.selector, 0x38);
  assert.equal(result.resumeCandidate.savedContinuation, true);
  assert.equal(result.frameReturnQualified, false);
});

test('decoded IRET attempt is retained uncommitted when its core throws', () => {
  const f = terminal(), token = f.armPost();
  f.cpu._stepInstruction = I80386.prototype._stepInstruction;
  f.put(f.cpu.segmentCaches[1].base + f.cpu.eip, [0xcf]);
  f.cpu._iret = function () { throw new I80386Fault(13, 0); };
  assert.equal(f.cpu.step(), 0);
  const result = f.cpu.takeOwned0501PostPfContinuationObservation(token);
  assert.equal(result.events[0].kind, 'decoded-iret-intent');
  assert.equal(result.events[0].enclosingStepCommitted, false);
  assert.equal(result.committedSteps, 0);
});

test('source IRQ boundary has separate credit and no ordinary instruction count', () => {
  const f = terminal({ irqEnabled: true }), token = f.armPost();
  f.cpu._deliverProtected = function () { this.eip++; };
  assert.equal(f.cpu.interrupt(8), true);
  const result = end(f, token);
  assert.equal(result.attemptedSteps, 0); assert.equal(result.committedSteps, 0);
  assert.equal(result.events[0].kind, 'source-interrupt');
  assert.equal(result.events[0].sourceOperationReturned, true);
  assert.equal(result.events[0].enclosingStepCommitted, false);
});

test('disabled post-PF profile preserves original exception and allocates no observation', () => {
  const f = terminal(), thrown = new Error('owned original exception');
  f.cpu.takeOwned0501FaultOutcome(f.pfToken);
  f.cpu.takeOwned0501TaskModeObservation(f.modeToken);
  f.cpu._stepInstruction = () => { throw thrown; };
  assert.throws(() => f.cpu.step(), error => error === thrown);
  assert.throws(() => f.cpu.owned0501PostPfContinuationStatus({}), /stale/);
});

test('drain during reflected admission prevents token mint', () => {
  const f = terminal();
  const options = new Proxy({ maxActiveSteps: 4 }, {
    getOwnPropertyDescriptor(object, key) {
      f.cpu.takeOwned0501TaskModeObservation(f.modeToken);
      return Reflect.getOwnPropertyDescriptor(object, key);
    },
  });
  assert.throws(() => f.cpu.armOwned0501PostPfContinuation(f.pfToken,
    f.modeToken, options), /changed during admission/);
});

test('between-step register mutation refuses observer credit', () => {
  const f = terminal(), token = f.armPost();
  f.cpu.eax++;
  f.cpu._stepInstruction = function () { this.eip++; return 1; };
  assert.equal(f.cpu.step(), 1);
  const result = f.cpu.takeOwned0501PostPfContinuationObservation(token);
  assert.equal(result.firstFailure, 'post-pf-between-step-change');
  assert.equal(result.attemptedSteps, 0);
});

test('scalar CS mutation cannot manufacture a decoded CS-transfer event', () => {
  const f = terminal(), token = f.armPost();
  f.cpu._stepInstruction = function () { this.cs = 0x18; return 1; };
  assert.equal(f.cpu.step(), 1);
  const result = f.cpu.takeOwned0501PostPfContinuationObservation(token);
  assert.equal(result.firstFailure, 'unattributed-cs-transfer');
  assert.equal(result.events.length, 0);
});

test('old PF profile without handoff flag adds no terminal authority', () => {
  const f = terminal({ handoff: false });
  assert.throws(() => f.armPost(), /same-session/);
  assert.equal(f.cpu.takeOwned0501FaultOutcome(f.pfToken).delivery.outcome, 'returned');
});

for (const value of [0, 'true', null]) test(`invalid handoff flag ${value} refuses admission`, () => {
  const f = openedMixedMode();
  assert.throws(() => f.cpu.armOwned0501FaultOutcome({ maxActiveSteps: 4,
    postPfHandoff: value }), /own data boolean/);
});

test('accessor handoff flag is refused without invocation', () => {
  const f = openedMixedMode(); let called = false;
  assert.throws(() => f.cpu.armOwned0501FaultOutcome({ maxActiveSteps: 4,
    get postPfHandoff() { called = true; return true; } }), /own data boolean/);
  assert.equal(called, false);
});

for (const change of ['callback', 'cache-identity', 'tr-identity'])
  test(`terminal ${change} substitution cannot supply handoff authority`, () => {
    const f = terminal();
    if (change === 'callback') f.cpu.read = address => f.memory.get(address) ?? 0;
    else if (change === 'cache-identity') f.cpu.segmentCaches[1] = { ...f.cpu.segmentCaches[1] };
    else f.cpu.tr = { ...f.cpu.tr };
    assert.throws(() => f.armPost(), /anchor changed/);
  });

test('decoded IRET intent does not authorize an overridden-core mode delta', () => {
  const f = terminal(), token = f.armPost();
  f.cpu._stepInstruction = I80386.prototype._stepInstruction;
  f.put(f.cpu.segmentCaches[1].base + f.cpu.eip, [0xcf]);
  f.cpu._iret = function () { this.cr0 = 0; };
  assert.equal(f.cpu.step(), 1);
  const result = f.cpu.takeOwned0501PostPfContinuationObservation(token);
  assert.equal(result.firstFailure, 'unattributed-mode-change');
  assert.equal(result.events[0].kind, 'decoded-iret-intent');
  assert.equal(result.modeChanges.length, 0);
});

function candidatePostPf({ irqEnabled = false } = {}) {
  const f = terminal({ irqEnabled }), token = f.armPost();
  f.cpu._taskSwitchCore = function () {
    this.tr = { ...f.originalTr };
    this.cs = 0x0b; this.ss = 0x23; this.eip = 0x100;
    this.esp = 0x7f4; this.cr3 = 0;
    this.segmentCaches[1] = { ...f.originalCode };
    this.segmentCaches[2] = { ...f.originalStack };
    return 1;
  };
  f.cpu._stepInstruction = function () { this._taskSwitch(0x30, 'jmp'); return 1; };
  assert.equal(f.cpu.step(), 1);
  assert.equal(f.cpu.owned0501PostPfContinuationStatus(token).phase, 'candidate');
  return { ...f, postToken: token };
}

for (const accepted of [true, false])
  test(`candidate IRQ invalidation precedes ordinary accepted=${accepted} result`, () => {
    const f = candidatePostPf({ irqEnabled: accepted });
    let calls = 0;
    f.cpu._deliverProtected = function () { calls++; this.eip++; };
    assert.equal(f.cpu.interrupt(8), accepted);
    assert.equal(calls, accepted ? 1 : 0);
    const result = f.cpu.takeOwned0501PostPfContinuationObservation(f.postToken);
    assert.equal(result.phase, 'invalid');
    assert.equal(result.firstFailure, 'observer-reentry');
    assert.equal(result.resumeCandidate.savedContinuation, true);
    assert.equal(result.frameReturnQualified, false);
  });

test('candidate IRQ exception preserves original thrown identity', () => {
  const f = candidatePostPf({ irqEnabled: true }), thrown = new Error('original IRQ exception');
  f.cpu._deliverProtected = () => { throw thrown; };
  assert.throws(() => f.cpu.interrupt(8), error => error === thrown);
  const result = f.cpu.takeOwned0501PostPfContinuationObservation(f.postToken);
  assert.equal(result.phase, 'invalid');
  assert.equal(result.firstFailure, 'observer-reentry');
  assert.equal(result.resumeCandidate.savedContinuation, true);
});

test('consumed handoff cannot mint another anchor after ordinary steps', () => {
  const f = terminal(), token = f.armPost();
  end(f, token);
  f.cpu._stepInstruction = function () { this.eip++; return 1; };
  assert.equal(f.cpu.step(), 1);
  assert.throws(() => f.armPost(), /same-session/);
  assert.equal(f.cpu.takeOwned0501FaultOutcome(f.pfToken).delivery.outcome, 'returned');
});

test('drained PF authority cannot mint another anchor after ordinary steps', () => {
  const f = terminal();
  f.cpu.takeOwned0501FaultOutcome(f.pfToken);
  f.cpu._stepInstruction = function () { this.eip++; return 1; };
  assert.equal(f.cpu.step(), 1);
  assert.throws(() => f.armPost(), /same-session/);
});

for (const change of ['cr0', 'vm86', 'retained-real-cs'])
  test(`IRQ return cannot absorb unqualified ${change} mode mutation`, () => {
    const f = terminal({ irqEnabled: true }), token = f.armPost();
    f.cpu._deliverProtected = function () {
      if (change === 'cr0') this.cr0 ^= 0x80000000;
      else if (change === 'vm86') this.eflags |= 0x20000;
      else this._retainedRealCs = true;
    };
    assert.equal(f.cpu.interrupt(8), true);
    const result = f.cpu.takeOwned0501PostPfContinuationObservation(token);
    assert.equal(result.phase, 'invalid');
    assert.equal(result.firstFailure, 'unattributed-interrupt-mode-change');
    assert.equal(result.events[0].sourceOperationReturned, true);
    assert.equal(result.events[0].enclosingStepCommitted, false);
    assert.equal(result.modeRefusal.operation, null);
    assert.equal(result.frameReturnQualified, false);
  });
