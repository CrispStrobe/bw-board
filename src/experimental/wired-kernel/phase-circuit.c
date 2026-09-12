/* Owned latched-memory clock boundaries. No CPU or peripheral clock model. */
typedef unsigned int u32;
typedef unsigned char u8;
#include "stage-attribution.h"
#define NONE 0xffffffffu
#define B(i) ((u8*)(unsigned long)p[i])
#define W(i) ((u32*)(unsigned long)p[i])
extern u32 settle_owned_context(const u32*);
extern u32 settle_memory_circuit(const u32*,u32,u32*);
extern u32 begin_memory_phase(u32*,u32,u32,const u8*,const u8*,u8*,u32*);
extern u32 preview_memory_phase_end(const u32*,const u8*,const u8*,u32*,u32*);
extern u32 finish_memory_phase(u32*,u32,u8*,u8*,u32*);
extern u32 update_address_latch(u8*,const u8*,const u8*,u8*,u32*);
extern u32 write_owned_driver_tagged(const u32*,u32,u32,u32);
#define PRODUCER_PHASE_CONTROLLER 3
#define PRODUCER_PHASE_LATCH 4
/* Private phase context: memory context ptr, state ptr, io,intr,input-net IDs,
 * controller driver IDs,latch input-net IDs,latch driver IDs,latch values,
 * input staging,conflict staging,output staging,phase fault,ready,present,
 * lifecycle [open,faulted,previewed]. Buffers 9..11 accommodate 27 pins. */
