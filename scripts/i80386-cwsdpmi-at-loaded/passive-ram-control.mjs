import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readOrdinaryLinear} from './passive-ram.mjs';
import {VGAMemory} from '../../src/experimental/vga-memory.js';

const BACKING=16<<20,sha=b=>createHash('sha256').update(b).digest('hex');
function fixture({paging=false,cpl=3,vga=false}={}) {
  const mem=new Uint8Array(BACKING),pages=new Uint8Array(BACKING>>>12);
  pages.fill(1,0,0xa0);pages.fill(1,0x100,0x460);
  pages[0xb8]=vga?0:1;pages[0xf0]=2;
  const cpu={cpuProfile:'compatibility',cr0:paging?0x80000001:1,
    cr3:0x110000,cr4:0,cs:cpl===3?0x1b:0x18,eflags:2,
    cr2:0xfeed0000,_translationGeneration:7,_translations:[{page:4,physicalBase:0x101000}],
    _retainedRealCs:false,segmentCaches:{1:{base:0,default32:true,present:true,code:true}}};
  const vgaChip={getVideoState(){throw new Error('VGA register reader invoked');}};
  const machine={cpu,mem,_page:pages,memoryBytes:BACKING,
    chips:vga?{vga1:vgaChip}:{},vgaMemory:vga?new VGAMemory(vgaChip):null,
    _a20Configured:true,_a20Enabled:true,_xv6Mp:null,
    config:{cpuBackend:'i80386-experimental',memoryBytes:BACKING,
      ...(vga?{experimentalVgaMemory:'vga1'}:{}),
      regions:[{kind:'ram',start:0,end:0x9ffff},
        ...(!vga?[{kind:'ram',start:0xb8000,end:0xbffff}]:[]),
        {kind:'ram',start:0x100000,end:0x45ffff},
        {kind:'rom',start:0xf0000,end:0xfffff}]},
    boardState:{pio:0,displayRevision:7},
    _read386(){throw new Error('bus reader invoked');},
    _read(){throw new Error('board reader invoked');}};
  cpu._translate=()=>{throw new Error('CPU page walk invoked');};
  return machine;
}
const put32=(m,at,n)=>{for(let i=0;i<4;i++)m.mem[at+i]=(n>>>(8*i))&255;};
const get32=(m,at)=>(m.mem[at]|m.mem[at+1]<<8|m.mem[at+2]<<16|m.mem[at+3]<<24)>>>0;
function tables(m,{pde=0x111007,pte4=0x101007,pte5=0x200007}={}) {
  put32(m,0x110000,pde);put32(m,0x111000+4*4,pte4);
  put32(m,0x111000+5*4,pte5);
}
const read=(m,linear,length)=>readOrdinaryLinear(m,{linear,length,sourcePaused:true});
const denies=(m,linear,length)=>assert.throws(()=>read(m,linear,length));

const identity=fixture();identity.mem.set([0x31,0x32,0x33,0x34],0x101000);
const before={cpu:JSON.stringify(identity.cpu),board:JSON.stringify(identity.boardState),
  mem:sha(identity.mem),pages:sha(identity._page)};
assert.deepEqual([...read(identity,0x101000,4)],[0x31,0x32,0x33,0x34]);
assert.deepEqual({cpu:JSON.stringify(identity.cpu),board:JSON.stringify(identity.boardState),
  mem:sha(identity.mem),pages:sha(identity._page)},before);

const paged=fixture({paging:true});tables(paged);
paged.mem.set([0xa1,0xa2],0x101ffe);paged.mem.set([0xb1,0xb2],0x200000);
const oldEntries=[get32(paged,0x110000),get32(paged,0x111010),get32(paged,0x111014)];
const oldCpu=JSON.stringify(paged.cpu),oldBoard=JSON.stringify(paged.boardState),
  oldRam=sha(paged.mem);
assert.deepEqual([...read(paged,0x4ffe,4)],[0xa1,0xa2,0xb1,0xb2]);
assert.deepEqual([get32(paged,0x110000),get32(paged,0x111010),get32(paged,0x111014)],oldEntries);
assert.equal(JSON.stringify(paged.cpu),oldCpu);assert.equal(JSON.stringify(paged.boardState),oldBoard);
assert.equal(sha(paged.mem),oldRam);
const supervisor=fixture({paging:true,cpl:0});tables(supervisor,{pde:0x111001,pte4:0x101001});
supervisor.mem[0x101000]=0x77;assert.equal(read(supervisor,0x4000,1)[0],0x77);

const absent=fixture({paging:true});tables(absent,{pte4:0});denies(absent,0x4000,1);
const userDenied=fixture({paging:true});tables(userDenied,{pde:0x111003});denies(userDenied,0x4000,1);
const userPteDenied=fixture({paging:true});tables(userPteDenied,{pte4:0x101003});
denies(userPteDenied,0x4000,1);
const large=fixture({paging:true});tables(large,{pde:0x111087});denies(large,0x4000,1);
const pse=fixture({paging:true});pse.cpu.cr4=0x10;denies(pse,0x4000,1);
const disabled=fixture();disabled._a20Enabled=false;denies(disabled,0x101000,1);
const rom=fixture();denies(rom,0xf0000,1);
const mmio=fixture();denies(mmio,0xb8000,1);
const vga=fixture({vga:true});vga.mem[0x101000]=0x53;
assert.equal(read(vga,0x101000,1)[0],0x53);
const vgaAperture=fixture({vga:true});denies(vgaAperture,0xb8000,1);
const wrongVga=fixture({vga:true});wrongVga.vgaMemory.registerSource={};
denies(wrongVga,0x101000,1);
const backingOnly=fixture();denies(backingOnly,0x600000,1);
const tableRom=fixture({paging:true});tableRom.cpu.cr3=0xf0000;denies(tableRom,0x4000,1);
const wrongProfile=fixture();wrongProfile.cpu.cpuProfile='strict386';denies(wrongProfile,0x101000,1);
const overflow=fixture();denies(overflow,0xfffffffe,4);
const unpaused=fixture();assert.throws(()=>readOrdinaryLinear(unpaused,
  {linear:0x101000,length:1,sourcePaused:false}));
const accessor=fixture();let getterCalled=false;
const request={linear:0x101000,sourcePaused:true};
Object.defineProperty(request,'length',{get(){getterCalled=true;return 1;}});
assert.throws(()=>readOrdinaryLinear(accessor,request));
assert.equal(getterCalled,false);

let reentry;
const hostile=fixture();
Object.defineProperty(hostile.config,'regions',{get(){
  try {readOrdinaryLinear(hostile,{linear:0x101000,length:1,sourcePaused:true});}
  catch {reentry=true;}
  return [{kind:'ram',start:0,end:0x9ffff},{kind:'ram',start:0x100000,end:0x45ffff}];
}});
assert.throws(()=>read(hostile,0x101000,1));assert.equal(reentry,true);
assert.throws(()=>read(hostile,0x101000,1));
console.log('CWSDPMI passive ordinary-RAM controls PASS');
