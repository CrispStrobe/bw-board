// Single-owner-thread, source-only ordinary-RAM reader. No CPU/bus hooks.
const BACKING = 16 << 20;
const MAX_READ = 1 << 20;
const active = new WeakMap();
const u32 = n => Number.isInteger(n) && n >= 0 && n <= 0xffffffff;

function own(object,key) {
  const d = object && Object.getOwnPropertyDescriptor(object,key);
  if (!d || !Object.hasOwn(d,'value')) throw new Error(`non-data ${key}`);
  return d.value;
}
function ordinaryPage(page) {
  // 640 KiB conventional + 3456 KiB extended; the 16 MiB backing is not RAM.
  return page <= 0x9f || (page >= 0x100 && page <= 0x45f);
}
function context(machine) {
  const cpu=own(machine,'cpu'),mem=own(machine,'mem'),pages=own(machine,'_page');
  const config=own(machine,'config'),memoryBytes=own(machine,'memoryBytes');
  if (!cpu || !config || config.cpuBackend!=='i80386-experimental' ||
      config.experimentalXv6Mp || config.memoryBytes!==BACKING ||
      memoryBytes!==BACKING || mem?.constructor!==Uint8Array ||
      Object.getPrototypeOf(mem)!==Uint8Array.prototype ||
      !(mem.buffer instanceof ArrayBuffer) || mem.byteOffset!==0 ||
      mem.byteLength!==BACKING || mem.buffer.byteLength!==BACKING ||
      pages?.constructor!==Uint8Array || Object.getPrototypeOf(pages)!==Uint8Array.prototype ||
      pages.length!==(BACKING>>>12) || own(machine,'_xv6Mp')!==null)
    throw new Error('outside ordinary 4 MiB AT backing profile');
  const ram=(config.regions??[]).filter(r=>r.kind==='ram');
  if(ram.length!==2 || ram[0].start!==0 || ram[0].end!==0x9ffff ||
     ram[1].start!==0x100000 || ram[1].end!==0x45ffff)
    throw new Error('configured RAM ranges');
  if(own(machine,'_a20Configured')!==true || own(machine,'_a20Enabled')!==true)
    throw new Error('A20 source authority not enabled');
  const cr0=own(cpu,'cr0'),cr3=own(cpu,'cr3'),cr4=own(cpu,'cr4'),
    cs=own(cpu,'cs'),eflags=own(cpu,'eflags'),cache=own(cpu,'segmentCaches');
  const code=own(cache,1);
  if(own(cpu,'cpuProfile')!=='compatibility' || ![cr0,cr3,cr4,cs,eflags].every(u32) ||
     !(cr0&1) || cr4!==0 || (eflags&0x20000) || own(cpu,'_retainedRealCs')!==false ||
     own(code,'default32')!==true || own(code,'present')!==true ||
     own(code,'code')!==true || !u32(own(code,'base')))
    throw new Error('unsupported protected 32-bit paging profile');
  return {cpu,mem,pages,memoryBytes,cr0,cr3,cr4,cs,eflags,code,
    codeBase:own(code,'base'),cpl:cs&3};
}
function physical(c,address) {
  if(!u32(address) || address>=c.memoryBytes || address>=c.mem.length ||
     !ordinaryPage(address>>>12) || c.pages[address>>>12]!==1)
    throw new Error('physical address is not installed ordinary RAM');
  return c.mem[address];
}
function dword(c,address) {
  if(!u32(address) || address>0xfffffffc || (address&3))
    throw new Error('page-table entry extent');
  return (physical(c,address) | (physical(c,address+1)<<8) |
    (physical(c,address+2)<<16) | (physical(c,address+3)<<24))>>>0;
}
function translate(c,linear) {
  if(!(c.cr0&0x80000000))return linear;
  const pdeAt=(c.cr3&0xfffff000)>>>0;
  const pde=dword(c,pdeAt+((linear>>>20)&0xffc));
  if(!(pde&1))throw new Error('PDE not present');
  if(pde&0x80)throw new Error('large-page PDE unsupported');
  const pteAt=((pde&0xfffff000)>>>0)+((linear>>>10)&0xffc);
  const pte=dword(c,pteAt);
  if(!(pte&1))throw new Error('PTE not present');
  if(c.cpl===3 && (!(pde&4) || !(pte&4)))
    throw new Error('user read denied by PDE/PTE');
  // Read permission does not depend on RW or CR0.WP. No A/D bit is written.
  return (((pte&0xfffff000)>>>0) | (linear&0xfff))>>>0;
}

export function readOrdinaryLinear(machine,request) {
  if(!machine || typeof machine!=='object')throw new Error('machine object');
  const state=active.get(machine)??{busy:false,failed:false};
  active.set(machine,state);
  if(state.busy || state.failed){state.failed=true;throw new Error('reentered/failed RAM reader');}
  state.busy=true;
  try {
    // sourcePaused is a caller obligation, not an authenticated pause lease.
    if(request?.sourcePaused!==true || !u32(request.linear) ||
       !Number.isInteger(request.length) || request.length<1 || request.length>MAX_READ ||
       request.linear+request.length-1>0xffffffff)
      throw new Error('paused bounded linear request');
    const c=context(machine),chunks=[];
    for(let at=0;at<request.length;){
      const linear=request.linear+at,phys=translate(c,linear);
      const count=Math.min(request.length-at,0x1000-(linear&0xfff));
      if(phys+count-1>0xffffffff)throw new Error('physical page extent');
      // The whole span and every page-table entry must remain ordinary RAM.
      physical(c,phys);physical(c,phys+count-1);
      chunks.push({at,phys,count});at+=count;
    }
    const result=Buffer.alloc(request.length);
    for(const {at,phys,count} of chunks)
      result.set(c.mem.subarray(phys,phys+count),at);
    if(own(machine,'cpu')!==c.cpu || own(machine,'mem')!==c.mem ||
       own(machine,'_page')!==c.pages || own(machine,'memoryBytes')!==c.memoryBytes ||
       own(machine,'_a20Enabled')!==true || own(c.cpu,'cr0')!==c.cr0 ||
       own(c.cpu,'cr3')!==c.cr3 || own(c.cpu,'cr4')!==c.cr4 ||
       own(c.cpu,'cs')!==c.cs || own(c.cpu,'eflags')!==c.eflags ||
       own(c.code,'base')!==c.codeBase)
      throw new Error('source state changed during read');
    if(state.failed)throw new Error('swallowed RAM reader reentry');
    return result;
  } catch(error){state.failed=true;throw error;}
  finally {state.busy=false;}
}
