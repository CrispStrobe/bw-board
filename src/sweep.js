/**
 * The sweep instrument — one stepping/measuring core, two faces.
 *
 * DC sweep (Kennlinien): step a source voltage, let the circuit settle,
 * read node voltages and the source's branch current at each step.
 * This draws V/I characteristic curves — diode knees, LED forward drops,
 * transistor transfer curves, resistor lines.
 *
 * AC sweep (Bode): step a sine source's frequency, settle, then measure
 * amplitude and phase at the input and output nets by single-frequency
 * correlation over an integer number of cycles. Magnitude ratio and phase
 * difference per frequency — the Bode plot of the network between the
 * two probes.
 *
 * Both drive the board's own transient engine (advanceTo) and read
 * nodeVoltage directly per step: no probe-array plumbing, no sample cap,
 * and the measurement cadence is exactly the cadence we advance at.
 *
 * Deliberately NOT here: any rendering. The UI faces (curve tracer,
 * Bode panel) consume the row arrays these return.
 */

const NS = 1_000_000_000;

/**
 * Step a source's DC level and record the operating point at each step.
 *
 * The source is any part `setControl` can drive — a `vsource` (control
 * overrides params.volts) is the canonical curve-tracer supply.
 *
 * @param {import('./board.js').BoardImpl} board - powered, netlist set
 * @param {object} opts
 * @param {string} opts.sourceId    - part id of the swept vsource
 * @param {number} opts.from        - start volts
 * @param {number} opts.to          - end volts
 * @param {number} [opts.steps=50]  - number of points (inclusive of both ends)
 * @param {number} [opts.settleNs=2_000_000] - transient time per step (2 ms
 *   default: > 5 tau for any RC the curve tracer plausibly meets; raise it
 *   for slow reactive circuits)
 * @param {number} [opts.substeps=8] - advanceTo calls per settle interval,
 *   so reactive integration sees intermediate points
 * @param {string[]} [opts.nets=[]] - net ids to record besides the current
 * @param {string} [opts.currentTerminal='pos'] - source terminal for branchCurrent
 * @returns {Array<{v:number, i:number, nets:Record<string,number>}>}
 *   i is the current the SOURCE DELIVERS into its `pos` terminal's net
 *   (curve-tracer convention: positive current flows out of pos, through
 *   the device under test, back into neg).
 */
export function runDcSweep(board, opts) {
  const {
    sourceId, from, to,
    steps = 50,
    settleNs = 2_000_000,
    substeps = 8,
    nets = [],
    currentTerminal = 'pos',
  } = opts;
  if (!sourceId) throw new Error('runDcSweep: sourceId is required');
  const rows = [];
  let t = board.timeNs;
  const stepNs = BigInt(Math.max(1, Math.round(settleNs / substeps)));
  for (let k = 0; k < steps; k++) {
    const v = steps === 1 ? from : from + ((to - from) * k) / (steps - 1);
    board.setControl(sourceId, v);
    for (let s = 0; s < substeps; s++) {
      t += stepNs;
      board.advanceTo(t);
    }
    let i = 0;
    try { i = -board.branchCurrent(sourceId, currentTerminal); } catch { /* open circuit */ }
    const netV = {};
    for (const id of nets) netV[id] = board.nodeVoltage(id);
    rows.push({ v, i, nets: netV });
  }
  return rows;
}

/**
 * Single-frequency correlation of uniformly advanced samples.
 * v(t) = A·sin(ωt + φ) + DC  →  over an integer number of cycles the DC
 * term and every other harmonic integrate to zero against sin/cos at f.
 * @param {Array<{t:number, v:number}>} samples - t in seconds from window start
 * @param {number} f
 * @returns {{amp:number, phaseDeg:number}}
 */
export function correlateAt(samples, f) {
  const w = 2 * Math.PI * f;
  let s = 0, c = 0;
  for (const { t, v } of samples) {
    s += v * Math.sin(w * t);
    c += v * Math.cos(w * t);
  }
  const n = samples.length || 1;
  const b = (2 / n) * s; // A·cosφ
  const a = (2 / n) * c; // A·sinφ
  return { amp: Math.hypot(a, b), phaseDeg: (Math.atan2(a, b) * 180) / Math.PI };
}

/**
 * Build a log-spaced frequency list.
 * @param {number} from - Hz
 * @param {number} to - Hz
 * @param {number} [pointsPerDecade=10]
 * @returns {number[]}
 */
export function logSpace(from, to, pointsPerDecade = 10) {
  const out = [];
  const decades = Math.log10(to / from);
  const n = Math.max(2, Math.ceil(decades * pointsPerDecade) + 1);
  for (let k = 0; k < n; k++) {
    out.push(from * Math.pow(10, (decades * k) / (n - 1)));
  }
  return out;
}

/**
 * Frequency-response sweep between two nets.
 *
 * The source part must be a `vsource` whose params carry the sine shape
 * ({wave:'sine', amplitude, offset}); this function steps params.freq via
 * setPartParam. Board time keeps advancing monotonically across steps —
 * the settle cycles absorb both the frequency switch and its phase jump.
 *
 * @param {import('./board.js').BoardImpl} board - powered, netlist set
 * @param {object} opts
 * @param {string} opts.sourceId
 * @param {number[]} opts.freqs - Hz, e.g. from logSpace()
 * @param {string} opts.inNet   - reference net (usually the source's pos net)
 * @param {string} opts.outNet  - measured net
 * @param {number} [opts.settleCycles=6]  - cycles discarded before measuring
 * @param {number} [opts.measureCycles=4] - integer cycles correlated
 * @param {number} [opts.samplesPerCycle=32]
 * @returns {Array<{f:number, ain:number, aout:number, magDb:number, phaseDeg:number}>}
 *   phaseDeg is out minus in, normalised to (-180, 180].
 */
export function runAcSweep(board, opts) {
  const {
    sourceId, freqs, inNet, outNet,
    settleCycles = 6,
    measureCycles = 4,
    samplesPerCycle = 32,
  } = opts;
  if (!sourceId) throw new Error('runAcSweep: sourceId is required');
  if (!freqs?.length) throw new Error('runAcSweep: freqs is required');
  const rows = [];
  let t = board.timeNs;
  for (const f of freqs) {
    board.setPartParam(sourceId, 'freq', f);
    const dtNs = BigInt(Math.max(1, Math.round(NS / (f * samplesPerCycle))));

    for (let k = 0; k < settleCycles * samplesPerCycle; k++) {
      t += dtNs;
      board.advanceTo(t);
    }

    const t0 = t;
    const inSamples = [];
    const outSamples = [];
    for (let k = 0; k < measureCycles * samplesPerCycle; k++) {
      t += dtNs;
      board.advanceTo(t);
      const ts = Number(t - t0) / NS;
      inSamples.push({ t: ts, v: board.nodeVoltage(inNet) });
      outSamples.push({ t: ts, v: board.nodeVoltage(outNet) });
    }

    const vin = correlateAt(inSamples, f);
    const vout = correlateAt(outSamples, f);
    let phase = vout.phaseDeg - vin.phaseDeg;
    while (phase > 180) phase -= 360;
    while (phase <= -180) phase += 360;
    const ratio = vin.amp > 1e-12 ? vout.amp / vin.amp : 0;
    rows.push({
      f,
      ain: vin.amp,
      aout: vout.amp,
      magDb: 20 * Math.log10(Math.max(ratio, 1e-12)),
      phaseDeg: phase,
    });
  }
  return rows;
}
