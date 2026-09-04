/**
 * The Sound Blaster DSP (E6.8.11 step 4) — the digital half of audio, and the
 * half that needed no licence decision because its hard part was already
 * built: 8237 DMA and an 8259 IRQ, both of which already move real bytes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SBDSP } from '../src/sb-dsp.js';
import { freqFromCrossings } from './audio-analysis.mjs';

const B = 0x220;
const at = (port) => port - B;

/** A DSP fed from a byte array over a fake DMA wire. */
function withData(bytes, opts = {}) {
    const dsp = new SBDSP({ clockHz: 4_772_727, ...opts });
    let i = 0;
    const irqs = [];
    dsp.hooks.onDmaRequest = () => (i < bytes.length ? bytes[i++] : false);
    dsp.hooks.onIrq = () => irqs.push(true);
    return { dsp, irqs, taken: () => i };
}

test('the reset handshake answers AAh, and only on the falling edge', () => {
    const { dsp } = withData([]);
    dsp.write(at(0x226), 1);
    assert.equal(dsp.read(at(0x22a)), 0xff, 'nothing yet — 1 alone is not a reset');
    dsp.write(at(0x226), 0);
    assert.equal(dsp.read(at(0x22a)), 0xaa, 'the card identifies itself');

    // Writing 1 twice is still ONE reset, which is what a driver that
    // double-taps the register actually gets on hardware.
    dsp.write(at(0x226), 1);
    dsp.write(at(0x226), 1);
    dsp.write(at(0x226), 0);
    assert.equal(dsp.read(at(0x22a)), 0xaa);
    assert.equal(dsp.read(at(0x22a)), 0xff, 'and exactly one byte came back');
});

test('the time constant is a rate, and 256-tc is the trap', () => {
    const { dsp } = withData([]);
    const setTC = (tc) => { dsp.write(at(0x22c), 0x40); dsp.write(at(0x22c), tc); };
    setTC(165);                                        // the canonical 11 kHz
    assert.equal(dsp.sampleRate, Math.round(1_000_000 / 91));
    setTC(0);
    assert.equal(dsp.sampleRate, Math.round(1_000_000 / 256), 'tc 0 is the SLOWEST rate, not "unset"');
    setTC(255);
    assert.equal(dsp.sampleRate, 1_000_000, 'and 255 is the fastest — never a divide by zero');
});

test('a single-cycle block transfers LENGTH+1 bytes and raises one IRQ', () => {
    const data = new Array(64).fill(0x80);
    const { dsp, irqs, taken } = withData(data);
    dsp.write(at(0x22c), 0x40); dsp.write(at(0x22c), 233);   // ~43 kHz, so it moves fast
    dsp.write(at(0x22c), 0xd1);                              // speaker on
    dsp.write(at(0x22c), 0x14); dsp.write(at(0x22c), 0x0f); dsp.write(at(0x22c), 0x00);  // len-1 = 15

    for (let i = 0; i < 20; i++) dsp.advance(4_772_727 / 1000);   // 20 ms, plenty
    assert.equal(taken(), 16, 'the register holds LENGTH-1, so 0Fh moves sixteen bytes');
    assert.equal(irqs.length, 1, 'exactly one interrupt, at the end of the block');
    assert.equal(dsp.running, false, 'and single-cycle stops');
});

test('reading the status port acknowledges the interrupt', () => {
    const { dsp } = withData(new Array(8).fill(0x80));
    dsp.write(at(0x22c), 0x40); dsp.write(at(0x22c), 233);
    dsp.write(at(0x22c), 0x14); dsp.write(at(0x22c), 3); dsp.write(at(0x22c), 0);
    for (let i = 0; i < 10; i++) dsp.advance(4_772_727 / 1000);
    assert.equal(dsp.irq, true, 'raised');
    dsp.read(at(0x22e));
    assert.equal(dsp.irq, false,
        'a driver ISR reads 22Eh and nothing else — a DSP that ignored it would '
        + 're-raise on the next block and the machine would live in its handler');
});

