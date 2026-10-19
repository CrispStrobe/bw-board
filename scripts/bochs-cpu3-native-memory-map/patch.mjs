/** New CPU3 memory-map attribution, layered over the immutable event transform. */
import {patchPinnedSource as patchEvents,revision,sha256,upstreamHashes}
  from '../bochs-cpu3-native-events/patch.mjs';
export {revision,sha256,upstreamHashes};

function once(source,from,to) {
  if (source.split(from).length!==2)
    throw new Error(`memory-map patch context: ${from.slice(0,100)}`);
  return source.replace(from,to);
}

export function patchPinnedSource(path,bytes) {
  let source=patchEvents(path,bytes).toString('utf8');
  if (path==='bochs/cpu/paging.cc') {
    const start=source.indexOf('bx_phy_address BX_CPU_C::translate_linear_legacy(');
    const end=source.indexOf('// Translate a linear address',start);
    if(start<0 || end<0) throw new Error('legacy paging region missing');
    let region=source.slice(start,end);
    region=once(region,
      '    access_read_physical(entry_addr[leaf], 4, &entry[leaf]);',
      '    if (bw_slice_active) bw_slice_pagewalk_set(leaf == BX_LEVEL_PDE ? 1 : 2);\n'
      +'    access_read_physical(entry_addr[leaf], 4, &entry[leaf]);\n'
      +'    if (bw_slice_active) bw_slice_pagewalk_set(0);');
    region=once(region,
      '      access_write_physical(entry_addr[BX_LEVEL_PDE], 4, &entry[BX_LEVEL_PDE]);',
      '      if (bw_slice_active) bw_slice_pagewalk_set(3);\n'
      +'      access_write_physical(entry_addr[BX_LEVEL_PDE], 4, &entry[BX_LEVEL_PDE]);\n'
      +'      if (bw_slice_active) bw_slice_pagewalk_set(0);');
    region=once(region,
      '    access_write_physical(entry_addr[leaf], 4, &entry[leaf]);',
      '    if (bw_slice_active) bw_slice_pagewalk_set(leaf == BX_LEVEL_PDE ? 3 : 4);\n'
      +'    access_write_physical(entry_addr[leaf], 4, &entry[leaf]);\n'
      +'    if (bw_slice_active) bw_slice_pagewalk_set(0);');
    source=source.slice(0,start)+region+source.slice(end);
  }
  return Buffer.from(source);
}
