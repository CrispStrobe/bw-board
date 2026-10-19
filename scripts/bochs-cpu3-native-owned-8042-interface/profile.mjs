/** Fixed source-only self-test fixture. No compiled native initializer admits it. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {combinedBoardConfig} from '../bochs-cpu3-native-combined-paging-ram/host.mjs';
export const selfTestProfile=Object.freeze({name:'free-8042-interface-test-source-v1',inputBusyCycles:12,responseDelayCycles:32,maxStatusReads:64,maxDataReads:2,witnessAddress:0x592,marker:'I',status:'SOURCE_ONLY_NOT_NATIVE_INTEGRATED'});
export const selfTestBoardConfig=Object.freeze({...combinedBoardConfig,a20:Object.freeze({...combinedBoardConfig.a20,queueLimit:16,inputBusyCycles:12,responseDelayCycles:32,powerOnKeyboardBatCycles:null,keyboardAckCycles:null,keyboardBatCycles:null,keyboardUnlocked:false,mouse:false,allowReset:false})});
// Repository-owned 16-bit bytes: CLI, mask both PICs, AA, bounded OBF polling,
// AA/read55/store, AB/read00/store, markerI/HLT; failures emitF/HLT.
// This byte builder resolves only signed-byte branches, without an assembler.
const code=[],labels=new Map(),fixups=[];
const emit=(...bytes)=>code.push(...bytes),label=name=>labels.set(name,code.length);
const jump=(op,name)=>{emit(op,0);fixups.push([code.length-1,name]);};
emit(0xfa,0x31,0xc0,0x8e,0xd8,0xb0,0xff,0xe6,0x21,0xe6,0xa1,0xb0,0xaa,0xe6,0x64,0xb9,0x40,0x00);
label('poll');emit(0xe4,0x64,0xa8,0x01);jump(0x75,'ready');jump(0xe2,'poll');jump(0xeb,'fail');
label('ready');emit(0xe4,0x60,0xa2,0x92,0x05,0x3c,0x55);jump(0x75,'fail');
emit(0xb0,0xab,0xe6,0x64,0xb9,0x40,0x00);label('interface-poll');emit(0xe4,0x64,0xa8,0x01);jump(0x75,'interface-ready');jump(0xe2,'interface-poll');jump(0xeb,'fail');
label('interface-ready');emit(0xe4,0x60,0xa2,0x93,0x05,0x3c,0x00);jump(0x75,'fail');emit(0xb0,0x49,0xe6,0xe9);label('success-hlt');emit(0xf4);jump(0xeb,'success-hlt');
label('fail');emit(0xb0,0x46,0xe6,0xe9);label('failure-hlt');emit(0xf4);jump(0xeb,'failure-hlt');
for(const [at,name]of fixups){assert.ok(labels.has(name));const delta=labels.get(name)-(at+1);assert.ok(delta>=-128&&delta<=127);code[at]=delta&255;}
const fixed=Uint8Array.from({length:65536},()=>0x90);fixed.set(code);fixed.set([0xea,0x00,0x00,0x00,0xf0],0xfff0);
export const selfTestRomSha256=createHash('sha256').update(fixed).digest('hex');
export function fixedSelfTestRom(...args){assert.equal(args.length,0,'no ROM/config admission');return {rom:Uint8Array.from(fixed),sha256:selfTestRomSha256};}
export const selfTestRomLayout=Object.freeze({entry:0xf0000,reset:0xffff0,successHlt:0xf0000+labels.get('success-hlt'),failureHlt:0xf0000+labels.get('failure-hlt'),codeBytes:code.length});
