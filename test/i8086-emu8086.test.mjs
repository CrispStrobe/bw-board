// The emu8086 compatibility layer: the virtual devices on their documented
// ports, the macro library's emitted source, and the #...# directives.
//
// Every device assertion here is traceable to the evidence recorded in
// src/i8086-emu8086.js -- emu8086's published documentation, or a call site
// in the MIT-licensed yousefkotp/8086-Assembly-Projects corpus. The programs
// are hand-assembled, the same way test/i8086-dos.test.mjs does it, because
// the assembler is a separate gate from the emulator.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { I8086Machine, BREADBOARD8086 } from '../src/i8086-machine.js';
import { createDos8086 } from '../src/i8086-dos.js';
import {
    createEmu8086, Emu8086Ports, EMU8086BOX, EMU8086_INC, PORTS,
    TRAFFIC_ALL_RED, TrafficLights, StepperMotor, Thermometer, Printer,
    Robot, ROBOT_CMD, ROBOT_DATA, UNESTABLISHED, INC_MACROS, INC_PROCEDURES,
    parseDirectives, deviceForStart,
} from '../src/i8086-emu8086.js';
import { perfHint } from './helpers/perf-hint.mjs';

/** Assemble at .COM offset 100h: pairs of [offset, bytes]. */
function com(chunks) {
    const out = new Uint8Array(0x400);
    for (const [off, bytes] of chunks) out.set(bytes, off - 0x100);
    return out.subarray(0, Math.max(...chunks.map(([o, b]) => o - 0x100 + b.length)));
}

/** An emu8086 machine: virtual devices on the port bus, DOS services on the
 *  vectors, and a hand-assembled .COM loaded. */
function emuWith(bytes, opts = {}) {
    const m = new I8086Machine(EMU8086BOX);
    const emu = createEmu8086(m, opts).install();
    const dos = createDos8086(m).install().loadCom(Uint8Array.from(bytes));
    return { m, dos, emu, dev: emu.devices, ports: emu.ports };
}

/** Read a byte the program stored in its own data area (PSP:offset). */
const peek = (m, off, psp = 0x0800) => m._read((psp << 4) + off);

/** `mov ax, 4C00h / int 21h` -- the exit every corpus program ends with. */
const EXIT = [0xb8, 0x00, 0x4c, 0xcd, 0x21];

// ---------------------------------------------------------------------------
// Traffic lights -- port 4
// ---------------------------------------------------------------------------

test('a program writes a traffic-light pattern to port 4 and the device shows it', () => {
    // Corpus Project #6 line 8-9, to the digit:
    //     mov ax, 249h  ; 249h means all are red 0,3,6,9 bits are all ones
    //     out 4, ax     ; 4 is the output number for the traffic (built-in)
    // and emu8086's own asm_tutorial_12.html agrees: all_red equ
    // 0000_0010_0100_1001b, which is 249h.
    const { dos, dev, ports } = emuWith(com([
        [0x100, [0xb8, 0x49, 0x02]],        // mov ax, 249h
        [0x103, [0xe7, 0x04]],              // out 4, ax
        [0x105, EXIT],
    ]));
    assert.ok(dos.run(10_000).terminated);

    const s = dev.traffic.state();
    assert.equal(s.word, TRAFFIC_ALL_RED);
    assert.ok(s.allRed, '249h is all four groups red');
    assert.deepEqual(s.groups.map((g) => g.lamps), ['R--', 'R--', 'R--', 'R--']);
    // The bit layout itself: red is the LOW bit of each group of three.
    for (const g of s.groups) {
        assert.equal(g.red, true);
        assert.equal(g.yellow, false);
        assert.equal(g.green, false);
    }
    assert.equal(ports.readWord(PORTS.TRAFFIC), TRAFFIC_ALL_RED, 'IN AX, 4 reads back');
});

test('the by-group bit layout, not the by-colour one, is what the corpus means', () => {
    // Project #6: transition1 equ 0000_0011_0000_1100b, commented "2 Red and
    // 2 Green(north and south are green)". Under the layout implemented here
    // -- each group of three bits being red, yellow, green -- that word is
    // exactly two greens and two reds. Under the tempting alternative, where
    // bits 0-3 are the four greens and 8-11 the four reds, it would be three
    // greens, one yellow and one red, and its comment would be nonsense.
    const { dos, dev } = emuWith(com([
        [0x100, [0xb8, 0x0c, 0x03]],        // mov ax, 030Ch  (transition1)
        [0x103, [0xe7, 0x04]],              // out 4, ax
        [0x105, EXIT],
    ]));
    dos.run(10_000);
    const s = dev.traffic.state();
    assert.deepEqual(s.groups.map((g) => g.lamps), ['--G', 'R--', '--G', 'R--']);
    assert.equal(s.groups.filter((g) => g.green).length, 2, 'two greens');
    assert.equal(s.groups.filter((g) => g.red).length, 2, 'two reds');
    assert.equal(s.groups.filter((g) => g.yellow).length, 0, 'and no yellows');
});

test('transition2 really is all four yellows, which is what settles the layout', () => {
    // Project #6: transition2 equ 0000_0111_1001_1110b, commented "all 4 are
    // Yellow ... and the red and green remain". Only the by-group reading
    // makes that true, and it is true of every group.
    const { dos, dev } = emuWith(com([
        [0x100, [0xb8, 0x9e, 0x07]],        // mov ax, 079Eh  (transition2)
        [0x103, [0xe7, 0x04]],
        [0x105, EXIT],
    ]));
    dos.run(10_000);
    const s = dev.traffic.state();
    assert.deepEqual(s.groups.map((g) => g.yellow), [true, true, true, true]);
    assert.deepEqual(s.groups.map((g) => g.lamps), ['-YG', 'RY-', '-YG', 'RY-']);
});

test('a word port is two byte ports, and port 5 carries the high byte', () => {
    // `out 4, ax` is two bus cycles. Modelling the traffic light as one
    // atomic 16-bit register makes port 5 dead and hides the instant where
    // half the lamps have been updated.
    const { dos, ports, dev } = emuWith(com([
        [0x100, [0xb8, 0x9e, 0x07]],        // mov ax, 079Eh
        [0x103, [0xe7, 0x04]],              // out 4, ax
        [0x105, EXIT],
    ]));
    dos.run(10_000);
    assert.equal(ports.read(PORTS.TRAFFIC), 0x9e, 'AL went to port 4');
    assert.equal(ports.read(PORTS.TRAFFIC + 1), 0x07, 'AH went to port 5');
    assert.equal(dev.traffic.word, 0x079e);

    // And the half-updated instant is real: write only the low byte and the
    // device shows a word built from the new low byte and the old high one.
    ports.write(PORTS.TRAFFIC, 0x49);
    assert.equal(dev.traffic.word, 0x0749, 'one OUT of the pair has landed');
});