test('auto-init reloads and keeps going; DAh leaves it', () => {
    const { dsp, irqs, taken } = withData(new Array(256).fill(0x80));
    dsp.write(at(0x22c), 0x40); dsp.write(at(0x22c), 233);
    dsp.write(at(0x22c), 0x48); dsp.write(at(0x22c), 3); dsp.write(at(0x22c), 0);   // block = 4
    dsp.write(at(0x22c), 0x1c);                                                     // auto-init
    for (let i = 0; i < 5; i++) dsp.advance(4_772_727 / 1000);
    assert.ok(irqs.length >= 3, `auto-init raises per block, got ${irqs.length}`);
    assert.equal(dsp.running, true, 'and it keeps running');
    const before = taken();
    dsp.write(at(0x22c), 0xda);
    dsp.advance(4_772_727 / 100);
    assert.equal(taken(), before, 'DAh stops it dead');
});

test('pause and continue stop and resume the transfer', () => {
    const { dsp, taken } = withData(new Array(256).fill(0x80));
    dsp.write(at(0x22c), 0x40); dsp.write(at(0x22c), 233);
    dsp.write(at(0x22c), 0x14); dsp.write(at(0x22c), 0xff); dsp.write(at(0x22c), 0);
    dsp.advance(4_772_727 / 1000);
    const moved = taken();
    assert.ok(moved > 0);
    dsp.write(at(0x22c), 0xd0);                        // pause
    dsp.advance(4_772_727 / 100);
    assert.equal(taken(), moved, 'paused means paused');
    dsp.write(at(0x22c), 0xd4);                        // continue
    dsp.advance(4_772_727 / 1000);
    assert.ok(taken() > moved, 'and it picks up again');
});

test('THE DSP HAS NO TONE, and that is the honest answer', () => {
    // A PCM device has a sample RATE, not a pitch. An empty array means NO
    // VOICES -- distinct from [{on:false}], a voice that is silent -- which
    // is the distinction the arity rule exists to make, and this is the first
    // producer that needs it.
    const { dsp } = withData([]);
    assert.deepEqual(dsp.audioTone(), []);
    assert.equal(Array.isArray(dsp.audioTone()), true);
});

test('a square wave through the DSP comes out at the frequency it was written at', () => {
    // 8 kHz sample rate, alternating every 8 samples => a 500 Hz square.
    const RATE_TC = 131;                               // 1e6/(256-131) = 8000 Hz
    const data = [];
    for (let i = 0; i < 8000; i++) data.push(((i >> 3) & 1) ? 0xff : 0x00);
    const { dsp } = withData(data);
    dsp.write(at(0x22c), 0x40); dsp.write(at(0x22c), RATE_TC);
    dsp.write(at(0x22c), 0xd1);                        // speaker ON
    dsp.prepareAudio(48000);
    dsp.write(at(0x22c), 0x14); dsp.write(at(0x22c), 0xff); dsp.write(at(0x22c), 0x07);  // 2048 bytes

    const out = [];
    const tmp = new Float32Array(2048);
    for (let ms = 0; ms < 300; ms++) {
        dsp.advance(4_772_727 / 1000);
        const n = dsp.renderAudio(tmp, 2048);
        if (n) out.push(Float32Array.from(tmp.subarray(0, n)));
    }
    const total = out.reduce((a, c) => a + c.length, 0);
    const all = new Float32Array(total);
    let o = 0; for (const c of out) { all.set(c, o); o += c.length; }
    assert.ok(total > 4000, `expected real audio, got ${total} frames`);
    const measured = freqFromCrossings(all, 48000);
    assert.ok(Math.abs(measured - 500) / 500 < 0.05,
        `8 kHz PCM alternating every 8 samples is 500 Hz; measured ${measured.toFixed(1)}`);
});

test('the speaker gate is real, and an unknown command is COUNTED not swallowed', () => {
    const data = new Array(64).fill(0xff);
    const { dsp } = withData(data);
    dsp.write(at(0x22c), 0x40); dsp.write(at(0x22c), 233);
    dsp.prepareAudio(48000);
    // Speaker OFF: the transfer still runs (as on hardware) and is silent.
    dsp.write(at(0x22c), 0x14); dsp.write(at(0x22c), 0x1f); dsp.write(at(0x22c), 0);
    for (let i = 0; i < 5; i++) dsp.advance(4_772_727 / 1000);
    const buf = new Float32Array(512);
    const n = dsp.renderAudio(buf, 512);
    assert.ok(n > 0, 'bytes moved');
    assert.ok(buf.subarray(0, n).every((v) => v === 0),
        'a driver that forgets D1h hears nothing here, exactly as on hardware');

    // An SB16 command on a 2.0 card is a name in a report, not silence.
    dsp.write(at(0x22c), 0xb6);
    assert.ok(dsp.unsupported && dsp.unsupported.has(0xb6), 'the refusal is recorded');
});

