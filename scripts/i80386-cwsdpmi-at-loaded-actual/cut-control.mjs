import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {VGAMemory} from '../../src/experimental/vga-memory.js';
import {admitBoundImage} from '../i80386-cwsdpmi-at-owned/binding.mjs';
import {bindAtMainCut,candidateAtMain,observationFingerprint} from './cut.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const coff = 512, rawPointer = 128, textAddress = 0x1000, textBytes = 0x800;
const exe = Buffer.alloc(4096);
exe.write('MZ'); exe.writeUInt16LE(1,4); exe.writeUInt16LE(4,8);
exe.writeUInt16LE(0x14c,coff); exe.writeUInt16LE(1,coff+2);
exe.writeUInt16LE(28,coff+16); exe.writeUInt16LE(0x102,coff+18);
exe.writeUInt16LE(0x010b,coff+20); exe.write('.text',coff+48);
exe.writeUInt32LE(textAddress,coff+56);exe.writeUInt32LE(textAddress,coff+60);
exe.writeUInt32LE(textBytes,coff+64);exe.writeUInt32LE(rawPointer,coff+68);
exe.writeUInt32LE(0x20,coff+84);
for(let i=0;i<textBytes;i++)exe[coff+rawPointer+i]=i%251;
const specs=[
  ['main','main',0x1400,0x100,'client.o','.text.startup'],
  ['allocateMemory','__dpmi_allocate_memory',0x1100,0x40,'libc.a(d0501.o)','.text'],
  ['allocateLdt','__dpmi_allocate_ldt_descriptors',0x1140,0x30,'libc.a(d0000.o)','.text'],
  ['setBase','__dpmi_set_segment_base_address',0x1170,0x30,'libc.a(d0007.o)','.text'],
  ['setLimit','__dpmi_set_segment_limit',0x11a0,0x30,'libc.a(d0008.o)','.text'],
  ['simulateInt','__dpmi_int',0x11d0,0x90,'libc.a(d0300_z.o)','.text'],
  ['freeLdt','__dpmi_free_ldt_descriptor',0x1260,0x30,'libc.a(d0001.o)','.text'],
  ['freeMemory','__dpmi_free_memory',0x1290,0x30,'libc.a(d0502.o)','.text'],
];
const map=Buffer.from('.text 0x1000 0x800\n'+specs.map(([,symbol,address,bytes,member,section])=>
  ` ${section} 0x${address.toString(16)} 0x${bytes.toString(16)} /selected/${member}\n`+
  `  0x${address.toString(16)} ${symbol}\n`).join(''));
const compile={schema:'bw.cwsdpmi-owned.compile-only.v1',
  status:'COMPILED_NO_GUEST_NO_BINARY_PUBLICATION',
  ownedSource:{path:'scripts/i80386-cwsdpmi-owned/client.c',
    sha256:'c8c654326633b244c64baac144fe9300ce5a1800c330e52615470c62d8c3bb1d'},
  toolchain:{sha256:'8464f17017d6ab1b2bb2df4ed82357b5bf692e6e2b7fee37e315638f3d505f00'},
  sourceArchives:{
    'djcrx205.zip':{sha256:'22274ed8d5ee57cf7ccf161f5e1684fd1c0192068724a7d34e1bde168041ca60'},
    'djdev205.zip':{sha256:'4557dfb6c161d326680ae5fa71f0098ac49425a1b11b90a020b83162eb705dda'},
    'djlsr205.zip':{sha256:'80690b6e44ff8bc6c6081fca1f4faeba1591c4490b76ef0ec8b35847baa5deea'},
  },
  compileArgv:['/selected/i586-pc-msdosdjgpp-gcc','-std=gnu11','-O2','-march=i386',
    '-mtune=i386','-Wall','-Wextra','-Werror','-fno-lto','-c','client.c','-o','client.o'],
  linkArgv:['/selected/i586-pc-msdosdjgpp-gcc','-march=i386','-mtune=i386',
    '-Wl,-Map,client.map','-o','client.exe','client.o'],
  resolvedImplicitRoles:Object.fromEntries(['assembler','linker','stubify','crt0.o','libc.a','libgcc.a']
    .map(role=>[role,{admitted:true}])),
  executable:{bytes:exe.length,sha256:hash(exe),uploaded:false},
  map:{bytes:map.length,sha256:hash(map)}};
const layout=admitBoundImage(exe,map,compile);

