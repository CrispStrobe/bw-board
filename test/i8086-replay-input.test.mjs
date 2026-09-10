/**
 * The 8086 target's replay surface: the APPLY half ported up from a downstream
 * consumer that has been running it for months, and a RECORD half that consumer
 * never had.
 *
 * WHY THE RECORD HALF IS NEW AND THE APPLY HALF IS NOT. Downstream records at
 * the DRIVER, so a key handed straight to the debug target — which is what the
 * keyboard widget does — was applied and never logged. `onDebugInput` is the
 * name the recorder consumes, so the facts now come from the place that knows
 * whether the machine actually took them.
 *
 * THE BOARDS ARE CHOSEN FOR WHAT THEY LACK, deliberately. A refusal is only
 * worth anything if some real config triggers it:
 *
 *   KBDDEMO8086      pic + ppi + cga    keys yes, gpio yes, serial NO
 *   BREADBOARD8086   ppi + uart         keys NO (no pic), gpio yes, serial yes
 *   SERIALSHELL8086  uart only          keys NO, gpio NO, serial yes
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  I8086Machine, KBDDEMO8086, BREADBOARD8086, SERIALSHELL8086
} from '../src/i8086-machine.js';
import { createI8086DebugTarget } from '../src/i8086-debug.js';
import { readFileSync } from 'node:fs';
import { replayOutcome, replayCapabilities } from '../src/debug-replay-contract.js';

/** A ROM image whose reset jump lands on `code` at F800:0000. */
function rom(code) {
  const img = new Uint8Array(0x8000);
  img.set(code, 0);
  img.set([0xea, 0x00, 0x00, 0x00, 0xf8], 0x7ff0);   // jmp F800:0000
  return img;
}

const SPIN = [0x90, 0xeb, 0xfd];                     // nop; jmp $-3

function makeTarget(config = KBDDEMO8086) {
  const machine = new I8086Machine(config);
  machine.loadRom(rom(SPIN));
  machine.reset();
  machine.step();
  return {machine, target: createI8086DebugTarget({machine})};
}

const record = target => {
  const facts = [];
  const stop = target.onDebugInput(f => facts.push(f));
  return {facts, stop};
};

const spin = (machine, steps) => { for (let i = 0; i < steps; i++) machine.step(); };

describe('the 8086 target implements both halves', () => {
  it('reports both capabilities', () => {
    const {target} = makeTarget();
    assert.deepEqual(replayCapabilities(target), {applies: true, records: true});
  });
});