// ---------------------------------------------------------------------------
// End to end on a real machine: the DSP pulls through the SAME 8237 the floppy
// uses, and raises a real 8259 line.
// ---------------------------------------------------------------------------
import { I8086Machine } from '../src/i8086-machine.js';

test('the DSP moves bytes through the real 8237 and interrupts the real 8259', () => {
    const m = new I8086Machine({
        clockHz: 4_772_727,
        regions: [{ kind: 'ram', start: 0, end: 0xfffff }],
        chips: [
            { kind: 'dma', name: 'dma', at: 0x00 },
            { kind: 'dmapage', name: 'page', at: 0x80, dma: 'dma' },
            { kind: 'pic', name: 'pic', at: 0x20 },
            { kind: 'sb', name: 'sb', at: 0x220, dma: 'dma', dmaChannel: 1, irq: 7 },
        ],
    });
    const sb = m.chips.sb;
    assert.ok(typeof sb.hooks.onDmaRequest === 'function', 'the DMA wire is bridged');
    assert.ok(typeof sb.hooks.onIrq === 'function', 'and so is the interrupt line');

    // A square wave in memory at 1000h, 8 kHz, alternating every 8 samples.
    const BASE = 0x1000;
    for (let i = 0; i < 2048; i++) m.mem[BASE + i] = ((i >> 3) & 1) ? 0xff : 0x00;

    // Program channel 1 the way a driver would: mask, mode, address, count.
    const out = (p, v) => m._out(p, v);
    out(0x0a, 0x05);                                   // mask channel 1
    out(0x0c, 0x00);                                   // clear the flip-flop
    out(0x0b, 0x49);                                   // mode: single, read, ch 1
    out(0x02, BASE & 0xff); out(0x02, (BASE >> 8) & 0xff);
    out(0x83, 0x00);                                   // page latch: A16-A19
    out(0x03, 0xff); out(0x03, 0x07);                  // count = 2048-1
    out(0x0a, 0x01);                                   // unmask channel 1

    const cmd = (v) => out(0x22c, v);
    cmd(0x40); cmd(131);                               // 8 kHz
    cmd(0xd1);                                         // speaker on
    m.audio;                                           // attaching the bus arms the DSP
    cmd(0x14); cmd(0xff); cmd(0x07);                   // single-cycle, 2048 bytes

    // Run the machine's clock forward. The DSP pulls one byte per sample
    // period through the 8237, exactly as the FDC pulls one per byte.
    const chunks = [];
    const tmp = new Float32Array(4096);
    for (let ms = 0; ms < 300; ms++) {
        sb.advance(4_772_727 / 1000);
        const n = sb.renderAudio(tmp, 4096);
        if (n) chunks.push(Float32Array.from(tmp.subarray(0, n)));
    }
    const total = chunks.reduce((a, c) => a + c.length, 0);
    const all = new Float32Array(total);
    let o = 0; for (const c of chunks) { all.set(c, o); o += c.length; }
    assert.ok(total > 4000, `expected real audio through the machine, got ${total}`);

    const measured = freqFromCrossings(all, 48000);
    assert.ok(Math.abs(measured - 500) / 500 < 0.05,
        `the bytes really came from RAM via the 8237: expected 500 Hz, measured ${measured.toFixed(1)}`);
    assert.equal(m.chips.pic.intActive, true, 'and the end of the block raised IRQ 7');
});

test('a machine with a DSP advertises samples but no extra tone', () => {
    const m = new I8086Machine({
        clockHz: 4_772_727,
        regions: [{ kind: 'ram', start: 0, end: 0xfffff }],
        chips: [{ kind: 'sb', name: 'sb', at: 0x220 }],
    });
    assert.equal(m.canRenderAudio(), true, 'the DSP can render samples');
    // No speaker on this machine and a DSP with no pitch: no voices at all.
    // That is the empty array meaning something, which is why the arity is
    // part of the contract.
    assert.deepEqual(m.audioTone(), []);
});
