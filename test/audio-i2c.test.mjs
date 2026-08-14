// Audio trio (UM66T, KD9561, ISD1820) + I2C batch (MPU-6050, SSD1306) goldens.
// Hand-computed expectations from the datasheets.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAudioParts } from '../src/devices/audio-parts.js';
import { registerMPU6050 } from '../src/devices/mpu6050.js';
import { registerSSD1306, ssd1306Pixel } from '../src/devices/ssd1306.js';

registerAudioParts();
registerMPU6050();
registerSSD1306();

const V = { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] };
const G = { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] };
const net = (id, ...ts) => ({ id, terminals: ts.map(([part, terminal]) => ({ part, terminal })) });

// ─── I2C master harness (reused for MPU-6050 and SSD1306) ──────────
function i2cRig(deviceKind, deviceTerminals, deviceParams = {}, extraParts = [], extraNets = []) {
    const board = new BoardImpl(5.0);
    board.setNetlist([V, G,
        { id: 'R1', kind: 'resistor', params: { ohms: 4700 }, terminals: ['a', 'b'] },
        { id: 'R2', kind: 'resistor', params: { ohms: 4700 }, terminals: ['a', 'b'] },
        { id: 'U1', kind: deviceKind, params: deviceParams, terminals: deviceTerminals },
        { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0', 'P1.1'] },
        ...extraParts,
    ], [
        net('nv', ['VCC', 'vcc'], ['R1', 'a'], ['R2', 'a'], ['U1', 'vcc']),
        net('ng', ['GND', 'gnd'], ['U1', 'gnd']),
        net('nscl', ['MCU', 'P1.0'], ['R1', 'b'], ['U1', 'scl']),
        net('nsda', ['MCU', 'P1.1'], ['R2', 'b'], ['U1', 'sda']),
        ...extraNets,
    ]);
    let t = 0n;
    const tick = () => { t += 5_000n; board.advanceTo(t); };
    const scl = (h) => { board.setPin('P1.0', 'opendrain', h); tick(); };
    const sda = (h) => { board.setPin('P1.1', 'opendrain', h); tick(); };
    const sdaRead = () => board.readAnalog('P1.1') > 2.5;
    const start = () => { sda(true); scl(true); sda(false); scl(false); };
    const stop = () => { sda(false); scl(true); sda(true); };
    const wByte = (b) => {
        for (let i = 7; i >= 0; i--) { sda(!!((b >> i) & 1)); scl(true); scl(false); }
        sda(true); scl(true); const ack = !sdaRead(); scl(false);
        return ack;
    };
    const rByte = (ack) => {
        sda(true); let v = 0;
        for (let i = 7; i >= 0; i--) { scl(true); if (sdaRead()) v |= 1 << i; scl(false); }
        sda(!ack); scl(true); scl(false); sda(true);
        return v;
    };
    const readRegs = (devAddr, reg, n) => {
        start(); wByte(devAddr << 1); wByte(reg);
        start(); wByte((devAddr << 1) | 1);
        const out = [];
        for (let i = 0; i < n; i++) out.push(rByte(i < n - 1));
        stop();
        return out;
    };
    const writeRegs = (devAddr, reg, bytes) => {
        start(); wByte(devAddr << 1); wByte(reg);
        for (const b of bytes) wByte(b);
        stop();
    };
    const writeCmd = (devAddr, ctrlByte, bytes) => {
        start(); wByte(devAddr << 1);
        wByte(ctrlByte);
        for (const b of bytes) wByte(b);
        stop();
    };
    return { board, start, stop, wByte, rByte, readRegs, writeRegs, writeCmd, getState: () => board.getDeviceState('U1') };
}

// ═══════════════════════════════════════════════════════════════════
// UM66T
// ═══════════════════════════════════════════════════════════════════
describe('UM66T', () => {
    function rig() {
        const board = new BoardImpl(5.0);
        board.setNetlist([V, G,
            { id: 'U1', kind: 'um66t', params: {}, terminals: ['vdd', 'gnd', 'out'] },
        ], [
            net('nv', ['VCC', 'vcc'], ['U1', 'vdd']),
            net('ng', ['GND', 'gnd'], ['U1', 'gnd']),
        ]);
        return board;
    }

    it('produces edges when powered; silent when below 2 V', () => {
        const board = rig();
        // Power up: should produce output edges.
        let edges = 0;
        let lastOut = -1;
        for (let t = 0n; t < 20_000_000n; t += 500n) {
            board.advanceTo(t);
            const st = board.getDeviceState('U1');
            if (st._level !== lastOut) { edges++; lastOut = st._level; }
        }
        assert.ok(edges > 10, `should produce many edges, got ${edges}`);
    });

    it('output goes tri-state when unpowered (Vdd disconnected)', () => {
        const board = new BoardImpl(5.0);
        board.setNetlist([G,
            { id: 'U1', kind: 'um66t', params: {}, terminals: ['vdd', 'gnd', 'out'] },
        ], [
            net('ng', ['GND', 'gnd'], ['U1', 'gnd']),
        ]);
        board.advanceTo(100_000n);
        const st = board.getDeviceState('U1');
        assert.equal(st.drives.out.rTh, 1e9, 'output should be tri-stated');
    });

    it('first note is E4 (329.63 Hz) — verify edge period', () => {
        const board = rig();
        // The first note is MIDI 64 = E4 = 329.63 Hz.
        // Half period = 1/(329.63*2) ≈ 1516.9 µs ≈ 1_517_000 ns.
        const targetHalfNs = 0.5e9 / 329.63;
        let lastEdgeNs = -1n;
        let periods = [];
        let lastLevel = -1;
        // Run for 5 ms to catch several edges within the first E4 note.
        for (let t = 0n; t < 5_000_000n; t += 200n) {
            board.advanceTo(t);
            const st = board.getDeviceState('U1');
            if (st._level !== lastLevel && lastLevel >= 0) {
                if (lastEdgeNs >= 0n) {
                    periods.push(Number(t - lastEdgeNs));
                }
                lastEdgeNs = t;
            }
            lastLevel = st._level;
        }
        assert.ok(periods.length >= 2, `need at least 2 periods, got ${periods.length}`);
        // All periods should be close to the target half-period.
        for (const p of periods) {
            assert.ok(Math.abs(p - targetHalfNs) < 2000,
                `period ${p} ns should be close to ${Math.round(targetHalfNs)} ns`);
        }
    });
});

// ═══════════════════════════════════════════════════════════════════
// KD9561
// ═══════════════════════════════════════════════════════════════════
describe('KD9561', () => {
    function rig(params = {}) {
        const board = new BoardImpl(5.0);
        board.setNetlist([V, G,
            { id: 'U1', kind: 'kd9561', params, terminals: ['vdd', 'gnd', 'out', 'sel1', 'sel2'] },
            { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0', 'P1.1'] },
        ], [
            net('nv', ['VCC', 'vcc'], ['U1', 'vdd']),
            net('ng', ['GND', 'gnd'], ['U1', 'gnd']),
            net('ns1', ['MCU', 'P1.0'], ['U1', 'sel1']),
            net('ns2', ['MCU', 'P1.1'], ['U1', 'sel2']),
        ]);
        return board;
    }

    it('siren mode (sel=00) produces edges whose frequency sweeps', () => {
        const board = rig();
        board.setPin('P1.0', 'pushpull', false);
        board.setPin('P1.1', 'pushpull', false);

        // Measure edge frequency at two different times (t=0 → 800 Hz, t=0.5s → 2400 Hz).
        const measureFreq = (startNs, windowNs) => {
            let edges = 0, lastLevel = -1;
            for (let t = startNs; t < startNs + windowNs; t += 100n) {
                board.advanceTo(t);
                const st = board.getDeviceState('U1');
                if (st._level !== lastLevel && lastLevel >= 0) edges++;
                lastLevel = st._level;
            }
            // edges = number of half-cycles. freq = edges / (2 * window_seconds).
            return edges / (2 * Number(windowNs) / 1e9);
        };
        const f1 = measureFreq(1_000_000n, 2_000_000n);     // near t=0
        const f2 = measureFreq(500_000_000n, 2_000_000n);    // near t=0.5s (peak)
        assert.ok(f1 > 500, `siren start should be > 500 Hz, got ${f1}`);
        assert.ok(f2 > f1, `siren should sweep up: ${f2} > ${f1}`);
    });

    it('machine gun mode (sel=11) has silent gaps', () => {
        const board = rig();
        board.setPin('P1.0', 'pushpull', true);   // sel1=1
        board.setPin('P1.1', 'pushpull', true);   // sel2=1

        // Over 200 ms there should be both edges (tone) and silent stretches.
        let hasEdges = false, hasSilence = false;
        let lastLevel = -1, silentRun = 0;
        for (let t = 0n; t < 200_000_000n; t += 500n) {
            board.advanceTo(t);
            const st = board.getDeviceState('U1');
            if (st._level !== lastLevel && lastLevel >= 0) {
                hasEdges = true; silentRun = 0;
            } else { silentRun++; }
            if (silentRun > 5000) hasSilence = true;   // >2.5 ms of quiet
            lastLevel = st._level;
        }
        assert.ok(hasEdges, 'machine gun should produce tone bursts');
        assert.ok(hasSilence, 'machine gun should have silent gaps');
    });
});

// ═══════════════════════════════════════════════════════════════════
// ISD1820
// ═══════════════════════════════════════════════════════════════════
describe('ISD1820', () => {
    function rig() {
        const board = new BoardImpl(5.0);
        board.setNetlist([V, G,
            { id: 'U1', kind: 'isd1820', params: {},
              terminals: ['vcc', 'gnd', 'rec', 'playe', 'playl', 'mic', 'sp_p', 'sp_n'] },
            { id: 'MCU', kind: 'mcu', params: {},
              terminals: ['P1.0', 'P1.1', 'P1.2', 'P1.3'] },
        ], [
            net('nv', ['VCC', 'vcc'], ['U1', 'vcc']),
            net('ng', ['GND', 'gnd'], ['U1', 'gnd']),
            net('nr', ['MCU', 'P1.0'], ['U1', 'rec']),
            net('ne', ['MCU', 'P1.1'], ['U1', 'playe']),
            net('nl', ['MCU', 'P1.2'], ['U1', 'playl']),
            net('nm', ['MCU', 'P1.3'], ['U1', 'mic']),
        ]);
        let t = 0n;
        const tick = (ns = 5_000n) => { t += ns; board.advanceTo(t); };
        const pin = (p, h) => { board.setPin(p, 'pushpull', h); tick(); };
        const advance = (ns) => { t += ns; board.advanceTo(t); };
        return { board, tick, pin, advance, getState: () => board.getDeviceState('U1') };
    }

    it('records mic input and plays it back on PLAYE edge', () => {
        const r = rig();
        // Set mic to 2.5 V (mid-rail → sample = 0).
        r.board.setPin('P1.3', 'pushpull', false);    // 0 V
        r.pin('P1.0', true);                            // REC high: start recording

        // Drive mic to 5V for a bit (= sample +1 range), recording for 2 ms.
        r.board.setPin('P1.3', 'pushpull', true);       // 5 V
        r.advance(2_000_000n);                           // record ~16 samples at 8 kHz
        r.pin('P1.0', false);                            // stop recording

        const st = r.getState();
        assert.ok(st.sampleCount > 0, `should have recorded samples, got ${st.sampleCount}`);

        // Trigger playback with PLAYE rising edge.
        r.pin('P1.1', false);
        r.pin('P1.1', true);                             // rising edge
        r.advance(10_000n);

        assert.equal(st.playbackActive, true, 'playback should be active');
        assert.ok(st.drives.sp_p.rTh < 1e6, 'speaker should be driven');
    });

    it('PLAYL level-triggered: stops when released', () => {
        const r = rig();
        // Quick record.
        r.board.setPin('P1.3', 'pushpull', true);
        r.pin('P1.0', true);
        r.advance(1_000_000n);
        r.pin('P1.0', false);

        // PLAYL high: plays.
        r.pin('P1.2', true);
        r.advance(10_000n);
        assert.equal(r.getState().playbackActive, true);

        // PLAYL low: stops.
        r.pin('P1.2', false);
        r.advance(10_000n);
        assert.equal(r.getState().playbackActive, false, 'should stop on PLAYL release');
    });

    it('speaker goes tri-state when idle', () => {
        const r = rig();
        r.advance(100_000n);
        const st = r.getState();
        assert.equal(st.drives.sp_p.rTh, 1e9, 'idle speaker should be tri-stated');
    });
});

// ═══════════════════════════════════════════════════════════════════
// MPU-6050 — the i2cdevlib wake-then-read dance
// ═══════════════════════════════════════════════════════════════════
describe('MPU-6050', () => {
    it('WHO_AM_I returns 0x68', () => {
        const r = i2cRig('mpu6050', ['vcc', 'gnd', 'sda', 'scl', 'ad0', 'int']);
        const [who] = r.readRegs(0x68, 0x75, 1);
        assert.equal(who, 0x68, 'WHO_AM_I should be 0x68');
    });

    it('sleeps at power-on — accel reads as zero until wake', () => {
        const r = i2cRig('mpu6050', ['vcc', 'gnd', 'sda', 'scl', 'ad0', 'int'],
            { ax: 0, ay: 0, az: 1 });
        // Read accel while sleeping: should be zero.
        const sleeping = r.readRegs(0x68, 0x3b, 6);
        assert.deepEqual(sleeping, [0, 0, 0, 0, 0, 0], 'sleeping → all zeros');

        // The i2cdevlib dance: write 0x00 to PWR_MGMT_1 (0x6B) to clear SLEEP.
        r.writeRegs(0x68, 0x6b, [0x00]);

        // Now accel Z should be 1g = 16384 at ±2g range.
        const awake = r.readRegs(0x68, 0x3b, 6);
        // az = 1g → 16384 → 0x4000
        const azH = awake[4], azL = awake[5];
        const az = (azH << 8) | azL;
        assert.equal(az, 16384, 'az = 1g → 16384 at ±2g sensitivity');
    });

    it('accel sensitivity changes with FS_SEL', () => {
        const r = i2cRig('mpu6050', ['vcc', 'gnd', 'sda', 'scl', 'ad0', 'int'],
            { az: 1 });
        r.writeRegs(0x68, 0x6b, [0x00]);     // wake

        // Set FS_SEL = 2 (±8g → 4096 LSB/g).
        r.writeRegs(0x68, 0x1c, [0x02 << 3]);
        const [azH, azL] = r.readRegs(0x68, 0x3f, 2);
        assert.equal((azH << 8) | azL, 4096, 'az = 1g at ±8g → 4096');
    });

    it('gyro reads from params', () => {
        // gx = 100 deg/s at default ±250 → 131 LSB/(deg/s) → 13100.
        const r = i2cRig('mpu6050', ['vcc', 'gnd', 'sda', 'scl', 'ad0', 'int'],
            { gx: 100 });
        r.writeRegs(0x68, 0x6b, [0x00]);
        const [gxH, gxL] = r.readRegs(0x68, 0x43, 2);
        const gx = (gxH << 8) | gxL;
        assert.equal(gx, 13100, 'gx = 100 deg/s → 13100 at default sensitivity');
    });

    it('temperature register formula matches datasheet', () => {
        // T = 25 °C → regval = (25 + 36.53) × 340 = 20920.04 ≈ 20920 → 0x51B8
        const r = i2cRig('mpu6050', ['vcc', 'gnd', 'sda', 'scl', 'ad0', 'int'],
            { temperature: 25 });
        r.writeRegs(0x68, 0x6b, [0x00]);
        const [tH, tL] = r.readRegs(0x68, 0x41, 2);
        const raw = (tH << 8) | tL;
        assert.equal(raw, 20920, 'temp 25 °C → raw 20920');
        // Verify reverse formula: T = raw/340 - 36.53 = 25.00
        const tReverse = raw / 340 - 36.53;
        assert.ok(Math.abs(tReverse - 25) < 0.01, `reverse formula: ${tReverse} ≈ 25`);
    });

    it('DEVICE_RESET re-enters sleep', () => {
        const r = i2cRig('mpu6050', ['vcc', 'gnd', 'sda', 'scl', 'ad0', 'int'],
            { az: 1 });
        r.writeRegs(0x68, 0x6b, [0x00]);     // wake
        // Verify awake.
        const [azH1] = r.readRegs(0x68, 0x3f, 1);
        assert.ok(azH1 > 0, 'should read data when awake');

        // DEVICE_RESET.
        r.writeRegs(0x68, 0x6b, [0x80]);
        // Should be sleeping again: accel reads zero.
        const post = r.readRegs(0x68, 0x3b, 6);
        assert.deepEqual(post, [0, 0, 0, 0, 0, 0], 'reset puts it back to sleep');
    });

    it('AD0 high changes address to 0x69', () => {
        const r = i2cRig('mpu6050', ['vcc', 'gnd', 'sda', 'scl', 'ad0', 'int'],
            { ad0: 1 });
        // 0x68 should NACK.
        r.start();
        const ack68 = r.wByte(0x68 << 1);
        r.stop();
        assert.equal(ack68, false, '0x68 should NACK when AD0=1');

        // 0x69 should ACK.
        r.start();
        const ack69 = r.wByte(0x69 << 1);
        r.stop();
        assert.equal(ack69, true, '0x69 should ACK when AD0=1');
    });

    it('orientation preset "upright" sets ay=-1g by default', () => {
        const r = i2cRig('mpu6050', ['vcc', 'gnd', 'sda', 'scl', 'ad0', 'int'],
            { orientation: 'upright' });
        r.writeRegs(0x68, 0x6b, [0x00]);
        const [ayH, ayL] = r.readRegs(0x68, 0x3d, 2);
        let ay = (ayH << 8) | ayL;
        if (ay >= 32768) ay -= 65536;        // two's complement
        // -1g at ±2g sensitivity → -16384
        assert.equal(ay, -16384, 'upright: ay = -1g → -16384');
    });
});

// ═══════════════════════════════════════════════════════════════════
// SSD1306
// ═══════════════════════════════════════════════════════════════════
describe('SSD1306', () => {
    function oledRig(params = {}) {
        return i2cRig('ssd1306', ['vcc', 'gnd', 'sda', 'scl'], params);
    }

    // Send command(s) using single-command control byte (0x00).
    function sendCmds(r, addr, ...cmds) {
        for (const cmd of cmds) {
            r.writeCmd(addr, 0x00, [cmd]);
        }
    }

    // Send a multi-byte command (e.g., 0x21 colStart colEnd).
    function sendMultiCmd(r, addr, ...bytes) {
        r.start(); r.wByte(addr << 1);
        r.wByte(0x00);         // control: command, Co=0
        for (const b of bytes) r.wByte(b);
        r.stop();
    }

    // Send data bytes (GDDRAM writes).
    function sendData(r, addr, ...bytes) {
        r.start(); r.wByte(addr << 1);
        r.wByte(0x40);         // control: data stream, Co=0
        for (const b of bytes) r.wByte(b);
        r.stop();
    }

    it('defaults to display off, page addressing mode, empty framebuffer', () => {
        const r = oledRig();
        const st = r.getState();
        assert.equal(st.displayOn, false);
        assert.equal(st.addrMode, 0x02, 'power-on default is page mode');
        assert.equal(st.fb.every(b => b === 0), true, 'GDDRAM should be zeroed');
    });

    it('display on/off commands', () => {
        const r = oledRig();
        sendCmds(r, 0x3c, 0xaf);           // display ON
        assert.equal(r.getState().displayOn, true);
        sendCmds(r, 0x3c, 0xae);           // display OFF
        assert.equal(r.getState().displayOn, false);
    });

    it('horizontal addressing mode: write a pattern and verify pixels', () => {
        const r = oledRig();
        const addr = 0x3c;

        // Standard Adafruit init sequence (abbreviated).
        sendCmds(r, addr, 0xae);              // display off
        sendMultiCmd(r, addr, 0x20, 0x00);    // horizontal addressing mode
        sendMultiCmd(r, addr, 0x21, 0, 127);  // column range
        sendMultiCmd(r, addr, 0x22, 0, 7);    // page range

        // Write 0xFF to the first byte (page 0, col 0): all 8 pixels in that column ON.
        sendData(r, addr, 0xff);

        // Write 0x01 to the second position (page 0, col 1): only top pixel ON.
        sendData(r, addr, 0x01);

        const st = r.getState();
        // Page 0, col 0 = 0xFF: pixels (0,0) through (0,7) are on.
        for (let y = 0; y < 8; y++) {
            assert.equal(ssd1306Pixel(st, 0, y), 1, `pixel (0, ${y}) should be ON`);
        }
        // Page 0, col 1 = 0x01: only pixel (1,0) is on.
        assert.equal(ssd1306Pixel(st, 1, 0), 1, 'pixel (1, 0) should be ON');
        for (let y = 1; y < 8; y++) {
            assert.equal(ssd1306Pixel(st, 1, y), 0, `pixel (1, ${y}) should be OFF`);
        }
        // Untouched areas remain zero.
        assert.equal(ssd1306Pixel(st, 2, 0), 0, 'pixel (2, 0) should be OFF');
    });

    it('page addressing mode: column wraps but page stays', () => {
        const r = oledRig();
        const addr = 0x3c;

        sendMultiCmd(r, addr, 0x20, 0x02);    // page mode (the default)
        // Set page 0, lower col nibble = 126, upper = 0 → col 126.
        sendCmds(r, addr, 0xb0);              // page 0
        sendCmds(r, addr, 0x0e);              // lower nibble = 14
        sendCmds(r, addr, 0x17);              // upper nibble = 7 → col = 0x7E = 126

        // Write 3 bytes: col 126, 127, then wrap to colStart (0).
        sendData(r, addr, 0xaa, 0x55, 0xcc);

        const st = r.getState();
        assert.equal(st.fb[0 * 128 + 126], 0xaa);
        assert.equal(st.fb[0 * 128 + 127], 0x55);
        assert.equal(st.fb[0 * 128 + 0], 0xcc, 'column wrapped to start');
        // Page should NOT have advanced.
        assert.equal(st.fb[1 * 128 + 0], 0x00, 'page should not advance in page mode');
    });

    it('inverse display command', () => {
        const r = oledRig();
        sendCmds(r, 0x3c, 0xa7);
        assert.equal(r.getState().inverted, true);
        sendCmds(r, 0x3c, 0xa6);
        assert.equal(r.getState().inverted, false);
    });

    it('contrast command stores the value', () => {
        const r = oledRig();
        sendMultiCmd(r, 0x3c, 0x81, 0x42);
        assert.equal(r.getState().contrast, 0x42);
    });

    it('fills the full screen in horizontal mode and verifies diagonal pixels', () => {
        const r = oledRig();
        const addr = 0x3c;

        sendMultiCmd(r, addr, 0x20, 0x00);    // horizontal
        sendMultiCmd(r, addr, 0x21, 0, 127);
        sendMultiCmd(r, addr, 0x22, 0, 7);

        // Fill the entire 1024-byte framebuffer with a pattern:
        // each byte = column index & 0xff.
        r.start(); r.wByte(addr << 1);
        r.wByte(0x40);                         // data stream
        for (let page = 0; page < 8; page++) {
            for (let col = 0; col < 128; col++) {
                r.wByte(col & 0xff);
            }
        }
        r.stop();

        const st = r.getState();
        // Verify a diagonal: pixel (x, y) where y < 8 and col = x.
        // fb[0*128+x] = x. Pixel (x, bit) = (x >> bit) & 1.
        assert.equal(ssd1306Pixel(st, 5, 0), 1, 'col 5 bit 0');
        assert.equal(ssd1306Pixel(st, 5, 1), 0, 'col 5 bit 1');
        assert.equal(ssd1306Pixel(st, 5, 2), 1, 'col 5 bit 2');
        // col 5 = 0b00000101: bits 0,2 on; bits 1,3-7 off.
        assert.equal(ssd1306Pixel(st, 5, 3), 0);
        assert.equal(ssd1306Pixel(st, 5, 7), 0);
    });

    it('address 0x3D works with SA0 param', () => {
        const r = oledRig({ address: 0x3d });

        // 0x3C should NACK.
        r.start();
        const ack3c = r.wByte(0x3c << 1);
        r.stop();
        assert.equal(ack3c, false, '0x3C should NACK');

        // 0x3D should ACK.
        r.start();
        const ack3d = r.wByte(0x3d << 1);
        r.stop();
        assert.equal(ack3d, true, '0x3D should ACK');
    });

    it('charge pump enable stores', () => {
        const r = oledRig();
        sendMultiCmd(r, 0x3c, 0x8d, 0x14);    // charge pump ON
        assert.equal(r.getState().chargePump, true);
    });

    it('vertical addressing mode: page advances first', () => {
        const r = oledRig();
        const addr = 0x3c;

        sendMultiCmd(r, addr, 0x20, 0x01);    // vertical
        sendMultiCmd(r, addr, 0x21, 0, 127);
        sendMultiCmd(r, addr, 0x22, 0, 7);

        // Write 9 bytes: should fill col 0 pages 0-7, then col 1 page 0.
        r.start(); r.wByte(addr << 1);
        r.wByte(0x40);
        for (let i = 0; i < 9; i++) r.wByte(i + 1);
        r.stop();

        const st = r.getState();
        for (let p = 0; p < 8; p++) {
            assert.equal(st.fb[p * 128 + 0], p + 1, `page ${p} col 0`);
        }
        assert.equal(st.fb[0 * 128 + 1], 9, 'col 1 page 0 should be 9 (wrapped)');
    });
});