describe('keys: an EVENT, so autorepeat survives the log', () => {
  it('records the same scancode twice, because pressing twice is pressing twice', () => {
    const {target, machine} = makeTarget();
    const {facts} = record(target);
    assert.equal(target.keyIn(0x1e), true);
    spin(machine, 20);
    assert.equal(target.keyIn(0x1e), true);
    assert.equal(facts.length, 2, 'a repeated key is a repeated key, not one state');
    assert.deepEqual(facts.map(f => f.producer), ['i8086.key', 'i8086.key']);
    assert.deepEqual(facts.map(f => f.payload.scancode), [0x1e, 0x1e]);
  });

  it('the REPLAYED MACHINE ends with the scancode latched and IRQ1 raised', () => {
    // The round trip is of the STATE, not of the returned outcome: a test that
    // only checks `accepted` passes against an apply half that does nothing.
    const live = makeTarget();
    const {facts} = record(live.target);
    live.target.keyIn(0x2c);

    const replayed = makeTarget();
    const ppi = replayed.machine.chips.ppi1;
    assert.notEqual(ppi.inA, 0x2c, 'the scancode is not there before replay');
    for (const fact of facts) {
      assert.equal(replayOutcome(replayed.target.applyReplayInput(fact)).accepted, true);
    }
    assert.equal(replayed.machine.chips.ppi1.inA, 0x2c,
      'port A holds the recorded scancode, as read at 0x60');
  });

  it('a board with no PIC REFUSES the key instead of losing it quietly', () => {
    // canTakeKeys is `!!(this._kbdPpi && this._pic)`: BREADBOARD8086 has the
    // 8255 and no 8259, so there is nowhere to raise IRQ1.
    const {target, machine} = makeTarget(BREADBOARD8086);
    assert.equal(machine.canTakeKeys(), false);
    const out = replayOutcome(target.applyReplayInput({producer: 'i8086.key', payload: {scancode: 0x1e}}));
    assert.equal(out.accepted, false);
    assert.equal(out.code, 'no-input-path', 'a board without the hardware is not a bad input');
    assert.match(out.reason, /8255|PIC/);
  });

  it('and a refused live press is not recorded', () => {
    const {target} = makeTarget(BREADBOARD8086);
    const {facts} = record(target);
    assert.equal(target.keyIn(0x1e), false, 'the machine did not take it');
    assert.equal(facts.length, 0, 'so it is not a fact');
  });

  it('refuses a scancode outside a byte, as a BAD INPUT rather than a bad board', () => {
    const {target} = makeTarget();
    for (const scancode of [-1, 256, 1.5, undefined, '0x1e']) {
      const out = replayOutcome(target.applyReplayInput({producer: 'i8086.key', payload: {scancode}}));
      assert.equal(out.accepted, false, `${String(scancode)} must be refused`);
      assert.equal(out.code, 'invalid-replay-input');
    }
  });
});

describe('gpio: a LEVEL, so setting it twice is one fact', () => {
  it('deduplicates an unchanged bit and lets a changed one through', () => {
    const {target, machine} = makeTarget(BREADBOARD8086);
    const {facts} = record(target);
    assert.equal(target.setInput('ppi1', 'b', 3, 1), true);
    spin(machine, 20);
    assert.equal(target.setInput('ppi1', 'b', 3, 1), true);
    assert.equal(facts.length, 1, 'the same level twice is one input state');
    assert.equal(target.setInput('ppi1', 'b', 3, 0), true);
    assert.equal(facts.length, 2, 'the falling edge is a new fact');
    assert.equal(facts[0].producer, 'i8086.gpio');
    assert.deepEqual(facts.map(f => f.payload.level), [1, 0]);
  });

  it('KEYS AND GPIO DO NOT SHARE A DEDUP MAP', () => {
    // The event path must not consult the level map at all: if it did, a key
    // repeated after a GPIO change — or worse, a GPIO key collision — would
    // suppress one of them.
    const {target} = makeTarget();
    const {facts} = record(target);
    target.keyIn(0x1e);
    target.setInput('ppi1', 'a', 0, 1);
    target.keyIn(0x1e);
    assert.equal(facts.length, 3, 'three inputs, three facts');
  });

  it('the REPLAYED MACHINE ends with the bit driven, and a replay is not re-recorded', () => {
    const live = makeTarget(BREADBOARD8086);
    const {facts} = record(live.target);
    live.target.setInput('ppi1', 'b', 5, 1);

    const replayed = makeTarget(BREADBOARD8086);
    const {facts: echoed} = record(replayed.target);
    for (const fact of facts) {
      assert.equal(replayOutcome(replayed.target.applyReplayInput(fact)).accepted, true);
    }
    assert.equal((replayed.machine.chips.ppi1.inB >> 5) & 1, 1, 'the bit is driven high');
    assert.equal(echoed.length, 0, 'the replay seeded the dedup map instead of logging');
    // And the seed is the point: a live call with the replayed value is now a
    // repeat of a known state, not a change.
    replayed.target.setInput('ppi1', 'b', 5, 1);
    assert.equal(echoed.length, 0);
    replayed.target.setInput('ppi1', 'b', 5, 0);
    assert.equal(echoed.length, 1, 'a genuine change still gets through');
  });

  it('names the missing chip rather than calling the input invalid', () => {
    const {target} = makeTarget(SERIALSHELL8086);
    const out = replayOutcome(target.applyReplayInput(
      {producer: 'i8086.gpio', payload: {chip: 'ppi1', port: 'b', bit: 0, level: 1}}));
    assert.equal(out.accepted, false);
    assert.equal(out.code, 'no-input-path');
    assert.match(out.reason, /ppi1/);
  });

  it('refuses a malformed port, bit or level', () => {
    const {target} = makeTarget(BREADBOARD8086);
    const bad = [
      {chip: 'ppi1', port: 'd', bit: 0, level: 1},
      {chip: 'ppi1', port: 'b', bit: 8, level: 1},
      {chip: 'ppi1', port: 'b', bit: -1, level: 1},
      {chip: 'ppi1', port: 'b', bit: 0, level: 2},
      {chip: 'ppi1', port: 'b', bit: 0}
    ];
    for (const payload of bad) {
      const out = replayOutcome(target.applyReplayInput({producer: 'i8086.gpio', payload}));
      assert.equal(out.accepted, false, `${JSON.stringify(payload)} must be refused`);
      assert.equal(out.code, 'invalid-replay-input');
    }
  });
});

