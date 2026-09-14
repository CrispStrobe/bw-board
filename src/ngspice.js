/**
 * ngspice as an oracle: deck conventions, and reading what it prints.
 *
 * ONE HOME FOR THE DECK RULES. These were each paid for with a wrong answer
 * that looked right, and they are the kind of knowledge that rots the moment it
 * lives in two places. `test/lcapy/to-ngspice.mjs` and bw-circuit-ui's `bwc
 * oracle` both import from here rather than each carrying a copy.
 *
 * THE FOUR RULES:
 *
 * 1. THE FIRST LINE OF A DECK IS THE TITLE. A deck starting `V1 1 0 5` silently
 *    drops the source and every node sits at 0 V.
 *
 * 2. `.options temp=X tnom=X` — BOTH. `temp` alone leaves a flat +0.686 mV at
 *    every current, because ngspice rescales a diode's IS from its TNOM=27
 *    default to the requested temperature via the bandgap law. A constant
 *    offset across decades of current is therefore neither `n` (which would
 *    scale with ln i) nor `rs` (which would scale with i) -- read the SHAPE of
 *    a residue before attributing it. With tnom pinned, agreement is 2e-7 V
 *    over four decades where the "floor" had been recorded as 0.04 %.
 *
 * 3. THE BATCH `.op` TABLE IS CAPPED AT SEVEN SIGNIFICANT FIGURES, and it
 *    prints BARE node names, not `V(n)=x`. `.options numdgt` does NOT widen it;
 *    only `print` inside a `.control` block does. A 3.8e-6 "disagreement" was
 *    that rounding sitting on top of a real 1.2e-9 agreement. Ask for the
 *    precision form when you intend to compare tightly.
 *
 * 4. `.model D` SILENTLY CLAMPS IS AT 1e-28. No warning on stdout, stderr or in
 *    the raw file. An LED calibrated to drop vf at 20 mA needs
 *    Is = 0.02/exp((vf - 0.02*rs)/(n*Vt)), so above about 2.86 V at n=1.8 the
 *    part is unrepresentable AS A DIODE MODEL. It is NOT unrepresentable in
 *    ngspice: a behavioural source carries no clamp and makes ngspice's own
 *    Newton and limiting solve the identical device. Validated against
 *    `.model D` on a part both forms express -- 5e-6 relative at three
 *    operating points. `junctionCard()` below picks the form automatically.
 */
import { JUNCTION_I_RATED } from './mna.js';

/** ngspice's silent diode-model saturation-current floor. */
export const NGSPICE_IS_CLAMP = 1e-28;

/**
 * The temperature `VT_25C = 0.02585` actually is, in Celsius.
 *
 * Not 25. kT/q = 0.02585 V solves to 299.977 K = 26.8268 C. Pinning ngspice
 * here rather than "fixing" VT is deliberate: VT_25C is the engine's own
 * constant and thousands of corpus values are calibrated to it, so the ORACLE
 * moves to the engine's temperature for the comparison, and the 0.17 K
 * discrepancy with a nominal 25 C stays a known, named property of the engine
 * rather than being smeared into the oracle.
 */
export const ORACLE_TEMP_C = 0.02585 * 1.602176634e-19 / 1.380649e-23 - 273.15;

/**
 * The `.options` line every deck needs. Both keys, always -- see rule 2.
 *
 * PRECISION IS LOAD-BEARING HERE, and `toFixed(6)` was not enough. Rounding the
 * temperature to a microkelvin moves the thermal voltage by 1.4736794688e-9
 * relative -- small, and NOT small compared with the agreement this card exists
 * to produce, which is 2e-7 V over four decades of current. A deck that names a
 * rounded temperature cannot round-trip the constant it was derived from, so
 * "strict thermal equality" would be a claim the emitted text does not support.
 * Caught in review by the corpus lane; verified at 1.47e-9 before changing it.
 *
 * 12 significant digits, via toPrecision rather than a fixed decimal count, so
 * the emitted value re-reads as the same double. ngspice parses it fine.
 */
export const optionsCard = (tempC = ORACLE_TEMP_C) => {
  const t = Number(tempC).toPrecision(12);
  return `.options temp=${t} tnom=${t}`;
};

