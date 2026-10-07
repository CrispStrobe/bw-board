import test from 'node:test';
import assert from 'node:assert/strict';
import {createDriverPagedIrqProvider,deriveDriverProvider,profileProviderSha256} from '../scripts/bochs-cpu3-native-paged-irq/driver-provider.mjs';
import {bootStores,layout} from '../scripts/bochs-cpu3-native-paged-irq/profile.mjs';
import {irqProgress} from '../scripts/bochs-cpu3-native-paged-irq/parity.mjs';
import {derivePagedIrqComparison,comparisonParentSha256} from '../scripts/bochs-cpu3-native-paged-irq/cpu-comparison.mjs';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {runPagedIrqFixture,nextNamedCut} from '../scripts/bochs-cpu3-native-paged-irq/runner.mjs';
import {sourceIdentity} from '../scripts/bochs-cpu3-native-paged-irq/build-identity.mjs';
import {writePausedEvidence} from '../scripts/bochs-cpu3-native-paged-irq/pause-evidence.mjs';

test('IRQ driver adapter preserves actual board callbacks and copied read/write order',async()=>{
 const source=deriveDriverProvider();assert.equal(source.parentSha256,profileProviderSha256);
 assert.throws(()=>deriveDriverProvider(Buffer.from('changed')));
 const p=await createDriverPagedIrqProvider(),c=p.callbacks;
 c.clockTransfer(new Uint32Array(),1);
 p.begin();c.clockTransfer(new Uint32Array(),2);
 const read=c.readPhysical(0x610,8);assert.deepEqual([...read.bytes],Array(8).fill(0));
 const first=bootStores[0];c.writePhysical(first.raw,Uint8Array.from(first.bytes));
 p.end();const pages=p.ramPages(),events=p.memoryEvents(),state=p.checkpoint();
 assert.deepEqual(Object.keys(pages).sort(),Object.keys(layout).sort());
 assert.ok(Object.values(pages).every(bytes=>bytes instanceof Uint8Array&&bytes.length===4096));
 assert.deepEqual(events.map(e=>[e.ordinal,e.direction,e.raw,e.bytes]),[
  [0,'read',0x610,Array(8).fill(0)],[1,'write',first.raw,first.bytes]]);
 assert.deepEqual(events.filter(e=>e.direction==='read').map(({direction,ordinal,...e})=>e),state.ram.reads);
 assert.deepEqual(events.filter(e=>e.direction==='write').map(({direction,ordinal,...e})=>e),state.ram.writes);
 pages.gdt[first.raw&4095]=99;assert.equal(p.ramPages().gdt[first.raw&4095],first.bytes[0],'copies cannot mutate source RAM');
 events[1].bytes[0]=99;assert.equal(p.memoryEvents()[1].bytes[0],first.bytes[0]);
 p.close();
});

test('IRQ actual admission binds the imported INT parent and every actual gate source role',()=>{
 const source=sourceIdentity();
 for(const path of [
  'scripts/bochs-cpu3-native-paged-int-iret/runtime.mjs',
  'scripts/bochs-cpu3-native-paged-int-iret/provider-derivation.mjs',
  'scripts/bochs-cpu3-native-paged-irq/runner.mjs',
  'scripts/bochs-cpu3-native-paged-irq/parity.mjs',
  'scripts/ci-build-i80386-native-paged-irq.py',
  '.github/workflows/i80386-native-paged-irq-actual.yml',
 ])assert.match(source.hashes[path],/^[a-f0-9]{64}$/,path);
});

test('callback tape cap rejects the next read before board or tape effects',async()=>{
 const p=await createDriverPagedIrqProvider(),c=p.callbacks;
 c.clockTransfer(new Uint32Array(),1);p.begin();c.clockTransfer(new Uint32Array(),2);
 for(let i=0;i<1024;i++)c.readPhysical(0x610,8);
 assert.throws(()=>c.readPhysical(0x610,8),/bounded successful callback tape before read/);
 p.end();const events=p.memoryEvents(),state=p.checkpoint();
 assert.equal(events.length,1024);assert.equal(state.ram.reads.length,1024,'denied callback did not reach board');
 assert.deepEqual(events.filter(e=>e.direction==='read').map(({direction,ordinal,...e})=>e),state.ram.reads);
 p.close();
});

test('one atomic paused packet replaces its predecessor and authenticates the original boundary',()=>{
 const dir=mkdtempSync(join(tmpdir(),'irq-pause-control-'));
 try{
  const base={schema:'bw.paged-irq.last-paused-boundary.v1',source:{revision:'a'.repeat(40)},progress:{n:39,q:39},native:{state:[1,2]},board:{pic:{irr:1,isr:0}},physical:{stack:Uint8Array.of(2,0x70)},javascript:{q:39},sourceLine:{asserted:true},jsLine:{asserted:true}};
  writePausedEvidence(dir,{...base,phase:'before-line'});
  writePausedEvidence(dir,{...base,phase:'before-resume',native:{state:[3,4]}});
  const packet=JSON.parse(readFileSync(join(dir,'last-paused-packet.json'),'utf8'));
  const compressed=Buffer.from(packet.compressedBase64,'base64'),decoded=gunzipSync(compressed);
  const sha=b=>createHash('sha256').update(b).digest('hex');
  assert.deepEqual([packet.phase,packet.nativeTicks,packet.successfulQuanta],['before-resume',39,39]);
  assert.deepEqual([compressed.length,sha(compressed),decoded.length,sha(decoded)],
   [packet.compressedBytes,packet.compressedSha256,packet.decodedBytes,packet.decodedSha256]);
  assert.deepEqual(JSON.parse(decoded).native.state,[3,4]);
  assert.deepEqual(JSON.parse(decoded).physical.stack,[2,0x70]);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('IRQ progress admits only actual zero-Q delivery and keeps the IF phase in comparison',()=>{
 assert.equal(typeof runPagedIrqFixture,'function','actual runner import does not load an addon');
 assert.equal(nextNamedCut([],0x18,0x7002).name,'irq-eligible');
 assert.equal(nextNamedCut(['irq-eligible'],0x18,0x7002).name,'returned-from-IRET');
 const source=derivePagedIrqComparison(readFileSync(new URL('../scripts/bochs-cpu3-native-cold-bios/parity.mjs',import.meta.url)));
 assert.equal(source.baseSha256,comparisonParentSha256);
 assert.match(source.bytes.toString(),/fixed IRQ IF phase/);
 assert.doesNotMatch(source.bytes.toString(),/assert\.equal\(j\.eflags&0x200,0\)/);
 const n={state:Array(20).fill(0),extra:Array(20).fill(0),segments:Array(90).fill(0),system:Array(30).fill(0),debug:Array(6).fill(0),nativeTicks:39,successfulQuanta:39,chargedNativeTicks:0,chargedQuanta:0,reason:6,irqDelivered:1,irqVector:0,activityState:0,execution:{attempts:39,completed:39,repIterations:0,repPartial:0,faults:0,portCommits:0,irqDeliveries:1,haltIdleCuts:0},fallback:{bochsRamReads:0,bochsRamWrites:0,bochsDirectPointers:0,bochsPio:0,bochsTimer:0}};
 assert.deepEqual(irqProgress({n:39,q:39},n),{n:39,q:39,dn:0,dq:0});
 assert.throws(()=>irqProgress({n:39,q:39},{...n,reason:4}));
 assert.throws(()=>irqProgress({n:39,q:39},{...n,reason:6,chargedQuanta:1}));
});
