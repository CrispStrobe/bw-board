// SPDX-License-Identifier: MIT
/**
 * Default LED forward voltage by colour (2026-11-23).
 *
 * An LED with no explicit `vf` used to be 2.0 V whatever its colour, so a
 * blue or white LED (≈3 V) lit from a 3.3 V pin through a resistor it could
 * not really drive, and a red one drew too little. When `vf` is absent, the
 * colour now picks a typical datasheet value at the rated 20 mA; an explicit
 * `vf` always wins, and an LED with no (or an unknown) colour keeps the
 * historical 2.0 V.
 *
 * Typical 5 mm values: IR (GaAs/GaAlAs) 1.3 V, red (GaAsP/AlGaInP) 1.9 V,
 * orange 2.0 V, yellow 2.1 V, standard green (GaP) 2.2 V, blue / white /
 * true-green / pink / purple (InGaN) 3.1 V, UV 3.4 V.
 *
 * @module
 */
export const LED_DEFAULT_VF = 2.0;
export const DIODE_DEFAULT_VF = 0.7;

export const LED_COLOR_VF = Object.freeze({
    ir: 1.3, infrared: 1.3,
    red: 1.9,
    orange: 2.0, amber: 2.0,
    yellow: 2.1,
    green: 2.2,
    blue: 3.1, white: 3.1, warmwhite: 3.1, 'warm-white': 3.1, 'true-green': 3.1, truegreen: 3.1,
    pink: 3.1, purple: 3.1, violet: 3.1,
    uv: 3.4, ultraviolet: 3.4,
});

/** Forward voltage of an LED part: explicit vf, else its colour's, else 2.0 V. */
export function ledVf(part) {
    const vf = part?.params?.vf;
    if (vf !== undefined && vf !== null) return vf;
    const colour = part?.params?.color ?? part?.params?.colour;
    if (typeof colour === 'string') {
        const v = LED_COLOR_VF[colour.trim().toLowerCase()];
        if (v !== undefined) return v;
    }
    return LED_DEFAULT_VF;
}

/** Junction vf for a diode or LED part, with each kind's default. */
export function junctionVf(part) {
    return part?.kind === 'led' ? ledVf(part) : (part?.params?.vf ?? DIODE_DEFAULT_VF);
}
