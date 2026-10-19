// An LED with vf above ~2.86 V has Is below ngspice's SILENT 1e-28 diode
// clamp, so `.model D(IS=...)` cannot express it. A behavioural source can:
// ngspice solves OUR exact device equation with ITS Newton/limiting, which is
// the half we actually want checked.
//
// VALIDATE THE INSTRUMENT FIRST: run a device the D model CAN express both
// ways. If the B-source deck and the D-model deck disagree there, the B-source
// deck is wrong and nothing it says about vf=3.5 is worth anything.
import {execFileSync} from 'node:child_process';
import {writeFileSync, mkdtempSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const OUT = mkdtempSync(path.join(os.tmpdir(), 'bwb-oracle-'));
console.log(`decks: ${OUT}`);
const VT=0.02585, iR=0.020, rs=10, n=1.8, nVt=n*VT;
const T = VT*1.602176634e-19/1.380649e-23 - 273.15;
const isOf = vf => iR/Math.expm1((vf-iR*rs)/nVt);
const opts = `.options temp=${T.toFixed(6)} tnom=${T.toFixed(6)}`;

const dModel = (vf, vcc, rtot, label) => {
  const deck=[`d-model ${label}`, opts, `V1 nv 0 ${vcc}`, `R1 nv na ${rtot}`,
    'D1 na 0 LEDM', `.model LEDM D(IS=${isOf(vf).toExponential(10)} N=${n} RS=${rs})`,
    '.op','.end',''].join('\n');
  const f=path.join(OUT, `d-${label}.cir`); writeFileSync(f,deck);
  const out=execFileSync('ngspice',['-b',f],{encoding:'utf8'});
  const va=Number(out.match(/^\s*na\s+([-\d.eE+]+)/m)[1]);
  return (vcc-va)/rtot;
};
const bSource = (vf, vcc, rtot, label) => {
  const IS=isOf(vf);
  const deck=[`b-source ${label}`, opts, `V1 nv 0 ${vcc}`, `R1 nv na ${rtot}`,
    // junction between na and nj, then the bulk rs to ground
    `B1 na nj I = ${IS.toExponential(12)}*(exp(V(na,nj)/${nVt.toPrecision(12)})-1)`,
    `Rs nj 0 ${rs}`,
    '.op','.end',''].join('\n');
  const f=path.join(OUT, `b-${label}.cir`); writeFileSync(f,deck);
  const out=execFileSync('ngspice',['-b',f],{encoding:'utf8'});
  const va=Number(out.match(/^\s*na\s+([-\d.eE+]+)/m)[1]);
  return (vcc-va)/rtot;
};
console.log('INSTRUMENT VALIDATION (vf=2.0, representable both ways)');
for (const [vcc,rtot,l] of [[3.3,1035,'a'],[5.0,1035,'b'],[5.0,470,'c']]) {
  const d=dModel(2.0,vcc,rtot,'v'+l), b=bSource(2.0,vcc,rtot,'v'+l);
  console.log(`  vcc=${vcc} R=${rtot}: D=${(d*1e6).toFixed(4)} uA  B=${(b*1e6).toFixed(4)} uA  rel=${(100*Math.abs(d-b)/d).toFixed(6)}%`);
}
console.log(`\nvf=3.5: Is=${isOf(3.5).toExponential(4)} (clamp is 1e-28, so D is UNUSABLE)`);

console.log('\nTHE BENCH: vf=3.5 LED, R1=100, pad low R_STRONG=25 -> 125 ohm series');
const rows = [[3.3,'under'],[5.0,'driven']];
const out = {};
for (const [vcc,l] of rows) {
  const i = bSource(3.5, vcc, 125, `vf35-${l}`);
  out[l]=i;
  console.log(`  ${l.padEnd(7)} vcc=${vcc}: i=${(i*1e6).toFixed(3)} uA  brightness=i/20mA=${(i/0.020).toFixed(6)}`);
}
console.log(`  ratio driven/under = ${(out.driven/out.under).toFixed(3)}x`);
