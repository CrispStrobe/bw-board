/** New embedding derivation over immutable qualified combined transforms. */
import {readFileSync} from 'node:fs';
import {patchPinnedSource as combined,revision,sha256,upstreamHashes} from '../bochs-cpu3-native-combined-paging-ram/patch.mjs';
export {revision,sha256,upstreamHashes};
const baseHash='4c4d41c5248fd4610669fa192d625c944721058f00fbb5499d831b6d37eb4ada';
if(sha256(readFileSync(new URL('../bochs-cpu3-native-combined-paging-ram/patch.mjs',import.meta.url)))!==baseHash)throw Error('qualified combined derivation changed');
const once=(text,needle,replacement)=>{if(text.split(needle).length!==2)throw Error('direct bootstrap seam changed: '+needle.slice(0,60));return text.replace(needle,replacement);};
export function patchPinnedSource(path,bytes){
 let text=combined(path,bytes).toString();
 if(path!=='bochs/main.cc')return Buffer.from(text);
 text=once(text,'  bx_print_header();','  // Direct embedding does not print the executable banner.');
 text=text.replaceAll('bw_slice_driver();','bw_slice_fail("direct-entry-required");');
 const start=text.indexOf('  bx_gui->init_signal_handlers();'),end=text.indexOf('\n}\n\nvoid bx_init_bx_dbg',start);
 if(start<0||end<0)throw Error('direct signal/timer seam changed');
 text=text.slice(0,start)+'  // The embedding owns no process signal handlers, alarm, or native timers.\n'+text.slice(end);
 text+=`
// Called only by the synchronous one-lifetime embedding API. Never call bxmain:
// its quit context would point into a stack frame that has already returned.
extern "C" int bw_direct_bootstrap(const char *configuration) {
  bx_init_siminterface();
  SIM->set_quit_context(NULL);
  BX_INSTR_INIT_ENV();
  char name[]="bw-direct",quiet[]="-q",flag[]="-f";
  char *args[]={name,quiet,flag,const_cast<char *>(configuration)};
  if(bx_init_main(4,args)<0)return 0;
  SIM->opt_plugin_ctrl("*",1);
  if(!load_and_init_display_lib())return 0;
  bx_cpu_count=1;
  bx_init_hardware();
  SIM->set_init_done(1);
  SIM->set_quit_context(NULL);
  bw_slice_activate(BX_CPU(0));
  return 1;
}
`;
 return Buffer.from(text);
}