/**
 * Saturation current for a junction calibrated to drop `vf` at the rated
 * current -- the same rule `shockleyParams` uses, so the deck and the solve
 * describe one device.
 */
export const isFromVf = (vf, n, rs, iRated = JUNCTION_I_RATED) =>
  iRated / Math.expm1((vf - iRated * rs) / (n * 0.02585));

/**
 * A junction as deck lines, choosing the representable form.
 *
 * Returns `{lines, form}` where `form` is 'model' or 'bsource'. Above the clamp
 * a `.model D` is exact and cheap; below it the model would be silently
 * substituted, so the behavioural pair is emitted instead:
 *
 *     B<ref> <a> <internal> I = <Is>*(exp(V(<a>,<internal>)/<nVt>)-1)
 *     R<ref>s <internal> <k> <rs>
 *
 * The junction sits between the anode and an INTERNAL node with the bulk
 * resistance below it. Getting that topology backwards still produces plausible
 * numbers, which is why the caller is expected to have validated the form on a
 * part both can express.
 */
export function junctionCard(ref, anode, cathode, {vf, n, rs, is}) {
  const Is = is ?? isFromVf(vf, n, rs);
  const model = `${ref}MOD`;
  if (Is >= NGSPICE_IS_CLAMP) {
    return {
      form: 'model',
      lines: [`D${ref} ${anode} ${cathode} ${model}`,
        `.model ${model} D(IS=${Is.toExponential(10)} N=${n} RS=${rs})`],
    };
  }
  const nVt = n * 0.02585;
  const mid = `n_${ref}_j`;
  return {
    form: 'bsource',
    lines: [
      `B${ref} ${anode} ${mid} I = ${Is.toExponential(12)}*(exp(V(${anode},${mid})/${nVt.toPrecision(12)})-1)`,
      `R${ref}s ${mid} ${cathode} ${rs}`,
    ],
  };
}

/**
 * Wrap an analysis so ngspice prints at full precision -- see rule 3.
 *
 * `nodes` are bare node names; the caller passes the ones it intends to read.
 * With no nodes the plain `.op` table is emitted, which is what a hand-written
 * deck produces and what `parseOp` must still handle.
 */
export function analysisCard(nodes = []) {
  if (!nodes.length) return ['.op'];
  return ['.control', 'set numdgt=15', 'op',
    `print ${nodes.map(n => `v(${n})`).join(' ')}`, '.endc'];
}

/**
 * Parse ngspice batch output into `{node: volts}`.
 *
 * HANDLES BOTH FORMS, and that is not defensiveness. The `.control`/`print`
 * form gives `v(n2) = 1.0e+01` at full precision; the bare `.op` form gives a
 * TABLE with the node name BARE:
 *
 *     Node                                  Voltage
 *     ----                                  -------
 *     n2                               6.666667e+00
 *
 * Assuming the interactive `v(2) = ...` shape produced "0 nodes compared"
 * across all 14 circuits TWICE during development, because the first two fixes
 * guessed at the format instead of reading it. AN EMPTY RESULT MUST NEVER READ
 * AS AGREEMENT: a per-node loop over `{}` passes every assertion inside it, so
 * every caller is expected to assert the population separately.
 */
export function parseOp(stdout) {
  const v = {};
  let inTable = false;
  for (const line of String(stdout).split('\n')) {
    const pm = line.match(/^\s*v\(([A-Za-z0-9_.#]+)\)\s*=\s*([-+]?[\d.]+(?:e[-+]?\d+)?)\s*$/i);
    if (pm) { v[pm[1].toLowerCase()] = Number(pm[2]); continue; }
    if (/^\s*Node\s+Voltage\s*$/.test(line)) { inTable = true; continue; }
    if (!inTable) continue;
    if (/^\s*Source\s+Current/.test(line)) break;
    if (/^\s*-+\s*$/.test(line)) continue;
    const m = line.match(/^\s*([A-Za-z0-9_.#]+)\s+([-+]?[\d.]+e[-+]?\d+|[-+]?[\d.]+)\s*$/i);
    if (m) v[m[1].toLowerCase()] = Number(m[2]);
  }
  return v;
}
