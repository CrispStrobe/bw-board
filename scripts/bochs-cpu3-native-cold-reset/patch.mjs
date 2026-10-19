/** Separate cold-reset transform, preserving the qualified v6 derivation. */
import {patchPinnedSource as quanta,revision,sha256,upstreamHashes as baseHashes}
  from '../bochs-cpu3-native-device-quanta/patch.mjs';
export {revision,sha256};
export const upstreamHashes={...baseHashes,
  'bochs/cpu/init.cc':'4bdf4a39a2a3ceecafdd070836a055b5dec8696acf59652e2150a12fdfa7a9f3'};
function once(s,from,to){if(s.split(from).length!==2)throw Error(`cold patch context: ${from.slice(0,80)}`);return s.replace(from,to);}
export function patchPinnedSource(path,bytes){
  if(sha256(bytes)!==upstreamHashes[path])throw Error(`cold upstream hash: ${path}`);
  if(path==='bochs/cpu/init.cc')return bytes; // pin untouched hardware-reset semantics
  let s=quanta(path,bytes).toString('utf8');
  if(path==='bochs/main.cc'){
    s=once(s,'      while (1) {\n        BX_CPU(0)->cpu_loop();',
      '      bw_slice_activate(BX_CPU(0)); // cold ownership BEFORE first CPU fetch\n'
      +'      bw_slice_driver();\n      fflush(stderr);\n      exit(0);\n'
      +'      while (1) {\n        BX_CPU(0)->cpu_loop();');
  }
  if(path==='bochs/cpu/cpu.cc'){
    const first='    if (!bw_slice_active && BX_CPU_THIS_PTR sregs[BX_SEG_REG_CS].selector.value == 0 && RIP == 0x7e00) {\n'
      +'      bw_slice_activate(BX_CPU(0));\n      return; // caller switches from BIOS loop to external ABI before fetch\n    }\n';
    const second='        if (!bw_slice_active && BX_CPU_THIS_PTR sregs[BX_SEG_REG_CS].selector.value == 0 && RIP == 0x7e00) {\n'
      +'          bw_slice_activate(BX_CPU(0));\n          return; // no setup fetch/decode from Bochs RAM\n        }\n';
    s=once(s,first,'');s=once(s,second,'');
    s=once(s,'      bw_slice_note_attempt();','      bw_slice_note_attempt(i->ilen());');
    s=once(s,'    fetchPtr = (Bit8u*) tlbEntry->hostPageAddr;',
      '    bw_slice_note_prefetch((unsigned long long) BX_CPU_THIS_PTR pAddrFetchPage + pageOffset);\n    fetchPtr = (Bit8u*) tlbEntry->hostPageAddr;');
  }
  if(path==='bochs/cpu/paging.cc'){
    s=once(s,'  paddress = A20ADDR(paddress);',
      '  if (bw_slice_active && rw == BX_EXECUTE) bw_slice_note_prefetch((unsigned long long) paddress);\n  paddress = A20ADDR(paddress);');
  }
  return Buffer.from(s);
}
