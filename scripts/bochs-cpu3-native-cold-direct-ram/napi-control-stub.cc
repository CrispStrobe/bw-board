// Bounded N-API control only. This stub is never included in a CPU3 build.
#include "../bochs-cpu3-native-direct-board/abi.h"
#include "abi.h"
#include <cstring>

static bool deny_source_clock=false;
static bw_direct_callbacks live_callbacks{};
static uint64_t source_n=0,source_q=0;
static uint32_t source_debt=0;
static bool source_running=false;
static unsigned page_mode=0;
extern "C" int bw_cold_direct_ram_source_clock(bw_cold_direct_ram_clock_ledger *out){
 if(!out||deny_source_clock)return 0;
 *out={source_n,source_q,source_debt,6000,0,1,source_running?1u:0u};return 1;
}
extern "C" int bw_direct_initialize(const char *configuration,const uint8_t *rom,uint32_t length,
 const bw_direct_callbacks *callbacks,int){
 const bool require_marker=!configuration||(std::strcmp(configuration,"real-provider")!=0&&
  std::strcmp(configuration,"source-clock-deny")!=0&&std::strcmp(configuration,"page-clock")!=0&&
  std::strcmp(configuration,"invalid-actual-page")!=0);
 if(!rom||length!=65536||(require_marker&&(rom[0]!=0xa5||rom[65535]!=0x5a))||!callbacks||
    callbacks->version!=BW_COLD_DIRECT_RAM_ABI_VERSION||callbacks->memory)return 0;
 deny_source_clock=configuration&&std::strcmp(configuration,"source-clock-deny")==0;
 live_callbacks=*callbacks;source_n=source_q=0;source_debt=0;source_running=false;
 page_mode=configuration&&std::strcmp(configuration,"page-clock")==0?1u:
  configuration&&std::strcmp(configuration,"invalid-actual-page")==0?2u:0u;
 if(configuration&&std::strcmp(configuration,"two-writes")==0){
  for(uint32_t i=0;i<2;++i){
   bw_cold_direct_ram_source_ledger ledger{};ledger.effect=i+1;ledger.generation_before=i;
   ledger.owner_committed_sequence=i;ledger.owner_acknowledged_sequence=0;ledger.mapping_epoch=0;ledger.board_a20=1;
   const uint8_t value=uint8_t(0x31+i);bw_cold_direct_ram_memory_reply reply{};
   if(!bw_cold_direct_ram_memory(0x100+i,1,&value,&ledger,&reply)||reply.status!=BW_COLD_DIRECT_RAM_ACCEPTED||
      reply.sequence!=i+1||reply.generation!=i+1)return 0;
  }
 }
 bw_owned_clock_state state{};
 return callbacks->clock_transfer(callbacks->context,nullptr,0,BW_OWNED_INIT,&state)&&
  state.n==0&&state.q==0&&state.cycles==4&&state.debt==0&&state.deadline==6000&&state.epoch==0&&state.a20==1;
}
extern "C" int bw_direct_resume(uint32_t,uint32_t,uint64_t,bw_cpu3_combined_paging_ram_slice_result *result){
 if(!page_mode||!result)return 0;
 source_running=true;bw_owned_clock_state state{};
 if(!live_callbacks.clock_transfer(live_callbacks.context,nullptr,0,BW_OWNED_ENTRY,&state))return 0;
 const uint32_t tape[]={BW_OWNED_N1,BW_OWNED_Q0};source_n=source_q=1;source_debt=6;
 if(!live_callbacks.clock_transfer(live_callbacks.context,tape,2,BW_OWNED_PAGE,&state)||
    state.n!=1||state.q!=1||state.debt!=6)return 0;
 uint8_t bytes[4096]={};bw_direct_page_metadata metadata{};
 const uint32_t raw=page_mode==1?0xf0000u:0x7000u;
 if(!live_callbacks.page(live_callbacks.context,raw,bytes,&metadata))return 0;
 if(metadata.kind!=2||metadata.decoded!=0xf0000u||metadata.board_a20!=1)return 0;
 source_running=false;std::memset(result,0,sizeof(*result));return 1;
}
extern "C" int bw_direct_set_irq_line(int){return 1;}
extern "C" int bw_direct_inspect(bw_direct_snapshot *out){
 if(!out)return 0;
 std::memset(out,0,sizeof(*out));out->native_ticks=source_n;out->successful_quanta=source_q;out->board_a20=1;return 1;
}
extern "C" int bw_direct_close(void){return 1;}
