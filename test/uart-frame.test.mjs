/**
 * UART frame-protocol device tests — DFPlayer Mini and ZE08-CH2O.
 *
 * Golden tests: frames hand-computed from the datasheets, checksums
 * verified by independent calculation, both directions tested.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { registerUartFrame, dfBuildFrame, dfValidateFrame, dfChecksum,
         ze08BuildFrame } from '../src/devices/uart-frame.js';
import { createUartRx, buildUartFrame } from '../src/devices/uart-peer.js';
import { getDevice, unregisterDevice } from '../src/devices.js';

// ─── DFPlayer frame-level helpers ─────────────────────────────────
describe('DFPlayer frame helpers', () => {

  it('dfChecksum: hand-computed for PLAY TRACK 1', () => {
    // Frame: 7E FF 06 03 00 00 01 ?? ?? EF
    // Sum = 0xFF + 0x06 + 0x03 + 0x00 + 0x00 + 0x01 = 0x109
    // Neg = -0x109 & 0xFFFF = 0xFEF7
    const [h, l] = dfChecksum(0x03, 0x00, 0x00, 0x01);
    assert.equal(h, 0xfe, 'checksum high');
    assert.equal(l, 0xf7, 'checksum low');
  });

  it('dfBuildFrame produces 10 bytes with correct envelope', () => {
    const frame = dfBuildFrame(0x03, 0x00, 0x00, 0x01);
    assert.equal(frame.length, 10);
    assert.equal(frame[0], 0x7e, 'start byte');
    assert.equal(frame[1], 0xff, 'version');
    assert.equal(frame[2], 0x06, 'length');
    assert.equal(frame[3], 0x03, 'cmd = PLAY TRACK');
    assert.equal(frame[4], 0x00, 'feedback');
    assert.equal(frame[5], 0x00, 'par1');
    assert.equal(frame[6], 0x01, 'par2 = track 1');
    assert.equal(frame[9], 0xef, 'end byte');
  });

  it('dfValidateFrame accepts valid, rejects bad checksum', () => {
    const good = dfBuildFrame(0x06, 0x00, 0x00, 0x0f); // volume 15
    assert.ok(dfValidateFrame(good), 'valid frame accepted');
    assert.equal(dfValidateFrame(good).cmd, 0x06);

    const bad = [...good];
    bad[7] ^= 0x01; // corrupt checksum
    assert.equal(dfValidateFrame(bad), null, 'bad checksum rejected');

    const short = good.slice(0, 9);
    assert.equal(dfValidateFrame(short), null, 'short frame rejected');
  });

  it('dfChecksum: volume 30 — 7E FF 06 06 00 00 1E chk EF', () => {
    // Sum = 0xFF + 0x06 + 0x06 + 0x00 + 0x00 + 0x1E = 0x129
    // Neg = -0x129 & 0xFFFF = 0xFED7
    const [h, l] = dfChecksum(0x06, 0x00, 0x00, 0x1e);
    assert.equal(h, 0xfe);
    assert.equal(l, 0xd7);
  });
});

// ─── DFPlayer device model ────────────────────────────────────────
describe('DFPlayer Mini device model', () => {
  beforeEach(() => { try { unregisterDevice('dfplayer_mini'); } catch {} });

  function makeDfPlayer(params = {}) {
    registerUartFrame();
    const model = getDevice('dfplayer_mini');
    const part = { id: 'DF', kind: 'dfplayer_mini', params: { tracks: 5, ...params } };
    const state = model.init(part);
    const pins = { vcc: 5, gnd: 0, rx: 5, tx: 0, busy: 5 };
    const read = (t) => pins[t] ?? 0;
    let tNs = 1_000_000n; // start at 1ms

    // Send a frame by bit-banging the RX pin through edge timing
    const sendFrame = (frameBytes) => {
      const edges = buildUartFrame(frameBytes, tNs, 9600);
      for (const e of edges) {
        // Advance time in steps, feeding the decoder
        while (tNs < e.t) {
          tNs += 10_000n; // 10µs steps
          model.update(part, state, read, tNs);
        }
        pins.rx = e.level ? 5 : 0;
        model.update(part, state, read, tNs);
      }
      // Run a bit more to let the stop bit complete + processing
      tNs += 2_000_000n;
      model.update(part, state, read, tNs);
    };

    // Collect reply bytes from TX pin
    const collectReply = () => {
      const rx = createUartRx(9600);
      const bytes = [];
      // Run enough time for a 10-byte reply at 9600 baud (~10.4ms)
      const endNs = tNs + 15_000_000n;
      while (tNs < endNs) {
        tNs += 5_000n;
        model.update(part, state, read, tNs);
        const level = state.drives.tx.vTh > 2.5 ? 1 : 0;
        for (const b of rx.feed(level, tNs)) bytes.push(b);
      }
      return bytes;
    };

    return { model, part, state, pins, read, sendFrame, collectReply, getTNs: () => tNs };
  }

  it('PLAY TRACK 3: sets currentTrack and playing', () => {
    const df = makeDfPlayer();
    const frame = dfBuildFrame(0x03, 0x00, 0x00, 0x03);
    df.sendFrame(frame);
    assert.equal(df.state.currentTrack, 3);
    assert.equal(df.state.playing, true);
    assert.equal(df.state.commandLog.length, 1);
    assert.equal(df.state.commandLog[0].cmd, 0x03);
  });

  it('VOLUME sets volume 0-30', () => {
    const df = makeDfPlayer();
    df.sendFrame(dfBuildFrame(0x06, 0x00, 0x00, 0x1e)); // volume 30
    assert.equal(df.state.volume, 30);
    df.sendFrame(dfBuildFrame(0x06, 0x00, 0x00, 0x00)); // volume 0
    assert.equal(df.state.volume, 0);
  });

  it('NEXT/PREV cycle through tracks with wrap', () => {
    const df = makeDfPlayer({ tracks: 3 });
    df.sendFrame(dfBuildFrame(0x03, 0x00, 0x00, 0x01)); // play track 1
    assert.equal(df.state.currentTrack, 1);

    df.sendFrame(dfBuildFrame(0x01, 0x00, 0x00, 0x00)); // NEXT
    assert.equal(df.state.currentTrack, 2);

    df.sendFrame(dfBuildFrame(0x01, 0x00, 0x00, 0x00)); // NEXT
    assert.equal(df.state.currentTrack, 3);

    df.sendFrame(dfBuildFrame(0x01, 0x00, 0x00, 0x00)); // NEXT → wraps to 1
    assert.equal(df.state.currentTrack, 1);

    df.sendFrame(dfBuildFrame(0x02, 0x00, 0x00, 0x00)); // PREV → wraps to 3
    assert.equal(df.state.currentTrack, 3);
  });

  it('PAUSE/PLAY toggle playing state', () => {
    const df = makeDfPlayer();
    df.sendFrame(dfBuildFrame(0x03, 0x00, 0x00, 0x01)); // play track 1
    assert.equal(df.state.playing, true);
    df.sendFrame(dfBuildFrame(0x0e, 0x00, 0x00, 0x00)); // PAUSE
    assert.equal(df.state.playing, false);
    df.sendFrame(dfBuildFrame(0x0d, 0x00, 0x00, 0x00)); // PLAY (resume)
    assert.equal(df.state.playing, true);
  });

  it('BUSY pin is active-low when playing', () => {
    const df = makeDfPlayer();
    assert.ok(df.state.drives.busy.vTh > 2.5, 'not busy initially');
    df.sendFrame(dfBuildFrame(0x03, 0x00, 0x00, 0x01)); // play
    assert.equal(df.state.drives.busy.vTh, 0, 'busy (low) while playing');
    df.sendFrame(dfBuildFrame(0x0e, 0x00, 0x00, 0x00)); // pause
    assert.ok(df.state.drives.busy.vTh > 2.5, 'not busy after pause');
  });

  it('QUERY VOLUME replies with correct frame', () => {
    const df = makeDfPlayer();
    df.sendFrame(dfBuildFrame(0x06, 0x00, 0x00, 0x14)); // volume 20
    df.sendFrame(dfBuildFrame(0x43, 0x00, 0x00, 0x00)); // query volume
    const reply = df.collectReply();
    assert.ok(reply.length >= 10, `expected 10-byte reply, got ${reply.length}`);
    const parsed = dfValidateFrame(reply.slice(0, 10));
    assert.ok(parsed, 'reply has valid checksum');
    assert.equal(parsed.cmd, 0x43, 'reply cmd = QUERY VOLUME');
    assert.equal(parsed.par2, 20, 'volume = 20');
  });

  it('bad checksum frame is rejected and logged', () => {
    const df = makeDfPlayer();
    const frame = dfBuildFrame(0x03, 0x00, 0x00, 0x01);
    frame[7] ^= 0xff; // corrupt checksum
    df.sendFrame(frame);
    assert.equal(df.state.errors.length, 1, 'error logged');
    assert.equal(df.state.errors[0], 'checksum');
    assert.equal(df.state.currentTrack, 0, 'command was NOT executed');
  });

  it('RESET restores defaults, replies with init-complete if feedback', () => {
    const df = makeDfPlayer();
    df.sendFrame(dfBuildFrame(0x03, 0x00, 0x00, 0x02)); // play track 2
    df.sendFrame(dfBuildFrame(0x06, 0x00, 0x00, 0x1e)); // volume 30
    df.sendFrame(dfBuildFrame(0x0c, 0x01, 0x00, 0x00)); // RESET with feedback
    assert.equal(df.state.currentTrack, 0);
    assert.equal(df.state.volume, 15);
    assert.equal(df.state.playing, false);
    const reply = df.collectReply();
    assert.ok(reply.length >= 10, 'reset reply received');
    const parsed = dfValidateFrame(reply.slice(0, 10));
    assert.ok(parsed, 'reply valid');
    assert.equal(parsed.cmd, 0x41, 'init complete');
    assert.equal(parsed.par2, 0x02, 'source = SD');
  });
});

// ─── ZE08-CH2O ────────────────────────────────────────────────────
describe('ZE08-CH2O formaldehyde sensor', () => {
  beforeEach(() => { try { unregisterDevice('ze08_ch2o'); } catch {} });

  it('ze08BuildFrame: 50 ppb → hand-computed checksum', () => {
    // 50 ppb: DFH=0, DFL=0x32, THICKH=0, THICKL=0x32
    // Sum = 0x17 + 0x04 + 0 + 0x32 + 0 + 0x32 = 0x7F
    // Chk = -0x7F & 0xFF = 0x81
    const frame = ze08BuildFrame(50);
    assert.equal(frame.length, 9);
    assert.equal(frame[0], 0xff, 'start');
    assert.equal(frame[1], 0x17, 'gas');
    assert.equal(frame[2], 0x04, 'unit');
    assert.equal(frame[3], 0x00, 'DFH');
    assert.equal(frame[4], 0x32, 'DFL = 50');
    assert.equal(frame[7], 0x81, 'checksum');
  });

  it('ze08BuildFrame: 0 ppb checksum', () => {
    // Sum = 0x17 + 0x04 = 0x1B
    // Chk = -0x1B & 0xFF = 0xE5
    const frame = ze08BuildFrame(0);
    assert.equal(frame[3], 0x00);
    assert.equal(frame[4], 0x00);
    assert.equal(frame[7], 0xe5);
  });

  it('ze08BuildFrame: 1000 ppb = 0x03E8', () => {
    const frame = ze08BuildFrame(1000);
    assert.equal(frame[3], 0x03, 'DFH');
    assert.equal(frame[4], 0xe8, 'DFL');
    // Sum = 0x17 + 0x04 + 0x03 + 0xe8 + 0x03 + 0xe8 = 0x1F1
    // Chk = -0x1F1 & 0xFF = 0x0F
    assert.equal(frame[7], 0x0f, 'checksum');
  });

  it('device emits periodic frames on TX at ~1 Hz', () => {
    registerUartFrame();
    const model = getDevice('ze08_ch2o');
    const part = { id: 'ZE', kind: 'ze08_ch2o', params: { ch2o_ppb: 100 } };
    const state = model.init(part);
    const pins = { vcc: 5, gnd: 0, tx: 5, rx: 5 };
    const read = (t) => pins[t] ?? 0;

    // Collect bytes from TX over 2.5 seconds (should get ~2 frames)
    const rx = createUartRx(9600);
    const bytes = [];
    let tNs = 0n;
    const endNs = 2_500_000_000n;
    while (tNs < endNs) {
      tNs += 10_000n; // 10µs steps
      model.update(part, state, read, tNs);
      const level = state.drives.tx.vTh > 2.5 ? 1 : 0;
      for (const b of rx.feed(level, tNs)) bytes.push(b);
    }

    // Should have at least 2 × 9 = 18 bytes
    assert.ok(bytes.length >= 18, `expected ≥18 bytes from 2 frames, got ${bytes.length}`);

    // Validate first frame
    const f = bytes.slice(0, 9);
    assert.equal(f[0], 0xff, 'start byte');
    assert.equal(f[1], 0x17, 'gas type');
    assert.equal(f[2], 0x04, 'unit');
    // 100 ppb = 0x0064
    assert.equal(f[3], 0x00, 'DFH');
    assert.equal(f[4], 0x64, 'DFL = 100');
    // Checksum: sum = 0x17+0x04+0+0x64+0+0x64 = 0xE3, chk = -0xE3 & 0xFF = 0x1D
    assert.equal(f[7], 0x1d, 'checksum');
  });
});
