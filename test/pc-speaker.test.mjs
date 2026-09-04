// The PC speaker: 8255 port B bits 0/1 gating 8254 counter 2 into the cone.
// The direct tests pin the {hz, on} arithmetic; the machine test drives the
// real chips through the XT port map (8255 at 60h, 8254 at 40h) exactly as a
// corpus program does — OUT 43h/42h to set the tone, OUT 61h to sound it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PCSpeaker } from '../src/pc-speaker.js';
import { I8086Machine } from '../src/i8086-machine.js';

test('a tone sounds only when BOTH gate and data are set', () => {
    const spk = new PCSpeaker({ readDivisor: () => 1193 });
    assert.deepEqual(spk.audioTone(), [{ hz: 0, on: false }], 'silent at reset — one voice, not zero');
    spk.setControl(0x01);   // gate only
    assert.equal(spk.on, false, 'gate without data is silent');
    spk.setControl(0x02);   // data only
    assert.equal(spk.on, false, 'data without gate is silent');
    spk.setControl(0x03);   // both
    assert.equal(spk.on, true);
    assert.deepEqual(spk.audioTone(), [{ hz: 1000, on: true }], '1193182/1193 ~ 1000 Hz');
});

test('the pitch is 1193182 / divisor, and divisor 0 means 65536', () => {
    let div = 2385;                                   // ~500 Hz
    const spk = new PCSpeaker({ readDivisor: () => div });
    spk.setControl(0x03);
    assert.equal(spk.audioTone()[0].hz, 500);
    div = 0;                                          // wraps to 65536
    assert.equal(spk.audioTone()[0].hz, Math.round(1_193_182 / 0x10000));   // ~18 Hz
});

test('state round-trips', () => {
    const spk = new PCSpeaker({ readDivisor: () => 100 });
    spk.setControl(0x03);
    const s = new PCSpeaker({ readDivisor: () => 100 });
    s.setState(spk.getState());
    assert.equal(s.on, true);
});

// ---------------------------------------------------------------------------
test('the machine wires 61h -> counter 2 -> a {hz, on} readout', () => {
    const m = new I8086Machine({
        clockHz: 4_770_000,
        regions: [{ kind: 'ram', start: 0, end: 0xffff }, { kind: 'rom', start: 0xf8000, end: 0xfffff }],
        chips: [
            { kind: 'ppi', name: 'ppi1', at: 0x60 },     // XT: 8255 at 60-63h
            { kind: 'pit', name: 'pit1', at: 0x40 },     // XT: 8254 at 40-43h
            { kind: 'pcspeaker', name: 'spk', ppi: 'ppi1', pit: 'pit1' },
        ],
    });

    // 8255: all ports output (so port B drives the speaker gate).
    m._out(0x63, 0x80);
    // 8254 counter 2, mode 3 (square wave), divisor for ~1000 Hz.
    m._out(0x43, 0xb6);
    m._out(0x42, 1193 & 0xff); m._out(0x42, (1193 >> 8) & 0xff);

    // The tone is programmed but the speaker is not connected yet.
    assert.deepEqual(m.audioTone(), [{ hz: 0, on: false }]);

    // OUT 61h, 3 — the classic "turn the speaker on" (gate + data).
    m._out(0x61, 0x03);
    assert.deepEqual(m.audioTone(), [{ hz: 1000, on: true }], 'the tone now sounds');

    // Change the divisor and the reported pitch follows (reads it live).
    m._out(0x42, 2385 & 0xff); m._out(0x42, (2385 >> 8) & 0xff);
    assert.equal(m.audioTone()[0].hz, 500, 'reprogramming counter 2 changes the pitch');

    // OUT 61h, 0 — silence.
    m._out(0x61, 0x00);
    assert.deepEqual(m.audioTone(), [{ hz: 0, on: false }]);
});

