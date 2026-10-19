// The 8255 PPI. Datasheet behaviours that a plausible-looking model gets
// wrong, each one visible on a breadboard: the mode-set write clearing the
// output latches, port C carrying two independent directions, the control
// register being write-only, and BSR reaching one bit of port C without
// disturbing its neighbours.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { I8255 } from '../src/i8255.js';

const A = 0, B = 1, C = 2, CTRL = 3;

test('reset leaves every port an input, driving nothing', () => {
    const ppi = new I8255();
    assert.equal(ppi.control, 0x9b);
    assert.equal(ppi.dirA, 0);
    assert.equal(ppi.dirB, 0);
    assert.equal(ppi.dirC, 0);
});

test('a mode-set word sets directions and CLEARS the output latches', () => {
    const edges = [];
    const ppi = new I8255({ onPortChange: (p, v, o) => edges.push([p, v, o]) });
    ppi.write(CTRL, 0x80);                  // mode 0, everything an output
    ppi.write(A, 0xff);
    assert.equal(ppi.read(A), 0xff);

    edges.length = 0;
    ppi.write(CTRL, 0x80);                  // reconfigure to the SAME thing
    assert.equal(ppi.read(A), 0x00, 'the latch does not survive a mode-set write');
    // On the bench this is the instant every LED goes dark. A model that
    // keeps the latch makes a blink program look like it never started.
    assert.deepEqual(edges.map((e) => e[0]), ['a', 'b', 'c']);
    assert.deepEqual(edges.map((e) => e[1]), [0, 0, 0]);
});

test('port C is two ports with two directions', () => {
    const ppi = new I8255();
    ppi.write(CTRL, 0x81);                  // C lower input, C upper output
    assert.equal(ppi.dirC, 0xf0);
    ppi.setInputPort('c', 0x0f);
    ppi.write(C, 0xa5);
    // Upper nibble is the latch (Ah), lower is the pins (Fh).
    assert.equal(ppi.read(C), 0xaf);

    ppi.write(CTRL, 0x88);                  // C upper input, C lower output
    assert.equal(ppi.dirC, 0x0f);
});

test('the control register is write-only and reads as an undriven bus', () => {
    const ppi = new I8255();
    ppi.write(CTRL, 0x80);
    assert.equal(ppi.read(CTRL), 0xff, 'there is no path to read the mode back');
});

test('BSR sets one bit of port C and leaves the rest alone', () => {
    const ppi = new I8255();
    ppi.write(CTRL, 0x80);                  // all outputs
    ppi.write(C, 0x00);
    ppi.write(CTRL, 0x0b);                  // bit 5 (bits 3-1 = 101), set
    assert.equal(ppi.read(C), 0x20);
    ppi.write(CTRL, 0x03);                  // bit 1, set
    assert.equal(ppi.read(C), 0x22);
    ppi.write(CTRL, 0x0a);                  // bit 5, reset
    assert.equal(ppi.read(C), 0x02, 'the neighbour survived — this is why C is the control port');
});

test('an input port reads its pins, an output port reads its latch', () => {
    const ppi = new I8255();
    ppi.write(CTRL, 0x92);                  // A input, B input, C output
    ppi.setInputPort('a', 0x5a);
    ppi.setInput('b', 3, 0);
    assert.equal(ppi.read(A), 0x5a);
    assert.equal(ppi.read(B), 0xf7, 'B defaults high and bit 3 was pulled low');
    ppi.write(C, 0x3c);
    assert.equal(ppi.read(C), 0x3c);
});

test('modes 1 and 2 are refused in words, not silently faked', () => {
    const ppi = new I8255();
    ppi.write(CTRL, 0x80);
    assert.equal(ppi.modeWarning, null);
    ppi.write(CTRL, 0xa0);                  // group A mode 1
    assert.match(ppi.modeWarning, /mode 1 on group A/);
    assert.match(ppi.modeWarning, /not modelled/);
    ppi.write(CTRL, 0x84);                  // group B mode 1
    assert.match(ppi.modeWarning, /mode 1 on group B/);
    ppi.write(CTRL, 0x80);
    assert.equal(ppi.modeWarning, null, 'and the warning clears when the mode does');
});

test('state round-trips', () => {
    const ppi = new I8255();
    ppi.write(CTRL, 0x81);
    ppi.write(A, 0x12);
    ppi.setInputPort('c', 0x0f);
    const s = ppi.getState();
    const other = new I8255();
    other.setState(s);
    assert.equal(other.read(A), 0x12);
    assert.equal(other.dirC, 0xf0);
    assert.equal(other.read(C), 0x0f);
});