test('the half-updated instant between the two OUT bytes is recorded, not hidden', () => {
    // Two histories, because the transient is REAL and also misleading. Each
    // `out 4, ax` writes the low byte and then the high byte, so between
    // them the pair holds the new low byte beside the OLD high byte. emu8086
    // devices are separate programs polling a file, so whether one is ever
    // seen is a genuine race -- and a caller drawing "the light sequence"
    // from the faithful list would render a frame the program never meant.
    const { dos, dev } = emuWith(com([
        [0x100, [0xb8, 0x49, 0x02, 0xe7, 0x04]],   // mov ax, 249h / out 4, ax
        [0x105, [0xb8, 0x0c, 0x03, 0xe7, 0x04]],   // mov ax, 030Ch / out 4, ax
        [0x10a, EXIT],
    ]));
    dos.run(10_000);
    // 049h is 249h with the high byte not yet written; 20Ch is 030Ch with
    // the high byte still holding 249h's.
    assert.deepEqual(dev.traffic.history, [0x049, 0x249, 0x20c, 0x030c]);
    assert.deepEqual(dev.traffic.settledHistory, [0x249, 0x030c]);
});

test('a device written one byte at a time never settles, and says so by staying empty', () => {
    // `out 4, al` is a single bus cycle: the high byte is never written, so
    // there is no completed word to record. Inventing one would be worse
    // than an empty list.
    const p = new Emu8086Ports();
    p.write(PORTS.TRAFFIC, 0x49);
    assert.deepEqual(p.devices.traffic.history, [0x049]);
    assert.deepEqual(p.devices.traffic.settledHistory, []);
    // And once the other half arrives, it settles.
    p.write(PORTS.TRAFFIC + 1, 0x02);
    assert.deepEqual(p.devices.traffic.settledHistory, [0x249]);
});

test('writing a reserved traffic-light bit is counted, not ignored', () => {
    // io.html: "only 12 low bits of a word are used (0 to 11), last bits
    // (12 to 15) are unused". Project #6 agrees: "the last 4 bits are unused
    // C,D,E,F". A program setting one has the layout wrong.
    const { dos, dev } = emuWith(com([
        [0x100, [0xb8, 0x49, 0x12]],        // mov ax, 1249h -- bit 12 set
        [0x103, [0xe7, 0x04]],
        [0x105, EXIT],
    ]));
    dos.run(10_000);
    assert.equal(dev.traffic.state().reservedWrites, 1);
    assert.ok(dev.traffic.state().allRed, 'and the twelve real bits still decode');
});

// ---------------------------------------------------------------------------
// int 15h / AH=86h -- the delay the traffic-light project is built on
// ---------------------------------------------------------------------------

test('an int 15h/86h delay costs MACHINE time, not wall-clock time', () => {
    // Project #6's own delay, verbatim: CX:DX = 07270E00h = 120,000,000
    // microseconds. Two minutes of simulated time has to cost approximately
    // no real time at all, or no lesson using this service can run.
    //
    // (The corpus author noted "THIS CODE SHOULD CAUSE DELAY 2 MINS BUT IT
    // ONLY CAUSES 1 MIN FOR SOME REASON" against this exact constant. We
    // implement the documented contract -- CX:DX microseconds -- and give
    // the full 120 seconds. Whatever emu8086 did with it, the contract is
    // what a program can be written against.)
    const { m, dos } = emuWith(com([
        [0x100, [0xb9, 0x27, 0x07]],        // mov cx, 0727h
        [0x103, [0xba, 0x00, 0x0e]],        // mov dx, 0E00h
        [0x106, [0xb4, 0x86]],              // mov ah, 86h
        [0x108, [0xcd, 0x15]],              // int 15h
        [0x10a, EXIT],
    ]));
    const wallStart = Date.now();
    assert.ok(dos.run(10_000).terminated);
    const wallMs = Date.now() - wallStart;

    assert.ok(Math.abs(m.tMs - 120_000) < 1, `machine time advanced 120 s, got ${m.tMs} ms`);
    assert.ok(wallMs < 1_000, `and it took no real time: ${wallMs} ms of wall clock` +
        perfHint('Wall-clock cost of 120 s of simulated time'));
    assert.ok(m.tMs > wallMs * 10,
        `simulated time outruns real time by orders of magnitude ` +
        `(${m.tMs} ms simulated vs ${wallMs} ms wall)` +
        perfHint('Simulated-to-real time ratio'));
});

test('the traffic-light project end to end: pattern, delay, pattern', () => {
    // The shape of Project #6's main loop, cut down to two situations: this
    // is the whole reason the tier exists.
    const { m, dos, dev } = emuWith(com([
        [0x100, [0xb8, 0x49, 0x02]],        // mov ax, 249h      (all red)
        [0x103, [0xe7, 0x04]],              // out 4, ax
        [0x105, [0xb9, 0x4c, 0x00]],        // mov cx, 004Ch
        [0x108, [0xba, 0x40, 0x4b]],        // mov dx, 4B40h     (5,000,000 us)
        [0x10b, [0xb4, 0x86]],              // mov ah, 86h
        [0x10d, [0xcd, 0x15]],              // int 15h
        [0x10f, [0xb8, 0x0c, 0x03]],        // mov ax, 030Ch     (transition1)
        [0x112, [0xe7, 0x04]],              // out 4, ax
        [0x114, EXIT],
    ]));
    assert.ok(dos.run(50_000).terminated);

    // The SEQUENCE, not just the final state: a poller sampling the device
    // would miss the first pattern entirely. `settledHistory` is the two
    // patterns the program meant -- one entry per completed `out 4, ax`.
    assert.deepEqual(dev.traffic.settledHistory, [0x249, 0x030c]);
    assert.ok(Math.abs(m.tMs - 5_000) < 1, 'five seconds of machine time between them');
    assert.deepEqual(dev.traffic.state().groups.map((g) => g.lamps),
        ['--G', 'R--', '--G', 'R--']);
});

// ---------------------------------------------------------------------------
// Stepper motor -- port 7
// ---------------------------------------------------------------------------

