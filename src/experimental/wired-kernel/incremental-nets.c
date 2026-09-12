/* Default-off incremental resolution for one admitted private graph. */
typedef unsigned int u32;
typedef unsigned char u8;
#define LIMIT 16384
#define NONE 0xffffffffu
#define B(i) ((u8*)(unsigned long)c[i])
#define W(i) ((u32*)(unsigned long)c[i])
extern u32 resolve_nets(u32,u32,const u32*,const u32*,const u8*,u8*,u8*);
extern void evaluate_owned_operations(u32,const u32*,const u8*,u8*,const u32*,const u32*,const u8*);
static u32 driver_net[LIMIT];
static u8 queued_driver[LIMIT],dirty[LIMIT];
static u32 driver_queue[LIMIT],dirty_queue[LIMIT],changed_queue[LIMIT],driver_count,dirty_count,changed_count;
/* Test-visible u32 work counters wrap modulo 2^32. They observe work only;
 * admission and policy do not read them. Keep the order in sync with
 * memory-circuit.js. Driver comparisons count native work; the permitted JS
 * bulk-image comparison is outside this kernel counter. */
u32 incremental_work[10];
u32 *incremental_work_counters_ptr(void){return incremental_work;}
void reset_incremental_work_counters(void){for(u32 i=0;i<10;i++)incremental_work[i]=0;}
u32 incremental_work_counters_version(void){return 1;}
/* ABI 2 requires every runtime driver mutation to use write_owned_driver.
 * ABI 1 wrappers wrote the arena directly and depended on a discovery scan. */
u32 incremental_kernel_version(void){return 2;}
static u32 write_driver(const u32 *c,u32 id,u32 code,u32 count_comparison) {
    if(id>=c[1]||(c[31]==2&&driver_net[id]==NONE))return 1;
    if(code>3)return 2;
    if(count_comparison)incremental_work[0]++;
    if(B(4)[id]==code)return 0;
    incremental_work[1]++;B(4)[id]=(u8)code;
    if(c[31]==2&&!queued_driver[id]){queued_driver[id]=1;driver_queue[driver_count++]=id;}
    return 0;
}
u32 write_owned_driver(const u32 *c,u32 id,u32 code){return write_driver(c,id,code,1);}
u32 admit_incremental_context(const u32 *c) {
    if(c[0]>LIMIT||c[1]>LIMIT)return 7;
    driver_count=0;dirty_count=0;changed_count=0;
    for(u32 d=0;d<c[1];d++){driver_net[d]=NONE;queued_driver[d]=0;}
    for(u32 n=0;n<c[0];n++) {
        dirty[n]=0;
        for(u32 p=W(2)[n];p<W(2)[n+1];p++) {
            const u32 d=W(3)[p];
            if(driver_net[d]!=NONE)return 6; // Require a bijective driver membership image.
            driver_net[d]=n;
        }
    }
    for(u32 d=0;d<c[1];d++)if(driver_net[d]==NONE)return 6;
    u32 error=resolve_nets(c[0],c[1],W(2),W(3),B(4),B(5),B(6));
    if(error)return error;
    // Admission must compare every live net with the supplied previous image,
    // including nets whose drivers do not change before the first settle.
    for(u32 n=0;n<c[0];n++){dirty[n]=1;dirty_queue[dirty_count++]=n;B(17)[n]=0;}
    return 0;
}
static u32 resolve_dirty(const u32 *c) {
    for(u32 i=0;i<changed_count;i++)B(17)[changed_queue[i]]=0;
    changed_count=0;
    for(u32 i=0;i<driver_count;i++) {
        const u32 d=driver_queue[i],n=driver_net[d];queued_driver[d]=0;
        if(!dirty[n]){dirty[n]=1;dirty_queue[dirty_count++]=n;}
    }
    driver_count=0;
    for(u32 i=0;i<dirty_count;i++) {
        const u32 n=dirty_queue[i];incremental_work[2]++;
        u32 mask=0;dirty[n]=0;
        for(u32 p=W(2)[n];p<W(2)[n+1];p++){incremental_work[3]++;u8 code=B(4)[W(3)[p]];if(code!=3)mask|=1u<<code;}
        u8 conflict=(mask&3)==3;
        B(5)[n]=!mask?3:conflict||(mask&4)?2:(mask&1)?0:1;B(6)[n]=conflict;
        if(B(5)[n]!=B(16)[n]){B(17)[n]=1;changed_queue[changed_count++]=n;B(16)[n]=B(5)[n];}
    }
    dirty_count=0;return changed_count;
}
static void publish_incremental(const u32 *c) {
    for(u32 n=0;n<c[0];n++){incremental_work[8]++;B(10)[n]=B(5)[n];B(11)[n]=B(6)[n];}
}
u32 settle_incremental_context(const u32 *c) {
    for(u32 delta=0;delta<c[12];delta++) {
        incremental_work[9]++;
        const u32 resolved_changed=resolve_dirty(c);
        // Driver changes masked on a net do not schedule pure evaluators.
        // Conflict-only changes still publish their diagnostics below.
        if(!resolved_changed){publish_incremental(c);return delta+1;}
        for(u32 d=0;d<c[1];d++){incremental_work[6]++;B(9)[d]=B(4)[d];}
        evaluate_owned_operations(c[7],W(8),B(5),B(9),W(13),W(14),B(17));
        u32 changed=0;
        for(u32 d=0;d<c[1];d++){incremental_work[0]++;if(B(9)[d]!=B(4)[d]){
            incremental_work[7]++;changed=1;if(write_driver(c,d,B(9)[d],0))return 0x80000002u;
        }}
        if(!changed){publish_incremental(c);return delta+1;}
    }
    // Keep pending-driver/live history, but do not publish a failed fixpoint.
    return 0x80000003u;
}
