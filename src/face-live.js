/**
 * The LIVE-mode face resolver + the telemetry frame convention — the
 * other half of the faces doctrine: the same descriptor, the same
 * snapshot()/diff() surface as the simulated resolver (face.js), fed
 * from the TETHERED stream instead of the board. Rendering never
 * learns which world it is showing; that is the whole contract.
 *
 * THE FRAME CONVENTION (ours, both ends under our control — no parser
 * IDE needed): frames are single lines starting '~', comma-separated,
 * newline-terminated, interleaved freely with normal program output
 * (which passes through to onText, tokens stripped — the basicTrace
 * pattern):
 *
 *   ~p,P1.0,1        pin level (0/1)
 *   ~a,NAME,3.14     analog probe / measured value (volts or unit)
 *   ~v,NAME,VALUE    program variable (the telemetry panel's food)
 *   ~d,REF,FIELD,J   device state field, J = JSON (arrays for digits,
 *                    strings for text — the firmware side emits what
 *                    it knows)
 *
 * Firmware emits these with two or three prints per update — cheap on
 * every target (the 8051's print, MicroPython's print, Arduino's
 * Serial.print all qualify). Streaming-safe: split lines reassemble;
 * a dangling partial flushes as text.
 *
 * @module
 */

import { validateFace } from './face.js';

/**
 * @param {object} descriptor the SAME face descriptor face.js takes
 * @param {{ onText?: (text: string) => void }} [hooks] non-frame output
 */
export function createLiveFaceResolver(descriptor, hooks = {}) {
    const problems = validateFace(descriptor);
    if (problems.length) throw new Error(`face ${descriptor && descriptor.id}: ${problems.join('; ')}`);

    // Latest telemetry by source: pins['P1.0']=1, analog['POT']=2.5,
    // vars['count']=7, devices['U1'].digits=[...].
    const world = { pins: {}, analog: {}, vars: {}, devices: {} };
    let buf = '';

    const applyFrame = (line) => {
        const parts = line.split(',');
        const tag = parts[0];
        if (tag === '~p' && parts.length >= 3) {
            world.pins[parts[1]] = Number(parts[2]) ? 1 : 0;
        } else if (tag === '~a' && parts.length >= 3) {
            world.analog[parts[1]] = Number(parts[2]);
        } else if (tag === '~v' && parts.length >= 3) {
            const raw = parts.slice(2).join(',');
            const n = Number(raw);
            world.vars[parts[1]] = Number.isFinite(n) && raw.trim() !== '' ? n : raw;
        } else if (tag === '~d' && parts.length >= 4) {
            const ref = parts[1];
            const field = parts[2];
            const raw = parts.slice(3).join(',');
            let value;
            try { value = JSON.parse(raw); } catch { value = raw; }
            (world.devices[ref] = world.devices[ref] || {})[field] = value;
        } else {
            return false;                        // not a frame we know
        }
        return true;
    };

    const resolveOne = (el) => {
        const b = el.bind;
        if (b.source === 'pin') {
            const level = world.pins[b.ref];
            if (level === undefined) return null;   // no telemetry yet ≠ low
            return b.activeLow ? 1 - level : level;
        }
        if (b.source === 'net') {
            const v = world.analog[b.ref];
            return v === undefined ? null : v;
        }
        const dev = world.devices[b.ref];
        if (!dev || !(b.field in dev)) return null;
        const value = dev[b.field];
        if (el.kind === 'led') return value ? 1 : 0;
        return value;
    };

    return {
        descriptor,
        world,

        /** @param {string|Uint8Array} chunk raw tethered stream */
        feed(chunk) {
            buf += typeof chunk === 'string' ? chunk : String.fromCharCode(...chunk);
            let idx;
            let text = '';
            while ((idx = buf.indexOf('\n')) >= 0) {
                const line = buf.slice(0, idx).replace(/\r$/, '');
                buf = buf.slice(idx + 1);
                if (line.startsWith('~') && applyFrame(line)) continue;
                text += `${line}\n`;
            }
            // Anything not starting a possible frame can flow immediately;
            // a partial line that MIGHT be a frame is held for its newline.
            if (buf && !buf.startsWith('~')) { text += buf; buf = ''; }
            if (text && hooks.onText) hooks.onText(text);
        },

        /** Release a dangling partial as plain text (stream ended). */
        flush() {
            if (buf && hooks.onText) hooks.onText(buf);
            buf = '';
        },

        snapshot() {
            const out = {};
            for (const el of descriptor.elements) out[el.id] = resolveOne(el);
            return out;
        },

        diff() {
            const cur = this.snapshot();
            const prev = this._prev || {};
            const changed = {};
            for (const [k, v] of Object.entries(cur)) {
                if (JSON.stringify(prev[k]) !== JSON.stringify(v)) changed[k] = v;
            }
            this._prev = cur;
            return changed;
        },
    };
}

export default createLiveFaceResolver;
