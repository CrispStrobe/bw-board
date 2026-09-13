// Re-derive the shockley spot-current expectations against ngspice.
// Our model calibrates IS so the TOTAL drop is vf at the rated 20 mA;
// ngspice takes IS directly, so we hand it the IS our calibration implies
// and ask it the same question.
import {execFileSync} from 'node:child_process';
import {writeFileSync, mkdtempSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Decks are written to a temp dir and the path is printed, so a reader can
// open the exact deck a number came from rather than trust this file's prose.
const OUT = mkdtempSync(path.join(os.tmpdir(), 'bwb-shockley-'));
console.log(`decks: ${OUT}`);
import {BoardImpl} from '../../../src/board.js';

const VT = 0.02585;            // src/mna.js VT_25C
const {rs, n} = {rs: 0.568, n: 1.752};   // classDefaults('diode')
const vf = 0.7, iRated = 0.020;
const vJrated = vf - iRated * rs;
const nVt = n * VT;
const IS = iRated / (Math.expm1(vJrated / nVt));
// ngspice's default TEMP=27C gives VT=k*300.15/q; ours is 0.02585 (26.84 C).
// Pin ngspice to OUR temperature so the comparison is about the MODEL, not
// about which room the two engines think they are in.
const TEMP_C = 0.02585 * 1.602176634e-19 / 1.380649e-23 - 273.15;
console.log(`IS = ${IS.toExponential(6)}  vJrated = ${vJrated.toFixed(6)}  nVt = ${nVt.toFixed(7)}  temp = ${TEMP_C.toFixed(4)} C`);

const GND = {id: 'G1', kind: 'gnd', params: {}, terminals: ['gnd']};
const rows = [];
for (const iMa of [1, 10, 20, 100]) {
  const amps = iMa / 1000;
  const parts = [GND,
    {id: 'I1', kind: 'isource', params: {amps}, terminals: ['pos', 'neg']},
    {id: 'D1', kind: 'diode', params: {vf: 0.7, model: 'shockley'}, terminals: ['anode', 'cathode']}];
  const nets = [
    {id: 'n_a', terminals: [{part: 'I1', terminal: 'pos'}, {part: 'D1', terminal: 'anode'}]},
    {id: 'n_gnd', terminals: [{part: 'G1', terminal: 'gnd'}, {part: 'I1', terminal: 'neg'}, {part: 'D1', terminal: 'cathode'}]},
  ];
  const b = new BoardImpl(5.0);
  b.setNetlist(parts, nets);
  const ours = b.nodeVoltage('n_a');

  const closed = vJrated + nVt * Math.log(amps / iRated) + amps * rs;

  const deck = [
    `spot current ${iMa} mA`,                 // LINE 1 IS THE TITLE
    `.options temp=${TEMP_C.toFixed(6)} tnom=${TEMP_C.toFixed(6)}`,
    `I1 0 na ${amps}`,                        // into node na
    `D1 na 0 DM`,
    `.model DM D(IS=${IS.toExponential(10)} N=${n} RS=${rs})`,
    `.op`,
    `.end`, ''].join('\n');
  const f = path.join(OUT, `spot-${iMa}.cir`);
  writeFileSync(f, deck);
  const out = execFileSync('ngspice', ['-b', f], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
  // batch .op prints a column table with BARE node names
  const m = out.match(/^\s*na\s+([-\d.eE+]+)/m);
  const ng = m ? Number(m[1]) : NaN;
  rows.push({iMa, ours, closed, ng, dOurs: (ours - ng), rel: 100 * Math.abs(ours - ng) / Math.abs(ng)});
}
console.log('\n iMa      ours     closed   ngspice     ours-ng    rel%');
for (const r of rows) console.log(
  `${String(r.iMa).padStart(4)}  ${r.ours.toFixed(6)}  ${r.closed.toFixed(6)}  ${r.ng.toFixed(6)}  ${r.dOurs.toExponential(2).padStart(10)}  ${r.rel.toFixed(4)}`);
