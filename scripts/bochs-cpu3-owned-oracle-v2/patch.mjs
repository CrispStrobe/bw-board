/** Exact-byte, two-header bridge for the pinned Bochs notify dataptr arguments. */
import {createHash} from 'node:crypto';

export const revision='0e45b736ef9792eb9b752b0a35db49eaf2faea47';
export const upstreamHashes={
  'bochs/cpu/cpu.h':'9b686170fbf233886af05be619192192a6864a0cd003402067de027708f496cf',
  'bochs/instrument/stubs/instrument.h':'81cfbc14167dd8ac6465d9f2aacde8fc5cf353778d0911ade9a410993306cdf0',
};
export const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const replaceOnce=(text,before,after)=>{
  if(text.split(before).length!==2) throw new Error('pinned Bochs patch context missing or repeated');
  return text.replace(before,after);
};

export function patchPinnedHeader(path, bytes){
  if(sha256(bytes)!==upstreamHashes[path]) throw new Error(`unexpected upstream bytes: ${path}`);
  let source=bytes.toString('utf8');
  if(path==='bochs/cpu/cpu.h'){
    source=replaceOnce(source,
      'BX_INSTR_LIN_ACCESS(BX_CPU_ID, (laddr), (paddr), (size), (memtype), (rw));',
      'BX_INSTR_LIN_ACCESS(BX_CPU_ID, (laddr), (paddr), (size), (memtype), (rw), (dataptr));');
    source=replaceOnce(source,
      'BX_INSTR_PHY_ACCESS(BX_CPU_ID, (paddr), (size), (memtype), (rw));',
      'BX_INSTR_PHY_ACCESS(BX_CPU_ID, (paddr), (size), (memtype), (rw), (why), (dataptr));');
  } else if(path==='bochs/instrument/stubs/instrument.h'){
    source=replaceOnce(source,
      'void bx_instr_lin_access(unsigned cpu, bx_address lin, bx_address phy, unsigned len, unsigned memtype, unsigned rw);',
      'void bx_instr_lin_access(unsigned cpu, bx_address lin, bx_address phy, unsigned len, unsigned memtype, unsigned rw, const Bit8u *dataptr);');
    source=replaceOnce(source,
      'void bx_instr_phy_access(unsigned cpu, bx_address phy, unsigned len, unsigned memtype, unsigned rw);',
      'void bx_instr_phy_access(unsigned cpu, bx_address phy, unsigned len, unsigned memtype, unsigned rw, unsigned why, const Bit8u *dataptr);');
    source=replaceOnce(source,
      '#define BX_INSTR_LIN_ACCESS(cpu_id, lin, phy, len, memtype, rw)  bx_instr_lin_access(cpu_id, lin, phy, len, memtype, rw)',
      '#define BX_INSTR_LIN_ACCESS(cpu_id, lin, phy, len, memtype, rw, dataptr)  bx_instr_lin_access(cpu_id, lin, phy, len, memtype, rw, dataptr)');
    source=replaceOnce(source,
      '#define BX_INSTR_PHY_ACCESS(cpu_id, phy, len, memtype, rw)  bx_instr_phy_access(cpu_id, phy, len, memtype, rw)',
      '#define BX_INSTR_PHY_ACCESS(cpu_id, phy, len, memtype, rw, why, dataptr)  bx_instr_phy_access(cpu_id, phy, len, memtype, rw, why, dataptr)');
    source=replaceOnce(source,
      '#define BX_INSTR_LIN_ACCESS(cpu_id, lin, phy, len, memtype, rw)\n',
      '#define BX_INSTR_LIN_ACCESS(cpu_id, lin, phy, len, memtype, rw, dataptr)\n');
    source=replaceOnce(source,
      '#define BX_INSTR_PHY_ACCESS(cpu_id, phy, len, memtype, rw)\n',
      '#define BX_INSTR_PHY_ACCESS(cpu_id, phy, len, memtype, rw, why, dataptr)\n');
  } else throw new Error(`not an allowed Bochs patch path: ${path}`);
  return Buffer.from(source);
}
