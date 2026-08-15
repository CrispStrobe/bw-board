/**
 * Blinkenrocket audio modem — ENCODER, adopted from the MIT web editor
 * (blinkenrocket/webedit-react, src/Services/modem.js) and the openly
 * documented MessageSpecification.md. The GPL firmware is the RECEIVER
 * and stays local-only reference; this encoder is a from-the-MIT-source
 * adoption plus the spec, both permissive.
 *
 * The physical layer (V2 protocol): differential on-off keying with
 * pulse-LENGTH data. Every bit TOGGLES the activity state (faded sine
 * burst vs silence); the bit VALUE picks the symbol duration — short
 * (72 samples) = 0, long (144) = 1, LSB first. The receiver measures
 * time between activity edges: long gap = 1, short = 0 — no clock, no
 * carrier detect, survives terrible audio hardware. A slow-sine sync
 * prefix wakes the sampler.
 *
 * Framing (MessageSpecification.md): A5 A5 A5 5A | patterns | 84 84 84,
 * each pattern 0F F0 + 2-byte type/length header + 2-byte meta + data.
 * FEC: Hamming(24,16) — every byte pair gains a parity byte built from
 * per-nibble Hamming(8,4) tables.
 *
 * Output samples are unit-amplitude floats at a nominal 44100 Hz —
 * feed them to the 'pcm' source wave (gain sets the peak volts, offset
 * biases into the ADC's unipolar range).
 */

const STARTCODE1 = 0xa5;
const STARTCODE2 = 0x5a;
const PATTERNCODE1 = 0x0f;
const PATTERNCODE2 = 0xf0;
const ENDCODE = 0x84;

export const MODEM_RATE = 44100;

const rad = (deg) => deg * Math.PI / 180;

// The four symbols, exactly as the MIT encoder builds them.
const lowShort = new Array(72).fill(0);
const lowLong = new Array(144).fill(0);
const highShort = [];
for (let j = 0; j < 18; j++) highShort.push(j / 18 * Math.sin(rad(j * 10)));
for (let j = 0; j < 36; j++) highShort.push(Math.sin(rad((j + 18) * 10)));
for (let j = 0; j < 18; j++) highShort.push((18 - j) / 18 * Math.sin(rad((j + 54) * 10)));
const highLong = [];
for (let j = 0; j < 18; j++) highLong.push(j / 18 * Math.sin(rad(j * 10)));
for (let j = 0; j < 108; j++) highLong.push(Math.sin(rad((j + 18) * 10)));
for (let j = 0; j < 18; j++) highLong.push((18 - j) / 18 * Math.sin(rad((j + 126) * 10)));
const SYMBOLS = [[lowShort, lowLong], [highShort, highLong]];

// Hamming(8,4) parity tables (the firmware's own, via the MIT encoder).
const PAR_LO = [0, 3, 5, 6, 6, 5, 3, 0, 7, 4, 2, 1, 1, 2, 4, 7];
const PAR_HI = [0, 9, 10, 3, 11, 2, 1, 8, 12, 5, 6, 15, 7, 14, 13, 4];

const hamming128 = (byte) => PAR_LO[byte & 0x0f] ^ PAR_HI[byte >> 4];
export const hamming2416 = (first, second) => (hamming128(second) << 4) | hamming128(first);

/** Frame a TEXT pattern: header nibble type 1, then meta, then chars. */
export function textPattern(text, { speed = 8, delay = 0, direction = 0, repeat = 0 } = {}) {
    const bytes = [PATTERNCODE1, PATTERNCODE2,
        (0x01 << 4) | (text.length >> 8), text.length & 0xff,
        (speed << 4) | (delay * 2) & 0x0f, (direction << 4) | repeat];
    for (const ch of text) bytes.push(ch.charCodeAt(0) & 0xff);
    return bytes;
}

/** Frame an ANIMATION pattern: type 2, frames are 8-byte columns. */
export function animationPattern(frames, { speed = 8, delay = 0, repeat = 0 } = {}) {
    const bytes = [PATTERNCODE1, PATTERNCODE2,
        (0x02 << 4) | (frames.length >> 8), frames.length & 0xff,
        speed, (delay << 4) | repeat];
    for (const b of frames) bytes.push(b & 0xff);
    return bytes;
}

/** Whole-message framing + Hamming(24,16) over byte pairs. */
export function frameMessage(patternBytes) {
    const data = [STARTCODE1, STARTCODE1, STARTCODE1, STARTCODE2, ...patternBytes, ENDCODE, ENDCODE, ENDCODE];
    if (data.length % 2 !== 0) data.push(0);
    const out = [];
    for (let i = 0; i < data.length; i += 2) {
        out.push(data[i], data[i + 1], hamming2416(data[i], data[i + 1]));
    }
    return out;
}

/** The sync prefix: n blocks of a slow quarter-degree sine + mute. */
export function syncSignal(n = 200) {
    const out = [];
    for (let j = 0; j < n * 360; j++) {
        out.push(j < n / 2 ? Math.sin(rad(j / 4)) : 0);
    }
    return out;
}

/**
 * Encode framed bytes to PCM: LSB-first, each bit toggles the
 * activity state and its value picks short/long. Returns Float32Array
 * plus the state so callers can stream in chunks.
 */
export function encodeAudio(framedBytes, { sync = 200 } = {}) {
    const sound = syncSignal(sync);
    let hilo = 0;
    for (let byte of framedBytes) {
        for (let bit = 0; bit < 8; bit++) {
            hilo ^= 1;
            const sym = SYMBOLS[hilo][byte & 1];
            for (let k = 0; k < sym.length; k++) sound.push(sym[k]);
            byte >>= 1;
        }
    }
    return Float32Array.from(sound);
}

/** One call: text in, PCM out — ready for {wave:'pcm'} playback. */
export function encodeTextMessage(text, opts = {}) {
    return encodeAudio(frameMessage(textPattern(text, opts)), opts);
}

export default { textPattern, animationPattern, frameMessage, encodeAudio, encodeTextMessage, syncSignal, hamming2416, MODEM_RATE };
