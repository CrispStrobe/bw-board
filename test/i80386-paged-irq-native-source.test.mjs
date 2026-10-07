import test from 'node:test';
import assert from 'node:assert/strict';
import {derivePagedIrqRuntime,parentSha256 as runtimeParentSha256} from '../scripts/bochs-cpu3-native-paged-irq/runtime.mjs';
import {derivePagedIrqProvider,parentSha256 as providerParentSha256} from '../scripts/bochs-cpu3-native-paged-irq/provider-derivation.mjs';
import {nativePagedIrqProfile,nativeFrameStores,nativeWalkOwner,nativeWalkAllowed,nativeShadowPhase,validateIntWrite,expectedRamPage} from '../scripts/bochs-cpu3-native-paged-irq/provider-profile.mjs';
import {bootStores,frameStores,markerStores,ramProgram,entries} from '../scripts/bochs-cpu3-native-paged-irq/profile.mjs';
import {sha256} from '../scripts/bochs-cpu3-native-owned-clock/derive.mjs';

test('separate IRQ source derivatives invert exact authenticated parents',()=>{
 const runtime=derivePagedIrqRuntime(),provider=derivePagedIrqProvider();
 assert.equal(runtime.baseSha256,runtimeParentSha256);assert.equal(provider.baseSha256,providerParentSha256);
 assert.equal(sha256(runtime.bytes).length,64);assert.equal(sha256(provider.bytes).length,64);
 assert.throws(()=>derivePagedIrqRuntime(Buffer.from('changed')),/qualified paged INT\/IRET runtime/);
 assert.throws(()=>derivePagedIrqProvider(Buffer.from('changed')),/qualified paged INT\/IRET provider/);
 const source=runtime.bytes.toString();
 for(const marker of ['paged-IRQ-ack-preflight','paged-IRQ-ack-frame-ledger','bw_irq_marker_words','IRQ-prior-attempt']){
  assert.ok(source.includes(marker)||marker==='IRQ-prior-attempt'&&source.includes('liveIp==28674&&cs==24&&eip==28673'),marker);
 }
 assert.ok(!source.includes('cold-BIOS-no-IRQ-delivery'));
 assert.ok(source.includes('if(supplied!=0)return 0;*vector=(uint8_t)supplied;return 1;'),'actual reset PIC vector zero');
 assert.ok(!source.includes('if(supplied!=0x20)return 0;*vector=(uint8_t)supplied;return 1;'));
 assert.equal(nativePagedIrqProfile.maxPortEvents,undefined);
 assert.deepEqual([...expectedRamPage().subarray(0,20)],ramProgram);
});

test('STI shadow and exact delivery pagewalk owner precede generic code prefetch',()=>{
 assert.equal(nativeShadowPhase(24,0x7001,true,false),true);
 assert.equal(nativeShadowPhase(24,0x7001,false,false),false);
 assert.equal(nativeShadowPhase(24,0x7001,true,true),false);
 assert.equal(nativeWalkOwner(24,0x700a,24,0x7002)?.phase,'IRQ-gate-stack');
 assert.equal(nativeWalkOwner(24,0x7002,24,0x7001)?.phase,'IRQ-prior-attempt');
 assert.equal(nativeWalkOwner(24,0x700a,24,0x700a)?.phase,'code-prefetch-28682');
 assert.equal(nativeWalkAllowed(2,entries.idt.raw,4,24,0x700a,24,0x7002),true);
 assert.equal(nativeWalkAllowed(2,entries.idt.raw,4,24,0x700a,24,0x700a),false);
});

test('owned writes require exact boot, native reversed frame, handler then interrupted markers',()=>{
 const state={boot:0,admitted:false,frameWords:0,markerWords:0,tableValues:Object.fromEntries(Object.values(entries).map(e=>[e.raw,e.value]))};
 assert.equal(bootStores.length,20);assert.equal(frameStores.length,3);assert.equal(nativeFrameStores.length,3);
 assert.throws(()=>validateIntWrite(nativeFrameStores[0].raw,Uint8Array.from(nativeFrameStores[0].bytes),state));
 for(const e of bootStores){const result=validateIntWrite(e.raw,Uint8Array.from(e.bytes),state);state.boot=result.nextBoot;}
 state.admitted=true;state.tableValues[entries.stack.raw]=0xc063;
 assert.throws(()=>validateIntWrite(nativeFrameStores[0].raw,Uint8Array.of(0,0),state));
 for(const e of nativeFrameStores){const result=validateIntWrite(e.raw,Uint8Array.from(e.bytes),state);state.frameWords=result.nextFrameWords;}
 assert.throws(()=>validateIntWrite(markerStores[1].raw,Uint8Array.from(markerStores[1].bytes),state));
 for(const e of markerStores){const result=validateIntWrite(e.raw,Uint8Array.from(e.bytes),state);state.markerWords=result.nextMarkerWords;}
 assert.throws(()=>validateIntWrite(markerStores[1].raw,Uint8Array.from(markerStores[1].bytes),state));
});