test('configuring the 8255 (mode set) clears the speaker gate', () => {
    const m = new I8086Machine({
        clockHz: 4_770_000,
        regions: [{ kind: 'ram', start: 0, end: 0xffff }, { kind: 'rom', start: 0xf8000, end: 0xfffff }],
        chips: [
            { kind: 'ppi', name: 'ppi1', at: 0x60 },
            { kind: 'pit', name: 'pit1', at: 0x40 },
            { kind: 'pcspeaker', name: 'spk', ppi: 'ppi1', pit: 'pit1' },
        ],
    });
    m._out(0x63, 0x80);
    m._out(0x43, 0xb6); m._out(0x42, 100); m._out(0x42, 0);
    m._out(0x61, 0x03);
    assert.equal(m.audioTone()[0].on, true);
    // A fresh mode-set word clears port B's latch — the speaker goes quiet.
    m._out(0x63, 0x80);
    assert.equal(m.audioTone()[0].on, false, 'mode-set cleared the gate bits');
});

// ---------------------------------------------------------------------------
// FROM A PROGRAM, NOT FROM THE CHIP API.
//
// Everything above drives `_out` directly, which proves the model and proves
// nothing about the path a compiled program takes. The tests below assemble
// the sequence `set spk to 440 hz` has to become, run it as machine code on
// DOSBOX8086_XT -- the preset the pseudocode back end actually targets -- and
// read the tone back out of the machine.
//
// They exist because `settone` is a LOWERING, not a chip: the preset already
// carries the 8255, the 8254 and the speaker, so nothing had to be built for
// a tone to sound. What did have to be worked out is how a tone shares port B
// with the pins, and that is the second test.
// ---------------------------------------------------------------------------

/** 1193182 / 2712 = 440 Hz. The divisor a lowering computes at compile time. */
const DIV_440 = 2712;

/**
 * The 8255 mode-set word, then whatever the case under test emits, then exit.
 * @returns {I8086Machine} halted at the INT 21h
 */
const runProgram = async (body) => {
    const { assemble } = await import('../src/i8086-asm.js');
    const { DOSBOX8086_XT } = await import('../src/i8086-dos.js');
    const img = assemble(`
    MOV AL, 80h
    OUT 63h, AL          ; 8255 mode 0, all ports output
${body}
    MOV AH, 4Ch
    INT 21h
`, { variant: '80186' });
    const m = new I8086Machine(DOSBOX8086_XT);
    m.mem.set(img.bytes, 0x100);
    m.cpu.cs = 0; m.cpu.ip = 0x100; m.cpu.ss = 0; m.cpu.sp = 0xfffe;
    let steps = 0;
    while (steps++ < 100_000 && m.mem[m.cpu.pc] !== 0xcd) m.step();
    assert.ok(steps < 100_000, 'the program never reached its exit');
    return m;
};

/** `turn on led` on P2.3, emitted the way pseudocode-8086.js emits a pin write:
 *  read the shadow, set the bit, write the shadow back, then drive the port. */
const LED_ON_P2_3 = `
    MOV AL, [200h]
    OR  AL, 8
    MOV [200h], AL
    OUT 61h, AL`;

/** A tone written straight to the port, ignoring the shadow. The tempting version. */
const TONE_RAW = `
    MOV AL, 0B6h
    OUT 43h, AL          ; counter 2, mode 3 (square wave), lobyte/hibyte
    MOV AL, ${DIV_440 & 0xff}
    OUT 42h, AL
    MOV AL, ${(DIV_440 >> 8) & 0xff}
    OUT 42h, AL
    IN  AL, 61h
    OR  AL, 3
    OUT 61h, AL          ; bit 0 = timer-2 gate, bit 1 = speaker data`;

/** The same tone, sharing the pin shadow. This is the reference sequence. */
const TONE_SHADOWED = `
    MOV AL, 0B6h
    OUT 43h, AL
    MOV AL, ${DIV_440 & 0xff}
    OUT 42h, AL
    MOV AL, ${(DIV_440 >> 8) & 0xff}
    OUT 42h, AL
    MOV AL, [200h]       ; BW_PORTB -- the SAME shadow the pin writes use
    OR  AL, 3
    MOV [200h], AL
    OUT 61h, AL`;

