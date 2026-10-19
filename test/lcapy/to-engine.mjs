/**
 * Neutral description -> our engine's (parts, nets).
 *
 * Conventions, to be verified against hand arithmetic rather than trusted:
 *   vsource  params.volts, terminals pos/neg, V(pos) - V(neg) = volts
 *   isource  params.amps,  terminals pos/neg, injects into pos
 *
 * The neutral ['I', ref, from, to, amps] means amps are drawn from `from` and
 * injected into `to`, so pos -> `to`.
 */
export function toEngine(circuit) {
  const parts = [{ id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] }];
  const netOf = new Map();                       // node number -> terminal list
  const put = (node, part, terminal) => {
    const id = `n${node}`;
    if (!netOf.has(id)) netOf.set(id, []);
    netOf.get(id).push({ part, terminal });
  };
  put(0, 'GND', 'gnd');

  for (const [type, ref, n1, n2, value] of circuit.parts) {
    if (type === 'R') {
      parts.push({ id: ref, kind: 'resistor', params: { ohms: value }, terminals: ['a', 'b'] });
      put(n1, ref, 'a'); put(n2, ref, 'b');
    } else if (type === 'V') {
      parts.push({ id: ref, kind: 'vsource', params: { volts: value }, terminals: ['pos', 'neg'] });
      put(n1, ref, 'pos'); put(n2, ref, 'neg');
    } else if (type === 'I') {
      parts.push({ id: ref, kind: 'isource', params: { amps: value }, terminals: ['pos', 'neg'] });
      put(n2, ref, 'pos'); put(n1, ref, 'neg');   // inject into `to`
    } else if (type === 'C') {
      parts.push({ id: ref, kind: 'capacitor', params: { farads: value }, terminals: ['a', 'b'] });
      put(n1, ref, 'a'); put(n2, ref, 'b');
    } else if (type === 'L') {
      parts.push({ id: ref, kind: 'inductor', params: { henries: value }, terminals: ['a', 'b'] });
      put(n1, ref, 'a'); put(n2, ref, 'b');
    } else throw new Error(`unknown component type ${type}`);
  }
  const nets = [...netOf].map(([id, terminals]) => ({ id, terminals }));
  return { parts, nets };
}