describe('serial: an EVENT, and the target finally has an entry point for it', () => {
  it('records and replays the same byte twice', () => {
    const live = makeTarget(SERIALSHELL8086);
    const {facts} = record(live.target);
    assert.equal(live.target.sendSerial(0x41), true);
    assert.equal(live.target.sendSerial(0x41), true);
    assert.equal(facts.length, 2, 'two bytes, not one state');
    assert.deepEqual(facts.map(f => f.payload.byte), [0x41, 0x41]);

    const replayed = makeTarget(SERIALSHELL8086);
    for (const fact of facts) {
      assert.equal(replayOutcome(replayed.target.applyReplayInput(fact)).accepted, true);
    }
    assert.equal(replayed.machine.chips.uart1.read(0), 0x41, 'the byte is readable at RBR');
  });

  it('a replayed byte is not re-recorded', () => {
    const {target} = makeTarget(SERIALSHELL8086);
    const {facts} = record(target);
    assert.equal(replayOutcome(
      target.applyReplayInput({producer: 'i8086.serial', payload: {byte: 0x37}})).accepted, true);
    assert.equal(facts.length, 0);
  });

  it('THE PREFLIGHT TESTS WHAT serialIn TESTS, both of its branches', () => {
    // machine.serialIn (i8086-machine.js:1423) accepts a chip with rxPush OR
    // one with rxByte. No chip in this tree exposes rxByte today, so that
    // branch is unreachable from any real board and a preflight that dropped it
    // would agree with every board that exists — right up until one did not.
    // The chip here is synthetic ON PURPOSE: it makes the second branch
    // checkable instead of taking the comment's word for it.
    const {target, machine} = makeTarget(KBDDEMO8086);
    const input = {producer: 'i8086.serial', payload: {byte: 0x41}};
    assert.equal(target.canApplyReplayInput(input), false, 'no receiver on this board yet');

    const got = [];
    machine.chips.oddball = {rxByte(b) { got.push(b); }};
    assert.equal(target.canApplyReplayInput(input), true, 'the other convention is a path too');
    assert.equal(replayOutcome(target.applyReplayInput(input)).accepted, true);
    assert.deepEqual(got, [0x41], 'and serialIn really delivered through it');
  });

  it('a board with no UART refuses, and says so as a board fact', () => {
    const {target} = makeTarget(KBDDEMO8086);
    const out = replayOutcome(target.applyReplayInput({producer: 'i8086.serial', payload: {byte: 0x41}}));
    assert.equal(out.accepted, false);
    assert.equal(out.code, 'no-input-path');
  });

  it('refuses a byte outside 0..255', () => {
    const {target} = makeTarget(SERIALSHELL8086);
    for (const byte of [-1, 256, 1.5, undefined]) {
      const out = replayOutcome(target.applyReplayInput({producer: 'i8086.serial', payload: {byte}}));
      assert.equal(out.accepted, false, `${String(byte)} must be refused`);
      assert.equal(out.code, 'invalid-replay-input');
    }
  });
});

