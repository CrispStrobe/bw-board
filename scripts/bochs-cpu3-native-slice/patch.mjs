/** Exact-byte CPU3-only Bochs adapter patch. No historical oracle is modified. */
import {createHash} from 'node:crypto';

export const revision='0e45b736ef9792eb9b752b0a35db49eaf2faea47';
export const upstreamHashes={
  'bochs/bochs.h':'6c757bbdf3e0bc188b63b5b70ef4e65eba8b166664b61c918dec5b3589c2482b',
  'bochs/cpu/cpu.cc':'2754d42ed014f72b28af1bfdf7d5fcaa50c7fdedd679f4845a90c191c6904587',
  'bochs/cpu/paging.cc':'3ab63124df3b393624bcd2bf0f8878d56ec638bc0ebdfd1e23cf70d154a122b1',
  'bochs/cpu/exception.cc':'c56022d1ce3a50ec9266e77f5b5cfcab29a8b6a84ceea3f4e25853e5c7460f2d',
  'bochs/cpu/event.cc':'5dfbfc60b8f3ee14acef3cbe9fa9f55ca0b4e6cd8ad4d94fad8119c13bccce31',
  'bochs/main.cc':'294e21dd4290a8f996e7d340e8a5792949474fafc807a7763a5b71766ce6608a',
  'bochs/memory/memory.cc':'40eb2b0ca7ca2caa4a9200fbb468c45ff5d4ffb16bbf7f2244ccd51da42e91a0',
  'bochs/memory/misc_mem.cc':'80eb352a65fdc940ce54894efe045e024416159c77f1cb6037bb1731a7e451cd',
  'bochs/pc_system.h':'52e5f687cba0a5b5c23adbf2ae7817290cfb5ca4d155ae95949f294473a8dc68',
  'bochs/pc_system.cc':'d96b802b79a8093b0e1b8fde7798384b70a7abea0bd4021d5664774ef5732c9c',
  'bochs/iodev/devices.cc':'b64a1a65a3e3d51ba9224dde4c86d70ac8fc82846f9ba962f38ef89e65aa215b',
};
export const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const once=(s,a,b)=>{
  if(s.split(a).length!==2)throw new Error(`pinned patch context missing or repeated: ${a.slice(0,65)}`);
  return s.replace(a,b);
};
const all=(s,a,b,count)=>{
  if(s.split(a).length-1!==count)throw new Error(`pinned patch count ${a.slice(0,50)}`);
  return s.split(a).join(b);
};

