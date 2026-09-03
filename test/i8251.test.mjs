// The 8251 USART. The cases that matter are all consequences of the control
// port being a SEQUENCE rather than a register: the first control write is a
// mode word, the rest are commands, and an internal-reset command rewinds the
// chip to expecting a mode word again.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { I8251 } from '../src/i8251.js';

// Async, 8N1, 16x: mode word 0x4E (bits: stop=01→1 stop, parity off,
// len=11→8 bits, baud=10→16x).
const MODE_8N1 = 0x4e;
// Command: TxEN | RxEN | RTS | DTR = 0x27.
const CMD_ON = 0x27;

function configured(hooks) {
    const u = new I8251(hooks);
    u.write(1, MODE_8N1);   // mode
    u.write(1, CMD_ON);     // command
    return u;
}

test('the first control write is the mode word, the second is a command', () => {
    const u = new I8251();
    u.write(1, MODE_8N1);
    assert.equal(u.mode, MODE_8N1);
    assert.equal(u.command, 0, 'no command yet');
    u.write(1, CMD_ON);
    assert.equal(u.command, CMD_ON);
    assert.equal(u.txEnabled, true);
    assert.equal(u.rxEnabled, true);
});

test('transmit reaches the hook only when TxEN is set', () => {
    const out = [];
    const u = new I8251({ onTx: (b) => out.push(b) });
    u.write(1, MODE_8N1);
    // No command yet → TxEN clear → data write is dropped.
    u.write(0, 0x41);
    assert.deepEqual(out, [], 'a byte written before TxEN vanishes, as on the bench');
    u.write(1, CMD_ON);
    u.write(0, 0x42);
    u.write(0, 0x43);
    assert.deepEqual(out, [0x42, 0x43]);
});

test('TxRDY and TxEMPTY read set once the transmitter is enabled', () => {
    const u = configured();
    const s = u.read(1);
    assert.ok(s & 0x01, 'TxRDY');
    assert.ok(s & 0x04, 'TxEMPTY');
});

test('a received byte raises RxRDY and reads back from the data port', () => {
    const u = configured();
    assert.equal(u.read(1) & 0x02, 0, 'RxRDY clear before any byte');
    u.rxPush(0x55);
    assert.equal(u.read(1) & 0x02, 0x02, 'RxRDY set');
    assert.equal(u.read(0), 0x55);
    assert.equal(u.read(1) & 0x02, 0, 'RxRDY clears after the read');
});

test('a second byte before the first is read sets the overrun bit', () => {
    const u = configured();
    u.rxPush(0x11);
    u.rxPush(0x22);
    assert.equal(u.read(1) & 0x10, 0x10, 'OE set');
    assert.equal(u.read(0), 0x11, 'first byte still delivered first');
    // Error reset clears OE.
    u.write(1, CMD_ON | 0x10);
    assert.equal(u.read(1) & 0x10, 0, 'error reset cleared OE');
});

test('RxRDY drives the interrupt line when the receiver is enabled', () => {
    const edges = [];
    const u = configured({ onIrqChange: (a) => edges.push(a) });
    u.rxPush(0x99);
    assert.equal(u.irqAsserted, true);
    assert.ok(edges.includes(true));
    u.read(0);   // consume the byte
    assert.equal(u.irqAsserted, false);
});

test('internal reset rewinds the sequence: the next control write is a mode word', () => {
    const u = configured();
    assert.equal(u.txEnabled, true);
    // Command with IR (bit 6) set.
    u.write(1, 0x40);
    assert.equal(u.txEnabled, false, 'internal reset cleared the command');
    // Now a control write is interpreted as a mode word again.
    u.write(1, MODE_8N1);
    assert.equal(u.mode, MODE_8N1);
    u.write(1, CMD_ON);
    assert.equal(u.txEnabled, true, 're-enabled after the fresh sequence');
});

test('sync mode is accepted, consumes its sync chars, and warns', () => {
    const u = new I8251();
    // Mode word with baud bits = 00 → sync. Bit7=0 → double sync char.
    u.write(1, 0x00);
    assert.ok(u.modeWarning, 'a sync mode word warns');
    assert.match(u.modeWarning, /async/);
    // Two sync-character writes follow before commands.
    u.write(1, 0x16);   // sync char 1
    u.write(1, 0x16);   // sync char 2
    // Now a command word takes effect.
    u.write(1, CMD_ON);
    assert.equal(u.txEnabled, true, 'the sequence stayed aligned through sync chars');
});

test('single sync char (mode bit7 set) consumes exactly one', () => {
    const u = new I8251();
    u.write(1, 0x80);   // sync mode, single sync char
    u.write(1, 0x16);   // the one sync char
    u.write(1, CMD_ON); // command
    assert.equal(u.txEnabled, true);
});

test('the canonical init dance (mode, soft-reset, mode, enable) leaves it ready', () => {
    // The sequence real 8251 code uses to force a known state, taken from
    // SIrfanH's MIT 8086/8251 demo: a dummy mode word, a soft-reset command
    // (0x40, the internal-reset bit), then the real mode word and the enable
    // command. A model that does not rewind on 0x40 reads the real mode word
    // as a command and desynchronises here.
    const out = [];
    const u = new I8251({ onTx: (b) => out.push(b) });
    u.write(1, 0x4d);   // dummy mode (async, 8N1, 1x)
    u.write(1, 0x40);   // soft reset -> expect a mode word next
    u.write(1, 0x4d);   // the real mode word
    u.write(1, 0x15);   // command: TxEN | RxEN | error-reset (00010101b)
    assert.equal(u.txEnabled, true);
    assert.equal(u.rxEnabled, true);
    u.write(0, 0x53);   // 'S'
    assert.deepEqual(out, [0x53], 'transmits after the dance');
});

test('state round-trips mid-sequence', () => {
    const u = configured();
    u.rxPush(0x77);
    const snap = u.saveState();
    const v = new I8251();
    v.loadState(snap);
    assert.equal(v.command, CMD_ON);
    assert.equal(v.read(0), 0x77);
    // And it keeps transmitting.
    const out = [];
    v.hooks.onTx = (b) => out.push(b);
    v.write(0, 0x41);
    assert.deepEqual(out, [0x41]);
});

test('reset clears everything back to expecting a mode word', () => {
    const u = configured();
    u.rxPush(0x33);
    u.reset();
    assert.equal(u.command, 0);
    assert.equal(u.rxRdy, false);
    // First control write after reset is a mode word.
    u.write(1, MODE_8N1);
    assert.equal(u.mode, MODE_8N1);
});
