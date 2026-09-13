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
export function toNgspice(circuit, {analysis = '.op'} = {}) {
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
    lines.push(analysis, '.END');
    return lines.join('\n') + '\n';
}

/**
 * Parse ngspice batch `.op` output into {node: volts}.
 *
 * IT IS A TABLE, NOT `V(n)=x`. Batch mode prints
 *
 *     \tNode                                  Voltage
 *     \t----                                  -------
 *     \tn2                               6.666667e+00
 *
 * with the node name BARE. The interactive `print v(2)` form does use
 * `v(2) = ...`, and assuming that form here produced "0 nodes compared" across
 * all 14 circuits — twice, because the first fix guessed at the separator
 * instead of reading the output. Zero compared must never read as agreement,
 * so the caller is expected to treat an empty result as a failure to measure.
 */
export function parseOp(stdout) {
    const v = {};
    const lines = stdout.split('\n');
    let inTable = false;
    for (const line of lines) {
        if (/^\s*Node\s+Voltage\s*$/.test(line)) { inTable = true; continue; }
        if (!inTable) continue;
        if (/^\s*(Source\s+Current|-+\s*$)/.test(line)) { if (/Source/.test(line)) break; continue; }
        const m = line.match(/^\s*([A-Za-z0-9_.#]+)\s+([-+]?[\d.]+e[-+]?\d+|[-+]?[\d.]+)\s*$/i);
        if (m) v[m[1].toLowerCase()] = Number(m[2]);
        else if (line.trim() === '') { /* blank inside the table is tolerated */ }
    }
    return v;
}
