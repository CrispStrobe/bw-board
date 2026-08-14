/**
 * Audio trio — UM66T melody generator, KD9561 sound-effect IC and
 * ISD1820 record/playback module. Clean-room from the respective
 * datasheets and application notes.
 *
 * UM66T: a fixed-tune CMOS melody generator. When Vdd−Vss exceeds
 * ~2 V, it oscillates at its internal tune rate and produces a square
 * wave on the OUT terminal. The tune is a PUBLIC-DOMAIN note table
 * (Ode to Joy — Beethoven, 1824, well out of copyright). The chip
 * plays through the table once per trigger cycle; the output drives a
 * speaker/piezo via a transistor amplifier. Edge-stream pattern: the
 * wave is generated from machine time like the TCS3200.
 *
 * KD9561: four-effect alarm IC. SEL1/SEL2 choose the effect (00 siren,
 * 01 fire, 10 ambulance, 11 machine gun). When Vdd−Vss > ~2 V the
 * selected waveform appears on OUT as a modulated square wave.
 * Parameterised oscillators: siren sweeps up-down, ambulance toggles
 * between two tones, fire alternates crackle bursts, machine gun is
 * rapid on/off. The TCS3200 wave pattern: level from machine time,
 * half-period computed per-tick from the envelope function.
 *
 * ISD1820: record/playback voice module. Three control pins: REC
 * (active HIGH — records analog input samples while held), PLAYE
 * (edge-triggered — plays once), PLAYL (level-triggered — plays while
 * held). Speaker terminal carries the playback wave. The model stores
 * samples in state as a Float32Array; audio rendering is the app's
 * job, the model is pins + state.
 *
 * @module
 */

import { registerDevice } from '../devices.js';

const R_OUT = 50;
const R_OFF = 1e9;
const R_INPUT = 1e6;

// ─── UM66T note table ──────────────────────────────────────────────
// Ode to Joy (Beethoven, 9th Symphony, 4th movement theme, 1824).
// Note: [MIDI note, duration in 16ths].  Public domain.
// Frequencies derived: f = 440 * 2^((midi-69)/12).
const ODE_TO_JOY = [
    [64, 4], [64, 4], [65, 4], [67, 4],   // E4 E4 F4 G4
    [67, 4], [65, 4], [64, 4], [62, 4],   // G4 F4 E4 D4
    [60, 4], [60, 4], [62, 4], [64, 4],   // C4 C4 D4 E4
    [64, 6], [62, 2], [62, 8],            // E4. D4 D4
    [64, 4], [64, 4], [65, 4], [67, 4],   // E4 E4 F4 G4
    [67, 4], [65, 4], [64, 4], [62, 4],   // G4 F4 E4 D4
    [60, 4], [60, 4], [62, 4], [64, 4],   // C4 C4 D4 E4
    [62, 6], [60, 2], [60, 8],            // D4. C4 C4
];

function midiToHz(midi) { return 440 * Math.pow(2, (midi - 69) / 12); }

// Pre-compute: array of { hz, durationNs } at default tempo (~120 bpm,
// 16th note = 125 ms).
const SIXTEENTH_NS = 125_000_000n;  // 125 ms
const UM66T_NOTES = ODE_TO_JOY.map(([midi, dur]) => ({
    hz: midiToHz(midi),
    durationNs: SIXTEENTH_NS * BigInt(dur),
}));

// Total tune length in ns.
const UM66T_TOTAL_NS = UM66T_NOTES.reduce((s, n) => s + n.durationNs, 0n);

