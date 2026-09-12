/* One owned memory bus + phase/memory context in the SAME private instance.
 * No CPU/instruction execution; host transactions advance every modeled period.
 * p: memory context,phase context,input-net map,output-driver map,external IDs,
 * external values,external count,lifecycle[open,faulted],run report[periods,count,
 * last],two physical completion records (9 words each). */
typedef unsigned int u32;
typedef unsigned char u8;
#include "stage-attribution.h"
#define W(i) ((u32*)(unsigned long)p[i])
#define B(i) ((u8*)(unsigned long)p[i])
extern u32 bus_input_ptr(void),bus_output_ptr(void),bus_completion_ptr(void),bus_error_pin(void);
extern u32 bus_output_change_word(u32);
extern u32 bus_begin(void),bus_end(void);
extern u32 settle_owned_context(const u32*);
extern u32 write_owned_driver_tagged(const u32*,u32,u32,u32);
extern u32 begin_latched_memory_clock(const u32*,u32*),preview_latched_memory_clock(const u32*,u32*);
extern u32 finish_latched_memory_clock(const u32*,u32*),abort_latched_memory_clock(const u32*,u32*);
extern double bus_inspect(u32);
u32 bus_circuit_version(void){return 2;}
/* All external and CPU bus outputs participate in the admitted dirty frontier. */
#define PRODUCER_BUS_EXTERNAL 1
#define PRODUCER_BUS_OUTPUT 2
static u32 stage_bus_driver(const u32 *c,u32 id,u8 value,u32 producer){return write_owned_driver_tagged(c,id,value,producer);}
static u32 failure(const u32*p,u32 category,u32 code,u32 pin,u32*fault) {
    fault[0]=category;fault[1]=code;fault[2]=pin;fault[3]=0xffffffff;
    if(category!=6||code!=2)W(7)[1]=1;return category;
}
static STAGE_NOINLINE u32 validate_bus_mapping(const u32*p,u32*fault) {
    const u32*c=W(0);
    STAGE_ADD(STAGE_BUS_VALIDATION_CALLS,1);
    #define BUS_MAPPING_RETURN(value,count) do{STAGE_ADD(STAGE_BUS_VALIDATION_VISITS,(count));return(value);}while(0)
    if(p[6]>128)return failure(p,8,2,0,fault);
    for(u32 i=0;i<24;i++)if(W(2)[i]>=c[0])BUS_MAPPING_RETURN(failure(p,8,2,i,fault),i+1);
    for(u32 i=0;i<48;i++)if(W(3)[i]>=c[1])BUS_MAPPING_RETURN(failure(p,8,2,i,fault),24+i+1);
    for(u32 i=0;i<p[6];i++)if(W(4)[i]>=c[1]||B(5)[i]>3)BUS_MAPPING_RETURN(failure(p,8,2,i,fault),72+i+1);
    BUS_MAPPING_RETURN(0,72+p[6]);
    #undef BUS_MAPPING_RETURN
}
static void gather(const u32*p) {
    const u32*c=W(0);const u8*levels=(u8*)(unsigned long)c[10],*conflicts=(u8*)(unsigned long)c[11];
    u32 *input=(u32*)(unsigned long)bus_input_ptr();
    for(u32 i=0;i<24;i++){u32 net=W(2)[i];input[i]=conflicts[net]?4:levels[net];}
}
static u32 settle(const u32*p,u32*fault) {
    u32 result=settle_owned_context(W(0));
    return result&0x80000000u?failure(p,1,result&0x7fffffff,0xffffffff,fault):0;
}
u32 begin_bus_memory_clock(const u32*p,u32*fault) {
    if(W(7)[1])return failure(p,6,1,0,fault);
    if(W(7)[0])return failure(p,6,2,0,fault);
    u32 result=validate_bus_mapping(p,fault);if(result)return result;
    for(u32 i=0;i<p[6];i++)if(stage_bus_driver(W(0),W(4)[i],B(5)[i],PRODUCER_BUS_EXTERNAL))return failure(p,8,2,i,fault);
    if((result=settle(p,fault)))return result;
    gather(p);result=bus_begin();if(result)return failure(p,7,result,bus_error_pin(),fault);
    const u32*output=(u32*)(unsigned long)bus_output_ptr();
    /* The sequencer retains the complete final four-state output image. This
     * mask only suppresses redundant canonical writer calls; it never stands
     * in for output computation or resolved-net state. */
    const u32 changed[2]={bus_output_change_word(0),bus_output_change_word(1)};
    for(u32 i=0;i<48;i++)if((changed[i>>5]&(1u<<(i&31)))&&
       stage_bus_driver(W(0),W(3)[i],(u8)output[i],PRODUCER_BUS_OUTPUT))return failure(p,8,2,i,fault);
    if((result=settle(p,fault)))return result;
    result=begin_latched_memory_clock(W(1),fault);if(result){W(7)[1]=1;return result;}
    W(7)[0]=1;fault[0]=0;return 0;
}
u32 end_bus_memory_clock(const u32*p,u32*fault) {
    if(W(7)[1])return failure(p,6,1,0,fault);
    if(!W(7)[0])return failure(p,6,2,0,fault);
    W(7)[0]=0;
    u32 result=preview_latched_memory_clock(W(1),fault);if(result){W(7)[1]=1;return result;}
    const u32*phase=W(1);u32 ready=*(u32*)(unsigned long)phase[13];gather(p);
    const u32*input=(u32*)(unsigned long)bus_input_ptr();
    if(ready!=0xffffffff&&input[7]!=ready) {
        u32 discard[4];abort_latched_memory_clock(phase,discard);
        if(input[7]>=2)return failure(p,7,input[7]==3?3:input[7]==4?13:4,7,fault);
        return failure(p,8,1,7,fault);
    }
    result=bus_end();
    if(result){u32 discard[4];abort_latched_memory_clock(phase,discard);return failure(p,7,result,bus_error_pin(),fault);}
    result=finish_latched_memory_clock(phase,fault);if(result){W(7)[1]=1;return result;}
    fault[0]=0;return 0;
}
u32 run_bus_memory_until_completion(const u32*p,u32 periods,u32*fault) {
    if(W(7)[1])return failure(p,6,1,0,fault);
    if(W(7)[0])return failure(p,6,2,0,fault);
    if(periods<1||periods>8192||!bus_inspect(9))return failure(p,8,3,0,fault);
    W(8)[0]=W(8)[1]=W(8)[2]=0;
    for(u32 i=0;i<periods;i++) {
        u32 result=begin_bus_memory_clock(p,fault);if(result)return result;
        result=end_bus_memory_clock(p,fault);if(result)return result;
        W(8)[0]++;
        const u32*completion=(u32*)(unsigned long)bus_completion_ptr();
        if(completion[0]) {
            u32 index=W(8)[1]++;
            for(u32 j=0;j<9;j++)W(9)[index*9+j]=completion[j];
            if(completion[7]){W(8)[2]=1;return 0;}
        }
    }
    fault[0]=0;return 0;
}
