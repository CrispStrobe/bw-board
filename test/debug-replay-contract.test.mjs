/**
 * The input-replay surface, exercised — because a declared interface with no
 * caller and no test is a promise this repository can neither keep nor break.
 *
 * The surface is declared in `src/debug-replay-contract.js` and four downstream
 * targets already implement it. What this file adds is the thing upstream did
 * not have: a target driven through record-and-apply here, so the first person
 * to implement it on a new target has something to check against.
 *
 * THE THREE LEGACY SHAPES ARE PINNED ON PURPOSE. `{accepted}`, bare `true` and
 * `{refused}` are all in the wild across the four existing implementations, and
 * a normalisation that silently changed one of their meanings would break a
 * consumer without failing anything here. Each is asserted to normalise the way
 * it already behaves.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  replayAccepted, replayRefused, replayOutcome, canApplyReplayInput,
  canRecordDebugInput, replayCapabilities, replaySupport, replaySupportRefusal
} from '../src/debug-replay-contract.js';

/** A target that records what it is given and can be asked to apply it back. */
function makeRecordingTarget({ shape = 'outcome' } = {}) {
  let listeners = [];
  const applied = [];
  const seen = new Map();
  return {
    applied,
    /** Emit a fact the way a real target does: only when the value changes. */
    observe(producer, key, payload) {
      const signature = JSON.stringify(payload);
      if (seen.get(key) === signature) return false;
      seen.set(key, signature);
      const fact = { time: { ticks: seen.size, domain: 'test-ns', hz: 1e9 }, producer, payload };
      for (const cb of listeners) cb(fact);
      return true;
    },
    onDebugInput(cb) {
      if (typeof cb !== 'function') throw new TypeError('input listener must be a function');
      listeners.push(cb);
      return () => { listeners = listeners.filter(l => l !== cb); };
    },
    applyReplayInput(fact) {
      if (fact?.producer !== 'test.pin') {
        return shape === 'legacy'
          ? { refused: 'unsupported test replay input', code: 'UNSUPPORTED_REPLAY_INPUT' }
          : replayRefused('unsupported-replay-input', 'expected a test.pin input');
      }
      applied.push(fact.payload);
      return shape === 'legacy' ? true : replayAccepted();
    }
  };
}

describe('the replay surface, driven end to end', () => {
  it('records facts and applies them back, in order', () => {
    const target = makeRecordingTarget();
    const recorded = [];
    const stop = target.onDebugInput(fact => recorded.push(fact));

    target.observe('test.pin', 'pin:1.0', { port: 1, bit: 0, level: 1 });
    target.observe('test.pin', 'pin:1.0', { port: 1, bit: 0, level: 1 }); // unchanged
    target.observe('test.pin', 'pin:1.0', { port: 1, bit: 0, level: 0 });

    assert.equal(recorded.length, 2, 'an unchanged value must not be recorded twice');

    for (const fact of recorded) {
      assert.equal(replayOutcome(target.applyReplayInput(fact)).accepted, true);
    }
    assert.deepEqual(target.applied, [
      { port: 1, bit: 0, level: 1 },
      { port: 1, bit: 0, level: 0 }
    ]);

    stop();
    target.observe('test.pin', 'pin:1.1', { port: 1, bit: 1, level: 1 });
    assert.equal(recorded.length, 2, 'unsubscribing must actually stop the listener');
  });

  it('refuses an input it does not support, as a RETURN VALUE', () => {
    const target = makeRecordingTarget();
    const outcome = replayOutcome(target.applyReplayInput({ producer: 'test.serial', payload: {} }));
    assert.equal(outcome.accepted, false);
    assert.equal(outcome.code, 'unsupported-replay-input');
    assert.match(outcome.reason, /test\.pin/);
    assert.equal(target.applied.length, 0, 'a refused input must not be applied');
  });
});

