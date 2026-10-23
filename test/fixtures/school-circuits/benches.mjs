// Original manufacturer topologies, with stated illustrative (not measured) BJT cards.
// OPITEC 107056, manual p2; Winkler PRINT 101455, schematic p1.
import {BoardImpl} from '../../../src/board.js';
export const transistor = {model:'shockley',is:1e-14,beta:100,br:1,n:1,rb:10,rc:1,cje:10e-12,cjc:4e-12,tf:.3e-9};
function circuit(){
 const parts=[],nodes=new Map();
 const add=(id,kind,params,connections)=>{
  parts.push({id,kind,params,terminals:Object.keys(connections)});
  for(const [terminal,net]of Object.entries(connections)){
   if(!nodes.has(net))nodes.set(net,[]);nodes.get(net).push({part:id,terminal});
  }
 };
 const board=()=>{const b=new BoardImpl(9);b.setNetlist(parts,[...nodes].map(([id,terminals])=>({id,terminals})));return b;};
 add('G','gnd',{}, {gnd:'g'});
 return {add,board,parts,nodes};
}
export function organBench({trim=500000,key=1}={}){
 const {add,board}=circuit();
 add('V','vsource',{wave:'spice-pwl',points:[[0,0],[10e-6,9]]},{pos:'vcc',neg:'g'});
 add('QN','npn',{...transistor},{collector:'drive',base:'base',emitter:'g'});
 add('QP','pnp',{...transistor},{collector:'out',base:'drive',emitter:'vcc'});
 add('Rbleed','resistor',{ohms:1e6},{a:'base',b:'g'});
 add('Rseries','resistor',{ohms:180000},{a:'base',b:'keys'});
 add('Rtrim','resistor',{ohms:trim},{a:'keys',b:'contact'});
 add('Key','button',{}, {a:'contact',b:'vcc'});
 add('Speaker','resistor',{ohms:8},{a:'out',b:'g'});
 add('Csmall','capacitor',{farads:3.3e-9},{a:'drive',b:'out'});
 add('Cfeedback','capacitor',{farads:10e-9},{a:'out',b:'base'});
 const b=board();b.setControl('Key',key);return b;
}
export function amplifierBench(){
 const {add,board}=circuit();
 add('V','vsource',{volts:9},{pos:'vcc',neg:'g'});
 add('Microphone','vsource',{wave:'sine',freq:1000,amplitude:.001,offset:0},{pos:'mic',neg:'g'});
 const resistors=[['Rmic',8,'mic','input'],['R1',10000,'vcc','u'],['R2',10000,'u','g'],['R3',4700,'vcc','c1'],['R4',1e6,'c1','b1'],['R5',1e6,'b1','g'],
  ['R6',1000,'vcc','c2'],['R7',100000,'c2','b2'],['R8',47000,'b2','g'],['R9',100,'e2','g'],['R10',10,'vcc','c3'],['R11',47000,'c3','b3'],
  ['VolumeTop',50000,'volume','wiper'],['VolumeBottom',50000,'wiper','g'],['Speaker',8,'out','g']];
 for(const [id,ohms,a,b]of resistors)add(id,'resistor',{ohms},{a,b});
 const caps=[['C1',10e-9,'input','g'],['C2',1e-6,'input','b1'],['C3',4.7e-6,'c1','volume'],['C4',4.7e-6,'wiper','b2'],
  ['C5',4.7e-6,'e2','g'],['C6',10e-6,'c2','b3'],['C7',47e-6,'vcc','g']];
 for(const [id,farads,a,b]of caps)add(id,'capacitor',{farads},{a,b});
 add('Q1','npn',{...transistor},{collector:'c1',base:'b1',emitter:'g'});
 add('Q2','npn',{...transistor},{collector:'c2',base:'b2',emitter:'e2'});
 add('Q3','npn',{...transistor},{collector:'c3',base:'b3',emitter:'out'});
 return board();
}
export function envelopeEdges(data,level=4,after=.004){
 const depth=data.samples.length/2,count=Math.min(data.count,depth),oldest=(data.writeIndex-count+depth)%depth;
 const interval=Number(data.sampleIntervalNs)/1e9,edges=[];
 let previous=-Infinity;
 for(let i=0;i<count;i++){
  const value=data.samples[((oldest+i)%depth)*2+1],time=Number(data.startTNs)/1e9+i*interval;
  if(time>=after&&previous<level&&value>=level)edges.push(time);previous=value;
 }
 return edges;
}