test('the documented clockwise half-step table turns the shaft clockwise', () => {
    // emu8086's stepper_motor.asm ships datcw as 0110, 0100, 0011, 0010.
    // Walking it is three half-steps, at 11.25 degrees each (tutorial 12).
    const { dos, dev } = emuWith(com([
        [0x100, [0xb0, 0x06, 0xe6, 0x07]],  // mov al, 0110b / out 7, al
        [0x104, [0xb0, 0x04, 0xe6, 0x07]],  // mov al, 0100b / out 7, al
        [0x108, [0xb0, 0x03, 0xe6, 0x07]],  // mov al, 0011b / out 7, al
        [0x10c, [0xb0, 0x02, 0xe6, 0x07]],  // mov al, 0010b / out 7, al
        [0x110, EXIT],
    ]));
    dos.run(10_000);
    const s = dev.stepper.state();
    assert.equal(s.direction, 'cw');
    assert.equal(s.halfSteps, 3, 'three recognised transitions, not four writes');
    assert.equal(s.angleDeg, 33.75);
    assert.equal(s.pattern, 0b010);
    assert.deepEqual(s.magnets, [false, true, false]);
    // The FIRST write is an initialisation, not a step: the shaft was at
    // pattern 0, which appears in neither documented table. Counting it as a
    // step would invent a movement nothing asked for.
    assert.equal(s.unrecognisedPatterns, 1);
});

test('the counter-clockwise table turns it the other way, and the table wraps', () => {
    // datccw is 0011, 0001, 0110, 0010 -- and 0010 back to 0011 closes it.
    const p = new Emu8086Ports();
    for (const v of [0b011, 0b001, 0b110, 0b010, 0b011]) p.write(PORTS.STEPPER, v);
    const s = p.devices.stepper.state();
    assert.equal(s.direction, 'ccw');
    assert.equal(s.halfSteps, -4, 'four half steps, the last one across the wrap');
    assert.equal(s.angleDeg, -45);
});

test('the ready bit is OR-ed into the pattern, so a documented busy-wait exits', () => {
    // emu8086's stepper example polls:
    //     wait:  in al, 7 / test al, 10000000b / jz wait
    // io.html: "Stepper motor sets topmost bit of byte value in port 7 when
    // it's ready" -- the bit is set in the byte that is already there, so a
    // read must return the magnet pattern AND bit 7. Returning 80h alone
    // would break any program that reads back what it commanded.
    const { dos, dev, m } = emuWith(com([
        [0x100, [0xb0, 0x06, 0xe6, 0x07]],  // mov al, 6 / out 7, al
        [0x104, [0xe4, 0x07]],              // wait: in al, 7
        [0x106, [0xa8, 0x80]],              // test al, 80h
        [0x108, [0x74, 0xfa]],              // jz wait
        [0x10a, [0xa2, 0x00, 0x02]],        // mov [0200], al
        [0x10d, EXIT],
    ]));
    const r = dos.run(100_000);
    assert.ok(r.terminated, 'the busy-wait terminated rather than spinning forever');
    assert.equal(peek(m, 0x200), 0x86, 'bit 7 set, and the pattern 6 still there');
    assert.equal(dev.stepper.state().ready, true);
});

test('a settling time makes the motor read as not-ready, and it is ours', () => {
    // The interval is undocumented, so it defaults to zero. A caller that
    // wants one gets one, and report() names it as invented.
    const m = new I8086Machine(EMU8086BOX);
    const emu = createEmu8086(m, { stepper: new StepperMotor({ settleUs: 1000 }) }).install();
    emu.ports.write(PORTS.STEPPER, 0b110);
    assert.equal(emu.ports.read(PORTS.STEPPER) & 0x80, 0, 'not ready yet');
    m.cycles += m.clockHz / 1000;                       // one millisecond
    assert.equal(emu.ports.read(PORTS.STEPPER) & 0x80, 0x80, 'ready after the interval');
    assert.equal(emu.report().invented.stepperSettleUs, 1000);
});

// ---------------------------------------------------------------------------
// Thermometer and heater -- ports 125 and 127
// ---------------------------------------------------------------------------

test('the thermometer reads degrees as a byte from port 125', () => {
    const m = new I8086Machine(EMU8086BOX);
    const emu = createEmu8086(m, { thermometer: new Thermometer({ startC: 72 }) }).install();
    // emu8086's thermometer.asm compares the reading directly against 60 and
    // 80, so port 125 is degrees -- not a scaled or offset code.
    assert.equal(emu.ports.read(PORTS.THERMOMETER), 72);
});

test('the heater on port 127 makes the temperature rise over MACHINE time', () => {
    // Ten seconds of int 15h delay, with the heater on. This is the whole
    // reason the thermal model integrates machine time lazily rather than
    // ticking: int 15h/86h jumps `cycles` forward in one go, and a model
    // driven off instruction execution would see no time pass at all.
    const therm = new Thermometer({ startC: 20, ambientC: 20, heatRateCPerSec: 10 });
    const machine = new I8086Machine(EMU8086BOX);
    const emu = createEmu8086(machine, { thermometer: therm }).install();
    const dos = createDos8086(machine).install().loadCom(Uint8Array.from(com([
        [0x100, [0xb0, 0x01, 0xe6, 0x7f]],  // mov al, 1 / out 127, al  (heater on)
        [0x104, [0xb9, 0x98, 0x00]],        // mov cx, 0098h
        [0x107, [0xba, 0x80, 0x96]],        // mov dx, 9680h  (10,000,000 us)
        [0x10a, [0xb4, 0x86, 0xcd, 0x15]],  // mov ah, 86h / int 15h
        [0x10e, [0xe4, 0x7d]],              // in al, 125
        [0x110, [0xa2, 0x00, 0x02]],        // mov [0200], al
        [0x113, EXIT],
    ])));
    assert.ok(dos.run(50_000).terminated);

    assert.ok(Math.abs(machine.tMs - 10_000) < 1, 'ten seconds of machine time');
    // 20 C + 10 s at 10 C/s = 120 C, and the program read it back itself.
    assert.equal(peek(machine, 0x200), 120);
    assert.equal(emu.devices.thermometer.state().heaterOn, true);
});