function machine() {
  const mem=new Uint8Array(16<<20),page=new Uint8Array(4096);
  page.fill(1,0,0xa0);page.fill(1,0x100,0x460);
  mem.set(exe.subarray(coff+rawPointer,coff+rawPointer+textBytes),textAddress);
  const cache={base:0,limit:0xffffffff,default32:true,present:true,code:true};
  const cpu={cpuProfile:'compatibility',segmentCaches:Object.fromEntries(
    [0,1,2,3,4,5].map(n=>[n,{...cache,code:n===1}])),
    gdtr:{base:0,limit:0},idtr:{base:0,limit:0},
    ldtr:{selector:0,base:0,limit:0,present:false},
    tr:{selector:0,base:0,limit:0,present:false},
    _debugRegisters:new Uint32Array(8),_repeatContext:null,
    _translationGeneration:1,_translations:new Array(512),
    _translationTablePages:new Set(),_retainedRealCs:false,
    _interruptShadow:0,_nmiShadow:0,_debugShadow:0,_nmiActive:false,
    halted:false,shutdown:false,cycles:5000,eip:0x1400,eflags:2,
    cs:0x18,ds:0x20,es:0x20,ss:0x20,fs:0x20,gs:0x20,
    cr0:1,cr2:0,cr3:0,cr4:0};
  for(const name of ['eax','ecx','edx','ebx','esp','ebp','esi','edi'])cpu[name]=0;
  Object.defineProperty(cpu,'protectedMode',{get(){return !!(this.cr0&1);}});
  const videoChip={displayRevision:1,getVideoState(){throw new Error('VGA hook invoked');}};
  const m={cpu,mem,_page:page,memoryBytes:16<<20,cycles:5000,
    _chipDebt:11,_chipDeadline:60,displayRevision:3,
    _nmiPending:false,_nmiMasked:false,_cpuResetPending:false,
    chips:{vga1:videoChip},vgaMemory:new VGAMemory(videoChip),
    _a20Configured:true,_a20Enabled:true,_xv6Mp:null,
    config:{cpuBackend:'i80386-experimental',memoryBytes:16<<20,
      experimentalVgaMemory:'vga1',regions:[
        {kind:'ram',start:0,end:0x9ffff},{kind:'ram',start:0x100000,end:0x45ffff}]},
    _read386(){throw new Error('bus reader invoked');},
    step(){throw new Error('guest step invoked');}};
  return m;
}

const valid=machine(),old=observationFingerprint(valid);
assert.equal(candidateAtMain(valid,layout),true);
const admitted=bindAtMainCut(valid,layout);
assert.equal(admitted.binding.main,0x1400);
assert.equal(admitted.loadedSha256,layout.text.sha256);
assert.deepEqual(admitted.before,old);
assert.deepEqual(admitted.after,old);
assert.deepEqual(observationFingerprint(valid),old);
assert.throws(()=>bindAtMainCut(valid,layout),/failed AT loaded-main cut/);
const publicTamper=machine();
const oldAddress=layout.text.address,oldBytes=layout.text.bytes,
  oldMain=layout.roles.main.address;
layout.text.address=0;layout.text.bytes=1;layout.roles.main.address=0;
assert.equal(candidateAtMain(publicTamper,layout),true);
assert.equal(bindAtMainCut(publicTamper,layout).binding.main,oldMain);
layout.text.address=oldAddress;layout.text.bytes=oldBytes;
layout.roles.main.address=oldMain;

const wrong=machine();wrong.mem[textAddress+7]^=1;
const wrongBefore=observationFingerprint(wrong);
let wrongError=null;
assert.throws(()=>bindAtMainCut(wrong,layout),error=>{
  wrongError=error;return /loaded text differs/.test(error.message);
});
assert.equal(wrongError.textMismatch.changedBytes,1);
assert.equal(wrongError.textMismatch.firstOffset,7);
assert.equal(wrongError.textMismatch.spans[0].offset,7);
assert.equal(wrongError.textMismatch.expectedSha256,layout.text.sha256);
assert.equal(wrongError.textMismatch.roles.main.equal,true);
assert.deepEqual(wrongError.observation.before,wrongError.observation.after);
assert.deepEqual(observationFingerprint(wrong),wrongBefore);
const falseMain=machine();falseMain.cpu.eip++;
assert.equal(candidateAtMain(falseMain,layout),false);
assert.throws(()=>bindAtMainCut(falseMain,layout),/not at/);
const halted=machine();halted.cpu.halted=true;
assert.equal(candidateAtMain(halted,layout),false);

const pageDenied=machine();pageDenied._page[1]=0;
assert.throws(()=>bindAtMainCut(pageDenied,layout),error=>{
  assert.equal(error.textMismatch,undefined);
  return /ordinary RAM/.test(error.message);
});
const accessor=machine();let getterCalled=false;
Object.defineProperty(accessor.chips,'vga1',{get(){getterCalled=true;return {};}});
assert.throws(()=>bindAtMainCut(accessor,layout),/chip map accessor/);
assert.equal(getterCalled,false);
const object=machine();let serialized=false;
object.cpu.eax={toJSON(){serialized=true;return 0;}};
assert.throws(()=>observationFingerprint(object),/nonprimitive observed scalar/);
assert.equal(serialized,false);

const changedBase=machine();let changed=false,configReads=0;
const changedMachine=new Proxy(changedBase,{getOwnPropertyDescriptor(target,key){
  if(key==='config'&&++configReads===2){changed=true;target._chipDebt++;}
  return Reflect.getOwnPropertyDescriptor(target,key);
}});
assert.throws(()=>bindAtMainCut(changedMachine,layout),/observation mutated/);
assert.equal(changed,true);

const swappedBase=machine();let pageReads=0;
const swapped=new Proxy(swappedBase,{getOwnPropertyDescriptor(target,key){
  if(key==='_page'&&++pageReads===5)target._page=Uint8Array.from(target._page);
  return Reflect.getOwnPropertyDescriptor(target,key);
}});
assert.throws(()=>bindAtMainCut(swapped,layout),/observation mutated/);
assert.equal(pageReads>=5,true);

const reentryBase=machine();let nested=false;
const reentrant=new Proxy(reentryBase,{getOwnPropertyDescriptor(target,key){
  if(key==='config'&&!nested){
    try {bindAtMainCut(reentrant,layout);} catch {nested=true;}
  }
  return Reflect.getOwnPropertyDescriptor(target,key);
}});
assert.throws(()=>bindAtMainCut(reentrant,layout),/observation mutated/);
assert.equal(nested,true);
assert.throws(()=>bindAtMainCut(reentrant,layout),/failed AT loaded-main cut/);
console.log('CWSDPMI AT loaded-main cut controls PASS');