export function registerAudioParts() {

    // ─── UM66T ─────────────────────────────────────────────────────────
    registerDevice('um66t', {
        terminals: ['vdd', 'gnd', 'out'],

        init() {
            return {
                drives: { out: { vTh: 0, rTh: R_OFF } },
                _playing: false,
                _startNs: 0n,
                _level: 0,
            };
        },

        stamp() { },

        update(part, state, read, tNs) {
            const vcc = (read('vdd') || 0) - (read('gnd') || 0);
            if (vcc < 2.0) {
                // Under threshold: output tri-stated, reset playback.
                if (state._playing || state.drives.out.rTh !== R_OFF) {
                    state._playing = false;
                    state._level = 0;
                    state.drives.out = { vTh: 0, rTh: R_OFF };
                    return true;
                }
                return false;
            }

            if (!state._playing) {
                state._playing = true;
                state._startNs = tNs;
            }

            // Find current note from elapsed time (loop the tune).
            const elapsed = tNs - state._startNs;
            const pos = elapsed % UM66T_TOTAL_NS;
            let acc = 0n;
            let note = UM66T_NOTES[0];
            for (const n of UM66T_NOTES) {
                acc += n.durationNs;
                if (pos < acc) { note = n; break; }
            }

            // Square wave at note frequency from machine time.
            const halfNs = 0.5e9 / note.hz;
            const level = Math.floor(Number(tNs) / halfNs) % 2;
            if (level !== state._level) {
                state._level = level;
                state.drives.out = { vTh: level ? vcc : 0, rTh: R_OUT };
                return true;
            }
            return false;
        },
    });

    // ─── KD9561 ────────────────────────────────────────────────────────
    registerDevice('kd9561', {
        terminals: ['vdd', 'gnd', 'out', 'sel1', 'sel2'],

        init() {
            return {
                drives: { out: { vTh: 0, rTh: R_OFF } },
                _level: 0,
            };
        },

        stamp(ctx) {
            ctx.conductance('sel1', null, 1 / R_INPUT);
            ctx.conductance('sel2', null, 1 / R_INPUT);
        },

        update(part, state, read, tNs) {
            const vcc = (read('vdd') || 0) - (read('gnd') || 0);
            if (vcc < 2.0) {
                if (state.drives.out.rTh !== R_OFF) {
                    state._level = 0;
                    state.drives.out = { vTh: 0, rTh: R_OFF };
                    return true;
                }
                return false;
            }

            const th = vcc * 0.5;
            const s1 = read('sel1') > th ? 1 : 0;
            const s2 = read('sel2') > th ? 1 : 0;
            const sel = (s2 << 1) | s1;

            // Compute instantaneous frequency from the effect envelope.
            const hz = effectFrequency(sel, tNs);
            if (hz <= 0) {
                // Silent phase (machine gun off-period).
                if (state._level !== 0) {
                    state._level = 0;
                    state.drives.out = { vTh: 0, rTh: R_OUT };
                    return true;
                }
                return false;
            }

            // Square wave from machine time.
            const halfNs = 0.5e9 / hz;
            const level = Math.floor(Number(tNs) / halfNs) % 2;
            if (level !== state._level) {
                state._level = level;
                state.drives.out = { vTh: level ? vcc : 0, rTh: R_OUT };
                return true;
            }
            return false;
        },
    });

    // ─── ISD1820 ───────────────────────────────────────────────────────
    registerDevice('isd1820', {
        terminals: ['vcc', 'gnd', 'rec', 'playe', 'playl', 'mic', 'sp_p', 'sp_n'],

        init() {
            return {
                drives: {
                    sp_p: { vTh: 0, rTh: R_OFF },
                    sp_n: { vTh: 0, rTh: R_OFF },
                },
                // Recording buffer: up to 10 s at 8 kHz = 80000 samples.
                samples: null,                     // Float32Array, created on first record
                sampleCount: 0,                    // how many valid samples
                sampleRate: 8000,
                _recording: false,
                _recIdx: 0,
                _recLastNs: 0n,
                _playing: false,
                _playIdx: 0,
                _playLastNs: 0n,
                _lastPlayE: false,                 // edge detect for PLAYE
                _playHeld: false,                   // PLAYL level
                playbackActive: false,              // UI-facing
            };
        },

        stamp(ctx) {
            ctx.conductance('rec', null, 1 / R_INPUT);
            ctx.conductance('playe', null, 1 / R_INPUT);
            ctx.conductance('playl', null, 1 / R_INPUT);
            ctx.conductance('mic', null, 1 / R_INPUT);
        },

        update(part, state, read, tNs) {
            const vcc = read('vcc') || 5.0;
            const th = vcc * 0.5;
            const recHigh = read('rec') > th;
            const playEHigh = read('playe') > th;
            const playLHigh = read('playl') > th;
            let changed = false;

            // ── Recording ──────────────────────────────────────────
            if (recHigh && !state._recording) {
                // Start recording: allocate or reset buffer.
                if (!state.samples) state.samples = new Float32Array(80000);
                state._recording = true;
                state._recIdx = 0;
                state._recLastNs = tNs;
                state._playing = false;
                state.playbackActive = false;
            }
            if (state._recording) {
                if (!recHigh) {
                    // Stop recording.
                    state._recording = false;
                    state.sampleCount = state._recIdx;
                } else {
                    // Sample the mic/analog input at sampleRate.
                    const samplePeriodNs = BigInt(Math.round(1e9 / state.sampleRate));
                    while (tNs - state._recLastNs >= samplePeriodNs
                        && state._recIdx < state.samples.length) {
                        const v = read('mic') / vcc;             // normalize 0..1
                        state.samples[state._recIdx++] = Math.max(-1, Math.min(1, v * 2 - 1));
                        state._recLastNs += samplePeriodNs;
                    }
                }
            }

            // ── Playback ───────────────────────────────────────────
            // PLAYE: rising edge triggers full playback.
            const playeEdge = playEHigh && !state._lastPlayE;
            state._lastPlayE = playEHigh;

            if (!state._recording) {
                if (playeEdge && state.sampleCount > 0) {
                    state._playing = true;
                    state._playIdx = 0;
                    state._playLastNs = tNs;
                    state.playbackActive = true;
                    state._playHeld = false;
                }
                // PLAYL: level-triggered — plays while held.
                if (playLHigh && !state._playHeld && state.sampleCount > 0) {
                    state._playHeld = true;
                    state._playing = true;
                    state._playIdx = 0;
                    state._playLastNs = tNs;
                    state.playbackActive = true;
                }
                if (!playLHigh && state._playHeld) {
                    state._playHeld = false;
                    state._playing = false;
                    state.playbackActive = false;
                }
            }

            // Drive speaker during playback.
            if (state._playing && state.sampleCount > 0) {
                const samplePeriodNs = BigInt(Math.round(1e9 / state.sampleRate));
                while (tNs - state._playLastNs >= samplePeriodNs) {
                    state._playIdx++;
                    state._playLastNs += samplePeriodNs;
                }
                if (state._playIdx >= state.sampleCount) {
                    // Playback finished.
                    state._playing = false;
                    state.playbackActive = false;
                    state.drives.sp_p = { vTh: vcc / 2, rTh: R_OUT };
                    state.drives.sp_n = { vTh: vcc / 2, rTh: R_OUT };
                    changed = true;
                } else {
                    // Bridge-tied-load: sp_p and sp_n swing differentially.
                    const s = state.samples[state._playIdx];
                    const sp = vcc / 2 + s * (vcc / 2) * 0.8;
                    const sn = vcc / 2 - s * (vcc / 2) * 0.8;
                    const oldP = state.drives.sp_p.vTh;
                    const oldN = state.drives.sp_n.vTh;
                    if (Math.abs(sp - oldP) > 0.01 || Math.abs(sn - oldN) > 0.01
                        || state.drives.sp_p.rTh === R_OFF) {
                        state.drives.sp_p = { vTh: sp, rTh: R_OUT };
                        state.drives.sp_n = { vTh: sn, rTh: R_OUT };
                        changed = true;
                    }
                }
            } else if (!state._recording && state.drives.sp_p.rTh !== R_OFF
                && !state._playing) {
                // Idle: tri-state the speaker.
                state.drives.sp_p = { vTh: 0, rTh: R_OFF };
                state.drives.sp_n = { vTh: 0, rTh: R_OFF };
                changed = true;
            }

            return changed;
        },
    });
}

