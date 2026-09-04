/**
 * The ADC0809, and the two properties that make it the right chip here.
 *
 * EIGHT CHANNELS SELECTED BY ADDRESS, because that is what keeps the reseat
 * contract a mapping: `PIN pot = P1.3 ANALOG` means ADC channel 3 on an STC12,
 * and it means channel 3 here, for the same reason `P1 -> port A` works on the
 * 8255. A single-channel converter would turn that into a lookup.
 *
 * AND EOC IS POLLABLE, because DOSBOX8086_XT has no PIC. A converter that only
 * signalled completion by interrupt could not be used on this bench at all.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ADC0809 } from '../src/adc0809.js';
import { I8086Machine } from '../src/i8086-machine.js';

const machine = () => new I8086Machine({
    clockHz: 5_000_000,
    regions: [{kind: 'ram', start: 0, end: 0xbffff}],
    chips: [{kind: 'adc0809', name: 'adc1', at: 0x300}],
});

test('the channel comes from the ADDRESS, which is how the mux is wired', () => {
    const adc = new ADC0809();
    for (let n = 0; n < 8; n++) adc.setChannel(n, n * 0.5);
    for (let n = 0; n < 8; n++) {
        adc.write(n);                 // ALE + START on port 300h+n
        adc.advance(adc.convCycles);
        assert.equal(adc.channel, n, `port 300h+${n} must select channel ${n}`);
        assert.equal(adc.read(0), Math.floor((n * 0.5 / 5.0) * 256),
            `channel ${n} carries ${n * 0.5}V`);
    }
    // The DATA byte is ignored: on the real card nothing is connected to it,
    // and taking the channel from the data would be a different board.
    adc.setChannel(2, 5.0);
    adc.write(2, 0x77);
    adc.advance(adc.convCycles);
    assert.equal(adc.channel, 2, 'the written byte must not select a channel');
});

test('a conversion takes real time, and reading early gives the PREVIOUS result', () => {
    // The datasheet is 64 clocks; at 640 kHz against a 5 MHz CPU that is 500
    // cycles. Answering instantly would make a broken polling loop look
    // correct, which is the whole reason this is not a lookup table.
    const adc = new ADC0809(5_000_000);
    assert.equal(adc.convCycles, 500);

    adc.setChannel(0, 5.0);
    adc.write(0);
    adc.advance(adc.convCycles);
    assert.equal(adc.read(0), 255, 'full scale');

    // Start a second conversion on a different voltage and read too soon.
    adc.setChannel(1, 0.0);
    adc.write(1);
    adc.advance(adc.convCycles - 1);
    assert.equal(adc.eoc, false, 'EOC must still be low one cycle early');
    assert.equal(adc.read(0), 255,
        'the output latch still holds the PREVIOUS result — START does not clear it');
    adc.advance(1);
    assert.equal(adc.eoc, true);
    assert.equal(adc.read(0), 0, 'and now the new one');
});

test('EOC is readable as a status port, because this bench has no PIC', () => {
    const adc = new ADC0809();
    adc.write(0);
    assert.equal(adc.read(8), 0x00, 'converting');
    adc.advance(adc.convCycles);
    assert.equal(adc.read(8), 0x01, 'complete');
    // A fresh chip has converted nothing and says so rather than claiming a
    // result it does not have.
    assert.equal(new ADC0809().read(8), 0x00);
});

test('volts convert to counts, and out-of-range input is clamped not wrapped', () => {
    const adc = new ADC0809(5_000_000, {vref: 5.0});
    const at = (v) => { adc.setChannel(0, v); adc.write(0); adc.advance(adc.convCycles);
        return adc.read(0); };
    assert.equal(at(0), 0);
    assert.equal(at(2.5), 128);
    assert.equal(at(5.0), 255, 'full scale reads full scale, not 0');
    assert.equal(at(7.5), 255, 'above vref CLAMPS — a wrap would report a low voltage');
    assert.equal(at(-1), 0, 'below ground clamps too');
});

test('a different vref rescales, so a 3.3V board is not silently read as 5V', () => {
    const adc = new ADC0809(5_000_000, {vref: 3.3});
    adc.setChannel(0, 3.3);
    adc.write(0);
    adc.advance(adc.convCycles);
    assert.equal(adc.read(0), 255, '3.3V is full scale when vref is 3.3');
});

test('the machine decodes it at 300h — the XT prototype-card range', () => {
    // 300h-31Fh is the block IBM documented for cards a user adds, and it is
    // free on every preset here. The window is nine ports: eight channels and
    // the status.
    const m = machine();
    m.chips.adc1.setChannel(3, 2.5);
    m._out(0x303, 0);                       // start channel 3
    assert.equal(m._in(0x308), 0x00, 'EOC low while converting');
    m._advanceChips(m.chips.adc1.convCycles);
    assert.equal(m._in(0x308), 0x01, 'EOC high when done');
    assert.equal(m._in(0x300), 128, '2.5V of 5V');
});

test('the conversion advances with the CPU, so a real program can poll it', () => {
    // The sequence a lab program writes: OUT to start, poll the status port,
    // IN to read. Driven through the machine rather than the chip, because
    // that is the path a program takes.
    const m = machine();
    m.chips.adc1.setChannel(5, 1.25);
    m._out(0x305, 0);
    let polls = 0;
    while (!(m._in(0x308) & 1) && polls++ < 10000) m._advanceChips(10);
    assert.ok(polls > 0 && polls < 10000, `polled ${polls} times — it must take some time`);
    assert.equal(m._in(0x300), 64, '1.25V of 5V');
});

test('state round-trips, so a machine snapshot keeps a conversion in flight', () => {
    const a = new ADC0809();
    a.setChannel(2, 4.0);
    a.write(2);
    a.advance(100);
    const b = new ADC0809();
    b.setState(JSON.parse(JSON.stringify(a.getState())));
    assert.equal(b.remaining, a.remaining, 'a conversion in flight survives');
    assert.equal(b.channel, 2);
    b.advance(b.remaining);
    a.advance(a.remaining);
    assert.equal(b.read(0), a.read(0), 'and finishes with the same answer');
    // The channel array must be a COPY, or a restored machine shares its
    // analog inputs with the snapshot it came from.
    b.setChannel(2, 0);
    assert.equal(a.volts[2], 4.0, 'the restored chip must not share the volts array');
});
