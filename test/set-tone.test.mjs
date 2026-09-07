/**
 * The board sounds a TONE pin, on every MCU family that can declare one.
 *
 * WHY THIS EXISTS. A consumer's two-tone siren example was silent with no error
 * while its program was correct. Its generated driver has always called
 * `_board().setTone(pin, hz)` — and no board implemented it, so the call landed
 * nowhere: the JS driver guarded on `b.setTone` and skipped, the Python one
 * raised. Everything else was already built. `buzzerTone()` is read every frame
 * by the circuit designer and fed to a real oscillator through
 * `bw-circuit-ui/audio/buzzer-audio.js`. Only the source was missing.
 *
 * WHY IT IS A STANDING OSCILLATION rather than synthesised edges. Real hardware
 * makes a note with a timer toggling a pin, and the board already turns pin
 * toggles into tone: `buzzerEdges` gets an entry per `setPin` and `buzzerTone`
 * measures the period from the last two. But a PROGRAM cannot produce those
 * edges — it advances simulated time only when it waits, so `set buzzer to
 * 440 hz` between two half-second waits emits two edges, not four hundred and
 * forty. So `setTone` records the oscillation the timer would sustain, and
 * `buzzerTone` reports it flagged `driven`, so a consumer can still tell a
 * modelled note from a measured waveform.
 *
 * WHY IT IS MCU-AGNOSTIC. The emitter emits the same call for every family —
 * measured: `{"buzzer":{"pin":"P1.5"}}` for the STC12 and `{"speaker":{"pin":
 * "d8"}}` for the Uno — and the board matches a pin by name against the MCU's
 * terminals, exactly as the existing edge recorder does. The synthetic cases
 * below therefore name pins the way each family spells them; the last case is
 * the real shipped siren circuit.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {BoardImpl} from '../src/board.js';
import {registerAllDevices} from '../src/register-all.js';

registerAllDevices();

/** A minimal bench: VCC — buzzer — MCU pin, which is how every tone example is wired. */
const bench = pin => {
    const parts = [
        {id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc']},
        {id: 'MCU', kind: 'mcu', params: {}, terminals: [pin]},
        {id: 'BZ', kind: 'buzzer', params: {}, terminals: ['a', 'b']}
    ];
    const nets = [
        {id: 'n0', terminals: [{part: 'VCC', terminal: 'vcc'}, {part: 'BZ', terminal: 'a'}]},
        {id: 'n1', terminals: [{part: 'BZ', terminal: 'b'}, {part: 'MCU', terminal: pin}]}
    ];
    const board = new BoardImpl(5);
    board.setNetlist(parts, nets);
    return board;
};

// One row per way an MCU family spells a pin. The board never asks which family
// it is; if this passes for all of them it is because the lookup is by name.
const FAMILIES = [
    ['8051 (STC12/STC15/STC89)', 'P1.5'],
    ['AVR (Uno/Nano/Mega)', 'd8'],
    ['AVR (analog-numbered)', 'a0'],
    ['RP2040 (Pico)', 'gp15'],
    ['STM32', 'pa7']
];

describe('setTone', () => {
for (const [family, pin] of FAMILIES) {
    it(`a tone sounds on ${family}, pin ${pin}`, () => {
        const board = bench(pin);
        assert.deepEqual(board.buzzerTone('BZ'), {hz: 0, on: false}, 'silent before anything is driven');

        assert.equal(board.setTone(pin, 440), true, `no buzzer found on ${pin}`);
        board.advanceTo(board.timeNs + 50_000_000n);
        const a = board.buzzerTone('BZ');
        assert.equal(a.hz, 440, `${family}: 440 Hz was driven and ${a.hz} came back`);
        assert.equal(a.on, true);
        assert.equal(a.driven, true, 'a modelled note must be distinguishable from a measured waveform');

        board.setTone(pin, 880);
        board.advanceTo(board.timeNs + 50_000_000n);
        assert.equal(board.buzzerTone('BZ').hz, 880, 'the note did not change');

        board.setTone(pin, 0);
        assert.equal(board.buzzerTone('BZ').on, false, 'zero hertz must stop the tone');
    });
}

it('a tone on a pin with no buzzer is refused, not silently accepted', () => {
    const board = bench('P1.5');
    assert.equal(board.setTone('P2.0', 440), false, 'a pin with no buzzer must report that it found none');
    assert.equal(board.buzzerTone('BZ').on, false, 'and must not sound the buzzer that is elsewhere');
});

it('writing a level takes the pin back from the timer', () => {
    // On real hardware a direct write means the timer is no longer driving the
    // pin. Without this the two would fight and the note would outlive the
    // program that stopped it.
    const board = bench('P1.5');
    board.setTone('P1.5', 440);
    assert.equal(board.buzzerTone('BZ').hz, 440);
    board.setPin('P1.5', 'pushpull', false);
    const after = board.buzzerTone('BZ');
    assert.notEqual(after.hz, 440, 'the driven tone survived a direct pin write');
    assert.notEqual(after.driven, true, 'the tone is no longer driven once the pin is written');
});

it('a bad frequency stops the tone rather than sounding nonsense', () => {
    const board = bench('P1.5');
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 'x']) {
        board.setTone('P1.5', 440);
        board.setTone('P1.5', bad);
        assert.equal(board.buzzerTone('BZ').on, false, `${String(bad)} should silence the buzzer`);
    }
});
});
