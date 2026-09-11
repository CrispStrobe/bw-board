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
import { createZ80DebugTarget } from '../src/z80-debug.js';
import { createM6502DebugTarget } from '../src/m6502-debug.js';
import { createI8086DebugTarget } from '../src/i8086-debug.js';
import {
  replayAccepted, replayRefused, replayOutcome, canApplyReplayInput,
  canRecordDebugInput, canVetoDebugInput, replayCapabilities, replaySupport, replaySupportRefusal,
  assertAdmissionVerdict
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
    assert.deepEqual(replayCapabilities(target), { applies: true, records: true, vetoes: false });
    assert.deepEqual(replaySupport(target), { supported: true, reasons: [] });
  });

  it('APPLYING WITHOUT RECORDING IS SUPPORTED, because one real target does exactly that', () => {
    // i8086-debug applies facts it never records — they are produced by the
    // driver rather than observed by the target. Requiring both halves would
    // refuse it, and refuse the two targets whose record half has another name.
    const applyOnly = { applyReplayInput: () => replayAccepted() };
    assert.deepEqual(replayCapabilities(applyOnly), { applies: true, records: false, vetoes: false });
    assert.deepEqual(replaySupport(applyOnly), { supported: true, reasons: [] });
  });

  it('recording without applying cannot replay, and says which half is missing', () => {
    const recordOnly = { onDebugInput: () => () => {} };
    assert.deepEqual(replayCapabilities(recordOnly), { applies: false, records: true, vetoes: false });
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

describe('a listener\u2019s return value is IGNORED unless the target says otherwise', () => {
  // The hole this closes: the recorder's listener DOES return something --
  // `input => !status().active || appendInput(input)` -- and it was honoured by
  // some targets and silently discarded by others, with no way to ask which.
  const recorder = () => ({ applyReplayInput: () => replayAccepted(), onDebugInput: () => () => {} });
  const declaring = extensions => ({ ...recorder(), capabilities: () => ({ extensions }) });

  it('a target that declares nothing does NOT veto', () => {
    assert.equal(canVetoDebugInput(recorder()), false);
    assert.equal(canVetoDebugInput(declaring({})), false, 'having capabilities() is not declaring');
    assert.equal(canVetoDebugInput({ ...recorder(), capabilities: () => ({}) }), false);
  });

  it('a target that declares may-refuse DOES veto', () => {
    assert.equal(canVetoDebugInput(declaring({ inputAdmission: 'may-refuse' })), true);
    assert.deepEqual(replayCapabilities(declaring({ inputAdmission: 'may-refuse' })),
      { applies: true, records: true, vetoes: true });
  });

  it('only that exact value counts — a truthy string is not a declaration', () => {
    // Otherwise `inputAdmission: 'always'` would read as a veto, which is the
    // opposite of what it says.
    for (const value of ['always', 'may_refuse', true, 1, {}]) {
      assert.equal(canVetoDebugInput(declaring({ inputAdmission: value })), false,
        `${JSON.stringify(value)} must not read as a declaration`);
    }
  });

  it('a target with no RECORD half cannot veto, whatever it declares', () => {
    // There is no listener to refuse with. Declaring it would be a capability
    // about a channel the target does not have.
    const applyOnly = { applyReplayInput: () => replayAccepted(),
      capabilities: () => ({ extensions: { inputAdmission: 'may-refuse' } }) };
    assert.equal(canVetoDebugInput(applyOnly), false);
  });

  it('A THROWING capabilities() ANSWERS FALSE rather than propagating', () => {
    // This predicate has to INVOKE the target, unlike its siblings, because the
    // property is behavioural and inspection cannot see it. A predicate that
    // threw would break the one rule this module exists to state.
    const hostile = { ...recorder(), capabilities() { throw new Error('half-built target'); } };
    assert.doesNotThrow(() => canVetoDebugInput(hostile));
    assert.equal(canVetoDebugInput(hostile), false);
    assert.doesNotThrow(() => replayCapabilities(hostile));
  });

  it('a capabilities() returning nothing at all is not a declaration', () => {
    for (const value of [undefined, null, 0, 'yes']) {
      assert.equal(canVetoDebugInput({ ...recorder(), capabilities: () => value }), false);
    }
  });
});

describe('THE VETO IS DECLARED PER TARGET, so gaining or losing it has to be deliberate', () => {
  // This module once measured, as an assertion, that EVERY target was
  // fire-and-forget. Two are no longer: z80 and m6502 converged onto the
  // admission hook (the ASK/TELL split, arrival-time stamp) and now declare a
  // veto. So the assertion is per-target and EXACT — a target gaining the veto
  // it should not, or losing the one it converged to, reddens here. That is the
  // point: it is a decision, not a tidy-up. The old blanket "does NOT veto"
  // reddening on the convergence WAS this guard doing its job.
  //
  // The 8051 is absent from this table on purpose and not by omission: it
  // publishes at the instant the core READS a pin, so it has no "before" at
  // which to refuse and could not adopt the veto if someone wanted it to.
  const TARGETS = {
    z80: { make: () => createZ80DebugTarget({ machine: { cpu: {} } }), vetoes: true },
    m6502: { make: () => createM6502DebugTarget({ machine: { cpu: {} } }), vetoes: true },
    i8086: { make: () => createI8086DebugTarget({ machine: { cpu: {} } }), vetoes: false }
  };

  for (const [name, { make, vetoes }] of Object.entries(TARGETS)) {
    it(`${name} records, and ${vetoes ? 'DOES' : 'does NOT'} veto — its declared state`, () => {
      const target = make();
      assert.equal(canRecordDebugInput(target), true, 'the record half is there to be asked about');
      assert.equal(canVetoDebugInput(target), vetoes);
      assert.equal(replayCapabilities(target).vetoes, vetoes);
    });
  }

  it('and the predicate is answering about the TARGET, not always false', () => {
    // Guards the whole table against passing because canVetoDebugInput never
    // returns true for anything.
    const declaring = {
      applyReplayInput: () => replayAccepted(),
      onDebugInput: () => () => {},
      capabilities: () => ({ extensions: { inputAdmission: 'may-refuse' } })
    };
    assert.equal(canVetoDebugInput(declaring), true);
  });
});

describe('assertAdmissionVerdict is STRICT, because a loose verdict silently refuses everything', () => {
  // The ASK hook is new surface, so strictness is free — and load-bearing. A
  // TELL-shaped listener mis-registered on onDebugInputAdmission returns
  // undefined; if that were a refusal, every input would be declined, the
  // recorder would record nothing, and the replay would agree with itself. So
  // anything that is not {accepted: boolean} throws, naming the admitter.
  it('accepts exactly {accepted: boolean} and returns it', () => {
    assert.deepEqual(assertAdmissionVerdict({ accepted: true }, 'a'), { accepted: true });
    assert.deepEqual(assertAdmissionVerdict({ accepted: false, code: 'x' }, 'a'), { accepted: false, code: 'x' });
  });

  it('throws on everything loose, naming the admitter', () => {
    for (const bad of [undefined, null, true, false, 0, 1, 'accepted', {}, { accepted: 'yes' }, { accept: true }, () => {}]) {
      assert.throws(() => assertAdmissionVerdict(bad, 'my-admitter'),
        err => err instanceof TypeError && /my-admitter/.test(err.message),
        `should throw naming the admitter for ${JSON.stringify(bad) ?? String(bad)}`);
    }
  });

  it('bare true is refused — the shape must be an object, not a truthy value', () => {
    // The trap: `replayOutcome` normalises bare `true` for legacy applyReplayInput,
    // so a reader might expect the ASK hook to too. It must not — a returned true
    // is exactly what a listener wired to the wrong hook might produce.
    assert.throws(() => assertAdmissionVerdict(true, 'a'), TypeError);
  });
});
