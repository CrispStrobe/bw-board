/**
 * Dual-function package pins — one physical pin, two datasheet names.
 *
 * Boundary A addresses pins BY NAME. A chip whose package pin carries two
 * names depending on a configuration bit therefore has two names for one
 * node, and whichever one a netlist happens to have been authored with is
 * the only one that drives — the other is indistinguishable from a pin that
 * does not exist. That is not a naming preference; it is measurable, and it
 * was measured on 60-retro-console before this file existed (see below).
 *
 * MEASURED 2026-08-31, bw-board 6571648 + bw-circuit-ui 14efc75, on
 * sb3-creator's `examples/60-retro-console/circuit.stc12c5a60s2.json`
 * loaded through the canonical loader. The bench wires `mcu1.P4.7` to a
 * 1 kOhm resistor into a PNP base; the PNP's emitter is VCC and its
 * collector drives the buzzer. Volts at r1.a / q1.base / q1.collector:
 *
 *   idle (no setPin)                4.990020 / 4.990020 / 0.000000
 *   setPin('P4.7', pushpull, LOW)   0.103865 / 4.258454 / 4.795205  <- buzzer on
 *   setPin('P4.7', pushpull, HIGH)  5.000000 / 5.000000 / 0.000000
 *   setPin('p4.7', ...)             identical to 'P4.7' (the case-blind join)
 *   setPin('RST',  pushpull, LOW)   4.990020 / 4.990020 / 0.000000
 *   setPin('RST',  pushpull, HIGH)  4.990020 / 4.990020 / 0.000000
 *   setPin('ZZ.NOPE', any)          4.990020 / 4.990020 / 0.000000
 *
 * So the engine DOES model that pin as a drivable GPIO — under the spelling
 * `P4.7`, and only that spelling. `RST` moved nothing: it is bit-identical
 * to the nonexistent-terminal control. The 8051 adapter emits `P${port}.
 * ${bit}`, so `P4.7` is exactly what reaches setPin when firmware writes
 * P4^7; no adapter ever emits `RST`.
 *
 * bw-parts' own datasheet audit already carried the dual name and ledgered
 * the gap — `docs/pin-table-stc12c5a60s2.md` row 9 reads "RST / P4.7" with
 * the note that the sidecar omits the P4.7 alias. This file closes it on
 * the side that owns names.
 *
 * UNIQUE MATCH, and it is the whole safety argument. The alias fires only
 * when the part declares EXACTLY ONE of the pair. A part declaring both has
 * two distinct terminals and each keeps its own drives; a part declaring
 * neither is untouched. So this can never merge two pins that a netlist
 * meant to keep apart, and it can never silently pick between two
 * candidates. Measured over sb3-creator's corpus at the pinned pair — 2163
 * circuit files — exactly three kind-'mcu' parts name either spelling:
 * 60-retro-console's two variants declare `P4.7` and not `RST`, and
 * 51-tft-pixels' flat STC12 bench declares `RST` and not `P4.7`. Zero
 * declare both, so the ambiguous case does not occur in the corpus and is
 * refused by construction anyway.
 *
 * SCOPE: kind 'mcu' only — the arbitrary-package surface the STC12 body
 * loads as. Registered board-kind models (`stc15_mcu`, `attiny88`, the
 * Arduino bodies) declare their own terminal lists from their own pinouts
 * and are NOT aliased: the STC15's reset shares P5.4 on pin 17, not P4.7,
 * so the same pair would be a lie there.
 *
 * READ SIDE DELIBERATELY UNTOUCHED, also measured: on 60-retro-console the
 * package leadMap seats lead 9 as `RST` at hole f11, which is its own net
 * (bb1:n-col-b11) carrying nothing else, while the drawn wire from `P4.7`
 * lands on bb1:n-col-t51 with r1.a. `readPin('RST')` therefore already
 * resolves — to that empty seat column — and aliasing reads would have
 * replaced a true answer about a real net with the other one, hiding a
 * genuine bench split rather than reporting it. Drives alias; reads do not.
 *
 * @module
 */

/**
 * Pairs of names for one physical pin, lowercased (the join is case-blind,
 * so these are canonical keys, not spellings).
 *
 * Add a pair only with a datasheet citation and a measurement. Every entry
 * makes two names mean one node, which is exactly the class of change that
 * can move a bench without anyone noticing.
 *
 * - `p4.7` / `rst`: STC12C5A60S2 PDIP-40 pin 9. RST by default; GPIO P4.7
 *   only once the P4SW configuration bit selects it. bw-parts
 *   `docs/pin-table-stc12c5a60s2.md` row 9, "Trap 4: Only P4.4-P4.7 on
 *   PDIP-40".
 *
 * @type {ReadonlyArray<readonly [string, string]>}
 */
export const DUAL_FUNCTION_PINS = Object.freeze([
  Object.freeze(/** @type {readonly [string, string]} */ (['p4.7', 'rst'])),
]);

/** @type {Map<string, string>} lowercased name → the other name for that pin */
const ALIAS = new Map();
for (const [a, b] of DUAL_FUNCTION_PINS) {
  ALIAS.set(a, b);
  ALIAS.set(b, a);
}

/**
 * The other datasheet name for a dual-function pin.
 * @param {string} keyLower already-lowercased pin name
 * @returns {string | undefined} the alias, or undefined when the pin has none
 */
export function dualFunctionAlias(keyLower) {
  return ALIAS.get(keyLower);
}

/**
 * Build the per-part alias table for one netlist.
 *
 * Returns, per MCU-surface part that needs one, a map from the part's own
 * declared terminal (lowercased, since the join is case-blind) to the OTHER
 * name for that physical pin — so a drive arriving under either spelling
 * reaches the same node. Parts declaring both names, or neither, get no
 * entry (unique match).
 *
 * Computed once per netlist rather than per solve: the lookups this feeds
 * run on every edge and every source trace, and the load-sensitive setPin
 * budgets are not this lane's to spend. `null` when no part needs one,
 * which is every bench but three in the shipped corpus, so the hot paths
 * pay a single optional-chain miss.
 *
 * @param {ReadonlyArray<{id: string, kind: string, terminals?: ReadonlyArray<string>}>} parts
 * @returns {Map<string, Map<string, string>> | null} partId → (declared terminal lowercased → alias key), or null
 */
export function buildPinAliasTable(parts) {
  /** @type {Map<string, Map<string, string>>} */
  const out = new Map();
  for (const part of parts) {
    // Only the arbitrary-package surface; see the SCOPE note above.
    if (part.kind !== 'mcu') continue;
    const terminals = part.terminals ?? [];
    const declared = new Set(terminals.map(t => String(t).toLowerCase()));
    /** @type {Map<string, string>} */
    const forPart = new Map();
    for (const terminal of terminals) {
      const key = String(terminal).toLowerCase();
      const alias = ALIAS.get(key);
      // Unique match: the part must declare this name and NOT the other.
      if (alias === undefined || declared.has(alias)) continue;
      forPart.set(key, alias);
    }
    if (forPart.size) out.set(part.id, forPart);
  }
  return out.size ? out : null;
}