test('with the heater off the temperature falls to ambient and stops there', () => {
    const therm = new Thermometer({ startC: 100, ambientC: 20, coolRateCPerSec: 5 });
    const m = new I8086Machine(EMU8086BOX);
    const emu = createEmu8086(m, { thermometer: therm }).install();
    emu.ports.write(PORTS.HEATER, 0);
    m.cycles += m.clockHz * 10;                          // ten seconds
    assert.equal(emu.ports.read(PORTS.THERMOMETER), 50, '100 C less 10 s at 5 C/s');
    m.cycles += m.clockHz * 1000;                        // a long time
    assert.equal(emu.ports.read(PORTS.THERMOMETER), 20, 'clamped at ambient, not below');
});

test('the thermometer reading is truncated, not rounded', () => {
    // A program doing `cmp al, 60` against 59.9 must see 59: an ADC that has
    // not reached the next code reports the lower one.
    const therm = new Thermometer({ startC: 59.9 });
    const m = new I8086Machine(EMU8086BOX);
    const emu = createEmu8086(m, { thermometer: therm }).install();
    assert.equal(emu.ports.read(PORTS.THERMOMETER), 59);
});

test('the Heater Alarm project shape: read the temperature and classify it', () => {
    // Corpus Project #7's specification: <= 200 green, 200 < t < 500 yellow,
    // >= 500 red. Its own source reads the temperature through SCAN_NUM
    // rather than the thermometer port -- so the port version is ours, and
    // the classification is the project's.
    const therm = new Thermometer({ startC: 150 });
    const m = new I8086Machine(EMU8086BOX);
    const emu = createEmu8086(m, { thermometer: therm }).install();
    const dos = createDos8086(m).install().loadCom(Uint8Array.from(com([
        [0x100, [0xe4, 0x7d]],              // in al, 125
        [0x102, [0x3c, 0xc8]],              // cmp al, 200
        [0x104, [0x77, 0x05]],              // ja hot
        [0x106, [0xb0, 0x01]],              // mov al, 1        (green)
        [0x108, [0xe6, 0xc7]],              // out 199, al
        [0x10a, [0xeb, 0x04]],              // jmp done
        [0x10c, [0xb0, 0x04]],              // hot: mov al, 4   (red)
        [0x10e, [0xe6, 0xc7]],              // out 199, al
        [0x110, EXIT],                      // done:
    ])));
    assert.ok(dos.run(10_000).terminated);
    assert.equal(emu.devices.led.state().value, 1, '150 C is below 200, so green');
});

// ---------------------------------------------------------------------------
// LED display -- port 199
// ---------------------------------------------------------------------------

test('the LED display shows the word at port 199 as a number', () => {
    // emu8086's LED_display_test.asm writes 1234 and then -5678 to port 199
    // as words. Nobody writes -5678 to a segment bit pattern, so the device
    // shows a number -- and both renderings are offered because the
    // documentation never says which the device itself picks.
    const { dos, dev } = emuWith(com([
        [0x100, [0xb8, 0xd2, 0x04]],        // mov ax, 1234
        [0x103, [0xe7, 0xc7]],              // out 199, ax
        [0x105, [0xb8, 0xd2, 0xe9]],        // mov ax, -5678
        [0x108, [0xe7, 0xc7]],              // out 199, ax
        [0x10a, EXIT],
    ]));
    dos.run(10_000);
    const s = dev.led.state();
    assert.equal(s.value, 0xe9d2, 'the raw word');
    assert.equal(s.signed, -5678);
    assert.equal(s.signedText, '-5678');
    assert.equal(s.unsignedText, '59858', 'and the unsigned reading, unasserted');
    assert.deepEqual(dev.led.settledHistory, [1234, 0xe9d2], 'the two values it meant');
});

test('the Car Waiting Meter project shape: 0 then 1 on port 199', () => {
    // Corpus Project #1 lines 51 and 93: `out 199,ax` with AX=0 and then
    // AX=1, for a specification whose only output is "LED turned red if time
    // is expired".
    const { dos, dev } = emuWith(com([
        [0x100, [0xb8, 0x00, 0x00, 0xe7, 0xc7]],   // mov ax, 0 / out 199, ax
        [0x105, [0xb8, 0x01, 0x00, 0xe7, 0xc7]],   // mov ax, 1 / out 199, ax
        [0x10a, EXIT],
    ]));
    dos.run(10_000);
    assert.equal(dev.led.state().value, 1, 'expired');
    assert.deepEqual(dev.led.history, [0, 1]);
});

// ---------------------------------------------------------------------------
// Printer -- port 130
// ---------------------------------------------------------------------------

test('the printer prints characters and honours the four control codes', () => {
    // DEVICES/Printer.txt: characters above 31 print; 07 bell, 08 backspace
    // ("move print head left one character"), 10 line feed, 13 carriage
    // return; everything else below 32 is not printed.
    const p = new Printer();
    for (const b of [...'Hi'].map((c) => c.charCodeAt(0))) p.onWrite(PORTS.PRINTER, b);
    p.onWrite(PORTS.PRINTER, 13);
    p.onWrite(PORTS.PRINTER, 10);
    for (const b of [...'There'].map((c) => c.charCodeAt(0))) p.onWrite(PORTS.PRINTER, b);
    assert.equal(p.page, 'Hi\nThere');
    assert.equal(p.state().row, 1);
});

test('printer backspace moves the head and overstrikes -- it does not delete', () => {
    const p = new Printer();
    for (const b of [65, 66, 8, 67]) p.onWrite(PORTS.PRINTER, b);   // A B <bs> C
    assert.equal(p.page, 'AC', 'C landed on top of B');
    // And carriage return alone rewinds the line WITHOUT advancing it, which
    // a naive `text += ch` model cannot represent at all.
    const q = new Printer();
    for (const b of [...'abcd'].map((c) => c.charCodeAt(0))) q.onWrite(PORTS.PRINTER, b);
    q.onWrite(PORTS.PRINTER, 13);
    q.onWrite(PORTS.PRINTER, 88);                                    // 'X'
    assert.equal(q.page, 'Xbcd', 'overprinted the line it had just typed');
});

test('the printer counts the bell and the control codes it will not print', () => {
    const p = new Printer();
    p.onWrite(PORTS.PRINTER, 7);                                     // bell
    p.onWrite(PORTS.PRINTER, 12);                                    // form feed: not implemented
    p.onWrite(PORTS.PRINTER, 1);
    assert.equal(p.state().bells, 1);
    assert.equal(p.state().ignoredControls, 2, 'and they are counted, not swallowed');
    assert.equal(p.page, '', 'nothing printed');
});

