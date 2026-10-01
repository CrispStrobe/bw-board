import test from 'node:test';
import assert from 'node:assert/strict';
import {DirectBoardFacade} from '../scripts/bochs-cpu3-native-direct-board/board.mjs';
import {NativeCombinedPagingRamHost,encodeCombinedReply} from '../scripts/bochs-cpu3-native-combined-paging-ram/host.mjs';
// Manual callbacks test the actual-board facade, not native CPU execution.
const rom=()=>{const b=new Uint8Array(65536);b.fill(255);b[0]=0xea;return b;};
test('direct callback values and actual board scheduler match the FIFO host operations',()=>{
 const direct=new DirectBoardFacade(rom()),fifo=new NativeCombinedPagingRamHost(rom());let seq=0;
 direct.beginRun();fifo.beginRun();
 const call=(operation,a,b=0,c=0,payload='-')=>fifo.handleRequest({seq:++seq,operation,arg0:a,arg1:b,arg2:c,payload,nativeTicks:fifo.nativeTicks,successfulQuanta:fifo.successfulQuanta});
 const bytes=Uint8Array.of(0xbb,0x11,0x11,0xcb),w=direct.writePhysical(0x7000,bytes),fw=call('WRITE',0x7000,4,0,Buffer.from(bytes).toString('hex'));
 assert.deepEqual([...w.bytes],[...Buffer.from(fw.hex,'hex')]);assert.equal(w.generation,fw.generation);
 const page=direct.admitExecutePage(0x7000),fp=call('PAGE',0x7000,4096);assert.equal(page.sha256,fp.sha256);assert.equal(page.mappingEpoch,fp.mappingEpoch);
 const read=direct.readPhysical(0x7000,4),fr=call('READ',0x7000,4);assert.equal(Buffer.from(read.bytes).toString('hex'),fr.hex);
 for(const [port,value] of [[0x64,0xd1],[0x60,1],[0xe9,82]]){const out=direct.outPort(port,1,value),reply=call('PIO_OUT',port,1,value);assert.deepEqual(out,{value:reply.value,boardA20:reply.boardA20,mappingEpoch:reply.mappingEpoch});}
 const alias=direct.writePhysical(0x107001,Uint8Array.of(0x55,0x55)),fa=call('WRITE',0x107001,2,0,'5555');assert.equal(alias.decoded,fa.decoded);assert.equal(alias.generation,fa.generation);
 for(let i=0;i<8;i++){assert.equal(direct.quantum(i%2),call('QUANTUM',i%2).value);direct.nativeTick();call('NATIVE_TICK',1);}
 direct.endRun();fifo.endRun();assert.deepEqual(direct.stageLine(),fifo.stageLine());
 const actual=direct.settleTerminal(),reference=fifo.finish().after;assert.deepEqual(actual.board,reference.board);assert.equal(actual.nativeTicks,reference.nativeTicks);assert.equal(actual.successfulQuanta,reference.successfulQuanta);assert.equal(actual.javascriptCpuCycles,0);
 assert.ok(encodeCombinedReply(fp).length===66);assert.deepEqual([...page.bytes.slice(0,4)],[0xbb,0x11,0x11,0xcb]); // persistent admission snapshot, native owns later publication
 direct.close();
});
test('capture disabled avoids checkpoint snapshots; optional capture preserves callback results',()=>{
 const no=new DirectBoardFacade(rom());no.inspect=()=>{throw Error('snapshot allocated');};no.beginRun();assert.equal(no.readPhysical(0xf0000,1).bytes[0],0xea);no.endRun();
 const events=[],yes=new DirectBoardFacade(rom(),{capture:e=>events.push(e)});yes.beginRun();yes.readPhysical(0xf0000,1);yes.endRun();assert.equal(events.length,1);assert.equal(events[0].before.board.cycles,4);assert.equal(events[0].after.board.cycles,4);
});
test('invalid whole spans and generation capacity reject before actual RAM effects',()=>{
 const d=new DirectBoardFacade(rom());d.beginRun();const before=d.machine.mem.slice(0x7000,0x7004);
 for(const [raw,bytes] of [[0x7fff,Uint8Array.of(1,2)],[0xa0000,Uint8Array.of(3)],[0xffffffff,Uint8Array.of(4,5)]])assert.throws(()=>d.writePhysical(raw,bytes));
 d.generations.set(0x7000,0xffffffff);assert.throws(()=>d.writePhysical(0x7000,Uint8Array.of(5)),/before effect/);assert.deepEqual(d.machine.mem.slice(0x7000,0x7004),before);assert.equal(d.successfulQuanta,0);
});
test('reentry, unsupported PIO, JavaScript stepping and use after close remain denied',()=>{
 let d;d=new DirectBoardFacade(rom(),{capture:()=>assert.throws(()=>d.nativeTick(),/reentry/)});d.beginRun();d.readPhysical(0,1);assert.throws(()=>d.outPort(0x92,1,2),/port admission/);assert.equal(d.mappingEpoch,0);assert.throws(()=>d.machine.cpu.step(),/forbidden/);assert.throws(()=>d.close(),/phase/);d.endRun();d.close();assert.throws(()=>d.beginRun(),/lifecycle/);
});

