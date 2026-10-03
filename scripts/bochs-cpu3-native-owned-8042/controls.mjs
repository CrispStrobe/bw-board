/** Bounded source controls and tiny functional JS ROM probe; no native addon/build. */
import assert from 'node:assert/strict';
import {Source8042Board,createOwned8042Provider} from './provider.mjs';
import {fixedSelfTestRom,selfTestProfile,selfTestRomLayout,selfTestRomSha256,selfTestBoardConfig} from './profile.mjs';
import {ExperimentalI80386ATMachine} from '../../src/experimental/i80386-at-machine.js';
import {combinedBoardConfig,combinedBoardState} from '../bochs-cpu3-native-combined-paging-ram/host.mjs';
let checks=0;const equal=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;},ok=(a,m)=>{assert.ok(a,m);checks++;},denied=(fn,re)=>{assert.throws(fn,re);checks++;};
const fresh=()=>{const b=new Source8042Board();b.beginRun();b.outPort(0x21,1,255);b.outPort(0xa1,1,255);return b;};
const device=b=>({board:b.inspect().board,controllerIrq:b.machine._a20Controller._irq,controllerAuxIrq:b.machine._a20Controller._auxIrq,mapping:b.mappingState()});
const elapsed=(b,n)=>{b.machine.cycles+=n;b.machine._chipDebt+=n;};
const pio=(p,op,port,value=0)=>{const result=p.callbacks.packedScalar(op,port,1,value);p.callbacks.clockTransfer(new Uint32Array(),6);return result;};
const owned=()=>{const p=createOwned8042Provider();p.callbacks.clockTransfer(new Uint32Array(),1);p.begin();p.callbacks.clockTransfer(new Uint32Array(),2);pio(p,3,0x21,255);pio(p,3,0xa1,255);pio(p,3,0x64,0xaa);return p;};
// ROM copies/config are fixed; no caller callbacks or arbitrary images enter the owner.
const rom=fixedSelfTestRom();equal(rom.sha256,selfTestRomSha256);equal(rom.rom.length,65536);rom.rom[0]=0;equal(fixedSelfTestRom().rom[0],0xfa);denied(()=>createOwned8042Provider({compactSink:()=>{}}),/no caller/);denied(()=>new Source8042Board({}),/no ROM/);
// Actual machine/controller timing; status reads do not supply clocks or consume data.
{
 const b=fresh();const map=b.mappingState(),pics=[b.machine._pic.getState(),b.machine.chips.pic2.getState()];b.outPort(0x64,1,0xaa);equal(b.inPort(0x64,1).value&7,2);
 const before=device(b);for(let i=0;i<20;i++)equal(b.inPort(0x64,1).value&7,2);equal(device(b),before,'repeated status preserves full controller/PIC/board state');
 elapsed(b,12);equal(b.inPort(0x64,1).value&7,0,'busy clears before response');elapsed(b,20);equal(b.inPort(0x64,1).value&7,1,'32 actual elapsed cycles release55');
 equal(b.inPort(0x60,1).value,0x55);equal(b.inPort(0x60,1).value,0xff);denied(()=>b.inPort(0x60,1),/bounded self-test/);equal(b.mappingState(),map);equal([b.machine._pic.getState(),b.machine.chips.pic2.getState()],pics,'controller-only55 creates no keyboard/aux IRQ edge');b.endRun();b.close();
}
// Equal elapsed state independently of polling count on two actual boards.
{
 const a=fresh(),b=fresh();a.outPort(0x64,1,0xaa);b.outPort(0x64,1,0xaa);for(let i=0;i<30;i++)a.inPort(0x64,1);elapsed(a,32);elapsed(b,32);a.inPort(0x64,1);b.inPort(0x64,1);equal(device(a),device(b));a.endRun();b.endRun();a.close();b.close();
}
// Invalid foreign state is refused before consuming the already ready55.
{
 const b=fresh();b.outPort(0x64,1,0xaa);elapsed(b,32);b.inPort(0x64,1);const c=b.machine._a20Controller;
 const taints=[['keyboardSchedule',[{remaining:7,value:0xaa}]],['pendingCommand',0xd1],['pendingKeyboardCommand',0xf3],['typematicParameter',1],['outputQueue',[{value:0x55,keyboard:true}]],['outputQueue',[{value:0x55,keyboard:false,aux:true}]],['outputQueue',[{value:0x54,keyboard:false}]],['delayedResponse',{value:0x54}]];
 for(const [name,value]of taints){const old=c[name];c[name]=value;const before=device(b);denied(()=>b.inPort(0x60,1),/8042/);equal(device(b),before,'denial consumes nothing at zero debt');c[name]=old;}
 denied(()=>b.outPort(0x64,1,0xaa),/one AA/);equal(c.outputQueue,[{value:0x55,keyboard:false}]);b.endRun();b.close();
}
// Denial after actual catchup preserves the response but can release an unsolicited schedule.
{
 const b=fresh();b.outPort(0x64,1,0xaa);elapsed(b,32);b.inPort(0x64,1);const c=b.machine._a20Controller;c.keyboardSchedule=[{remaining:1,value:0xaa}];elapsed(b,6);denied(()=>b.inPort(0x60,1),/8042/);equal(b.machine._chipDebt,0);equal(c.outputQueue,[{value:0x55,keyboard:false},{value:0xaa,keyboard:true}]);equal(c.keyboardSchedule,[]);equal(b.dataReads,0);b.endRun();b.close();
}
// Original D1+OUT60 1/3 behavior remains separate and positive; reset/other data denied.
{
 const b=fresh();denied(()=>b.outPort(0x60,1,1),/output port/);b.outPort(0x64,1,0xd1);denied(()=>b.outPort(0x60,1,0),/output port/);b.outPort(0x60,1,1);equal(b.mappingState(),{boardA20:0,mappingEpoch:1});b.outPort(0x64,1,0xd1);b.outPort(0x60,1,3);equal(b.mappingState(),{boardA20:1,mappingEpoch:2});denied(()=>b.outPort(0x64,1,0xfe),/command before effect/);b.endRun();b.close();
}
// No AA over existing delayed/pending/output state; no unsupported width before effects.
{
 const b=fresh(),c=b.machine._a20Controller;for(const [name,value]of [['pendingCommand',0xd1],['outputQueue',[{value:0x55,keyboard:false}]],['delayedResponse',{value:0x55}]]){const old=c[name];c[name]=value;const before=device(b);denied(()=>b.outPort(0x64,1,0xaa),/8042|one AA/);equal(device(b),before);c[name]=old;}denied(()=>b.inPort(0x64,2),/admission/);denied(()=>b.outPort(0x64,2,0xaa),/admission/);b.endRun();b.close();
}
// Mandatory POSTPIO even with zero debt, whole-tape preflight and due-Q boundary.
{
 const p=owned();const status=p.callbacks.packedScalar(5,0x64,1,0);equal(status[0]&7,2);denied(()=>p.end(),/assertion|false/i);denied(()=>p.callbacks.packedScalar(5,0x64,1,0),/lease/);p.callbacks.clockTransfer(new Uint32Array(),6);
 denied(()=>p.callbacks.clockTransfer(Uint32Array.of(2,99),3),/word enum/);equal(Array.from(p.callbacks.clockTransfer(Uint32Array.of(2,2),3)).slice(0,5),[0,2,16,12,12]);denied(()=>p.callbacks.clockTransfer(Uint32Array.of(2),3),/Q after due/);p.end();p.stage();const state=p.checkpoint();equal(state.board.a20.inputBusyCyclesRemaining,0);equal(state.board.a20.responseCyclesRemaining,20);p.begin();p.callbacks.clockTransfer(new Uint32Array(),2);p.callbacks.clockTransfer(Uint32Array.of(2,2,2,2),3);p.end();p.stage();equal(p.checkpoint().board.a20.outputQueue,[{value:0x55,keyboard:false}]);p.begin();p.callbacks.clockTransfer(new Uint32Array(),2);equal(pio(p,5,0x60)[0],0x55);const empty=p.callbacks.packedScalar(5,0x60,1,0);equal(empty[0],0xff);denied(()=>p.end(),/assertion|false/i);p.callbacks.clockTransfer(new Uint32Array(),6);p.end();equal(p.checkpoint().mappingEpoch,0);p.close();
}
// Delayed release at beginRun and terminal flush obeys a narrow unchanged-A20 owner phase.
for(const phase of ['begin','terminal']){
 const p=owned();p.callbacks.clockTransfer(Uint32Array.of(2,2),3);p.end();p.begin();p.callbacks.clockTransfer(new Uint32Array(),2);p.callbacks.clockTransfer(Uint32Array.of(2,2,2,2),3);p.end();
 if(phase==='begin'){p.begin();p.callbacks.clockTransfer(new Uint32Array(),2);p.end();equal(p.checkpoint().board.a20.outputQueue,[{value:0x55,keyboard:false}]);}
 else equal(p.terminal().state.board.a20.outputQueue,[{value:0x55,keyboard:false}]);
 equal(p.checkpoint().mappingEpoch,0);equal(p.checkpoint().board.a20Enabled,true);p.close();
}
// Neither paused callbacks nor a chip-flush phase may mutate A20.
{
 const b=fresh(),c=b.machine._a20Controller;b.endRun();denied(()=>c.onA20Change(true),/unauthorized A20/);denied(()=>c.onA20Change(false),/unauthorized A20/);equal(b.mappingState(),{boardA20:1,mappingEpoch:0});b.beginRun();b.outPort(0x64,1,0xaa);elapsed(b,32);c.outputPort=1;b.endRun();denied(()=>b.stageLine(),/cannot change A20/);equal(b.mappingState(),{boardA20:1,mappingEpoch:0});equal([b.running,b.active],[false,false]);b.close();
}
// Tiny ordinary JavaScript CPU probe validates the actual authored ROM bytes.
{
 const ports=[];const m=new ExperimentalI80386ATMachine(selfTestBoardConfig,{onPortAccess:e=>ports.push({...e})});const {rom}=fixedSelfTestRom();m.loadRom(rom,0xf0000);m.loadRom(rom);m.reset();let steps=0;while(!m.cpu.halted&&steps<512){m.step();steps++;}ok(m.cpu.halted,'bounded JS ROM reaches HLT');ok(steps<512);equal(Array.from(m.mem.subarray(0x592,0x594)),[0x55,0xff]);equal(ports.filter(e=>e.dir==='out'&&e.port===0xe9).map(e=>e.value),[0x4b]);equal(ports.filter(e=>e.dir==='out'&&e.port===0x64).map(e=>e.value),[0xaa]);ok(ports.filter(e=>e.dir==='in'&&e.port===0x64).length<=64);equal(m._a20Enabled,true);equal(m._pic.imr,255);equal(m.chips.pic2.imr,255);equal(m._a20Controller.outputQueue,[]);
 console.log(JSON.stringify({status:'SOURCE_8042_CONTROLS_AND_TINY_JS_ROM_PASS_NOT_NATIVE_QUALIFICATION',checks,jsProbeSteps:steps,romSha256:selfTestRomSha256,layout:selfTestRomLayout,finalBoard:combinedBoardState(m),scope:'Actual source owner/device controls and tiny ordinary JS fixture only. No addon/C build/native guest/performance/general AT claim.'}));
}