test('a program prints through port 130 and the port reads back zero', () => {
    // The whole handshake: "then clear the port back to zero once its done,
    // that way you can tell when it's time to pass it the next character".
    const { m, dos, dev } = emuWith(com([
        [0x100, [0xb0, 0x4f, 0xe6, 0x82]],  // mov al, 'O' / out 130, al
        [0x104, [0xb0, 0x4b, 0xe6, 0x82]],  // mov al, 'K' / out 130, al
        [0x108, [0xe4, 0x82]],              // in al, 130
        [0x10a, [0xa2, 0x00, 0x02]],        // mov [0200], al
        [0x10d, EXIT],
    ]));
    assert.ok(dos.run(10_000).terminated);
    assert.equal(dev.printer.page, 'OK');
    assert.equal(peek(m, 0x200), 0, 'the device consumed the byte and cleared the port');
});

// ---------------------------------------------------------------------------
// Robot -- ports 9, 10, 11
// ---------------------------------------------------------------------------

test('the robot examines, reports, moves and refuses to walk into a wall', () => {
    // io.html gives the whole instruction set. The program below exercises
    // examine (4), the status and data registers, a failed move, a turn and
    // a successful move.
    const { m, dos, dev } = emuWith(com([
        [0x100, [0xb0, 0x04, 0xe6, 0x09]],  // mov al, 4 / out 9, al   examine
        [0x104, [0xe4, 0x0b, 0xa2, 0x00, 0x02]],   // in al, 11 / mov [0200], al
        [0x109, [0xe4, 0x0a, 0xa2, 0x01, 0x02]],   // in al, 10 / mov [0201], al
        [0x10e, [0xe4, 0x0b, 0xa2, 0x02, 0x02]],   // in al, 11 / mov [0202], al
        [0x113, [0xb0, 0x01, 0xe6, 0x09]],  // mov al, 1 / out 9, al   forward (wall)
        [0x117, [0xe4, 0x0b, 0xa2, 0x03, 0x02]],   // in al, 11 / mov [0203], al
        [0x11c, [0xb0, 0x03, 0xe6, 0x09]],  // mov al, 3 / out 9, al   turn right
        [0x120, [0xb0, 0x01, 0xe6, 0x09]],  // mov al, 1 / out 9, al   forward
        [0x124, EXIT],
    ]));
    assert.ok(dos.run(10_000).terminated);

    assert.equal(peek(m, 0x200), 0x01, 'status bit 0: new data in the data register');
    assert.equal(peek(m, 0x201), ROBOT_DATA.WALL, 'the default map faces the robot at a wall');
    assert.equal(peek(m, 0x202), 0x00, 'and reading the data register cleared bit 0');
    assert.equal(peek(m, 0x203), 0x04, 'status bit 2: the move into the wall errored');

    const s = dev.robot.state();
    assert.equal(s.heading, 'east', 'the turn took');
    assert.deepEqual([s.x, s.y], [2, 1], 'and then it moved one cell east');
});

test('examining a wall is a SUCCESS reporting 255, not an error', () => {
    // The trap: "examine" looks at the cell in front, it does not enter it.
    // Treating a wall in front as a failure makes every sensor reading of a
    // boundary look like a broken robot.
    const r = new Robot();
    r.onWrite(PORTS.ROBOT_CMD, ROBOT_CMD.EXAMINE);
    assert.equal(r.state().error, false);
    assert.equal(r.state().newData, true);
    assert.equal(r.onRead(PORTS.ROBOT_DATA), ROBOT_DATA.WALL);
});

test('the robot switches lamps only where there is one to switch', () => {
    const r = new Robot();
    // Standing on an empty cell, there is no lamp: io.html lists "switch
    // on/off lamp" among the tasks the error bit is for.
    r.onWrite(PORTS.ROBOT_CMD, ROBOT_CMD.LAMP_OFF);
    assert.equal(r.state().error, true);

    // Walk east onto the switched-on lamp in the default map and switch it off.
    r.onWrite(PORTS.ROBOT_CMD, ROBOT_CMD.TURN_RIGHT);
    for (let i = 0; i < 3; i++) r.onWrite(PORTS.ROBOT_CMD, ROBOT_CMD.FORWARD);
    assert.deepEqual([r.x, r.y], [4, 1]);
    r.onWrite(PORTS.ROBOT_CMD, ROBOT_CMD.LAMP_OFF);
    assert.equal(r.state().error, false);
    // And a neighbour examining it now sees a switched-OFF lamp.
    r.onWrite(PORTS.ROBOT_CMD, ROBOT_CMD.TURN_LEFT);
    r.onWrite(PORTS.ROBOT_CMD, ROBOT_CMD.TURN_LEFT);   // face west
    r.onWrite(PORTS.ROBOT_CMD, ROBOT_CMD.FORWARD);
    r.onWrite(PORTS.ROBOT_CMD, ROBOT_CMD.TURN_RIGHT);
    r.onWrite(PORTS.ROBOT_CMD, ROBOT_CMD.TURN_RIGHT);  // face east again
    r.onWrite(PORTS.ROBOT_CMD, ROBOT_CMD.EXAMINE);
    assert.equal(r.onRead(PORTS.ROBOT_DATA), ROBOT_DATA.LAMP_OFF);
});

test('a busy robot rejects the command, and the rejection is counted', () => {
    // io.html: "you should always check bit#1 of status register before
    // sending data to port 9, otherwise the robot will reject your command".
    // The interval is undocumented, so it defaults to zero -- never busy.
    const m = new I8086Machine(EMU8086BOX);
    const emu = createEmu8086(m, { robot: new Robot({ commandUs: 1000 }) }).install();
    emu.ports.write(PORTS.ROBOT_CMD, ROBOT_CMD.TURN_RIGHT);
    assert.equal(emu.ports.read(PORTS.ROBOT_STATUS) & 0x02, 0x02, 'busy');
    emu.ports.write(PORTS.ROBOT_CMD, ROBOT_CMD.TURN_RIGHT);
    assert.equal(emu.devices.robot.state().rejectedCommands, 1);
    assert.equal(emu.devices.robot.state().heading, 'east', 'the second turn did not happen');

    m.cycles += m.clockHz / 1000;
    assert.equal(emu.ports.read(PORTS.ROBOT_STATUS) & 0x02, 0, 'ready again');
    emu.ports.write(PORTS.ROBOT_CMD, ROBOT_CMD.TURN_RIGHT);
    assert.equal(emu.devices.robot.state().heading, 'south');
});

