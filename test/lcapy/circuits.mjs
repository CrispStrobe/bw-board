/**
 * Circuits described ONCE, in a neutral form, so both the lcapy netlist and
 * our engine's parts/nets are GENERATED from the same source. Hand-writing
 * each side twice would let a mistake agree with itself.
 *
 * Node 0 is ground. Values are SI (ohms, volts, amps).
 */
export const CIRCUITS = [
  { name: 'divider-1k-2k',
    parts: [['V', 'V1', 1, 0, 10], ['R', 'R1', 1, 2, 1000], ['R', 'R2', 2, 0, 2000]] },

  { name: 'series-three',
    parts: [['V', 'V1', 1, 0, 12], ['R', 'R1', 1, 2, 100], ['R', 'R2', 2, 3, 220], ['R', 'R3', 3, 0, 330]] },

  { name: 'parallel-pair',
    parts: [['V', 'V1', 1, 0, 5], ['R', 'R1', 1, 2, 1000], ['R', 'R2', 2, 0, 1000], ['R', 'R3', 2, 0, 1000]] },

  { name: 'wheatstone-unbalanced',
    parts: [['V', 'V1', 1, 0, 9],
      ['R', 'R1', 1, 2, 1000], ['R', 'R2', 2, 0, 2200],
      ['R', 'R3', 1, 3, 4700], ['R', 'R4', 3, 0, 3300],
      ['R', 'R5', 2, 3, 10000]] },

  { name: 'ladder-r2r',
    parts: [['V', 'V1', 1, 0, 5],
      ['R', 'R1', 1, 2, 1000], ['R', 'R2', 2, 3, 1000], ['R', 'R3', 3, 4, 1000],
      ['R', 'R4', 2, 0, 2000], ['R', 'R5', 3, 0, 2000], ['R', 'R6', 4, 0, 2000]] },

  { name: 'two-sources-opposing',
    parts: [['V', 'V1', 1, 0, 10], ['V', 'V2', 3, 0, 4],
      ['R', 'R1', 1, 2, 1000], ['R', 'R2', 2, 3, 1000], ['R', 'R3', 2, 0, 1000]] },

  { name: 'bridged-tee',
    parts: [['V', 'V1', 1, 0, 6],
      ['R', 'R1', 1, 2, 470], ['R', 'R2', 2, 3, 680], ['R', 'R3', 3, 0, 820],
      ['R', 'R4', 1, 3, 1500], ['R', 'R5', 2, 0, 2700]] },

  { name: 'current-source-into-r',
    parts: [['I', 'I1', 0, 1, 0.002], ['R', 'R1', 1, 0, 4700]] },

  { name: 'current-source-divider',
    parts: [['I', 'I1', 0, 1, 0.001], ['R', 'R1', 1, 0, 1000], ['R', 'R2', 1, 2, 2200], ['R', 'R3', 2, 0, 3300]] },

  { name: 'mixed-v-and-i',
    parts: [['V', 'V1', 1, 0, 8], ['R', 'R1', 1, 2, 1000],
      ['I', 'I1', 0, 2, 0.003], ['R', 'R2', 2, 0, 2200]] },

  // ---- reactive parts at DC, where a capacitor is an OPEN and an inductor a
  // SHORT. Solvers differ most on what happens to a node the source can no
  // longer reach.
  { name: 'cap-blocks-dc',
    parts: [['V','V1',1,0,5], ['R','R1',1,2,1000], ['C','C1',2,3,1e-6], ['R','R2',3,0,1000]] },

  { name: 'cap-across-resistor',
    parts: [['V','V1',1,0,5], ['R','R1',1,2,1000], ['R','R2',2,0,1000], ['C','C1',2,0,1e-5]] },

  { name: 'inductor-is-a-short', tol: 5e-6,   // 2.5 mA through our 1 mOhm DC inductor model
    parts: [['V','V1',1,0,5], ['R','R1',1,2,1000], ['L','L1',2,3,1e-3], ['R','R2',3,0,1000]] },

  { name: 'rc-lowpass-dc',
    parts: [['V','V1',1,0,3.3], ['R','R1',1,2,10000], ['C','C1',2,0,1e-7]] },
];