test('overlapping input views preserve the complete attempted operand',()=>{
 const d=new DirectBoardFacade(rom());d.beginRun();d.writePhysical(0x7000,Uint8Array.of(1,2,3,4));d.writePhysical(0x7001,d.machine.mem.subarray(0x7000,0x7003));assert.deepEqual([...d.machine.mem.slice(0x7000,0x7004)],[1,1,2,3]);assert.equal(d.generations.get(0x7000),2);d.endRun();
});

test('unauthorized A20 hooks and reset-request PIO reject before actual board changes',()=>{
 const d=new DirectBoardFacade(rom());const initial=d.inspect();assert.throws(()=>d.machine._a20Controller.onA20Change(false),/before effect/);assert.deepEqual(d.inspect(),initial);d.beginRun();
 for(const value of [0xfe,0xff,0x60]){const before=d.inspect();assert.throws(()=>d.outPort(0x64,1,value),/before effect/);assert.deepEqual(d.inspect(),before);}
 d.outPort(0x64,1,0xd1);for(const value of [0,2,0xff]){const before=d.inspect();assert.throws(()=>d.outPort(0x60,1,value),/before effect/);assert.deepEqual(d.inspect(),before);}
 d.mappingEpoch=0xffffffff;const before=d.inspect();assert.throws(()=>d.outPort(0x60,1,1),/before effect/);assert.deepEqual(d.inspect(),before);d.active=true;assert.throws(()=>d.machine._a20Controller.onA20Change(false),/before A20 effect/);d.active=false;assert.deepEqual(d.inspect(),before);d.endRun();
});
test('ignored ROM write capture retains copied attempted operand separately from observed bytes',()=>{
 const events=[],d=new DirectBoardFacade(rom(),{capture:e=>events.push(e)});d.beginRun();const operand=Buffer.from([0x12]);const observed=d.writePhysical(0xf0000,operand);operand[0]=0x34;assert.equal(observed.bytes[0],0xea);assert.equal(events[0].args[2][0],0x12);assert.equal(events[0].result.bytes[0],0xea);assert.equal(events[0].result.effect,2);d.endRun();
});

test('bulk execute snapshots match scalar board reads for RAM, ROM and A20 aliases',()=>{
 const board=new DirectBoardFacade(rom());board.beginRun();
 for(const [raw,value] of [[0x7000,0x12],[0x107000,0x34]])board.writePhysical(raw,Uint8Array.of(value,0x56));
 const compare=raw=>{const expected=Uint8Array.from({length:4096},(_,i)=>board.machine._read386(raw+i));const before=board.inspect();const page=board.admitExecutePage(raw);assert.deepEqual(page.bytes,expected);assert.deepEqual(board.inspect(),before);return page;};
 for(const raw of [0x7000,0x107000,0xf0000,0xfffff000])compare(raw);
 board.outPort(0x64,1,0xd1);board.outPort(0x60,1,1);const alias=compare(0x107000);assert.equal(alias.decoded,0x7000);assert.equal(alias.bytes[0],0x12);
 board.writePhysical(0x107000,Uint8Array.of(0x99));assert.equal(alias.bytes[0],0x12,'owned admission remains independent of later RAM writes');
 board.outPort(0x64,1,0xd1);board.outPort(0x60,1,3);assert.equal(compare(0x107000).bytes[0],0x34);board.endRun();board.close();
});
test('bulk execute admission denies unsafe spans and alternate overlays before publication',()=>{
 const board=new DirectBoardFacade(rom());board.beginRun();
 for(const raw of [0x7001,0xa0000,0xc0000,0xffffffff]){const count=board.pages.length,before=board.inspect();assert.throws(()=>board.admitExecutePage(raw));assert.equal(board.pages.length,count);assert.deepEqual(board.inspect(),before);}
 board.machine.vgaMemory={read(){throw Error('overlay must not be read');}};assert.throws(()=>board.admitExecutePage(0xf0000),/overlay/);assert.equal(board.pages.length,0);delete board.machine.vgaMemory;
 board.machine._xv6Mp={};assert.throws(()=>board.admitExecutePage(0xf0000),/overlay/);assert.equal(board.pages.length,0);board.machine._xv6Mp=null;board.endRun();board.close();
});
