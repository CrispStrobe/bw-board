import test from 'node:test';
import assert from 'node:assert/strict';
import {createDriverPagedIrqProvider,deriveDriverProvider,profileProviderSha256} from '../scripts/bochs-cpu3-native-paged-irq/driver-provider.mjs';
import {bootStores,layout} from '../scripts/bochs-cpu3-native-paged-irq/profile.mjs';
import {irqProgress} from '../scripts/bochs-cpu3-native-paged-irq/parity.mjs';
import {derivePagedIrqComparison,comparisonParentSha256} from '../scripts/bochs-cpu3-native-paged-irq/cpu-comparison.mjs';
import {readFileSync} from 'node:fs';
import {runPagedIrqFixture} from '../scripts/bochs-cpu3-native-paged-irq/runner.mjs';

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

test('IRQ progress admits only actual zero-Q delivery and keeps the IF phase in comparison',()=>{
 assert.equal(typeof runPagedIrqFixture,'function','actual runner import does not load an addon');
 const source=derivePagedIrqComparison(readFileSync(new URL('../scripts/bochs-cpu3-native-cold-bios/parity.mjs',import.meta.url)));
 assert.equal(source.baseSha256,comparisonParentSha256);
 assert.match(source.bytes.toString(),/fixed IRQ IF phase/);
 assert.doesNotMatch(source.bytes.toString(),/assert\.equal\(j\.eflags&0x200,0\)/);
 const n={state:Array(20).fill(0),extra:Array(20).fill(0),segments:Array(90).fill(0),system:Array(30).fill(0),debug:Array(6).fill(0),nativeTicks:39,successfulQuanta:39,chargedNativeTicks:0,chargedQuanta:0,reason:6,irqDelivered:1,irqVector:0,activityState:0,execution:{attempts:39,completed:39,repIterations:0,repPartial:0,faults:0,portCommits:0,irqDeliveries:1,haltIdleCuts:0},fallback:{bochsRamReads:0,bochsRamWrites:0,bochsDirectPointers:0,bochsPio:0,bochsTimer:0}};
 assert.deepEqual(irqProgress({n:39,q:39},n),{n:39,q:39,dn:0,dq:0});
 assert.throws(()=>irqProgress({n:39,q:39},{...n,reason:4}));
 assert.throws(()=>irqProgress({n:39,q:39},{...n,reason:6,chargedQuanta:1}));
});
