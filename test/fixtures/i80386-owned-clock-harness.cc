// Executes the production clock helper only. No Bochs, addon, or guest.
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <csetjmp>
#include <initializer_list>
#include "../../scripts/bochs-cpu3-native-owned-clock/abi.h"
static bool bw_in_resume=false,bw_mapping_pending=false;
static uint32_t bw_ticks=0,bw_successful_quanta=0,bw_mapping_epoch=0,bw_board_a20=1,bw_next_epoch=1,bw_next_a20=0;
static uint32_t bw_slice_ticks=0,bw_slice_quanta=0,bw_native_budget=600,bw_quantum_budget=300;
[[noreturn]] static void bw_slice_fail(const char *why);
static bw_direct_callbacks bw_direct_host={};
#include "../../scripts/bochs-cpu3-native-owned-clock/clock.inc"
static int mutation=-1;static const char *mode;static unsigned calls=0;
[[noreturn]] static void bw_slice_fail(const char *why){
 // Rejected replies leave the pending tape uncommitted; ledger rejection happens before callback.
 if(mode&&!std::strncmp(mode,"reply-",6)&&(bw_owned_count!=2||bw_owned_commits||bw_owned_words))std::exit(77);
 if(mode&&!std::strcmp(mode,"lag")&&calls!=2)std::exit(78);
 std::fprintf(stderr,"%s\n",why);std::exit(73);
}
static int transfer(void*,const uint32_t *t,uint32_t count,uint32_t reason,bw_owned_clock_state *r){
 ++calls;*r=bw_owned;r->epoch=bw_mapping_pending?bw_next_epoch:bw_mapping_epoch;r->a20=bw_mapping_pending?bw_next_a20:bw_board_a20;
 if(!std::strcmp(mode,"ordered")&&count){const uint32_t expected[]={1,3,3,1,2,1};if(count!=6||std::memcmp(t,expected,sizeof(expected)))std::exit(74);}
 if(mutation>=0&&count){switch(mutation){case 0:++r->n;break;case 1:++r->q;break;case 2:++r->cycles;break;case 3:++r->debt;break;case 4:--r->deadline;break;case 5:++r->epoch;break;case 6:r->a20^=1;break;}}
 if(!std::strcmp(mode,"entry-due")&&reason==BW_OWNED_ENTRY)r->debt=r->deadline;
 if(!std::strcmp(mode,"post-debt")&&reason==BW_OWNED_POST_PIO)r->debt=1;
 if(!std::strcmp(mode,"zero-deadline")&&reason==BW_OWNED_ENTRY)r->deadline=0;
 if(!std::strcmp(mode,"oversize-deadline")&&reason==BW_OWNED_ENTRY)r->deadline=6001;
 return 1;
}
static void append(uint32_t word){bw_owned_append(word);if(word==1){++bw_ticks;++bw_slice_ticks;}else{++bw_successful_quanta;++bw_slice_quanta;}}
int main(int argc,char **argv){
 if(argc!=2)return 75;
 mode=argv[1];bw_direct_host.clock_transfer=transfer;
 bw_owned_query_phase=BW_OWNED_INIT;bw_owned_transfer(BW_OWNED_INIT,true);
 if(!std::strcmp(mode,"init-repeat")){bw_owned_query_phase=BW_OWNED_INIT;bw_owned_transfer(BW_OWNED_INIT,true);}
 bw_in_resume=true;bw_owned_query_phase=BW_OWNED_ENTRY;bw_owned_transfer(BW_OWNED_ENTRY,true);
 if(!std::strcmp(mode,"entry-repeat"))bw_owned_transfer(BW_OWNED_ENTRY,true);
 if(!std::strcmp(mode,"post-wrong"))bw_owned_transfer(BW_OWNED_POST_PIO,true);
 if(!std::strcmp(mode,"post-valid")){bw_owned_query_phase=BW_OWNED_POST_PIO;bw_owned_transfer(BW_OWNED_POST_PIO,true);}
 if(!std::strcmp(mode,"post-debt")){bw_owned_query_phase=BW_OWNED_POST_PIO;bw_owned_transfer(BW_OWNED_POST_PIO,true);}
 if(!std::strcmp(mode,"mapping-N")||!std::strcmp(mode,"mapping-REP")||!std::strcmp(mode,"mapping-Q0")){bw_mapping_pending=true;append(!std::strcmp(mode,"mapping-N")?1:!std::strcmp(mode,"mapping-REP")?3:2);}
 else if(!std::strcmp(mode,"lag")){bw_owned_append(1);bw_owned_transfer(BW_OWNED_RETURN);}
 else if(!std::strcmp(mode,"N-cap")){bw_native_budget=1;append(1);append(1);}
 else if(!std::strcmp(mode,"Q-cap")){bw_quantum_budget=1;append(2);append(3);}
 else if(!std::strcmp(mode,"due")){bw_owned.deadline=1;append(2);append(2);}
 else if(!std::strcmp(mode,"900")||!std::strcmp(mode,"901")){for(unsigned i=0;i<600;i++)append(1);for(unsigned i=0;i<300;i++)append(3);if(!std::strcmp(mode,"901"))append(1);}
 else if(!std::strcmp(mode,"ordered")){for(uint32_t w:{1u,3u,3u,1u,2u,1u})append(w);}
 else if(!std::strcmp(mode,"invalid"))append(4);
 else if(!std::strcmp(mode,"longjmp")){static std::jmp_buf fault;if(!setjmp(fault)){append(1);longjmp(fault,1);}append(2);}
 else {append(1);append(2);if(!std::strncmp(mode,"reply-",6))mutation=std::atoi(mode+6);}
 const auto pending=bw_owned_count;bw_owned_transfer(BW_OWNED_RETURN);
 if(bw_owned_count||bw_owned_commits!=1||bw_owned_words!=pending||calls!=(!std::strcmp(mode,"post-valid")?4u:3u))return 76;
 bw_in_resume=false;bw_owned_empty();std::puts("PASS");return 0;
}