describe('nmi and rom', () => {
  it('nmi is applied and recorded, and carries no payload', () => {
    const {target, machine} = makeTarget();
    const {facts} = record(target);
    assert.equal(target.nmi(), true);
    assert.equal(facts.length, 1);
    assert.deepEqual(facts[0].payload, {});
    assert.equal(machine._nmiPending, true, 'the machine has the NMI pending');

    const replayed = makeTarget();
    assert.equal(replayOutcome(replayed.target.applyReplayInput(facts[0])).accepted, true);
    assert.equal(replayed.machine._nmiPending, true);
  });

  it('refuses an nmi that carries a payload, because a payload means a misread fact', () => {
    const {target} = makeTarget();
    const out = replayOutcome(target.applyReplayInput({producer: 'i8086.nmi', payload: {vector: 2}}));
    assert.equal(out.accepted, false);
    assert.equal(out.code, 'invalid-replay-input');
  });

  it('rom loads the image AND RESETS, which is the half that is easy to drop', () => {
    const {target, machine} = makeTarget();
    spin(machine, 40);                    // running inside the old image
    assert.equal(machine.cpu.cs, 0xf800, 'running inside the old image, not at the vector');

    const image = rom([0xb8, 0x21, 0x43, 0xeb, 0xfe]);   // mov ax,4321h; jmp $
    assert.equal(replayOutcome(
      target.applyReplayInput({producer: 'i8086.rom', payload: {bytes: image}})).accepted, true);

    // Without the reset the CPU keeps executing wherever it was, inside an
    // image that has just been replaced underneath it.
    // FFFF:0000, which is where this core resets to — measured, not assumed
    // from the textbook F000:FFF0. Both name the same linear FFFF0, which is
    // where rom() puts the far jump.
    assert.equal(machine.cpu.cs, 0xffff, 'CS is back at the reset vector');
    assert.equal(machine.cpu.ip, 0x0000, 'and so is IP');

    machine.step();                       // the far jump at FFFF:0000
    machine.step();                       // mov ax, 4321h
    assert.equal(machine.cpu.ax, 0x4321, 'the replayed ROM is the one running');

    for (const payload of [{bytes: [1, 2, 3]}, {bytes: image, at: -1}, {bytes: image, at: 0x100000}]) {
      const out = replayOutcome(target.applyReplayInput({producer: 'i8086.rom', payload}));
      assert.equal(out.accepted, false, `${JSON.stringify(Object.keys(payload))} must be refused`);
      assert.equal(out.code, 'invalid-replay-input');
    }
  });
});

