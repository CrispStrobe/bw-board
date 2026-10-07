// Bounded N-API control only. This stub is never included in a CPU3 build.
#include "../bochs-cpu3-native-direct-board/abi.h"
#include "abi.h"
#include <cstring>

extern "C" int bw_cold_direct_ram_source_clock(bw_cold_direct_ram_clock_ledger *out){
 if(!out)return 0;
 *out={0,0,0,6000,0,1,0};return 1;
}
extern "C" int bw_direct_initialize(const char *configuration,const uint8_t *rom,uint32_t length,
 const bw_direct_callbacks *callbacks,int){
 if(!rom||length!=65536||rom[0]!=0xa5||rom[65535]!=0x5a||!callbacks||
    callbacks->version!=BW_COLD_DIRECT_RAM_ABI_VERSION||callbacks->memory)return 0;
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
extern "C" int bw_direct_resume(uint32_t,uint32_t,uint64_t,bw_cpu3_combined_paging_ram_slice_result *){return 0;}
extern "C" int bw_direct_set_irq_line(int){return 1;}
extern "C" int bw_direct_inspect(bw_direct_snapshot *out){
 if(!out)return 0;
 std::memset(out,0,sizeof(*out));out->board_a20=1;return 1;
}
extern "C" int bw_direct_close(void){return 1;}
