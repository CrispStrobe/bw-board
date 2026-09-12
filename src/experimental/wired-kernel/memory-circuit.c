/* Owned net + memory fixed-point loop. No CPU/controller/device clock. */
typedef unsigned int u32;
typedef unsigned char u8;
#include "stage-attribution.h"
extern u32 settle_owned_context(const u32*);
extern u32 preview_memory_banks(u32,u8*,u32*,u32*,const u8*,const u8*,const u8*,u8*,u8*,u8*,u32*);
extern u32 preview_owned_memory_banks(u32,u8*,u32*,u32*,const u8*,const u8*,const u8*,u8*,u8*,u8*,u32*);
extern u32 write_owned_driver_tagged(const u32*,u32,u32,u32);
extern u32 producer_work[18];
#define PRODUCER_COUNT 9
#define PRODUCER_MEMORY_BANK 5
/* Calls, passes, preview calls/banks, present banks, changed banks, post-memory
 * settles, and post-memory settles entered after zero output-driver changes. */
u32 memory_pass_work[8];
u32 *memory_pass_counters_ptr(void){return memory_pass_work;}
void reset_memory_pass_counters(void){for(u32 i=0;i<8;i++)memory_pass_work[i]=0;}
u32 memory_pass_counters_version(void){return 1;}
/* Private wrapper-owned context; pointer entries are wasm32 arena offsets.
 * net args[0..17], bank args[18..28], input-net IDs[29], output IDs[30],
 * private graph-admission gate[31]. */
#define U8(i) ((u8*)(unsigned long)c[i])
#define U32(i) ((u32*)(unsigned long)c[i])
static u32 settle_context(const u32 *c) {
    return settle_owned_context(c);
}
#ifdef NATIVE_STAGE_ATTRIBUTION
u32 native_stage_work[STAGE_COUNTER_COUNT];
u32 stage_attribution_version(void){return 1;}
u32 *stage_attribution_counters_ptr(void){return native_stage_work;}
void reset_stage_attribution_counters(void){for(u32 i=0;i<STAGE_COUNTER_COUNT;i++)native_stage_work[i]=0;}
#endif
static STAGE_NOINLINE u32 validate_memory_mapping(const u32 *c,u32 banks,const u32 *input_nets,const u32 *output_ids) {
    STAGE_ADD(STAGE_MEMORY_MAPPING_CALLS,1);
    #define MAPPING_RETURN(code,count) do{STAGE_ADD(STAGE_MEMORY_MAPPING_VISITS,(count));return(code);}while(0)
    for(u32 i=0;i<banks*28;i++)if(input_nets[i]>=c[0])MAPPING_RETURN(2,i+1);
    for(u32 i=0;i<banks*8;i++) {
        if(output_ids[i]>=c[1])MAPPING_RETURN(3,banks*28+i*(i+1)/2+1);
        for(u32 j=0;j<i;j++)if(output_ids[i]==output_ids[j])MAPPING_RETURN(4,banks*28+i*(i+1)/2+j+2);
    }
    MAPPING_RETURN(0,banks*28+(banks*8)*(banks*8+1)/2);
    #undef MAPPING_RETURN
}
static STAGE_NOINLINE void gather_memory_inputs(const u32 *c,u32 banks,const u32 *input_nets,u8 *inputs,u8 *conflicts) {
    STAGE_ADD(STAGE_MEMORY_GATHER_CALLS,1);
    STAGE_ADD(STAGE_MEMORY_GATHER_PIN_RECORDS,banks*28);
    for(u32 i=0;i<banks*28;i++){inputs[i]=((u8*)(unsigned long)c[10])[input_nets[i]];conflicts[i]=((u8*)(unsigned long)c[11])[input_nets[i]];}
}
static STAGE_NOINLINE u32 publish_memory_writers(const u32 *c,u32 banks,const u32 *output_ids,const u8 *drives,
                                                  const u8 *present,const u8 *bank_changed,u32 *changed) {
    u32 publications=0;for(u32 b=0;b<banks;b++) {
        if(present[b])memory_pass_work[4]++;
        if(bank_changed[b]){*changed=1;memory_pass_work[5]++;}
        if(present[b])for(u32 bit=0;bit<8;bit++){
            publications++;
            if(write_owned_driver_tagged(c,output_ids[b*8+bit],drives[b*8+bit],PRODUCER_MEMORY_BANK)){
                STAGE_ADD(STAGE_MEMORY_WRITER_PUBLICATIONS,publications);return 1;}
        }
    }
    STAGE_ADD(STAGE_MEMORY_WRITER_PUBLICATIONS,publications);return 0;
}
static STAGE_NOINLINE u32 post_memory_settle(const u32 *c){STAGE_ADD(STAGE_MEMORY_POST_SETTLES,1);return settle_context(c);}
u32 memory_circuit_version(void){return 3;}
/* fault: category (1 combinational,2 memory,3 limit,4 mapping),code,bank,pin.
 * Per-pass commit matches JS: a later settle failure does not roll back a
 * successfully committed earlier memory pass. A peer preflight failure does. */
u32 settle_memory_circuit(const u32 *c,u32 passes,u32 *fault) {
    if(!passes||passes>1024){fault[0]=3;fault[1]=1;return 3;}
    const u32 banks=c[18],*input_nets=U32(29),*output_ids=U32(30);
    if(!banks||banks>32){fault[0]=4;fault[1]=1;return 4;}
    u32 mapping=validate_memory_mapping(c,banks,input_nets,output_ids);
    if(mapping){fault[0]=4;fault[1]=mapping;return 4;}
    memory_pass_work[0]++;
    for(u32 pass=0;pass<passes;pass++) {
        memory_pass_work[1]++;
        u32 result=settle_context(c);
        if(result&0x80000000u){fault[0]=1;fault[1]=result&0x7fffffffu;return 1;}
        gather_memory_inputs(c,banks,input_nets,U8(23),U8(24));
        memory_pass_work[2]++;memory_pass_work[3]+=banks;
        if(c[31])result=preview_owned_memory_banks(banks,U8(19),U32(20),U32(21),U8(22),U8(23),U8(24),U8(25),U8(26),U8(27),U32(28));
        else result=preview_memory_banks(banks,U8(19),U32(20),U32(21),U8(22),U8(23),U8(24),U8(25),U8(26),U8(27),U32(28));
        if(result){fault[0]=2;fault[1]=result;fault[2]=U32(28)[1];fault[3]=U32(28)[2];return 2;}
        u32 changed=0,prior_driver_changes=producer_work[PRODUCER_COUNT+PRODUCER_MEMORY_BANK];
        if(publish_memory_writers(c,banks,output_ids,U8(25),U8(26),U8(27),&changed)){fault[0]=1;fault[1]=2;return 1;}
        memory_pass_work[6]++;
        if(producer_work[PRODUCER_COUNT+PRODUCER_MEMORY_BANK]==prior_driver_changes)memory_pass_work[7]++;
        result=post_memory_settle(c);
        if(result&0x80000000u){fault[0]=1;fault[1]=result&0x7fffffffu;return 1;}
        if(!changed){fault[0]=0;return 0;}
    }
    fault[0]=3;fault[1]=2;return 3;
}
