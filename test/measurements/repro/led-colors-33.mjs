import {execFileSync} from 'node:child_process';
import {writeFileSync, mkdtempSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const OUT = mkdtempSync(path.join(os.tmpdir(), 'bwb-oracle-'));
console.log(`decks: ${OUT}`);
import {BoardImpl} from '../../../src/board.js';
const VT=0.02585,iR=0.020,rs=10,n=1.8,nVt=n*VT;
const T=VT*1.602176634e-19/1.380649e-23-273.15;
const isOf=vf=>iR/Math.expm1((vf-iR*rs)/nVt);
const bSource=(vf,vcc,rtot,label)=>{
  const IS=isOf(vf);
  const deck=[`led ${label}`,`.options temp=${T.toFixed(6)} tnom=${T.toFixed(6)}`,
    `V1 nv 0 ${vcc}`,`R1 nv na ${rtot}`,
    `B1 na nj I = ${IS.toExponential(12)}*(exp(V(na,nj)/${nVt.toPrecision(12)})-1)`,
    `Rs nj 0 ${rs}`,'.op','.end',''].join('\n');
  const f=path.join(OUT, `c-${label}.cir`);writeFileSync(f,deck);
  const out=execFileSync('ngspice',['-b',f],{encoding:'utf8'});
  const va=Number(out.match(/^\s*na\s+([-\d.eE+]+)/m)[1]);
  return (vcc-va)/rtot;
};
const COLORS=[['infrared',1.2],['red',1.8],['orange',2.0],['yellow',2.1],['green',2.2],['blue',3.2],['white',3.4],['UV',3.8]];
const ledCircuit=(vf,ohms=1000)=>({parts:[
  {id:'VCC',kind:'vcc',params:{},terminals:['vcc']},{id:'GND',kind:'gnd',params:{},terminals:['gnd']},
  {id:'R1',kind:'resistor',params:{ohms},terminals:['a','b']},
  {id:'LED1',kind:'led',params:{vf},terminals:['anode','cathode']},
  {id:'MCU',kind:'mcu',params:{},terminals:['P1.0']}],nets:[
  {id:'nv',terminals:[{part:'VCC',terminal:'vcc'},{part:'R1',terminal:'a'}]},
  {id:'nr',terminals:[{part:'R1',terminal:'b'},{part:'LED1',terminal:'anode'}]},
  {id:'np',terminals:[{part:'LED1',terminal:'cathode'},{part:'MCU',terminal:'P1.0'}]},
  {id:'ng',terminals:[{part:'GND',terminal:'gnd'}]}]});
console.log('3.3 V rail, 1 kOhm + 25 ohm pad');
console.log('name        vf     ours b     ngspice b    i (uA)    rel%');
for (const [name,vf] of COLORS) {
  const {parts,nets}=ledCircuit(vf);
  const b=new BoardImpl(3.3); b.setNetlist(parts,nets); b.setPin('P1.0','pushpull',false); b.advanceTo(25_000_000n);
  const ours=b.ledBrightness('LED1');
  const i=bSource(vf,3.3,1025,`c${vf}`);
  const ng=Math.min(1,i/0.020);
  console.log(`${name.padEnd(10)} ${String(vf).padEnd(5)} ${ours.toFixed(8)}  ${ng.toFixed(8)}  ${(i*1e6).toFixed(2).padStart(9)}  ${(100*Math.abs(ours-ng)/ng).toFixed(4)}`);
}
