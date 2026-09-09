/** Experimental wired DOS boot diagnostic. Uses existing local inputs only. */
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {buildBios} from './build-bios.mjs';
import {findMsdosFiles,build,GEOM,MEM} from './build-dos-image.mjs';
import {HarrisBootCPU} from '../src/experimental/harris-80c286-boot-cpu.js';
import {createHarrisMemoryBoard} from '../src/experimental/harris-80c286-memory-board.js';
import {Harris8259Adapter} from '../src/experimental/harris-8259-adapter.js';
import {Harris8254Adapter} from '../src/experimental/harris-8254-adapter.js';
import {HarrisFDCAdapter} from '../src/experimental/harris-fdc-adapter.js';
import {HarrisDMAAdapter} from '../src/experimental/harris-dma-adapter.js';
import {HarrisKeyboardAdapter} from '../src/experimental/harris-keyboard-adapter.js';
import {registerBusMemory} from '../src/devices/bus-memory.js';
const maxClocks=Number(process.argv[2]??2000000);
const reportPath=process.argv[3];
const netBackend=process.env.HARRIS_NET_BACKEND??'reference';
if(!['reference','compiled'].includes(netBackend))throw new TypeError('HARRIS_NET_BACKEND must be reference or compiled');
const busTrace=process.env.HARRIS_BUS_TRACE??'on';
if(!['on','off'].includes(busTrace))throw new TypeError('HARRIS_BUS_TRACE must be on or off');
const busTraceEnabled=busTrace==='on';
const memorySchedule=process.env.HARRIS_MEMORY_SCHEDULING??'off';
if(!['on','off'].includes(memorySchedule))throw new TypeError('HARRIS_MEMORY_SCHEDULING must be on or off');
const memoryScheduling=memorySchedule==='on';
const journal=process.env.HARRIS_MEMORY_JOURNAL??'off';
if(!['on','off'].includes(journal))throw new TypeError('HARRIS_MEMORY_JOURNAL must be on or off');
const memoryWriteJournal=journal==='on';
const specialize=process.env.HARRIS_DECODER_SPECIALIZATION??'off';
if(!['on','off'].includes(specialize))throw new TypeError('HARRIS_DECODER_SPECIALIZATION must be on or off');
const decoderSpecialization=specialize==='on';
const devices=process.env.HARRIS_DEVICE_SCHEDULING??'off';
if(!['on','off'].includes(devices))throw new TypeError('HARRIS_DEVICE_SCHEDULING must be on or off');
const deviceScheduling=devices==='on';
const packed=process.env.HARRIS_PACKED_BUS??'off';
if(!['on','off'].includes(packed))throw new TypeError('HARRIS_PACKED_BUS must be on or off');
const packedBus=packed==='on';
const layouts=process.env.HARRIS_DRIVE_LAYOUTS??'off';
if(!['on','off'].includes(layouts))throw new TypeError('HARRIS_DRIVE_LAYOUTS must be on or off');
const driveLayouts=layouts==='on';
// Explicit laboratory clock ratio: PIT input is half the board step rate.
// This is a functional boot probe, not a stock-PC timing/performance grade.
const timerClockHalfPeriod=1;
if(!Number.isSafeInteger(maxClocks)||maxClocks<1||maxClocks>100000000)throw new RangeError('clock budget 1..100000000');
const found=findMsdosFiles();if(!found.ok)throw new Error(found.reason);
const hash=b=>createHash('sha256').update(b).digest('hex');
const sourceHashes=Object.fromEntries(['./probe-harris-dos.mjs','./build-bios.mjs','./build-dos-image.mjs',
    '../src/experimental/harris-80c286-boot-cpu.js','../src/experimental/harris-80c286-bus.js',
    '../src/experimental/harris-80c286-memory-board.js','../src/experimental/digital-circuit.js',
    '../src/experimental/compiled-digital-circuit.js',
    '../src/devices/bus-memory.js',
    '../src/experimental/harris-memory-decoder.js',
    '../src/experimental/compiled-device-scheduler.js',
    '../src/experimental/latched-memory-components.js','../src/experimental/harris-fdc-adapter.js',
    '../src/experimental/harris-dma-adapter.js','../src/experimental/harris-keyboard-adapter.js',
    '../src/experimental/harris-8259-adapter.js','../src/experimental/harris-8254-adapter.js',
    '../src/upd765.js','../src/i8237.js','../src/i8255.js','../src/i8259.js','../src/i8254.js',
    '../rom/bios.asm'].map(p=>[p,hash(readFileSync(new URL(p,import.meta.url)))]));