// ─── KD9561 effect envelopes ───────────────────────────────────────
// Each returns the instantaneous frequency at time tNs. The patterns
// are parameterised oscillators; no lookup tables.

function effectFrequency(sel, tNs) {
    const t = Number(tNs) / 1e9;          // seconds as float
    switch (sel) {
        case 0: return sirenFreq(t);
        case 1: return fireFreq(t);
        case 2: return ambulanceFreq(t);
        case 3: return machineGunFreq(t);
        default: return 0;
    }
}

// Siren: continuous triangle sweep 800→2400→800 Hz, 2 s period.
function sirenFreq(t) {
    const period = 2.0;
    const phase = (t % period) / period;        // 0..1
    return phase < 0.5
        ? 800 + (2400 - 800) * (phase * 2)
        : 2400 - (2400 - 800) * ((phase - 0.5) * 2);
}

// Fire engine: rapid warbling — two tones alternating at ~8 Hz.
function fireFreq(t) {
    const warp = Math.floor(t * 8) % 2;
    return warp ? 1200 : 1600;
}

// Ambulance: two-tone alternation at ~1 Hz (European style).
function ambulanceFreq(t) {
    const phase = Math.floor(t * 1.0) % 2;
    return phase ? 960 : 780;
}

// Machine gun: rapid on/off bursts. ~12 Hz duty cycle, 50% on.
function machineGunFreq(t) {
    const burstHz = 12;
    const phase = (t * burstHz) % 1.0;
    if (phase >= 0.5) return 0;                 // silent gap
    return 150;                                  // low thud tone
}

export default registerAudioParts;
