import assert from 'node:assert/strict';
import test from 'node:test';
import {SourceColdBiosBoard} from '../scripts/bochs-cpu3-native-cold-bios/board-provider.mjs';
import {createOwnedRamColdBiosProvider} from '../scripts/bochs-cpu3-native-cold-owned-ram/provider.mjs';

test('denied owned-RAM callbacks leave a native write pending and board shadow untouched',()=>{
 let board;
 const inspect=SourceColdBiosBoard.prototype.inspect;
 SourceColdBiosBoard.prototype.inspect=function(...args){board=this;return inspect.apply(this,args);};
 const owner={profile:'bw.cold-native.owned-ram-rom-exec.v1',journal:[],ack:0,drains:0,
  create(ram){this.ram=Uint8Array.from(ram);},
  drain(){this.drains++;return this.journal.map(e=>({...e,before:Uint8Array.from(e.before),after:Uint8Array.from(e.after)}));},
  acknowledge(){this.ack+=this.journal.length;this.journal=[];return this.ack;},
  write(raw,bytes){assert.equal(raw,0x100);assert.deepEqual(bytes,Uint8Array.of(0x5a));const before=this.ram[raw];this.ram[raw]=bytes[0];this.journal.push({address:raw,before:Uint8Array.of(before),after:Uint8Array.from(bytes),generation:1});return {fence:0};},
  read(){assert.throws(()=>provider.callbacks.clockTransfer(Uint32Array.of(1),3),/clock reentry/);return Uint8Array.of(0x5a);},
  page(){throw Error('invalid page reached native owner');},close(){}
 };
 let provider;
 try{provider=createOwnedRamColdBiosProvider(owner);provider.callbacks.clockTransfer(new Uint32Array(),1);provider.checkpoint();}
 finally{SourceColdBiosBoard.prototype.inspect=inspect;}
 assert.ok(board,'captured actual board through its existing checkpoint');
 provider.stage();provider.begin();provider.callbacks.clockTransfer(new Uint32Array(),2);
 const before=board.machine.mem[0x100];assert.notEqual(before,0x5a);
 provider.callbacks.writePhysical(0x100,Uint8Array.of(0x5a));
 assert.equal(owner.journal.length,1);assert.equal(owner.ram[0x100],0x5a);assert.equal(board.machine.mem[0x100],before);
 const baseline={ack:owner.ack,drains:owner.drains,gen:board.generations.get(0),ticks:board.nativeTicks,q:board.successfulQuanta};
 const denied=[
  ['invalid reason',()=>provider.callbacks.clockTransfer(Uint32Array.of(1),12)],
  ['fractional reason',()=>provider.callbacks.clockTransfer(Uint32Array.of(1),3.5)],
  ['wrong tape type',()=>provider.callbacks.clockTransfer([1],3)],
  ['tape view',()=>provider.callbacks.clockTransfer(new Uint32Array(new ArrayBuffer(8),4,1),3)],
  ['bad tape word',()=>provider.callbacks.clockTransfer(Uint32Array.of(4),3)],
  ['Q ahead of N',()=>provider.callbacks.clockTransfer(Uint32Array.of(2),3)],
  ['N above per-run cap',()=>provider.callbacks.clockTransfer(new Uint32Array(601).fill(1),3)],
  ['Q above per-run cap',()=>provider.callbacks.clockTransfer(Uint32Array.from([...Array(301).fill(1),...Array(301).fill(2)]),3)],
  ['wrong query phase',()=>provider.callbacks.clockTransfer(new Uint32Array(),2)],
  ['invalid execute page',()=>provider.callbacks.admitExecutePage(0x100)],
  ['unaligned execute page',()=>provider.callbacks.admitExecutePage(0xf0001)],
  ['scalar op',()=>provider.callbacks.packedScalar(99,0,0,0)],
  ['OUT width',()=>provider.callbacks.packedScalar(3,0x402,2,0x41)],
  ['IN port',()=>provider.callbacks.packedScalar(5,0x402,1,0)],
  ['ACK args',()=>provider.callbacks.packedScalar(4,0,0,1)]
 ];
 for(const [label,call] of denied){assert.throws(call,undefined,label);assert.equal(owner.ack,baseline.ack,label+' native ack');assert.equal(owner.drains,baseline.drains,label+' journal drain');assert.equal(owner.journal.length,1,label+' pending write');assert.equal(board.machine.mem[0x100],before,label+' board shadow');assert.equal(board.generations.get(0),baseline.gen,label+' page generation');assert.equal(board.nativeTicks,baseline.ticks,label+' N');assert.equal(board.successfulQuanta,baseline.q,label+' Q');}
 provider.callbacks.readPhysical(0x100,1);
 assert.equal(owner.ack,baseline.ack);assert.equal(owner.drains,baseline.drains);assert.equal(board.machine.mem[0x100],before);assert.equal(board.generations.get(0),baseline.gen);
 provider.callbacks.clockTransfer(Uint32Array.of(1),3);
 assert.equal(owner.ack,baseline.ack+1);assert.equal(owner.journal.length,0);assert.equal(board.machine.mem[0x100],0x5a);assert.equal(board.generations.get(0),1);
 provider.end();provider.close();
});