test('a command the robot does not have sets the error bit and is counted', () => {
    const r = new Robot();
    r.onWrite(PORTS.ROBOT_CMD, 9);              // io.html tabulates 0..6 only
    assert.equal(r.state().error, true);
    assert.equal(r.state().unknownCommands, 1);
});

// ---------------------------------------------------------------------------
// The flat port space
// ---------------------------------------------------------------------------

test('an unclaimed port reads back what was written -- the simple test device', () => {
    // emu8086's simple_io.asm writes 0A7h to port 110 and 1234h to port 112
    // and reads both straight back. The port space is a 65536-byte array
    // ("Port 100 corresponds to byte 100 in this file c:\\emu8086.io"), so
    // read-back IS the behaviour, and returning 0FFh for open bus -- right
    // for a breadboard -- would be wrong here.
    const { m, dos, ports } = emuWith(com([
        [0x100, [0xb0, 0xa7, 0xe6, 0x6e]],  // mov al, 0A7h / out 110, al
        [0x104, [0xb8, 0x34, 0x12]],        // mov ax, 1234h
        [0x107, [0xe7, 0x70]],              // out 112, ax
        [0x109, [0xb8, 0x00, 0x00]],        // mov ax, 0
        [0x10c, [0xe4, 0x6e, 0xa2, 0x00, 0x02]],   // in al, 110 / mov [0200], al
        [0x111, [0xe5, 0x70, 0xa3, 0x01, 0x02]],   // in ax, 112 / mov [0201], ax
        [0x116, EXIT],
    ]));
    assert.ok(dos.run(10_000).terminated);
    assert.equal(peek(m, 0x200), 0xa7);
    assert.equal(peek(m, 0x201) | (peek(m, 0x202) << 8), 0x1234);
    // Visible, but not refused: nothing owns these ports.
    const unclaimed = ports.report().unclaimed.map((u) => u.port);
    assert.ok(unclaimed.includes(110) && unclaimed.includes(112));
});

test('two devices cannot claim the same port', () => {
    // The port map is built from each device's own declaration, so a
    // collision is a construction error rather than a silent shadowing.
    class Greedy extends TrafficLights { get ports() { return [PORTS.PRINTER]; } }
    assert.throws(() => new Emu8086Ports({ traffic: new Greedy() }), /claimed by two devices/);
});

test('installing the port space does not shadow a board\'s own chips', () => {
    // The window goes on the END of the machine's decode list, so a declared
    // 8255 keeps ports 0-3 and the emu8086 devices fill everything else.
    // Installing at the front would silently steal them.
    const m = new I8086Machine(BREADBOARD8086);
    const emu = createEmu8086(m).install();
    m._out(0x03, 0x80);                     // 8255 control word: all outputs
    m._out(0x00, 0x5a);                     // port A
    assert.equal(m._in(0x00), 0x5a, 'the PPI still answers for its own ports');
    m._out(PORTS.TRAFFIC, 0x49);
    m._out(PORTS.TRAFFIC + 1, 0x02);
    assert.equal(emu.devices.traffic.word, TRAFFIC_ALL_RED, 'and port 4 reaches the traffic light');
});

test('install() is idempotent', () => {
    const m = new I8086Machine(EMU8086BOX);
    const before = m._io.length;
    const emu = createEmu8086(m);
    emu.install().install().install();
    assert.equal(m._io.length, before + 1);
});

test('the report names what is invented and what is unestablished', () => {
    // Refusals visible and counted: a caller reading device state must not
    // be able to mistake one of our invented defaults for an emulated fact.
    const emu = createEmu8086(new I8086Machine(EMU8086BOX)).install();
    const r = emu.report();
    assert.ok(Array.isArray(r.unestablished) && r.unestablished.length >= 8);
    assert.equal(r.unestablished, UNESTABLISHED);
    assert.ok(/robot_map\.dat/.test(r.invented.robotMap));
    assert.ok(r.unestablished.some((s) => /seven-segment/.test(s)),
        'the LED display has no segment map and we do not pretend otherwise');
    assert.ok(r.unestablished.some((s) => /compass direction/.test(s)),
        'and we do not claim to know which traffic group faces which way');
});

// ---------------------------------------------------------------------------
// The macro library, as source text
// ---------------------------------------------------------------------------

test('the emitted library defines every documented macro and procedure', () => {
    // asm_tutorial_05.html lists exactly these. Anything missing is a corpus
    // program that will not assemble.
    for (const name of INC_MACROS) {
        assert.match(EMU8086_INC, new RegExp(`^${name} MACRO`, 'm'), `${name} is a macro`);
    }
    for (const name of INC_PROCEDURES) {
        assert.match(EMU8086_INC, new RegExp(`^DEFINE_${name} MACRO`, 'm'),
            `DEFINE_${name} emits the procedure`);
        assert.match(EMU8086_INC, new RegExp(`^${name} PROC NEAR`, 'm'),
            `${name} is a PROC`);
        assert.match(EMU8086_INC, new RegExp(`^${name} ENDP`, 'm'));
    }
});

test('every DEFINE_ macro jumps over the procedure it emits', () => {
    // THE most important property here. The documentation says to put the
    // DEFINE_ calls "in the bottom of your file (but before the END
    // directive)", where they are unreachable -- but corpus Project #0 lines
    // 25-28 and Project #2 lines 21-25 put them between `MOV DS, AX` and the
    // first real instruction. Without a jump over the body the CPU falls
    // into the procedure and hits its RET with the wrong return address, and
    // six of the ten corpus projects die on their fourth instruction.
    const blocks = EMU8086_INC.split(/^DEFINE_/m).slice(1);
    assert.equal(blocks.length, INC_PROCEDURES.length);
    for (const b of blocks) {
        const name = b.split(/\s/)[0];
        const body = b.split(/^ENDM$/m)[0];
        assert.match(body, /LOCAL over/, `DEFINE_${name} declares a local label`);
        assert.match(body, /^    JMP  over$/m, `DEFINE_${name} jumps over its body`);
        assert.match(body, /^over:$/m, `DEFINE_${name} lands after it`);
        // And the jump must come BEFORE the PROC, or it jumps over nothing.
        assert.ok(body.indexOf('JMP  over') < body.indexOf('PROC NEAR'),
            `DEFINE_${name} jumps before the procedure, not after it`);
    }
});