export function patchPinnedSource(path,bytes){
  if(sha256(bytes)!==upstreamHashes[path])throw new Error(`unexpected upstream bytes: ${path}`);
  let s=bytes.toString('utf8');
  if(path==='bochs/bochs.h'){
    s=once(s,'#define BX_INP(addr, len)           bx_devices.inp(addr, len)',
      '#define BX_INP(addr, len)           bw_slice_port_in(addr, len)');
    s=once(s,'#define BX_OUTP(addr, val, len)     bx_devices.outp(addr, val, len)',
      '#define BX_OUTP(addr, val, len)     bw_slice_port_out(addr, val, len)');
    s=once(s,'// =-=-=-=-=-=-=- Normal optimized use -=-=-=-=-=-=-=-=-=-=-=-=-=-=',
      '#include "cpu/bw_slice_runtime.h"\n// =-=-=-=-=-=-=- Normal optimized use -=-=-=-=-=-=-=-=-=-=-=-=-=-=');
  }else if(path==='bochs/cpu/cpu.cc'){
    s=once(s,'jmp_buf BX_CPU_C::jmp_buf_env;',
      'jmp_buf BX_CPU_C::jmp_buf_env;');
    s=once(s,'    BX_SYNC_TIME_IF_SINGLE_PROCESSOR(0);\n#if BX_DEBUGGER || BX_GDBSTUB',
      '    BX_SYNC_TIME_IF_SINGLE_PROCESSOR(0);\n    if (bw_slice_active && bw_slice_fault_pending) {\n      BX_CPU_THIS_PTR prev_rip = RIP;\n      BX_CPU_THIS_PTR speculative_rsp = 0;\n      return; // delivery complete; handler has not executed\n    }\n#if BX_DEBUGGER || BX_GDBSTUB');
    s=once(s,'    bxICacheEntry_c *entry = getICacheEntry();',
      '    if (!bw_slice_active && BX_CPU_THIS_PTR sregs[BX_SEG_REG_CS].selector.value == 0 && RIP == 0x7e00) {\n      bw_slice_activate(BX_CPU(0));\n      return; // caller switches from BIOS loop to external ABI before fetch\n    }\n    if (bw_slice_active && bw_slice_ticks_reached()) return;\n    bxICacheEntry_c *entry = getICacheEntry();');
    s=once(s,'      BX_INSTR_BEFORE_EXECUTION(BX_CPU_ID, i);\n      RIP += i->ilen();\n      BX_CPU_CALL_METHOD(i->execute1, (i)); // might iterate repeat instruction\n      BX_CPU_THIS_PTR prev_rip = RIP; // commit new RIP\n      BX_INSTR_AFTER_EXECUTION(BX_CPU_ID, i);',
      '      bw_slice_note_attempt();\n      BX_INSTR_BEFORE_EXECUTION(BX_CPU_ID, i);\n      RIP += i->ilen();\n      BX_CPU_CALL_METHOD(i->execute1, (i)); // might iterate repeat instruction\n      BX_CPU_THIS_PTR prev_rip = RIP; // commit new RIP\n      BX_INSTR_AFTER_EXECUTION(BX_CPU_ID, i);\n      bw_slice_note_completed();');
    s=once(s,'      BX_SYNC_TIME_IF_SINGLE_PROCESSOR(0);\n\n      // note instructions generating exceptions never reach this point',
      '      BX_SYNC_TIME_IF_SINGLE_PROCESSOR(0);\n      if (bw_slice_active && bw_slice_should_yield()) {\n        BX_CPU_THIS_PTR async_event &= ~BX_ASYNC_EVENT_STOP_TRACE;\n        return; // after architectural commit and native tick\n      }\n\n      // note instructions generating exceptions never reach this point');
    const marker='void BX_CPP_AttrRegparmN(2) BX_CPU_C::repeat(bxInstruction_c *i, BxRepIterationPtr_tR execute)';
    const index=s.indexOf(marker);
    const end=s.indexOf('\n// boundaries of consideration:',index);
    if(index<0 || end<0)throw new Error('repeat region missing');
    let region=s.slice(index,end);
    region=all(region,'BX_INSTR_REPEAT_ITERATION(BX_CPU_ID, i);',
      'BX_INSTR_REPEAT_ITERATION(BX_CPU_ID, i);\n        bw_slice_note_rep_iteration();',9);
    region=all(region,'if (BX_CPU_THIS_PTR async_event)',
      'if (BX_CPU_THIS_PTR async_event || bw_slice_rep_budget_exhausted())',9);
    region=all(region,'  RIP = BX_CPU_THIS_PTR prev_rip; // repeat loop not done, restore RIP',
      '  if (bw_slice_active) bw_slice_rep_incomplete = true;\n  RIP = BX_CPU_THIS_PTR prev_rip; // repeat loop not done, restore RIP',2);
    s=s.slice(0,index)+region+s.slice(end);
    s+='\n#include "bw_slice_runtime.inc"\n';
  }else if(path==='bochs/cpu/paging.cc'){
    s=once(s,'  BX_MEM(0)->writePhysicalPage(BX_CPU_THIS, paddr, len, data);',
      '  if (bw_slice_active) { bw_slice_write(paddr, len, data); return; }\n  BX_MEM(0)->writePhysicalPage(BX_CPU_THIS, paddr, len, data);');
    s=once(s,'  BX_MEM(0)->readPhysicalPage(BX_CPU_THIS, paddr, len, data);',
      '  if (bw_slice_active) { bw_slice_read(paddr, len, data); return; }\n  BX_MEM(0)->readPhysicalPage(BX_CPU_THIS, paddr, len, data);');
    s=once(s,'  return (bx_hostpageaddr_t) BX_MEM(0)->getHostMemAddr(BX_CPU_THIS, paddr, rw);',
      '  if (bw_slice_active) return rw == BX_EXECUTE ?\n    (bx_hostpageaddr_t) bw_slice_execute_page(paddr) : 0;\n  return (bx_hostpageaddr_t) BX_MEM(0)->getHostMemAddr(BX_CPU_THIS, paddr, rw);');
  }else if(path==='bochs/cpu/exception.cc'){
    s=once(s,'  BX_INSTR_EXCEPTION(BX_CPU_ID, vector, error_code);',
      '  bw_slice_note_fault(vector, error_code);\n  BX_INSTR_EXCEPTION(BX_CPU_ID, vector, error_code);');
  }else if(path==='bochs/cpu/event.cc'){
    s=once(s,'bool BX_CPU_C::handleWaitForEvent(void)\n{',
      'bool BX_CPU_C::handleWaitForEvent(void)\n{\n  if (bw_slice_active) { bw_slice_note_halt(); return 1; }');
    s=once(s,'void BX_CPU_C::InterruptAcknowledge(void)\n{',
      'void BX_CPU_C::InterruptAcknowledge(void)\n{\n  if (bw_slice_active) bw_slice_fail("Bochs-PIC-fallback");');
    s=once(s,'      DEV_dma_raise_hlda();',
      '      if (bw_slice_active) bw_slice_fail("Bochs-DMA-fallback");\n      DEV_dma_raise_hlda();');
    if([...s.matchAll(/^    DEV_dma_raise_hlda\(\);$/gm)].length!==2)
      throw new Error('pinned async DMA call count changed');
    s=s.replace(/^    DEV_dma_raise_hlda\(\);$/gm,
      '    if (bw_slice_active) bw_slice_fail("Bochs-DMA-fallback");\n    DEV_dma_raise_hlda();');
  }else if(path==='bochs/main.cc'){
    s=once(s,'        BX_CPU(0)->cpu_loop();\n        if (bx_pc_system.kill_bochs_request)',
      '        BX_CPU(0)->cpu_loop();\n        if (bw_slice_active) { bw_slice_driver(); break; }\n        if (bx_pc_system.kill_bochs_request)');
  }else if(path==='bochs/memory/memory.cc'){
    s=once(s,'void BX_MEM_C::writePhysicalPage(BX_CPU_C *cpu, bx_phy_address addr, unsigned len, void *data)\n{',
      'void BX_MEM_C::writePhysicalPage(BX_CPU_C *cpu, bx_phy_address addr, unsigned len, void *data)\n{\n  if (bw_slice_active) bw_slice_fail("Bochs-RAM-write-fallback");');
    s=once(s,'void BX_MEM_C::readPhysicalPage(BX_CPU_C *cpu, bx_phy_address addr, unsigned len, void *data)\n{',
      'void BX_MEM_C::readPhysicalPage(BX_CPU_C *cpu, bx_phy_address addr, unsigned len, void *data)\n{\n  if (bw_slice_active) bw_slice_fail("Bochs-RAM-read-fallback");');
  }else if(path==='bochs/memory/misc_mem.cc'){
    s=once(s,'Bit8u *BX_MEM_C::getHostMemAddr(BX_CPU_C *cpu, bx_phy_address addr, unsigned rw)\n{',
      'Bit8u *BX_MEM_C::getHostMemAddr(BX_CPU_C *cpu, bx_phy_address addr, unsigned rw)\n{\n  if (bw_slice_active) bw_slice_fail("Bochs-direct-pointer-fallback");');
  }else if(path==='bochs/pc_system.h'){
    s=once(s,'  static BX_CPP_INLINE void tick1(void) {',
      '  void bw_probe_countdown_fallback(void) { countdownEvent(); }\n  static BX_CPP_INLINE void tick1(void) {');
    s=once(s,'  static BX_CPP_INLINE void tick1(void) {\n    if (--bx_pc_system.currCountdown == 0)',
      '  static BX_CPP_INLINE void tick1(void) {\n    if (bw_slice_active) { bw_slice_tick(1); return; }\n    if (--bx_pc_system.currCountdown == 0)');
    s=once(s,'  static BX_CPP_INLINE void tickn(Bit32u n) {\n    while (n >= bx_pc_system.currCountdown)',
      '  static BX_CPP_INLINE void tickn(Bit32u n) {\n    if (bw_slice_active) { bw_slice_tick(n); return; }\n    while (n >= bx_pc_system.currCountdown)');
  }else if(path==='bochs/pc_system.cc'){
    s=once(s,'void bx_pc_system_c::countdownEvent(void)\n{',
      'void bx_pc_system_c::countdownEvent(void)\n{\n  if (bw_slice_active) bw_slice_fail("Bochs-timer-fallback");');
  }else if(path==='bochs/iodev/devices.cc'){
    s=once(s,'bx_devices_c::inp(Bit16u addr, unsigned io_len)\n{',
      'bx_devices_c::inp(Bit16u addr, unsigned io_len)\n{\n  if (bw_slice_active) bw_slice_fail("Bochs-PIO-fallback");');
    s=once(s,'bx_devices_c::outp(Bit16u addr, Bit32u value, unsigned io_len)\n{',
      'bx_devices_c::outp(Bit16u addr, Bit32u value, unsigned io_len)\n{\n  if (bw_slice_active) bw_slice_fail("Bochs-PIO-fallback");');
  }else throw new Error(`not an allowed patch path: ${path}`);
  return Buffer.from(s);
}
