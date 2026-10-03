import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {captureReference,validateReference,compareArchitectural,compareNativeModes,compareNativePorts,compareNativeTraceSnapshots} from '../scripts/bochs-cpu3-native-owned-8042-interface/reference.mjs';
const copy=v=>JSON.parse(JSON.stringify(v));
test('actual fixed-ROM JS reference records every instruction and PIO',()=>{
 const r=validateReference(captureReference());assert.ok(r.q>28&&r.q<512);assert.deepEqual(r.final.witness,[0x55,0x00]);assert.equal(r.final.board.debt,0);assert.equal(r.reset.cpu.segmentCaches[1].base,0xffff0000);assert.equal(r.steps[0].cpu.segmentCaches[1].base,0xf0000);
 assert.deepEqual(r.ports.filter(p=>p.dir==='in').map(p=>[p.port,p.value]),[[0x64,0],[0x64,1],[0x60,0x55],[0x64,0],[0x64,1],[0x60,0x00]]);
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
test('entire emitted CPU trace matches actual qualified first-run snapshots and refuses corruption',()=>{
 const f=JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/i80386-8042-selftest-first-trace.json.gz',import.meta.url))));
 f.capture=JSON.parse(f.captureRaw);const sha=v=>createHash('sha256').update(v).digest('hex');assert.equal(sha(f.captureRaw),f.origin.captureSha256);assert.equal(sha(f.stderr),f.origin.stderrSha256);
 assert.equal(f.origin.stderrSha256,'9a14aed5ff0e93835d69833f8d451eeae4831dbea4e9b80cb9bd7ef6df5e351a');
 assert.deepEqual(compareNativeTraceSnapshots(f.stderr,f.capture),{emittedBlocks:29,comparedWords:4814,savedBoundaries:30,phasePolicy:'ordinary noREP/noFault POST is postQ/preN; RESET0/0',terminalPolicy:'zero-charge terminal has saved snapshot and no additional POST block'});
 const lines=f.stderr.split('\n');let mutations=0;for(const tag of ['RESET','RESET_EXTRA','RESET_SEG','RESET_SYS','RESET_DR']){
  const rows=lines.map((v,i)=>({v,i})).filter(({v})=>v.startsWith('BWSD1\t'+tag+'\t'));
  for(const {v,i}of rows){const fields=v.split('\t');for(let n=2;n<fields.length;n++){const word=n-2,radix=tag==='RESET'||tag==='RESET_DR'||tag==='RESET_EXTRA'&&[0,1,2,3,4,8,13,14,18,19].includes(word)||(tag==='RESET_SEG'||tag==='RESET_SYS')&&[1,5,10,11].includes(word)?16:10;const changed=[...fields];changed[n]=parseInt(fields[n],radix)===0?'1':'0';assert.notEqual(parseInt(changed[n],radix),parseInt(fields[n],radix));const bad=[...lines];bad[i]=changed.join('\t');assert.throws(()=>compareNativeTraceSnapshots(bad.join('\n'),f.capture));mutations++;}}
 }
 assert.equal(mutations,166);
 assert.throws(()=>compareNativeTraceSnapshots(lines.filter(v=>!v.startsWith('BWSD1\tPOST_DR\t')).join('\n'),f.capture));
 assert.throws(()=>compareNativeTraceSnapshots(f.stderr+'\n'+lines.find(v=>v.startsWith('BWSD1\tPOST_STATE\t')),f.capture));
 const bad=[...lines],i=bad.findIndex(v=>v.startsWith('BWSD1\tPOST_EXTRA\t')),fields=bad[i].split('\t');fields[fields.length-1]='1';bad[i]=fields.join('\t');assert.throws(()=>compareNativeTraceSnapshots(bad.join('\n'),f.capture));
 const at=lines.findIndex(v=>v.startsWith('BWSD1\tPOST_STATE\t'));for(const value of ['', '1e0', '-0','01','9007199254740992'])for(const back of [1,2,3]){const malformed=[...lines],a=malformed[at].split('\t');a[a.length-back]=value;malformed[at]=a.join('\t');assert.throws(()=>compareNativeTraceSnapshots(malformed.join('\n'),f.capture));}
});