describe('the preflight answers the question the apply half asks', () => {
  it('canApplyReplayInput agrees with applyReplayInput on every case here', () => {
    // The runner calls the preflight and then the apply half; a preflight that
    // said yes where the apply half refuses would make the runner replay a run
    // it cannot reproduce, and one that said no where the apply half accepts
    // would drop an input that was available.
    const boards = [KBDDEMO8086, BREADBOARD8086, SERIALSHELL8086];
    const inputs = [
      {producer: 'i8086.key', payload: {scancode: 0x1e}},
      {producer: 'i8086.gpio', payload: {chip: 'ppi1', port: 'b', bit: 1, level: 1}},
      {producer: 'i8086.serial', payload: {byte: 0x41}},
      {producer: 'i8086.nmi', payload: {}},
      {producer: 'i8086.paddle', payload: {}},
      {producer: 'i8086.key', payload: {scancode: 999}},
      undefined
    ];
    let refusals = 0, acceptances = 0;
    for (const board of boards) {
      for (const input of inputs) {
        const {target} = makeTarget(board);
        const preflight = target.canApplyReplayInput(input);
        const accepted = replayOutcome(target.applyReplayInput(input)).accepted;
        assert.equal(preflight, accepted,
          `${board.chips.map(c => c.kind).join('+')} / ${input?.producer ?? '(none)'}`);
        if (accepted) acceptances++; else refusals++;
      }
    }
    // Guards against the whole table agreeing vacuously in one direction.
    assert.ok(refusals > 0 && acceptances > 0,
      `the table must exercise both answers (${acceptances} accepted, ${refusals} refused)`);
  });

  it('an unknown producer is refused by name, not called invalid', () => {
    const {target} = makeTarget();
    const out = replayOutcome(target.applyReplayInput({producer: 'i8086.paddle', payload: {}}));
    assert.equal(out.accepted, false);
    assert.equal(out.code, 'unsupported-replay-input');
    assert.match(out.reason, /i8086\.paddle/);
  });

  it('a fact with no payload at all is refused, not thrown on', () => {
    const {target} = makeTarget();
    for (const bad of [undefined, null, {}, {producer: 'i8086.key'}]) {
      const out = replayOutcome(target.applyReplayInput(bad));
      assert.equal(out.accepted, false);
      assert.equal(out.code, 'invalid-replay-input');
    }
  });
});

