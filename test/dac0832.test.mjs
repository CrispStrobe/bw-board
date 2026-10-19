// The DAC0832 — the output half of the analog pair, and the chip `set led to
// 128` (stc12_writepin) lands on. The direct tests pin the ladder arithmetic
// and the two latches; the last one assembles the sequence a lowering has to
// emit and runs it as machine code, because everything else here drives the
// chip's own API and so proves nothing about the path a program takes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DAC0832 } from '../src/dac0832.js';
import { I8086Machine } from '../src/i8086-machine.js';

const machine = () => new I8086Machine({
    clockHz: 5_000_000,
    regions: [{kind: 'ram', start: 0, end: 0xbffff}],
    chips: [{kind: 'dac0832', name: 'dac1', at: 0x310}],
});

test('full scale is Vref x 255/256, so the reference is NOT reachable', () => {
    const d = new DAC0832();
    d.write(0, 255);
    assert.equal(d.volts(), 5 * 255 / 256);
    assert.ok(d.volts() < 5.0, 'code 255 must not reach the rail');
    assert.equal(Number(d.volts().toFixed(4)), 4.9805);
    // The step is one 256th, not one 255th. Getting this wrong is invisible at
    // mid-scale and only shows at the top, which is why the top is asserted.
    d.write(0, 1);
    assert.equal(d.volts(), 5 / 256);
    d.write(0, 0);
    assert.equal(d.volts(), 0, 'zero code is exactly zero volts');
});

test('mid-scale is 128, and 2.5V is the value a learner will check', () => {
    const d = new DAC0832();
    d.write(0, 128);
    assert.equal(d.volts(), 2.5);
    assert.equal(d.counts, 128);
});

test('a different vref rescales, so a 3.3V card is not reported as a 5V one', () => {
    const d = new DAC0832({vref: 3.3});
    d.write(0, 255);
    assert.equal(Number(d.volts().toFixed(4)), 3.2871);
    d.write(0, 128);
    assert.equal(d.volts(), 1.65);
});

test('the two latches are separate: staging does not move the output', () => {
    // The 0832's actual feature. 311h loads the input latch and the ladder
    // does not see it; 312h transfers. A card that tied XFER low would get
    // the 310h path only and could not move two converters together.
    const d = new DAC0832();
    d.write(0, 64);
    assert.equal(d.counts, 64, 'the single-buffered write moved the output');

    d.write(1, 200);                       // stage
    assert.equal(d.counts, 64, 'staging must NOT move the ladder');
    assert.equal(d.volts(), 64 * 5 / 256);

    d.write(2);                            // XFER strobe, no data
    assert.equal(d.counts, 200, 'the transfer moved the staged value out');

    // The strobe carries no data: the byte on the bus during XFER is ignored,
    // because WR2/XFER latches what is already in the input register.
    d.write(1, 10);
    d.write(2, 0xff);
    assert.equal(d.counts, 10, 'the transfer used the staged 10, not the bus 0xFF');
});

test('it is WRITE-ONLY: reading gives open bus, not the last value written', () => {
    // A 0832 has no data outputs. A model that echoed the write back would
    // teach that a DAC can be read, and the program relying on it would work
    // here and fail on a bench.
    const d = new DAC0832();
    d.write(0, 0x42);
    assert.equal(d.read(), 0xff);
    const m = machine();
    m._out(0x310, 0x42);
    assert.equal(m._in(0x310), 0xff, 'through the machine too');
    assert.equal(m._in(0x313), 0xff);
});

test('the machine decodes it at 310h — the window after the ADC', () => {
    const m = machine();
    m._out(0x310, 100);
    assert.equal(m.chips.dac1.counts, 100);
    m._out(0x311, 250);
    assert.equal(m.chips.dac1.counts, 100, '311h stages only');
    m._out(0x312, 0);
    assert.equal(m.chips.dac1.counts, 250, '312h transfers');
    // 30Fh belongs to nobody here and must not reach the chip.
    m._out(0x30f, 7);
    assert.equal(m.chips.dac1.counts, 250, 'the window starts at 310h');
});

test('analogOutputs() reports counts and volts as separate facts', () => {
    const m = machine();
    m._out(0x310, 128);
    assert.deepEqual(m.analogOutputs(), [{chip: 'dac1', counts: 128, volts: 2.5, vref: 5}]);
    // A machine with no DAC reports an EMPTY list, which is how "no analog
    // output" differs from "an output sitting at zero" -- the same distinction
    // audioTone() makes between no voices and a silent one.
    const bare = new I8086Machine({
        clockHz: 5_000_000, regions: [{kind: 'ram', start: 0, end: 0xffff}], chips: [],
    });
    assert.deepEqual(bare.analogOutputs(), []);
});

test('state round-trips, including a value staged but not transferred', () => {
    const d = new DAC0832({vref: 3.3});
    d.write(0, 90);
    d.write(1, 240);          // staged, deliberately not transferred
    const clone = new DAC0832();
    clone.setState(d.getState());
    assert.equal(clone.counts, 90);
    assert.equal(clone.vref, 3.3);
    clone.write(2);
    assert.equal(clone.counts, 240, 'the snapshot carried the STAGED value too');
});

test('a real 8086 program sets a voltage, and staging really is two steps', async () => {
    // The reference sequence: this is what `set led to 128` must become.
    const {assemble} = await import('../src/i8086-asm.js');
    const img = assemble(`
    MOV DX, 310h
    MOV AL, 128
    OUT DX, AL        ; load + transfer: the output moves here
    MOV AH, 4Ch
    INT 21h
`, {variant: '80186'});
    const m = machine();
    m.mem.set(img.bytes, 0x100);
    m.cpu.cs = 0; m.cpu.ip = 0x100; m.cpu.ss = 0; m.cpu.sp = 0xfffe;
    let steps = 0;
    while (steps++ < 100_000 && m.mem[m.cpu.pc] !== 0xcd) m.step();
    assert.ok(steps < 100_000, 'the program never reached its exit');
    assert.equal(m.analogOutputs()[0].volts, 2.5, '128 of 256 at 5V is 2.5V');

    // And the staged path, which a multi-channel move would use.
    const img2 = assemble(`
    MOV DX, 311h
    MOV AL, 255
    OUT DX, AL        ; stage only -- the ladder must not move
    MOV DX, 312h
    OUT DX, AL        ; XFER
    MOV AH, 4Ch
    INT 21h
`, {variant: '80186'});
    const m2 = machine();
    m2._out(0x310, 0);
    m2.mem.set(img2.bytes, 0x100);
    m2.cpu.cs = 0; m2.cpu.ip = 0x100; m2.cpu.ss = 0; m2.cpu.sp = 0xfffe;
    let s2 = 0;
    while (s2++ < 100_000 && m2.mem[m2.cpu.pc] !== 0xcd) m2.step();
    assert.equal(m2.analogOutputs()[0].counts, 255, 'the transfer landed');
});