describe('replayOutcome normalises the shapes that already exist', () => {
  // Measured across the four implementations before this module was written.
  // If one of these rows changes meaning, a downstream consumer breaks.
  const rows = [
    ['{accepted: true} (emu8051, i8086)', { accepted: true }, true],
    ['{accepted:false,code,reason}', { accepted: false, code: 'x', reason: 'y' }, false],
    ['bare true (m6502, z80 success)', true, true],
    ['bare false', false, false],
    ['{refused, code} (m6502, z80 failure)', { refused: 'nope', code: 'UNSUPPORTED' }, false]
  ];
  for (const [label, value, accepted] of rows) {
    it(`${label} -> accepted ${accepted}`, () => {
      assert.equal(replayOutcome(value).accepted, accepted);
    });
  }

  it('carries the code and reason through a legacy {refused} shape', () => {
    const out = replayOutcome({ refused: 'unsupported or malformed input', code: 'UNSUPPORTED_REPLAY_INPUT' });
    assert.equal(out.code, 'UNSUPPORTED_REPLAY_INPUT');
    assert.equal(out.reason, 'unsupported or malformed input');
  });

  it('undefined is a REFUSAL and says the method returned nothing', () => {
    // A method that falls off the end returns undefined. Accepting that would
    // accept every input a target forgot to handle, silently.
    const out = replayOutcome(undefined, 'recorded input replay');
    assert.equal(out.accepted, false);
    assert.equal(out.code, 'no-replay-outcome');
    assert.match(out.reason, /returned no result/);
  });

  it('a promise is refused rather than awaited', () => {
    // The drivers apply inputs inside a synchronous replay loop.
    const out = replayOutcome(Promise.resolve({ accepted: true }));
    assert.equal(out.accepted, false);
    assert.equal(out.code, 'async-replay-outcome');
  });

  it('an unrecognised value is refused rather than guessed at', () => {
    for (const value of [42, 'ok', {}, { accepted: 'yes' }]) {
      const out = replayOutcome(value);
      assert.equal(out.accepted, false, `${JSON.stringify(value)} must not be accepted`);
    }
  });
});

describe('support is a list of reasons, not a boolean', () => {
  it('a target implementing both halves is supported', () => {
    const target = makeRecordingTarget();
    assert.deepEqual(replayCapabilities(target), { applies: true, records: true });
    assert.deepEqual(replaySupport(target), { supported: true, reasons: [] });
  });

  it('APPLYING WITHOUT RECORDING IS SUPPORTED, because one real target does exactly that', () => {
    // i8086-debug applies facts it never records — they are produced by the
    // driver rather than observed by the target. Requiring both halves would
    // refuse it, and refuse the two targets whose record half has another name.
    const applyOnly = { applyReplayInput: () => replayAccepted() };
    assert.deepEqual(replayCapabilities(applyOnly), { applies: true, records: false });
    assert.deepEqual(replaySupport(applyOnly), { supported: true, reasons: [] });
  });

  it('recording without applying cannot replay, and says which half is missing', () => {
    const recordOnly = { onDebugInput: () => () => {} };
    assert.deepEqual(replayCapabilities(recordOnly), { applies: false, records: true });
    const support = replaySupport(recordOnly);
    assert.equal(support.supported, false);
    assert.match(support.reasons[0], /does not implement applyReplayInput/);
    const refusal = replaySupportRefusal(support);
    assert.equal(refusal.accepted, false);
    assert.equal(refusal.code, 'replay-unsupported');
    assert.deepEqual(refusal.details.reasons, support.reasons);
  });

  it('the RECORD half is named onDebugInput, which is the name with a consumer', () => {
    // Measured downstream: subscribeDebugTargetInputs tests for onDebugInput and
    // returns null without it, so a target using another name is never recorded.
    const otherName = { applyReplayInput: () => replayAccepted(), onInput: () => () => {} };
    assert.equal(canRecordDebugInput(otherName), false,
      'onInput must not count as the record half — the recorder does not consume it');
    assert.equal(canApplyReplayInput(otherName), true);
  });

  it('THE TWO KINDS OF REFUSAL COMPOSE, which is why reasons are a list', () => {
    // One is a fact about the TARGET (it cannot serialise its state at all);
    // the other is a fact about the WIRING (a live board changes inputs outside
    // the debug target, so a restored run would diverge). A single boolean
    // cannot carry both, and a caller must see both when both apply.
    const support = replaySupport({}, ['live board input sampling is not logged']);
    assert.equal(support.supported, false);
    assert.equal(support.reasons.length, 2, 'both reasons must survive');
    assert.match(support.reasons.join(' | '), /live board input sampling/);
    assert.match(support.reasons.join(' | '), /does not implement applyReplayInput/);
  });

  it('a caller-supplied reason alone is enough to refuse a capable target', () => {
    // The dynamic half on its own: the target implements everything and the
    // session still cannot be replayed.
    const support = replaySupport(makeRecordingTarget(), ['live board input sampling is not logged']);
    assert.equal(support.supported, false);
    assert.deepEqual(support.reasons, ['live board input sampling is not logged']);
  });
});
