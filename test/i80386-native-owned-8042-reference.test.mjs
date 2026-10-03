import test from 'node:test';
import assert from 'node:assert/strict';
import {captureReference,validateReference,compareArchitectural,compareNativeModes,compareNativePorts} from '../scripts/bochs-cpu3-native-owned-8042/reference.mjs';
const copy=v=>JSON.parse(JSON.stringify(v));
test('actual fixed-ROM JS reference records every instruction and PIO',()=>{
 const r=validateReference(captureReference());assert.equal(r.q,28);assert.deepEqual(r.final.witness,[0x55,0xff]);assert.equal(r.final.board.debt,0);assert.equal(r.reset.cpu.segmentCaches[1].base,0xffff0000);assert.equal(r.steps[0].cpu.segmentCaches[1].base,0xf0000);
 assert.deepEqual(r.ports.filter(p=>p.dir==='in').map(p=>[p.port,p.value]),[[0x64,0],[0x64,1],[0x60,0x55],[0x60,0xff]]);
 const bad=copy(r);bad.steps[4].q++;assert.throws(()=>validateReference(bad));
 const tape=r.ports.map((p,i)=>`BWSD1\tPORT\t${p.dir}\t${p.port.toString(16).padStart(4,'0')}\t1\t${p.value.toString(16).padStart(8,'0')}\t${p.attempt-1}\t${i+1}`).join('\n');assert.equal(compareNativePorts(tape,r).ports,r.ports.length);assert.throws(()=>compareNativePorts(tape.replace('00000055','00000054'),r));
});
// These are explicit comparator refusal fixtures, not fabricated native runs.
function refusalFixture(j){
 const n={state:Array(20).fill(0),extra:Array(20).fill(0),segments:Array(90).fill(0),system:Array(30).fill(0),debug:[0,0,0,0,0xffff1ff0,0x400],mappingEpoch:0,boardA20:1};
 const fields={eax:0,ecx:1,ebx:3,esp:4,ebp:5,esi:6,edi:7,eip:8,eflags:9,cr2:11,cr3:12,cs:13,ds:14,ss:15};for(const [k,i]of Object.entries(fields))n.state[i]=j[k];n.state[10]=0x7ffffff0;n.state.splice(16,4,0,0xffff,0,0xffff);n.extra.splice(0,5,0xffff1ff0,0x400,j.es,j.fs,j.gs);
 ['es','cs','ss','ds','fs','gs'].forEach((k,i)=>{const p=i*15,c=j.segmentCaches[i];n.segments[p]=i;n.segments[p+1]=j[k];n.segments[p+6]=1;n.segments[p+10]=c.base>>>0;n.segments[p+11]=c.limit;n.segments[p+13]=Number(c.default32);});for(let i=0;i<2;i++){n.system[i*15+6]=1;n.system[i*15+11]=0xffff;}return n;
}
test('architectural comparator rejects each exposed register and reset-profile drift',()=>{
 const r=captureReference(),j=r.final.cpu,n=refusalFixture(j);compareArchitectural(n,j);
 for(const i of [...Array(20).keys()]){const bad=copy(n);bad.state[i]=(bad.state[i]+1)>>>0;assert.throws(()=>compareArchitectural(bad,j));}
 for(const field of ['segments','system','debug']){const bad=copy(n);const index=field==='segments'?10:field==='system'?11:4;bad[field][index]++;assert.throws(()=>compareArchitectural(bad,j));}
 const bad=copy(j);bad.edx=0;assert.throws(()=>compareArchitectural(n,bad));
});
test('crossmode comparator refuses changes in every one of166 raw native words',()=>{
 const n=refusalFixture(captureReference().reset.cpu),off={nativeTrace:false,reset:{native:n},steps:[],terminal:{native:n},settled:{},closed:{}},on=copy(off);on.nativeTrace=true;compareNativeModes(off,on);
 for(const k of ['state','extra','segments','system','debug'])for(let i=0;i<n[k].length;i++){const bad=copy(on);bad.reset.native[k][i]=(bad.reset.native[k][i]+1)>>>0;assert.throws(()=>compareNativeModes(off,bad));}
});