describe('the event clock, and the rewind it can and cannot see', () => {
  it('stamps ticks from the machine clock, and debugTime READS without advancing', () => {
    const {target, machine} = makeTarget();
    const {facts} = record(target);
    spin(machine, 40);
    target.keyIn(0x1e);
    assert.equal(facts[0].time.ticks, machine.cycles);
    assert.equal(facts[0].time.hz, KBDDEMO8086.clockHz);
    assert.equal(facts[0].time.domain, 'i8086-cycles');
    assert.ok(facts[0].time.ticks > 0, 'the clock actually moved');
    assert.deepEqual(target.debugTime(), facts[0].time, 'the read agrees with the stamp');
  });

  it('A VISIBLE REWIND changes the domain and CLEARS the level map', () => {
    // i8086-machine.js:1817 (`this.cycles = s.cycles` in loadState) is this
    // machine's only backward move. Clearing the map matters as much as the
    // domain: a map surviving the rewind holds levels from an abandoned
    // timeline, and the first genuine change afterwards that happens to match
    // one is dropped with nothing to show for it.
    const {target, machine} = makeTarget(BREADBOARD8086);
    const {facts} = record(target);

    spin(machine, 20);
    const snap = machine.saveState();
    spin(machine, 200);
    target.setInput('ppi1', 'b', 2, 1);
    const highTicks = facts[0].time.ticks;

    machine.loadState(snap);
    assert.ok(machine.cycles < highTicks, 'the restore really moved the clock back');
    target.setInput('ppi1', 'b', 2, 1);          // the SAME level, new timeline

    assert.equal(facts.length, 2, 'the cleared map lets the repeat through');
    // RENAMED 2026-09-10: this was `i8086-cycles-reset-1`. The old string is
    // named here on purpose — someone debugging a replay that refuses for no
    // visible reason will grep for the string in their log, and a rename that
    // leaves no trace of the old name makes that grep come back empty. A log
    // recorded before the rename is not replayable and there is no migration;
    // see the note in src/i8086-debug.js.
    assert.equal(facts[1].time.domain, 'i8086-cycles-rewind-1');
    assert.ok(facts[1].time.ticks < highTicks);

    // THE TWO SPELLING SITES ARE PINNED TOGETHER. eventTime() stamps facts and
    // debugTime() reports the clock, and each builds the domain string itself —
    // so a rename applied to one and not the other leaves a target whose facts
    // and whose reported time disagree about which timeline they are on, only
    // once an epoch exists. Every other assertion here runs in epoch 0, where
    // both spellings are the bare 'i8086-cycles' and the divergence is
    // invisible. (Found by mutating the rename rather than by reading it.)
    assert.equal(target.debugTime().domain, facts[1].time.domain,
      'the reported clock and the stamped facts must name the same era');
  });

  it('THE LIMIT, pinned: a rewind that runs past its own high-water mark is invisible', () => {
    // Not a bug being hidden, a boundary being stated: from here the clock only
    // went forward. The downstream copy does not have this hole, because its
    // restore goes THROUGH the target and bumps the epoch explicitly; that
    // checkpoint machinery is a separate convergence and is not ported here.
    const {target, machine} = makeTarget(BREADBOARD8086);
    const {facts} = record(target);

    target.setInput('ppi1', 'b', 2, 1);
    const snap = machine.saveState();
    spin(machine, 300);
    machine.loadState(snap);
    spin(machine, 600);
    target.setInput('ppi1', 'b', 2, 0);

    assert.equal(facts.length, 2);
    assert.equal(facts[1].time.domain, 'i8086-cycles',
      'monotonic from here: the epoch does not bump, and this is the known limit');
  });

  it('A RESET DOES NOT BUMP THE EPOCH, because a reset ADVANCES this clock', () => {
    // This test was called 'THE DOMAIN SAYS "reset" AND NOTHING RESETS IT'
    // while the domain was `i8086-cycles-reset-N`. The domain now says rewind,
    // which is what the epoch actually tracks, so the test is no longer about a
    // misnomer — but the assertion is the same one and still worth having:
    // i8086-machine.js:1130 does `this.cycles += 4`, so a reset moves the clock
    // FORWARD and nothing about it starts a new era.
    const {target, machine} = makeTarget();
    const {facts} = record(target);
    target.keyIn(0x1e);
    const before = machine.cycles;
    machine.reset();
    assert.ok(machine.cycles > before, 'reset advanced the clock');
    target.keyIn(0x1e);
    assert.equal(facts[1].time.domain, 'i8086-cycles', 'no epoch was bumped');
    assert.ok(!facts.some(f => /reset/.test(f.time.domain)),
      'and no fact carries the old -reset- spelling');
  });

  it('debugTime is a READ: calling it during a rewind starts no epoch', () => {
    // The advancing stamp and the reading one are deliberately separate. If
    // debugTime() advanced the clock, a driver that merely ASKED the time after
    // a restore would consume the rewind — and the next real input would be
    // stamped in an epoch nobody could tell apart from ordinary progress. The
    // observable difference is exactly this: an epoch that appears with no
    // input to explain it.
    const {target, machine} = makeTarget(BREADBOARD8086);
    const {facts} = record(target);

    // The snapshot is taken BEFORE the input on purpose: the restore has to
    // land below the last STAMPED tick for a reading call to have anything to
    // consume, and a snapshot taken at the same tick as the fact would make
    // this test pass against either behaviour.
    spin(machine, 20);
    const snap = machine.saveState();
    spin(machine, 100);
    target.setInput('ppi1', 'b', 2, 1);        // stamped high
    machine.loadState(snap);                   // and now back below it
    target.debugTime();                        // the restore is NOT consumed here
    target.debugTime();
    spin(machine, 600);                        // forward, past where the stamp was
    target.setInput('ppi1', 'b', 2, 0);

    assert.equal(facts.length, 2);
    assert.equal(facts[1].time.domain, 'i8086-cycles',
      'reading the clock did not bump the epoch behind the recorder’s back');
  });

  it('unsubscribing stops the listener', () => {
    const {target, machine} = makeTarget();
    const {facts, stop} = record(target);
    target.keyIn(0x1e);
    stop();
    spin(machine, 10);
    target.keyIn(0x1e);
    assert.equal(facts.length, 1);
  });

  it('each listener gets its own copy of the fact', () => {
    const {target} = makeTarget();
    const a = [], b = [];
    target.onDebugInput(f => a.push(f));
    target.onDebugInput(f => b.push(f));
    target.keyIn(0x1e);
    a[0].payload.scancode = 0xff;
    a[0].time.ticks = -1;
    assert.equal(b[0].payload.scancode, 0x1e, 'a mutating listener cannot corrupt the log');
    assert.notEqual(b[0].time.ticks, -1);
  });

  it('refuses a listener that is not a function', () => {
    const {target} = makeTarget();
    assert.throws(() => target.onDebugInput(null), TypeError);
  });
});

