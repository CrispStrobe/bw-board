/**
 * THE PARTS LIBRARY — the one place an electrical number lives.
 *
 * A part's parameters were in three places that disagreed. For an LED's series
 * resistance, on 2026-09-13:
 *
 *     board.js LED_RD / mna.js JUNCTION_RD  (piecewise)     10
 *     mna.js junctionOpts                   (exponential)    2
 *     bw-circuit-ui exporters/spice.js      .model LED       5
 *
 * Three homes, one physical quantity, no authority. The 1N4148 agreed at 0.568
 * across the solver and the exporter only because it was reconciled by hand,
 * for one part, in one direction. Adding twenty named parts to three
 * unsynchronised tables multiplies that by twenty, so the authority comes
 * before the parts.
 *
 * THE RULE (ruling: lego-38, 2026-09-13):
 *
 *   A `kind` exists when the STAMP differs. A `part` exists when only the
 *   NUMBERS differ. So a 2N2222 is `kind: 'npn', params: {part: '2N2222'}`,
 *   while an HD44780 is its own kind because it has its own device model.
 *
 *   A CARD HERE IS THE ONLY PLACE AN ELECTRICAL NUMBER LIVES. bw-circuit-ui
 *   sidecars carry face, pins and footprint and REFERENCE a card by id; a gate
 *   there asserts every referenced id resolves and that no sidecar carries a
 *   field from the electrical schema below. exporters/spice.js DERIVES its
 *   .model lines from these cards, so `.model LED` stops having its own 5.
 *
 * WHAT A CARD IS NOT. It is not a datasheet. It is the parameter set our two
 * models need, with provenance for where each number came from, so that a
 * number can be argued with. `provenance` is required for exactly that reason:
 * a card without it is a number nobody can check, and this file exists because
 * we had three of those.
 *
 * @module
 */

/** Rated current at which a junction's `vf` is specified. Matches mna.js. */
export const I_RATED = 0.020;

/**
 * The electrical schema. A sidecar in bw-circuit-ui may carry none of these
 * INSIDE ITS `params`/`defaults` — that is the gate that stops a fourth home
 * appearing. It is scoped to those objects rather than the whole document
 * because geometry and pin vocabulary legitimately share spellings: measured
 * by lego-38 on 2026-09-13, all 267 sidecars carry a top-level `w` (width) and
 * ten name pins `rs`, `k`, `rd` in `footprint.leads`.
 *
 * EVERY NAME HERE IS ONE THE SOLVER ACTUALLY READS, and
 * test/parts-library-one-authority.test.mjs proves it by scanning src/. The
 * first draft also carried `w`, `l`, `bf`, `kp` and `vce_sat`: `w`/`l` were
 * read by nothing and were exactly what collided with 267 documents' geometry,
 * while `bf` and `kp` were SPICE spellings of `beta` and `k` — a second
 * vocabulary for one number, which is the failure this file exists to end,
 * arriving inside the fix for it.
 *
 * A schema entry nothing reads is a claim with no holder. Here it also
 * generated a false positive across an entire corpus of documents.
 * @type {ReadonlySet<string>}
 */
export const ELECTRICAL_FIELDS = Object.freeze(new Set([
    'vf', 'rd', 'rs', 'is', 'n', 'vz',              // junctions
    'beta', 'vbe',                                   // bipolar
    'vth', 'k',                                      // field-effect
    'ohms', 'farads', 'henries', 'volts', 'amps'     // passives and sources
]));

/**
 * @typedef {object} Card
 * @property {string} id            part number as printed on the device
 * @property {string} kind          the bw-board kind whose stamp it uses
 * @property {string} provenance    WHERE each number came from — required
 * @property {object} params        parameters, keys drawn from ELECTRICAL_FIELDS
 * @property {string} [spiceModel]  the SPICE .model body, derived if absent
 * @property {string} [note]        anything a reader would otherwise ask about
 */

