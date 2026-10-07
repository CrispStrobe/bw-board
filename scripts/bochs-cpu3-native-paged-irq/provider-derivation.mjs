/** Authenticated separate IRQ provider derivative; the old profile stays immutable. */
import assert from 'node:assert/strict';
import {derivePagedIntIretProvider} from '../bochs-cpu3-native-paged-int-iret/provider-derivation.mjs';
import {authenticated,replacement,sha256} from '../bochs-cpu3-native-owned-clock/derive.mjs';
export const parentSha256='afc02de595449021f64cfa74cb0004ae71028e57596195769563439b5d0f005f';
export function derivePagedIrqProvider(bytes=derivePagedIntIretProvider().bytes){
 let s=authenticated(bytes,parentSha256,'qualified paged INT/IRET provider');const edits=[];
 const once=(old,next,label)=>{s=replacement(s,old,next,label);edits.push({old,next,label});};
 const many=(old,next,count,label)=>{assert.equal(s.split(old).length-1,count,label);s=s.split(old).join(next);edits.push({old,next,count,label});};
 many('SourcePagedIntIretBoard','SourcePagedIrqBoard',2,'new separate board');
 once('createOwnedPagedIntIretProvider','createOwnedPagedIrqProvider','new private factory');
 once('frameWords:0,tableValues:', 'frameWords:0,markerWords:0,tableValues:', 'marker effect ledger');
 once('this.pagingReads=[];this.ramAdmitted=false;this.ramWrites=[];', 'this.pagingReads=[];this.ramAdmitted=false;this.ramWrites=[];this.irqAcks=0;', 'single real PIC ACK ledger');
 once('m.reset();assert.equal(m.cycles,4);', "m.reset();assert.deepEqual([m._pic.vectorBase,m._pic.imr,m._pic.irr,m._pic.isr,m._pic.intActive],[0,0,0,0,false],'reset PIC source admission');assert.equal(m.cycles,4);", 'actual reset PIC snapshot');
 once("acknowledgeIrq(){return this._call('ack',[],()=>{throw Error('cold BIOS source scope forbids PIC ACK/delivery');});}",
 "acknowledgeIrq(){return this._call('ack',[],()=>{const p=this.machine._pic;assert.equal(this.irqAcks,0,'once-only PIC ACK');assert.ok(this.lineAsserted&&p.intActive,'actual PIC line');assert.deepEqual([p.vectorBase,p.imr,p.irr,p.isr],[0,0,1,0],'scoped IRQ0 before ACK');assert.ok(!this.machine.chips.pic2.intActive,'no slave IRQ');const vector=p.acknowledge();assert.equal(vector,0);p.setIRQ(0,0);assert.deepEqual([p.irr,p.isr,p.intActive],[0,1,false]);this.irqAcks=1;return vector;});}", 'real PIC ACK after complete preflight');
 once('const expected=[5,0x70,0x18,0,2,0];','const expected=[2,0x70,0x18,0,2,2];','IRQ frame physical bytes');
 once("if(next.kind==='frame')this.pagingState.frameWords=next.nextFrameWords;", "if(next.kind==='frame')this.pagingState.frameWords=next.nextFrameWords;if(next.kind==='marker')this.pagingState.markerWords=next.nextMarkerWords;", 'marker write sequence');
 once('frameWords:this.pagingState.frameWords,writes:', 'frameWords:this.pagingState.frameWords,markerWords:this.pagingState.markerWords,irqAcks:this.irqAcks,pic:this.machine._pic.getState(),writes:', 'copied PIC and marker diagnostic state');
 once("assert.ok(!closed&&!active,'clock reentry');assert.ok(words instanceof Uint32Array", "assert.ok(!closed&&!active,'clock reentry');active=true;try{assert.ok(words instanceof Uint32Array", 'guard copied tape preflight from hostile iterator reentry');
 once('   }finally{active=false;}\n  }\n });', '   }finally{active=false;}\n   }finally{active=false;}\n  }\n });', 'release preflight guard after all callbacks');
 once('let lease=false,closed=false,initialized=false,entry=false,postPio=false,mappingPending=false,active=false,n=0,q=0;',
 'let lease=false,closed=false,initialized=false,entry=false,postPio=false,mappingPending=false,active=false,pulsed=false,n=0,q=0;',
 'one-shot paused stimulus ledger');
 once("  stage(){assert.ok(initialized&&!lease&&!closed&&!active);return call('stageLine');},",
 "  pulse(){assert.ok(initialized&&!lease&&!closed&&!active&&!pulsed&&!board.irqAcks&&!board.lineAsserted,'paused once-only fixture pulse');assert.deepEqual([board.machine._pic.vectorBase,board.machine._pic.imr,board.machine._pic.irr,board.machine._pic.isr],[0,0,0,0]);assert.deepEqual([board.nativeTicks,board.successfulQuanta],[39,39],'actual named N/Q cut');board.machine._pic.setIRQ(0,1);assert.equal(board.machine._pic.intActive,true);pulsed=true;},\n  stage(){assert.ok(initialized&&!lease&&!closed&&!active);return call('stageLine');},", 'paused actual PIC stimulus');
 let inverse=s;for(const e of [...edits].reverse())if(e.count){assert.equal(inverse.split(e.next).length-1,e.count);inverse=inverse.split(e.next).join(e.old);}else inverse=replacement(inverse,e.next,e.old,'IRQ provider inverse '+e.label);
 assert.equal(sha256(inverse),parentSha256);return {bytes:Buffer.from(s),edits,baseSha256:parentSha256};
}
export async function createOwnedPagedIrqProvider(...args){assert.equal(args.length,0);const s=derivePagedIrqProvider().bytes.toString().replace(/from (['"])([^'"]+)\1/g,(_,q,p)=>`from ${q}${new URL(p,import.meta.url).href}${q}`);return (await import('data:text/javascript;base64,'+Buffer.from(s).toString('base64'))).createOwnedPagedIrqProvider();}
