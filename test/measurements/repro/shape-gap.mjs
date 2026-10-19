import {BoardImpl} from '../../../src/board.js';
import {classDefaults} from '../../../src/parts-library.js';
import {JUNCTION_RD, junctionRd} from '../../../src/mna.js';
const chain = (vcc, r, params, kind='led') => {
  const parts = [
    {id:'VCC',kind:'vcc',params:{},terminals:['vcc']},
    {id:'GND',kind:'gnd',params:{},terminals:['gnd']},
    {id:'R1',kind:'resistor',params:{ohms:r},terminals:['a','b']},
    {id:'D1',kind,params,terminals:['anode','cathode']}];
  const nets=[
    {id:'nv',terminals:[{part:'VCC',terminal:'vcc'},{part:'R1',terminal:'a'}]},
    {id:'na',terminals:[{part:'R1',terminal:'b'},{part:'D1',terminal:'anode'}]},
    {id:'ng',terminals:[{part:'GND',terminal:'gnd'},{part:'D1',terminal:'cathode'}]}];
  const b=new BoardImpl(vcc); b.setNetlist(parts,nets);
  return Math.abs(b.branchCurrent('D1','anode'));
};
console.log('rs/rd identity per kind:');
for (const k of ['led','diode','zener'])
  console.log(`  ${k.padEnd(6)} classDefaults.rs=${classDefaults(k).rs}  junctionRd=${junctionRd({kind:k})}  equal=${classDefaults(k).rs===junctionRd({kind:k})}`);
console.log('\nLED vf=2.0, 5 V:');
console.log('    R      i_pwl mA    i_shk mA     gap %');
let worst=0,wr=0;
for (const r of [100,150,220,470,1000,2200,4700,10000]) {
  const p=chain(5.0,r,{vf:2.0,model:'pwl'}), s=chain(5.0,r,{vf:2.0,model:'shockley'});
  const g=Math.abs(s-p)/p; if(g>worst){worst=g;wr=r;}
  console.log(`${String(r).padStart(6)}  ${(p*1e3).toFixed(5).padStart(10)}  ${(s*1e3).toFixed(5).padStart(10)}  ${(g*100).toFixed(3).padStart(8)}`);
}
console.log(`worst ${(worst*100).toFixed(3)}% at R=${wr}`);
console.log('\ndiode vf=0.7, 5 V:');
let dw=0,dr=0;
for (const r of [100,220,470,1000,2200,4700]) {
  const p=chain(5.0,r,{vf:0.7,model:'pwl'},'diode'), s=chain(5.0,r,{vf:0.7,model:'shockley'},'diode');
  const g=Math.abs(s-p)/p; if(g>dw){dw=g;dr=r;}
  console.log(`${String(r).padStart(6)}  ${(p*1e3).toFixed(5).padStart(10)}  ${(s*1e3).toFixed(5).padStart(10)}  ${(g*100).toFixed(3).padStart(8)}`);
}
console.log(`worst ${(dw*100).toFixed(3)}% at R=${dr}`);