const built=build(found.files),bios=buildBios({picMode:'single-unbuffered'}),rom=bios.bytes;
registerBusMemory();
const pic=new Harris8259Adapter({enabled:true}),timer=new Harris8254Adapter({enabled:true}),
    fdc=new HarrisFDCAdapter({enabled:true,transferEnabled:true}),dma=new HarrisDMAAdapter({enabled:true,transferEnabled:true}),keyboard=new HarrisKeyboardAdapter({enabled:true});
fdc.loadMedia(built.image,{cylinders:GEOM.totalSectors/(GEOM.sectorsPerTrack*GEOM.heads),heads:GEOM.heads,sectors:GEOM.sectorsPerTrack,bytesPerSector:512});
const board=createHarrisMemoryBoard({enabled:true,rom,romLowAlias:true,ramBytes:640*1024,textRAM:true,netBackend,busTraceEnabled,memoryScheduling,memoryWriteJournal,decoderSpecialization,deviceScheduling,packedBus,driveLayouts,
    intrEnabled:true,ioEnabled:true,holdEnabled:true,interruptDevice:pic,timerDevice:timer,timerClockHalfPeriod,fdcDevice:fdc,dmaDevice:dma,keyboardDevice:keyboard});
const cpu=new HarrisBootCPU({enabled:true,board});let clocks=0,outcome,screen='',bootSectorEntered=false;
const textScreen=()=>{const c=board.inspectMemory('text0').bytes;return Array.from({length:25},(_,r)=>String.fromCharCode(...c.slice(0x4000+r*80,0x4000+(r+1)*80))).join('\n');};
const start=Date.now();
let keys=2;
const ramByte=a=>{const bank=a>>>16;return board.inspectMemory(bank?`ram${bank}_${a&1}`:`ram${a&1}`).bytes[(a&65535)>>1];};
const landmarks={};let commandMatches=false;
const seen=name=>{landmarks[name]??=clocks;};
try {
    cpu.initialize();
    while(clocks<maxClocks){
        cpu.stepClock();clocks++;
        if(keys&&cpu.cs===0xf000&&cpu.ip===bios.symbols.get('int16').value&&keyboard.inspect().scan===null&&
            ramByte(0x41a)===ramByte(0x41c)&&ramByte(0x41b)===ramByte(0x41d)){keyboard.press(0x1c);keys--;}
        if(cpu.cs===0&&cpu.ip>=0x7c00&&cpu.ip<0x7e00)bootSectorEntered=true;
        if(cpu.cs===0&&cpu.ip===0x7c00)seen('bootSector');
        if(cpu.cs===MEM.biosSeg){
            if(cpu.ip===0)seen('iosysEntry');
            for(const name of ['HWINIT','RE_INIT','DSK_RED','CONIN'])if(cpu.ip===built.iosys.sym(name))seen(name);
        }
        if(cpu.cs===MEM.sysinitSeg&&cpu.ip===0)seen('sysinit');
        if(!commandMatches&&cpu.ip===0x100&&cpu.cs>0x400&&cpu.cs<0x9000){
            const psp=cpu.cs*16;
            if(ramByte(psp)===0xcd&&ramByte(psp+1)===0x20){
                commandMatches=found.files.command.slice(0,64).every((b,i)=>ramByte(psp+0x100+i)===b);
                if(commandMatches)seen('commandCom');
            }
        }
        if(clocks%10000===0){
            screen=textScreen();console.error(JSON.stringify({clocks,retired:cpu.retired,cs:cpu.cs,ip:cpu.ip,dma:dma.inspect().transferred,elapsedMS:Date.now()-start,screen:screen.replaceAll('\0',' ').trimEnd()}));
            if(commandMatches&&bootSectorEntered&&/^A>/m.test(screen)&&dma.inspect().transferred>32768){outcome={status:'dos-prompt'};break;}
        }
    }
    outcome??={status:'budget-exhausted'};
}catch(e){outcome={status:'fault',code:e.code??e.name,message:e.message};}
screen=textScreen();
const report={accepted:outcome.status==='dos-prompt',maxClocks,clocks,elapsedMS:Date.now()-start,outcome,bootSectorEntered,landmarks,commandMatches,timerClockHalfPeriod,netBackend,busTraceEnabled,memoryScheduling,memoryWriteJournal,decoderSpecialization,deviceScheduling,packedBus,driveLayouts,
    sourceHashes,romSHA256:hash(rom),diskSHA256:hash(built.image),inputHashes:Object.fromEntries(Object.entries(found.files).map(([k,v])=>[k,hash(v)])),
    cpu:cpu.inspect(),pic:pic.inspect(),timer:timer.inspect(),fdc:fdc.inspect(),dma:dma.inspect(),keyboard:keyboard.inspect(),screen};
if(reportPath)writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(report,null,2));
process.exitCode=outcome.status==='dos-prompt'?0:2;