/** @type {Record<string, Card>} */
const CARDS = {
    // ---- silicon signal diodes -------------------------------------------
    '1N4148': {
        id: '1N4148', kind: 'diode',
        provenance: 'test/golden/run_ngspice_diode.py, the reference deck this '
            + "repo's SILICON_RD was derived from; agreed with bw-circuit-ui's "
            + 'exporter before this library existed',
        params: {is: 2.52e-9, rs: 0.568, n: 1.752, vf: 0.7},
        note: 'vf 0.7 is the datasheet TOTAL drop at I_RATED, not the knee. The '
            + 'piecewise path converts with kneeFromVf; the exponential path '
            + 'calibrates is from it. Both read this one number.'
    },
    '1N4001': {
        id: '1N4001', kind: 'diode',
        provenance: 'rectifier class: vf 1.0 V at 1 A is the datasheet figure; '
            + 'rs and n are the 1N4148 shape scaled to that drop and are NOT '
            + 'measured — flagged so the first corpus disagreement lands here',
        params: {is: 1.0e-9, rs: 0.045, n: 1.9, vf: 1.0}
    },
    // ---- LED --------------------------------------------------------------
    'LED_RED': {
        id: 'LED_RED', kind: 'led',
        provenance: 'THE 10/2/5 RECONCILIATION. rd = 10 is board.js LED_RD, the '
            + 'value the piecewise path has always used and the one the '
            + 'exponential path should have shared; rs = 2 and the exporter\'s '
            + 'Rs = 5 were the other two homes and are retired here. n = 1.8 is '
            + "mna.js junctionOpts' LED default.",
        params: {vf: 2.0, rd: 10, rs: 10, n: 1.8},
        note: 'rs === rd deliberately: they are the same physical quantity, and '
            + 'while they differed the routing toggle switched DEVICES rather '
            + 'than models. Held by test/junction-rs-divergence.test.mjs.'
    },
    // ---- bipolar ----------------------------------------------------------
    '2N2222': {
        id: '2N2222', kind: 'npn',
        provenance: "bw-circuit-ui exporters/spice.js '.model 2N2222 NPN "
            + "(Bf=200 Is=1e-14)' — the fleet's existing figure, moved here "
            + 'rather than restated; vbe 0.7 is bw-board\'s npn default',
        params: {beta: 200, is: 1e-14, vbe: 0.7}
    },
    '2N2907': {
        id: '2N2907', kind: 'pnp',
        provenance: "bw-circuit-ui exporters/spice.js '.model 2N2907 PNP "
            + "(Bf=200 Is=1e-14)'",
        params: {beta: 200, is: 1e-14, vbe: 0.7}
    },
    'TIP120': {
        id: 'TIP120', kind: 'npn',
        provenance: "bw-circuit-ui exporters/spice.js '.model TIP120 NPN "
            + "(Bf=1000 Is=1e-12)'; a Darlington, so beta is the pair's",
        params: {beta: 1000, is: 1e-12, vbe: 1.4},
        note: 'vbe 1.4 not 0.7: a Darlington has two junctions in series. The '
            + 'exporter card did not say so and the solver default would have '
            + 'used 0.7 — the first substantive disagreement this library '
            + 'settles rather than inherits.'
    },
    // ---- zener ------------------------------------------------------------
    '1N4733A': {
        id: '1N4733A', kind: 'zener',
        provenance: "bw-circuit-ui exporters/spice.js '.model 1N4733A D "
            + "(Is=1e-12 BV=5.1)'",
        params: {is: 1e-12, vz: 5.1, vf: 0.7},
        note: 'vz only. The first draft of this card carried BOTH vz: 5.1 and '
            + "bv: 5.1 -- the same number in two vocabularies, which is the "
            + 'failure this whole file exists to end, committed inside the fix '
            + "for it. The solver reads vz; SPICE spells it BV, and "
            + 'spiceModelFor derives that spelling rather than storing it.'
    }
};

/** @returns {Card|null} the card for a part id, case-insensitively. */
export const cardFor = id => {
    if (typeof id !== 'string') return null;
    const key = Object.keys(CARDS).find(k => k.toLowerCase() === id.toLowerCase());
    return key ? CARDS[key] : null;
};

/** Every card id we ship. */
export const cardIds = () => Object.keys(CARDS);

/** Every card, for gates that must enumerate rather than sample. */
export const allCards = () => Object.values(CARDS);

/**
 * Resolve a part's effective params: the card's numbers, with anything set
 * explicitly on the part winning.
 *
 * Explicit wins because a user who typed a number meant it. A card is a
 * DEFAULT with provenance, not an override.
 */
export const resolveParams = (params = {}) => {
    const card = cardFor(params.part);
    return card ? {...card.params, ...params} : params;
};

/**
 * The SPICE `.model` body for a card, derived from the SAME numbers the solver
 * uses. Nothing here may be typed independently of `params` — that is the whole
 * point, and test/parts-library-one-authority.test.mjs asserts a card change
 * moves the emitted text.
 */
export const spiceModelFor = id => {
    const c = cardFor(id);
    if (!c) return null;
    const p = c.params;
    const num = v => (v === undefined ? null : String(v));
    if (c.kind === 'diode' || c.kind === 'led') {
        const bits = [`Is=${num(p.is ?? isFromVf(p))}`, `Rs=${num(p.rs)}`, `N=${num(p.n)}`];
        return {name: c.id, type: 'D', body: bits.filter(b => !b.endsWith('null')).join(' ')};
    }
    if (c.kind === 'zener') {
        // BV is SPICE's spelling of the solver's vz — derived, never stored twice.
        return {name: c.id, type: 'D', body: `Is=${num(p.is)} BV=${num(p.vz)}`};
    }
    if (c.kind === 'npn' || c.kind === 'pnp') {
        return {name: c.id, type: c.kind.toUpperCase(),
            body: `Bf=${num(p.beta)} Is=${num(p.is)}`};
    }
    return null;
};

/** Is calibrated so junction + rs drop exactly vf at I_RATED — mna.js's rule. */
const isFromVf = p => {
    if (p.vf === undefined || p.n === undefined) return undefined;
    const nVt = p.n * 0.02585;
    const vJ = p.vf - I_RATED * (p.rs ?? 0);
    return 0.020 / (Math.exp(vJ / nVt) - 1);
};
