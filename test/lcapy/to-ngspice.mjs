/**
 * Neutral description -> an ngspice deck.
 *
 * The THIRD emitter from the same source. `circuits.mjs` is written once and
 * `to-engine`, `to-lcapy` and now `to-ngspice` all generate from it, so a
 * mistake in one description cannot agree with itself across the comparison —
 * which is the property that makes any of this evidence rather than a curve fit.
 *
 * Why a third oracle at all, when lcapy already disagrees independently: lcapy
 * solves SYMBOLICALLY and returns exact rationals, so it is the better judge of
 * a linear network but cannot help with a junction. ngspice is numeric and
 * models devices. Where the two agree and we do not, it is us. Where THEY
 * disagree, the circuit is degenerate or ill-posed and the case belongs in
 * neither corpus — which is a verdict no single oracle can deliver.
 *
 * Conventions are those of to-engine.mjs, restated so a reader can check them
 * against SPICE's own rather than infer them:
 *   ['V', ref, n1, n2, volts]  ->  V(n1) - V(n2) = volts        `Vref n1 n2 volts`
 *   ['I', ref, from, to, amps] ->  amps injected into `to`.
 *      SPICE's `Iref na nb amps` drives current FROM na THROUGH the source TO
 *      nb internally, i.e. OUT of nb into the circuit. So `to` is nb.
 */
export function toNgspice(circuit, {analysis = '.op', precision = false} = {}) {
    const lines = [`* ${circuit.name}`];
    let needsDiodeModel = false;
    for (const [type, ref, n1, n2, value] of circuit.parts) {
        const a = n1 === 0 ? '0' : `n${n1}`, b = n2 === 0 ? '0' : `n${n2}`;
        if (type === 'R') lines.push(`R${ref} ${a} ${b} ${value}`);
        else if (type === 'C') lines.push(`C${ref} ${a} ${b} ${value}`);
        else if (type === 'L') lines.push(`L${ref} ${a} ${b} ${value}`);
        else if (type === 'V') lines.push(`V${ref} ${a} ${b} ${value}`);
        else if (type === 'I') lines.push(`I${ref} ${a} ${b} ${value}`);
        else if (type === 'D') { lines.push(`D${ref} ${a} ${b} DMOD`); needsDiodeModel = true; }
        else throw new Error(`to-ngspice: unhandled neutral type ${type} in ${circuit.name}`);
    }
    if (needsDiodeModel) {
        // The same 1N4148 our own SILICON_RD is derived from, so a diode
        // disagreement is about the SOLVER and not about two different parts.
        lines.push('.MODEL DMOD D (IS=2.52E-9 RS=0.568 N=1.752)');
    }
    if (precision) {
        // THE `.op` TABLE IS FIXED AT SEVEN SIGNIFICANT FIGURES, and that is a
        // property of the PRINT FORMAT, not of the solve. `series-three` reads
        // 1.015385e+01 where ngspice actually computed 10.153846153846150, so
        // comparing at 1e-6 charged us a 3.8e-6 "disagreement" that does not
        // exist -- our own answer is within 1.2e-9 of it. `.options numdgt` does
        // NOT change the table; only the interactive `print` does, and it needs
        // a .control block.
        //
        // Do not widen a tolerance to absorb an instrument's rounding. Read the
        // instrument at the precision it can actually give.
        const nodes = [...new Set(circuit.parts
            .flatMap(([, , n1, n2]) => [n1, n2])
            .filter((n) => n !== 0))].sort((a, b) => a - b);
        lines.push('.control', 'set numdgt=15', analysis.replace(/^\./, ''),
            `print ${nodes.map((n) => `v(n${n})`).join(' ')}`, '.endc');
    } else {
        lines.push(analysis);
    }
    lines.push('.END');
    return lines.join('\n') + '\n';
}

/**
 * Parse ngspice batch output into `{node: volts}`.
 *
 * RE-EXPORTED, NOT REDEFINED. This lived here first and now lives in
 * `src/ngspice.js`, because `bwc oracle` needs the same parser and a second
 * copy of a format rule is how the format rule rots. The full account of both
 * output forms -- and of the two development runs where a guessed regex
 * returned {} for all 14 circuits, which reads as agreement -- is in that file.
 */
export { parseOp } from '../../src/ngspice.js';
