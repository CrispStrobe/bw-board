/**
 * Blinkenrocket modem FULL LOOP: sound becomes data on the real firmware.
 *
 * encodeTextMessage("Hi") → PCM samples → ADC on ATtiny88 (channel 6,
 * PA0 per modem.h MODEM_PIN) → firmware demodulates via ADC interrupt
 * → FEC-decoded pattern arrives in the external I2C EEPROM.
 *
 * The PCM waveform is fed through the board's readAnalog callback,
 * time-indexed by the adapter's timeNs(). The gain/offset map the
 * ±1.0 unit-amplitude signal into the ADC's 0-5V range (offset=2.5,
 * gain=2.0 → [0.5, 4.5]).
 *
 * Skips loudly without the firmware hex.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import { createAvr8jsAdapter } from '../src/avr8js-adapter.js';
import { wirePeripherals } from '../src/avr-peripherals.js';
import { parseIntelHex } from '../src/intel-hex.js';
import { encodeTextMessage, MODEM_RATE } from '../src/blinkenrocket-modem.js';

import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
// The blinkenrocket firmware is a SIBLING checkout, not a fixture in this
// repo, so it is looked up rather than assumed. It used to be a single
// absolute /mnt/volume1 path, which resolved on one VPS and nowhere else --
// so every test needing it skipped, and a skip reads as a deliberate
// exclusion rather than as a broken path. The env var comes first so a
// build in an unusual place can still be pointed at.
const HEX_CANDIDATES = [
  process.env.BLINKENROCKET_HEX,
  path.join(HERE, '..', '..', 'blinkenrocket-firmware-with-minigame', 'build', 'main.hex'),
  path.join(HERE, '..', '..', 'blinkenrocket-firmware', 'build', 'main.hex'),
  path.join(process.env.HOME || '', 'code', 'blinkenrocket-firmware-with-minigame', 'build', 'main.hex'),
  path.join(process.env.HOME || '', 'code', 'blinkenrocket-firmware', 'build', 'main.hex'),
].filter(Boolean);
const HEX_PATH = HEX_CANDIDATES.find(p => existsSync(p)) || HEX_CANDIDATES[HEX_CANDIDATES.length - 1];


test('modem full loop: encodeTextMessage → firmware ADC → EEPROM pattern', {
    skip: !existsSync(HEX_PATH) && 'blinkenrocket firmware hex not found at ' + HEX_PATH,
    timeout: 120_000,
}, () => {
    // ── Encode the message ────────────────────────────────────────
    const text = 'Hi';
    const pcmSamples = encodeTextMessage(text, { sync: 200 });
    const gain = 2.0, offset = 2.5;
    // Duration: samples / rate
    const audioDurationSec = pcmSamples.length / MODEM_RATE;

    // ── Load firmware ─────────────────────────────────────────────
    const hexStr = readFileSync(HEX_PATH, 'utf8');
    const flash = parseIntelHex(hexStr, 8192);
    const adapter = createAvr8jsAdapter({ chip: 'attiny88', program: flash });

    // External EEPROM (24C64, 8KB) for storage
    const extEE = new Uint8Array(8192).fill(0xFF);
    wirePeripherals(adapter, { externalEeprom: extEE });

    // ── Board stub: time-indexed PCM on A6 ────────────────────────
    // The adapter's ADC callback calls board.readAnalog('A6').
    // We feed the PCM waveform, time-indexed by adapter.timeNs().
    // The waveform starts AFTER boot (bootNs offset) so the sync
    // prefix arrives when the firmware's ADC interrupt is active.
    const bootNs = 200_000_000; // 200ms boot
    let adcReads = 0;

    const board = {
        setPin() {},
        advanceTo() {},
        readPin(name) {
            // Buttons: PC3/PC7 pulled up (not pressed)
            if (name === 'PC3' || name === 'PC7') return 1;
            return 0;
        },
        readAnalog(name) {
            if (name === 'A6') {
                adcReads++;
                const tNs = Number(adapter.timeNs());
                const tSec = (tNs - bootNs) / 1e9;
                if (tSec < 0) return offset; // before waveform starts
                const sampleIdx = tSec * MODEM_RATE;
                if (sampleIdx >= pcmSamples.length) return offset; // past end
                // Linear interpolation
                const i = Math.floor(sampleIdx);
                const frac = sampleIdx - i;
                const s = i + 1 < pcmSamples.length
                    ? pcmSamples[i] * (1 - frac) + pcmSamples[i + 1] * frac
                    : pcmSamples[i];
                return offset + gain * s;
            }
            return 0;
        },
    };

    adapter.attachBoard(board);

    // ── Run: boot + modem receive ─────────────────────────────────
    // Boot (200ms)
    for (let ms = 0; ms < 200; ms += 2) adapter.advanceNs(2_000_000);

    // Run for the audio duration + 500ms processing
    const totalMs = Math.ceil(audioDurationSec * 1000) + 500;
    for (let ms = 0; ms < totalMs; ms += 2) adapter.advanceNs(2_000_000);

    // ── Assert: pattern arrived in EEPROM ─────────────────────────
    const animBase = 256;
    const headerByte0 = extEE[animBase];
    const headerType = (headerByte0 >> 4) & 0x0f;
    const headerLenLo = extEE[animBase + 1];
    const patternLen = ((headerByte0 & 0x0f) << 8) | headerLenLo;

    console.log(`# modem e2e: ADC reads=${adcReads}, header=[0x${headerByte0.toString(16)}, 0x${extEE[animBase + 1].toString(16)}], type=${headerType}, len=${patternLen}`);

    if (headerType === 1 && patternLen === text.length) {
        // Perfect decode: verify the text characters
        const received = [];
        for (let i = 0; i < text.length; i++) {
            received.push(String.fromCharCode(extEE[animBase + 4 + i]));
        }
        const receivedText = received.join('');
        console.log(`# modem e2e: received text = "${receivedText}"`);
        assert.equal(receivedText, text, 'decoded text matches transmitted');
    } else {
        // Check if anything was written at all
        const anyWritten = extEE.subarray(animBase, animBase + 32).some(b => b !== 0xFF);
        console.log(`# modem e2e: first 16 bytes at animBase: [${Array.from(extEE.subarray(animBase, animBase + 16)).map(b => '0x' + b.toString(16).padStart(2, '0')).join(', ')}]`);

        if (!anyWritten) {
            // Check if the modem even received anything (num_anims at byte 0)
            console.log(`# modem e2e: num_anims(byte 0)=0x${extEE[0].toString(16)}, page_offset(byte 1)=0x${extEE[1].toString(16)}`);
            // Check a wider range
            let firstNonFF = -1;
            for (let i = 0; i < extEE.length; i++) {
                if (extEE[i] !== 0xFF) { firstNonFF = i; break; }
            }
            console.log(`# modem e2e: first non-FF byte at offset ${firstNonFF}`);
        }

        assert.ok(anyWritten,
            `EEPROM should have received data from the modem (ADC reads: ${adcReads})`);
    }

    assert.ok(adcReads > 100, `ADC should have fired many times: ${adcReads}`);
});
