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
 * test/parts-library-one-authority.test.mjs proves it by scanning src/.
 *
 * `w`, `l` and `kp` were REMOVED and then PUT BACK, and the round trip is the
 * point. They were dropped because nothing read them — which was true, and the
 * wrong conclusion. Every real SPICE model card specifies a MOSFET as KP with
 * per-instance W and L, so refusing them meant no foreign netlist could be read
 * without a hand conversion, and the corpus work depends on ingesting thousands
 * (2,822 MOSFET topologies in one dataset alone). The solver was EXTENDED
 * instead: `mosK()` in mna.js accepts either spelling, k = KP/2 * W/L, verified
 * against ngspice LEVEL=1. Widening the vocabulary beat discarding the fields.
 *
 * `bf` and `vce_sat` stay out, and for a different reason: `bf` is SPICE's
 * spelling of `beta`, one number with two names, which belongs in an importer's
 * spelling map and never in a card; `vce_sat` names behaviour our BJT does not
 * model, so a card carrying it would promise something the stamp cannot do.
 *
 * A schema entry nothing reads is a claim with no holder. Here it also
 * generated a false positive across an entire corpus of documents.
 * @type {ReadonlySet<string>}
 */
export const ELECTRICAL_FIELDS = Object.freeze(new Set([
    'vf', 'rd', 'rs', 'is', 'n', 'vz',              // junctions
    'beta', 'br', 'vbe', 'rceSat',                   // bipolar (br = reverse beta)
    'vth', 'k', 'kp', 'w', 'l',                      // field-effect
    'ohms', 'farads', 'henries', 'volts', 'amps',    // passives and sources
    'kV', 'contactOhms', 'openOhms'                  // motor back-EMF, relay contacts
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
        id: 'LED_RED', kind: 'led', generic: true,
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
        id: 'TIP120', kind: 'tip120',
        provenance: "bw-circuit-ui exporters/spice.js '.model TIP120 NPN "
            + "(Bf=1000 Is=1e-12)'; a Darlington, so beta is the pair's",
        params: {beta: 1000, is: 1e-12, vbe: 1.4, rceSat: 2.0},
        note: 'KIND tip120, not npn. It has its OWN stamp — '
            + "devices/analog-ics.js registerDevice('tip120') — reading vbe and "
            + 'rceSat, so under the rule "a kind exists when the stamp differs" '
            + 'a card naming npn would never reach it: a placed tip120 would '
            + 'ignore the card and a placed npn+part:TIP120 would miss the '
            + 'Darlington stamp. Two homes again, caught by lego-38 reading the '
            + 'registry. The 1.4 was right on its own — that stamp already '
            + "defaults vbe to 1.4 with the comment '2 x 0.7V' — so the card "
            + 'agreed with the solver about the number while disagreeing about '
            + 'which solver.'
    },
    // ---- generics -----------------------------------------------------------
    // Not real part numbers. They exist so bw-circuit-ui's exporter can derive
    // EVERY .model line it emits from this library rather than leaving two
    // literals behind — a literal left behind is the fourth home returning by
    // the back door. `id` is the .model name the exporter already emits.
    //
    // `generic: true` IS MACHINE-READABLE ON PURPOSE, AND IT ANSWERS EXACTLY
    // ONE QUESTION: is this card an orderable part number? It is NOT a claim
    // about reachability, and the two came apart the moment the mark existed.
    //
    // The mark was added for lego-38's reachability gate, which asks "can a
    // user get to this card" — and for Q_DEFAULT and NMOS_GENERIC the answer is
    // "only through its CLASS", since nothing offers "NMOS_GENERIC" in a menu.
    // It is tempting to read `generic` as "not nameable", and their exporter
    // briefly did: it refused a generic that the palette also names. LED_RED
    // breaks that reading — it is marked because "a red LED" is not something
    // you order by that name, yet it is plainly a palette entry. So a consumer
    // must ask reachability PER CASE (a generic through its class, a kind that
    // IS the part through its kind, a part number on a shared class by name)
    // and use this field only for what it says.
    //
    // Derive the set: `allCards().filter(c => c.generic)`. Without the mark
    // that list is hand-kept in the other repo, which is one more place the two
    // of us can disagree about which cards are real parts.
    'Q_DEFAULT': {
        id: 'Q_DEFAULT', kind: 'npn', generic: true,
        provenance: "bw-circuit-ui exporters/spice.js '.model Q_DEFAULT NPN "
            + "(Bf=100 Is=1e-14)', and beta 100 is also mna.js's npn default — "
            + 'the two already agreed, which is why this one is a move and not '
            + 'a decision',
        params: {beta: 100, is: 1e-14, vbe: 0.7}
    },
    // THE GENERIC PNP, the counterpart of Q_DEFAULT, added because its absence
    // was measurable. bw-circuit-ui's symbol table falls back to a NAMED part
    // number for an un-carded transistor — `2N2222` for npn, `2N2907` for pnp —
    // and both of those carry Bf = 200 while the solver's default for a bare
    // transistor is 100. So a placed-and-unconfigured transistor was exported
    // as a device with TWICE the beta it was solved with.
    //
    // Measured on `10-motor-speed`: the engine put the collector at 0.912 V
    // (Ic = beta*Ib = 409 mA, still active at Bf = 100) and ngspice at 0.147 V
    // (saturated at Bf = 200), a 15.8 % split on supply current across 15
    // circuits. Not a model gap — the two sides were describing different
    // transistors, which is what a generic card exists to stop.
    'Q_DEFAULT_PNP': {
        id: 'Q_DEFAULT_PNP', kind: 'pnp', generic: true,
        provenance: "the pnp mirror of Q_DEFAULT: beta 100 is mna.js's default "
            + 'for a bare transistor of either polarity (`part.params.beta ?? '
            + '100` in stampNPN and stampPNP alike), and Is 1e-14 matches '
            + 'Q_DEFAULT. Named rather than inherited so an exporter has one '
            + 'card to resolve to instead of a part number that is not the '
            + 'device on the bench.',
        params: {beta: 100, is: 1e-14, vbe: 0.7}
    },
    'NMOS_GENERIC': {
        id: 'MOSFET', kind: 'nmos', generic: true,
        provenance: "bw-circuit-ui exporters/spice.js '.model MOSFET NMOS "
            + "(Vto=2 Kp=20u)'; vth 2.0 is mna.js's nmos default. Carries kp "
            + 'rather than k now that mna.js mosK() reads either: k = KP/2 * '
            + 'W/L, so a card can hold the SPICE-native number and the exporter '
            + 'emits it unchanged instead of converting.',
        params: {vth: 2.0, kp: 20e-6}
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

/**
 * The parameters an UN-CARDED part of a given kind solves with.
 *
 * WHY THIS EXISTS, and it is the third home. A part with no `params.part` never
 * touches a card, so its numbers came from literals inside `junctionOpts` —
 * `rs ?? 2` among them. bw-circuit-ui's exporter then had to guess what those
 * literals were in order to write a deck the engine would agree with, and its
 * old `?? 2` matched only by copy. When the exporter moved to JUNCTION_RD the
 * copy stopped matching and the spice-oracle job reddened: engine 1.879795 V
 * against ngspice 1.748971 V on the canonical bench, measured by lego-38.
 *
 * That red is correct and is the point. The defaults are now DECLARED here and
 * read by `junctionOpts`, so there is one definition rather than a literal and
 * a guess at it.
 *
 * @param {string} kind
 * @returns {object} the class defaults, or {} for a kind with none
 */
export const classDefaults = kind => ({
    led:   {rs: 10, n: 1.8, vf: 2.0},
    diode: {rs: 0.568, n: 1.752, vf: 0.7},
    zener: {rs: 0.568, n: 1.752, vf: 0.7},

    // ── DC-equivalent resistance of a part the exporter cannot spell ──
    //
    // A buzzer, a motor winding and a relay coil are each a resistance the
    // SOLVER applies and any exporter must reproduce, which is the same kind of
    // number as a junction's rd and belongs in the same place. They were in
    // three different homes and none of them was here:
    //
    //   buzzer     `const g = 1 / 100` inside stampBuzzerResistance — no param,
    //              not even a named constant, and buzzer is not a registered
    //              device so there was nowhere else to look
    //   dc_motor   `part.params?.windingR ?? part.params?.R ?? 10`  (devices/dc-motor.js)
    //   relay      `part.params?.coilR ?? 200`                      (devices/relay.js)
    //
    // The two device defaults stay reachable by their own param names — `R` is
    // an accepted alias on the motor and gallery circuits use it — so this
    // changes where the DEFAULT lives, not how a part is configured.
    //
    // THESE ARE NOT THE WHOLE DEVICE, and the exporter must not treat them as
    // such. A motor is this resistance in SERIES WITH A BACK-EMF SOURCE
    // (`theveninBetween('a','b', kV*omega, R)`); it only looks like a resistor
    // at a static operating point because omega is 0 there, which is a property
    // of the moment and not of the part. A relay is this coil PLUS contacts
    // stamped as controlled switches (0.1 Ohm closed, 1e9 open, with threshold
    // and hysteresis), so emitting one resistor would model the coil and
    // silently delete the contacts — on a relay bench, the entire circuit.
    // Only the buzzer is fully described by its number.
    // The motor needs BOTH numbers or the emit takes one from here and one from
    // the device file, which is the shape we keep closing. Same for the relay's
    // contacts: a coil resistance without them describes a relay that cannot
    // switch.
    // ── BJT EBERS-MOLL PARAMETERS ──
    //
    // `is` and `beta` mirror Q_DEFAULT / the generic PNP card, which the
    // exporter already writes as `.model ... (Bf=100 Is=1e-14)`; they are here
    // so an UN-CARDED npn solves with the same two numbers the deck declares.
    // `br` and `n` are new and are SPICE's own defaults (BR=1, NF=NR=1) — an
    // Ebers-Moll model needs a REVERSE beta and no card carried one, so the
    // choice is stated here rather than as a literal in the stamp.
    //
    // BR = 1 is not a datasheet figure for any real part; it is the value the
    // reference simulator uses when a `.model` line omits it, which is what
    // every deck we export does. A card that carries a measured `br` wins.
    npn:      {is: 1e-14, beta: 100, br: 1, n: 1},
    pnp:      {is: 1e-14, beta: 100, br: 1, n: 1},
    tip120:   {is: 1e-14, beta: 1000, br: 1, n: 1},

    buzzer:   {ohms: 100},
    dc_motor: {ohms: 10, kV: 0.01},
    relay:    {ohms: 200, contactOhms: 0.1, openOhms: 1e9}
}[kind] ?? {});

/**
 * @returns {Card|null} the card for a part id, case-insensitively.
 *
 * RESOLVES BY KEY **OR** BY `id`, because those are allowed to differ and one
 * pair does: the key `NMOS_GENERIC` names the card, the id `MOSFET` is the
 * .model name the exporter emits. Looking up only the key meant
 * `cardFor('MOSFET')` returned null — so the card that exists precisely to stop
 * the exporter emitting a `.model MOSFET` literal could not be found under the
 * name the exporter uses. Two spellings for one card, which is the shape this
 * library exists to end; found by lego-38 wiring the exporter, not here.
 *
 * The alternative was to force key === id. That would have renamed the emitted
 * model and moved deck text for a naming problem, so the split stays and the
 * LOOKUP becomes total instead. `cardIds()` still returns keys; `cardAliases()`
 * returns every name that resolves, which is what a reachability gate needs.
 */
export const cardFor = id => {
    if (typeof id !== 'string') return null;
    const want = id.toLowerCase();
    const key = Object.keys(CARDS).find(k => k.toLowerCase() === want);
    if (key) return CARDS[key];
    const byId = Object.keys(CARDS).find(k => String(CARDS[k].id).toLowerCase() === want);
    return byId ? CARDS[byId] : null;
};

/** Every name `cardFor` resolves — keys plus any `id` that differs from its key. */
export const cardAliases = () => {
    const names = new Set();
    for (const [key, card] of Object.entries(CARDS)) { names.add(key); names.add(card.id); }
    return [...names];
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
    // A DARLINGTON IS AN NPN TO SPICE. The kind exists because our own stamp
    // differs (devices/analog-ics.js reads vbe and rceSat); SPICE has no
    // Darlington primitive, so the deck says NPN with the pair's beta. Branching
    // only on npn/pnp meant a card that EXISTS could not produce a model body,
    // and the exporter then emitted an element line naming a `.model TIP120`
    // the deck never defined — no warning, a deck that reads complete and
    // cannot simulate.
    if (c.kind === 'tip120') {
        return {name: c.id, type: 'NPN', body: `Bf=${num(p.beta)} Is=${num(p.is)}`};
    }
    if (c.kind === 'nmos' || c.kind === 'pmos') {
        // Vto/Kp are SPICE's spellings of vth/kp. kp is stored SPICE-native
        // precisely so this emits it unchanged rather than converting; if a
        // card ever carries `k` instead, that is mosK()'s k = KP/2 * W/L and
        // the conversion belongs here, named, not silently inverted.
        const bits = [`Vto=${num(p.vth)}`, `Kp=${num(p.kp)}`,
            p.w === undefined ? null : `W=${num(p.w)}`,
            p.l === undefined ? null : `L=${num(p.l)}`].filter(Boolean);
        return {name: c.id, type: c.kind === 'nmos' ? 'NMOS' : 'PMOS',
            body: bits.filter(b => !b.endsWith('null')).join(' ')};
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