test('PRINT passes its argument to DB, so PRINT 0AH works as well as PRINT \'x\'', () => {
    // Corpus Project #0 lines 48, 49 and 108: PRINT 0AH, PRINT 0DH, PRINT
    // 09H. A macro that assumed a quoted string would fail on all three.
    const printMacro = EMU8086_INC.split(/^PRINT MACRO arg$/m)[1].split(/^ENDM$/m)[0];
    assert.match(printMacro, /DB\s+arg, 0/, 'the argument goes straight to DB');
    // And it preserves SI, because Project #0 keeps an array index there
    // across PRINT calls inside its input loop.
    assert.match(printMacro, /PUSH SI/);
    assert.match(printMacro, /POP  SI/);
    // The string is read with a CS override, so the macro is correct in an
    // .EXE with a separate data segment and not only in a .COM.
    assert.match(printMacro, /MOV  AL, CS:\[SI\]/);
});

test('PRINTN takes an optional argument and ends the line with CR AND LF', () => {
    // Project #7 uses a bare `PRINTN` as a separator, so the parameter must
    // be optional. And the documented wording is "carriage return", which
    // taken literally is byte 13 alone -- that returns to column zero
    // without advancing, so consecutive PRINTNs would overprint one line.
    const m = EMU8086_INC.split(/^PRINTN MACRO arg$/m)[1].split(/^ENDM$/m)[0];
    assert.match(m, /IFNB <arg>/, 'the argument is optional');
    assert.match(m, /PUTC 13/);
    assert.match(m, /PUTC 10/, 'and the line actually advances');
});

test('the register conventions the corpus depends on are the ones emitted', () => {
    const inc = EMU8086_INC;
    // "receives address of string in DS:SI" -- Project #0 line 33 comments
    // "PRINT_STRING FUNCTION PRINTS WHAT'S IN SI".
    assert.match(inc.split('PRINT_STRING PROC NEAR')[1], /MOV  AL, \[SI\]/);
    // SCAN_NUM returns in CX and preserves everything else -- Project #0
    // line 35: "THE FUNCTION PUTS THE INPUT IN CX".
    const scan = inc.split('SCAN_NUM PROC NEAR')[1].split('SCAN_NUM ENDP')[0];
    assert.match(scan, /XOR  CX, CX/);
    assert.ok(!/PUSH CX/.test(scan), 'CX is the output, so it is not preserved');
    assert.match(scan, /PUSH AX[\s\S]*PUSH BX[\s\S]*PUSH DX/, 'but AX, BX and DX are');
    assert.match(scan, /NEG  CX/, 'and the number is SIGNED, as documented');
    // GET_STRING takes the buffer in DI and its size in DX -- corpus
    // Project #3 lines 41-43: LEA DI, TEMP_ID / MOV DX, IDSize / CALL
    // get_string.
    const gs = inc.split('GET_STRING PROC NEAR')[1].split('GET_STRING ENDP')[0];
    assert.match(gs, /MOV  BX, DX/, 'the size is copied out of DX before DL is used for echo');
    assert.match(gs, /MOV  \[DI\], AL/);
    assert.match(gs, /MOV  BYTE PTR \[DI\], 0/, 'and the result is NUL-terminated');
    // PRINT_NUM calls PRINT_NUM_UNS, which is why the documented usage needs
    // DEFINE_PRINT_NUM_UNS as well.
    assert.match(inc.split('PRINT_NUM PROC NEAR')[1], /CALL PRINT_NUM_UNS/);
});

test('CLEAR_SCREEN clears by scrolling the window, as documented', () => {
    // "done by scrolling entire screen window, and set cursor position to
    // top of it". AH=6 with AL=0 blanks the named window.
    const cs = EMU8086_INC.split('CLEAR_SCREEN PROC NEAR')[1].split('CLEAR_SCREEN ENDP')[0];
    assert.match(cs, /MOV  AX, 0600h/, 'scroll up, AL=0 meaning blank it');
    assert.match(cs, /MOV  DX, 184Fh/, 'the whole 80x25 window');
    assert.match(cs, /MOV  AH, 2[\s\S]*INT  10h/, 'then home the cursor');
});

test('PTHIS returns PAST its inline string', () => {
    // The return address a NEAR call pushed IS the string. A version that
    // just RETs jumps into its own text and executes the message.
    const p = EMU8086_INC.split('PTHIS PROC NEAR')[1].split('PTHIS ENDP')[0];
    assert.match(p, /MOV  SI, \[BP\+2\]/, 'the string is at the return address');
    assert.match(p, /MOV  \[BP\+2\], SI/, 'and the return address is moved past it');
});

test('every jump in the emitted library resolves to a label in its own macro', () => {
    // The emitted text is source for an assembler we do not run here, so a
    // typo'd jump target would otherwise surface as somebody else's build
    // error. Each macro must be self-contained: the only names a jump may
    // reach outside its own block are the two procedures that legitimately
    // call each other.
    const blocks = [];
    let cur = null;
    for (const l of EMU8086_INC.split('\n')) {
        const open = l.match(/^([A-Z_0-9]+) MACRO/);
        if (open) { cur = { name: open[1], defs: new Set(), refs: [] }; blocks.push(cur); continue; }
        if (l === 'ENDM') { cur = null; continue; }
        if (!cur) continue;
        const local = l.match(/^    LOCAL (.+)$/);
        if (local) { for (const n of local[1].split(/,\s*/)) cur.defs.add(n.trim()); continue; }
        const def = l.match(/^([a-z_0-9]+):/);
        if (def) cur.defs.add(def[1]);
        const ref = l.match(/^\s+(?:J[A-Z]+|LOOP|CALL)\s+([a-zA-Z_][a-zA-Z_0-9]*)\s*$/);
        if (ref) cur.refs.push(ref[1]);
    }
    assert.equal(blocks.length, INC_MACROS.length + INC_PROCEDURES.length);
    const crossMacro = new Set(['PRINT_NUM_UNS']);   // PRINT_NUM calls it, by design
    for (const b of blocks) {
        for (const r of b.refs) {
            assert.ok(b.defs.has(r) || crossMacro.has(r),
                `${b.name} jumps to ${r}, which it never defines`);
        }
        // Every macro that emits a label must declare it LOCAL, or a program
        // using the macro twice is a duplicate-declaration error.
        assert.ok(b.defs.size === 0 || /LOCAL/.test(EMU8086_INC),
            `${b.name} emits labels`);
    }
});