describe('A HOLLOW TARGET REFUSES, IT DOES NOT THROW', () => {
  // The contract's central rule: applyReplayInput never throws for an input it
  // merely cannot serve. A target built over a bare `{machine}` is not
  // hypothetical — `code-address-progression.test.mjs:32` builds
  // `{machine: {cpu: {}}}` literally, and three more suites construct over
  // `{machine}`.
  //
  // This is an ENUMERATION rather than a handful of cases, because a handful of
  // cases is how it got here: `sendSerial` was written WITH the guard, and its
  // own comment says why, while the preflight beside it called
  // `Object.values(machine.chips)` on a machine with no chips. The code written
  // to turn a hardware fact into a refusal was the code that threw instead.
  const SOURCE = readFileSync(new URL('../src/i8086-debug.js', import.meta.url), 'utf8');
  const PRODUCERS = [...new Set(
    [...SOURCE.matchAll(/case '(i8086\.[a-z]+)':/g)].map(m => m[1]))];

  // A VALID payload per producer, so the refusal comes from the missing
  // hardware and not from a validation short-circuit that would have returned
  // before reaching anything.
  const VALID = {
    'i8086.key': {scancode: 0x1e},
    'i8086.gpio': {chip: 'ppi1', port: 'b', bit: 0, level: 1},
    'i8086.serial': {byte: 0x41},
    'i8086.nmi': {},
    'i8086.rom': {bytes: new Uint8Array(16)}
  };

  const hollow = () => createI8086DebugTarget({machine: {cpu: {}}});

  it('the payload table covers every producer the source handles', () => {
    // Without this the table silently describes an older switch, and a producer
    // added later is never driven here at all.
    assert.deepEqual(PRODUCERS.sort(), Object.keys(VALID).sort(),
      'a producer with no valid payload here is a producer this test does not check');
    assert.ok(PRODUCERS.length >= 5, `the scan found only ${PRODUCERS.length}`);
  });

  it('every producer returns a refusal, with a VALID payload', () => {
    const target = hollow();
    for (const producer of PRODUCERS) {
      const out = replayOutcome(target.applyReplayInput({producer, payload: VALID[producer]}));
      assert.equal(out.accepted, false, `${producer} must refuse`);
      assert.equal(out.code, 'no-input-path',
        `${producer} refused for the wrong reason: ${out.reason}`);
    }
  });

  it('the preflight agrees, and does not throw either', () => {
    // canApplyReplayInput is called by the runner BEFORE the apply half, so it
    // is the first thing a hollow target would throw from — and on this target
    // it was: `Object.values(machine.chips)` with no chips.
    const target = hollow();
    for (const producer of PRODUCERS) {
      assert.equal(target.canApplyReplayInput({producer, payload: VALID[producer]}), false,
        `${producer} preflight must answer false, not throw`);
    }
  });

  it('and so do the record entry points, and an unknown producer', () => {
    const target = hollow();
    assert.equal(target.keyIn(0x1e), false);
    assert.equal(target.setInput('ppi1', 'b', 0, 1), false);
    assert.equal(target.sendSerial(0x41), false);
    assert.equal(target.nmi(), false);
    const out = replayOutcome(target.applyReplayInput({producer: 'i8086.paddle', payload: {}}));
    assert.equal(out.code, 'unsupported-replay-input');
  });

  it('reading the clock on a hollow target does not throw either', () => {
    const target = hollow();
    assert.equal(typeof target.debugTime(), 'object');
  });
});
