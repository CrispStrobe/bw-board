/**
 * Neutral description -> lcapy netlist.
 *
 * lcapy sign conventions, stated explicitly because they are the classic
 * source of a false mismatch:
 *   V1 np nm dc v   -- np is the + terminal, so V(np) - V(nm) = v
 *   I1 np nm dc i   -- INJECTS into np and sinks from nm. Established by
 *                      hand arithmetic, not by reading: 2 mA through 4k7 to
 *                      ground must give +9.4 V, and `I1 0 1` gives -9.400
 *                      while `I1 1 0` gives +9.400.
 *
 * The neutral spec's ['I', ref, from, to, amps] means amps are drawn from
 * `from` and injected into `to`, so the operands are SWAPPED here. Pinning the
 * physical meaning first and then making each translator honour it is what
 * keeps this a comparison rather than a curve fit.
 */
export function toLcapy(circuit) {
  const lines = [];
  for (const [type, ref, n1, n2, value] of circuit.parts) {
    if (type === 'V') lines.push(`${ref} ${n1} ${n2} dc ${value}`);
    else if (type === 'R') lines.push(`${ref} ${n1} ${n2} ${value}`);
    else if (type === 'I') lines.push(`${ref} ${n2} ${n1} dc ${value}`);   // swap: see above
    else if (type === 'C') lines.push(`${ref} ${n1} ${n2} ${value}`);
    else if (type === 'L') lines.push(`${ref} ${n1} ${n2} ${value}`);
    else throw new Error(`unknown component type ${type}`);
  }
  return lines.join('\n');
}