test('GET_STRING with a zero-size buffer stores nothing, not even a terminator', () => {
    // Writing a NUL into a zero-byte buffer would overrun the very buffer
    // whose size the caller passed in to prevent exactly that.
    const gs = EMU8086_INC.split('GET_STRING PROC NEAR')[1].split('GET_STRING ENDP')[0];
    assert.match(gs, /CMP  BX, 0\n    JE   gs_ret/, 'a zero size skips the store entirely');
    // And gs_ret must sit AFTER the terminator write, so the normal path
    // still terminates the string.
    assert.ok(gs.indexOf('MOV  BYTE PTR [DI], 0') < gs.indexOf('gs_ret:'),
        'the normal path still writes the terminator');
});

test('the emitted library says it is a clean re-implementation', () => {
    assert.match(EMU8086_INC, /CLEAN RE-IMPLEMENTATION/);
    assert.match(EMU8086_INC, /contains none of it/);
    assert.match(EMU8086_INC, /asm_tutorial_05/, 'and cites what it was built from');
});

// ---------------------------------------------------------------------------
// Source directives
// ---------------------------------------------------------------------------

test('#start=NAME# names a virtual device, NOT an entry point', () => {
    // The trap. Corpus Project #6 opens with this line and its entry point
    // is simply the first instruction; emu8086's own thermometer.asm
    // comments the equivalent line "thermometer.exe is started automatically
    // from c:\\emu8086\\devices".
    const d = parseDirectives('#start=Traffic_Lights.exe#\nname "traffic"\nmov ax, 249h\nout 4, ax\n');
    assert.deepEqual(d.devices, ['Traffic_Lights.exe']);
    assert.equal(deviceForStart('Traffic_Lights.exe'), 'traffic');
    assert.equal(deviceForStart('led_display.exe'), 'led', 'case and underscores do not matter');
    assert.equal(deviceForStart('thermometer.exe'), 'thermometer');
    assert.equal(deviceForStart('simple.exe'), null, 'known, and needs no handler');
    assert.equal(deviceForStart('nosuchdevice.exe'), undefined, 'unknown is not null');
});

test('the output-type directives choose the loader', () => {
    // compiler.html: COM is a raw binary at offset 100h; EXE has an MZ
    // header and an entry point of its own; BIN is a flat load at
    // LOAD_SEGMENT:LOAD_OFFSET, defaulting to 0100:0000.
    assert.equal(parseDirectives('#make_com#\norg 100h\nret').loader, 'com');
    assert.equal(parseDirectives('#make_exe#\n.stack 100h\nret').loader, 'exe');

    const bin = parseDirectives('#start=thermometer.exe#\n#make_bin#\nname "thermo"\nin al, 125\n');
    assert.equal(bin.loader, 'bin');
    assert.equal(bin.loadSegment, 0x0100, 'the documented default');
    assert.equal(bin.loadOffset, 0x0000);
    assert.deepEqual(bin.devices, ['thermometer.exe']);

    const boot = parseDirectives('#make_boot#\norg 7c00h\n');
    assert.equal(boot.loader, 'bin');
    assert.equal(boot.org, 0x7c00);
    assert.equal(boot.loadOffset, 0x7c00, 'a boot sector loads at 0000:7C00');
    assert.equal(boot.loadSegment, 0x0000);
});

test('the loader is inferred from ORG 100h or a stack segment when no directive says', () => {
    assert.equal(parseDirectives('ORG 100h\nmov ax, 1\nret').makeType, 'make_com');
    assert.equal(parseDirectives('CSEG SEGMENT\nSTACK SEGMENT\nret').makeType, 'make_exe');
    const none = parseDirectives('mov ax, 1\nret');
    assert.equal(none.makeType, null);
    assert.match(none.warnings.join(' '), /cannot be determined/,
        'and an undeterminable loader is said out loud, not guessed');
});

test('directive values are HEXADECIMAL without a suffix', () => {
    // The other easy mistake: #CS=1234# is 1234h, not decimal 1234.
    const d = parseDirectives('#make_bin#\n#LOAD_SEGMENT=8000#\n#LOAD_OFFSET=0100#\n'
        + '#CS=8000#\n#IP=0100#\n#AL=55#\n#DS=DDEE#\n');
    assert.equal(d.loadSegment, 0x8000);
    assert.equal(d.loadOffset, 0x0100);
    assert.equal(d.registers.cs, 0x8000);
    assert.equal(d.registers.ip, 0x0100);
    assert.equal(d.registers.al, 0x55);
    assert.equal(d.registers.ds, 0xddee);
});

test('#MEM# presets memory, by physical or by logical address', () => {
    // compiler.html: "#MEM=nnnn,[bytestring]-nnnn:nnnn,[bytestring]#",
    // "- separates the entries", "for each byte there must be exactly 2
    // characters".
    const d = parseDirectives('#make_bin#\n#MEM=1000,01ABCDEF0122-0200,1233#');
    assert.deepEqual(d.mem, [
        { at: 0x1000, bytes: [0x01, 0xab, 0xcd, 0xef, 0x01, 0x22] },
        { at: 0x0200, bytes: [0x12, 0x33] },
    ]);
    // 0100:FFFE is (100h << 4) + FFFEh = 10FFEh, not 1FFEh: the segment is
    // shifted four bits, and the offset can carry into the next paragraph.
    const logical = parseDirectives('#make_bin#\n#MEM=0100:FFFE,00FF#');
    assert.deepEqual(logical.mem, [{ at: 0x10ffe, bytes: [0x00, 0xff] }]);
    const bad = parseDirectives('#make_bin#\n#MEM=1000,ABC#');
    assert.match(bad.warnings.join(' '), /odd length/, 'a half byte is refused by name');
});

test('two output-type directives are a warning, not a silent choice', () => {
    const d = parseDirectives('#make_com#\n#make_bin#\norg 100h');
    assert.equal(d.makeType, 'make_bin');
    assert.match(d.warnings.join(' '), /two output types/);
});

test('the real Project #6 header parses to a device plus a first-instruction entry', () => {
    // Verbatim, from the corpus.
    const src = [
        '#start=Traffic_Lights.exe#',
        ';Red is the least significant of each consecutive 3 bits : 0,3,6,9',
        'name "traffic"',
        'mov ax, 249h',
        'out 4, ax',
    ].join('\n');
    const d = parseDirectives(src);
    assert.deepEqual(d.devices, ['Traffic_Lights.exe']);
    // No #make_*#, no ORG 100h, no stack segment: the loader is genuinely
    // undeterminable from this source, and saying so is the honest answer.
    assert.equal(d.makeType, null);
    assert.equal(d.loader, 'unknown');
    assert.equal(d.warnings.length, 1);
});