test('a real 8086 program sounds 440 Hz on the preset the back end targets', async () => {
    // No new chip and no preset change: DOSBOX8086_XT already carries ppi1,
    // pit1 and the speaker, so `settone` is a lowering and nothing else.
    const m = await runProgram(TONE_RAW);
    assert.deepEqual(m.audioTone(), [{ hz: 440, on: true }],
        'the assembled reference sequence must produce an audible 440 Hz');
});

test('the pitch is quantised by the divisor, and a high tone shows it', async () => {
    // 440 Hz ALONE CANNOT DETECT AN ARITHMETIC ERROR. Its divisor is 2712, so
    // 2712, 2713 and 2714 all round back to 440 Hz -- measured: a deliberate
    // off-by-one in the divisor read left the 440 Hz test green. A frequency
    // is only evidence about the arithmetic when the divisor is small enough
    // that one count moves the answer.
    //
    // 4000 Hz has divisor 298, where one count is 13 Hz. It also carries the
    // teaching point: 1193182/298 = 4004, so THE REQUESTED TONE IS NOT THE
    // TONE PRODUCED. A PIT can only make 1193182/n, and a lowering that
    // reports back what the learner typed rather than what the hardware makes
    // would be inventing a precision the chip does not have.
    const div = Math.round(1193182 / 4000);
    assert.equal(div, 298);
    const m = await runProgram(`
    MOV AL, 0B6h
    OUT 43h, AL
    MOV AL, ${div & 0xff}
    OUT 42h, AL
    MOV AL, ${(div >> 8) & 0xff}
    OUT 42h, AL
    IN  AL, 61h
    OR  AL, 3
    OUT 61h, AL`);
    assert.deepEqual(m.audioTone(), [{ hz: 4004, on: true }],
        'asking for 4000 Hz gets 4004 Hz, because 1193182/298 is what the counter makes');
});

test('a tone must go through BW_PORTB, because the pins live in that port too', async () => {
    // THE GATE BITS ARE PIN BITS. P2 maps to port B, so P2.0 and P2.1 ARE the
    // timer gate and the speaker data line -- a tone and a lit LED are two
    // bits of one byte, and an 8255 output port is written whole.
    //
    // A raw `OUT 61h` therefore does not compose with a pin write, and it
    // fails DIFFERENTLY in each order:

    const toneThenLed = await runProgram(TONE_RAW + LED_ON_P2_3);
    assert.equal(toneThenLed.audioTone()[0].on, false,
        'raw OUT: lighting a pin afterwards writes a shadow with the gate bits '
        + 'clear, and the tone stops');

    const ledThenTone = await runProgram(LED_ON_P2_3 + TONE_RAW);
    assert.equal(ledThenTone.audioTone()[0].hz, 440, 'raw OUT: the tone survives...');
    assert.equal(ledThenTone.mem[0x200], 0b1000,
        '...but the shadow still claims the LED bit is set while the port holds 0b0011');
    // This second order is the worse of the two: nothing stops, nothing
    // errors, and the shadow has simply diverged from the hardware. The LED is
    // dark and the program believes it is lit. There is no diagnostic for a
    // learner to act on, which is exactly the class of failure this tier
    // exists to refuse.

    // Routing the tone through the same shadow fixes both orders at once.
    for (const [label, body] of [
        ['tone then led', TONE_SHADOWED + LED_ON_P2_3],
        ['led then tone', LED_ON_P2_3 + TONE_SHADOWED],
    ]) {
        const m = await runProgram(body);
        assert.deepEqual(m.audioTone(), [{ hz: 440, on: true }], `${label}: the tone sounds`);
        assert.equal(m.mem[0x200], 0b1011,
            `${label}: and the shadow agrees with the port -- LED bit AND both gate bits`);
    }
});