static u32 reject_phase(const u32 *p,u32 category,u32 code,u32 detail,u32 *fault) {
    fault[0]=category;fault[1]=code;fault[2]=detail;fault[3]=NONE;
    if(category!=6||code!=2)W(15)[1]=1;
    return category;
}
static u32 controller_output(const u32 *p,u32 bit){return bit<3||(bit<5?p[2]:p[3]);}
static STAGE_NOINLINE u32 validate_phase_mapping(const u32 *p,u32 *fault) {
    const u32 *c=W(0);
    u32 visits=0;STAGE_ADD(STAGE_PHASE_VALIDATION_CALLS,1);
    #define PHASE_MAPPING_RETURN(value) do{STAGE_ADD(STAGE_PHASE_VALIDATION_VISITS,visits);return(value);}while(0)
    if(p[2]>1||p[3]>1)return reject_phase(p,4,5,NONE,fault);
    for(u32 i=0;i<6;i++){visits++;if(W(4)[i]>=c[0])PHASE_MAPPING_RETURN(reject_phase(p,4,6,i,fault));}
    for(u32 i=0;i<7;i++){visits++;if(controller_output(p,i)&&W(5)[i]>=c[1])PHASE_MAPPING_RETURN(reject_phase(p,4,7,i,fault));}
    for(u32 i=0;i<27;i++){visits++;if(W(6)[i]>=c[0])PHASE_MAPPING_RETURN(reject_phase(p,4,8,i,fault));}
    for(u32 i=0;i<26;i++){visits++;if(W(7)[i]>=c[1])PHASE_MAPPING_RETURN(reject_phase(p,4,9,i,fault));}
    PHASE_MAPPING_RETURN(0);
    #undef PHASE_MAPPING_RETURN
}
static u32 settle_phase_nets(const u32 *p,u32 *fault) {
    const u32 *c=W(0);
    #define CB(i) ((u8*)(unsigned long)c[i])
    #define CW(i) ((u32*)(unsigned long)c[i])
    u32 result=settle_owned_context(c);
    return result&0x80000000u?reject_phase(p,1,result&0x7fffffffu,NONE,fault):0;
}
static void gather_phase(const u32 *p,u32 mapping,u32 count) {
    const u32 *c=W(0);const u8 *levels=CB(10),*conflicts=CB(11);
    for(u32 i=0;i<count;i++){B(9)[i]=levels[W(mapping)[i]];B(10)[i]=conflicts[W(mapping)[i]];}
}
static u32 publish_controller(const u32 *p) {
    const u32 *c=W(0);for(u32 i=0;i<7;i++)if(controller_output(p,i)){
        if(write_owned_driver_tagged(c,W(5)[i],B(11)[i],PRODUCER_PHASE_CONTROLLER))return 1;
    }
    return 0;
}
static u32 phase_component_error(const u32 *p,u32 result,u32 component,u32 *fault) {
    fault[0]=5;fault[1]=result;fault[2]=component;fault[3]=W(12)[1];W(15)[1]=1;return 5;
}
static u32 settle_phase_memory(const u32 *p,u32 *fault) {
    u32 result=settle_memory_circuit(W(0),8,fault);if(result)W(15)[1]=1;return result;
}
u32 phase_circuit_version(void){return 2;}
u32 begin_latched_memory_clock(const u32 *p,u32 *fault) {
    if(W(15)[1])return reject_phase(p,6,1,NONE,fault);
    if(W(15)[0]||W(15)[2])return reject_phase(p,6,2,NONE,fault);
    u32 result=validate_phase_mapping(p,fault);if(result)return result;
    if((result=settle_phase_nets(p,fault)))return result;
    gather_phase(p,4,6);
    result=begin_memory_phase(W(1),p[2],p[3],B(9),B(10),B(11),W(12));if(result)return phase_component_error(p,result,0,fault);
    if(publish_controller(p))return reject_phase(p,1,2,NONE,fault);if((result=settle_phase_nets(p,fault)))return result;
    gather_phase(p,6,27);
    result=update_address_latch(B(8),B(9),B(10),B(11),W(12));if(result)return phase_component_error(p,result,1,fault);
    const u32 *c=W(0);for(u32 i=0;i<26;i++){
        if(write_owned_driver_tagged(c,W(7)[i],B(11)[i],PRODUCER_PHASE_LATCH))return reject_phase(p,1,2,NONE,fault);
    }
    if((result=settle_phase_memory(p,fault)))return result;
    W(15)[0]=1;fault[0]=0;return 0;
}
/* Capture READY before CPU/master sampling. Do not release any command yet. */
u32 preview_latched_memory_clock(const u32 *p,u32 *fault) {
    if(W(15)[1])return reject_phase(p,6,1,NONE,fault);
    if(!W(15)[0]||W(15)[2])return reject_phase(p,6,2,NONE,fault);
    W(15)[0]=0;gather_phase(p,4,6);
    u32 result=preview_memory_phase_end(W(1),B(9),B(10),W(13),W(12));if(result)return phase_component_error(p,result,0,fault);
    W(15)[2]=1;fault[0]=0;return 0;
}
/* Consume the captured READY exactly once; no fresh input sampling here. */
u32 finish_latched_memory_clock(const u32 *p,u32 *fault) {
    if(W(15)[1])return reject_phase(p,6,1,NONE,fault);
    if(!W(15)[2])return reject_phase(p,6,2,NONE,fault);
    W(15)[2]=0;
    u32 result=finish_memory_phase(W(1),*W(13),B(11),B(14),W(12));if(result)return phase_component_error(p,result,0,fault);
    if(*B(14)) {
        if(publish_controller(p))return reject_phase(p,1,2,NONE,fault);if((result=settle_phase_nets(p,fault)))return result;
        if((result=settle_phase_memory(p,fault)))return result;
    }
    fault[0]=0;return 0;
}
/* A future CPU/master sample fault must not let finish commit the write edge. */
u32 abort_latched_memory_clock(const u32 *p,u32 *fault) {
    if(W(15)[1])return reject_phase(p,6,1,NONE,fault);
    if(!W(15)[2])return reject_phase(p,6,2,NONE,fault);
    W(15)[2]=0;W(15)[1]=1;fault[0]=0;return 0;
}
u32 end_latched_memory_clock(const u32 *p,u32 *fault) {
    u32 result=preview_latched_memory_clock(p,fault);if(result)return result;
    return finish_latched_memory_clock(p,fault);
}
