/* Bounded owned-fixture schedule runner. Not a CPU interpreter/fast-forwarder. */
typedef unsigned int u32;
typedef unsigned char u8;
extern u32 begin_latched_memory_clock(const u32*,u32*);
extern u32 end_latched_memory_clock(const u32*,u32*);
#define W(i) ((u32*)(unsigned long)p[i])
static u32 schedule_fault(u32 code,u32 detail,u32 *fault){fault[0]=7;fault[1]=code;fault[2]=detail;fault[3]=0;return 7;}
u32 phase_schedule_version(void){return 1;}
u32 run_latched_memory_schedule(const u32 *p,u32 count,u32 updates,const u32 *offsets,const u32 *ids,const u8 *values,
                               const u8 *allowed,const u8 *read_flags,const u32 *read_nets,const u32 *expected,u32 *stats,u32 *fault) {
    const u32 *c=W(0);u8 *drivers=(u8*)(unsigned long)c[4];
    stats[0]=stats[1]=0;
    if(!count||count>8192)return schedule_fault(1,count,fault);
    if(offsets[0]||offsets[count]!=updates)return schedule_fault(2,0,fault);
    for(u32 i=0;i<c[1];i++)if(allowed[i]>1)return schedule_fault(3,i,fault);
    for(u32 i=0;i<16;i++)if(read_nets[i]>=c[0])return schedule_fault(4,i,fault);
    for(u32 i=0;i<count;i++) {
        if(offsets[i]>offsets[i+1]||offsets[i+1]>updates)return schedule_fault(2,i,fault);
        if(read_flags[i]>1||expected[i]>65535)return schedule_fault(5,i,fault);
    }
    for(u32 i=0;i<updates;i++)if(ids[i]>=c[1]||!allowed[ids[i]]||values[i]>3)return schedule_fault(6,i,fault);
    // All schedule admission precedes mutation of pending drivers or clock state.
    if(W(15)[1]||W(15)[0]){fault[0]=6;fault[1]=W(15)[1]?1:2;return 6;}
    for(u32 step=0;step<count;step++) {
        for(u32 i=offsets[step];i<offsets[step+1];i++)drivers[ids[i]]=values[i];
        u32 result=begin_latched_memory_clock(p,fault);if(result)return result;
        if(read_flags[step]) {
            const u8 *levels=(u8*)(unsigned long)c[10],*conflicts=(u8*)(unsigned long)c[11];u32 value=0;
            for(u32 bit=0;bit<16;bit++) {
                u8 code=levels[read_nets[bit]];
                if(code>1){fault[0]=8;fault[1]=code==3?1:conflicts[read_nets[bit]]?3:2;fault[2]=step;fault[3]=bit;W(15)[1]=1;return 8;}
                value|=(u32)code<<bit;
            }
            if(value!=expected[step]){fault[0]=8;fault[1]=4;fault[2]=step;fault[3]=value;W(15)[1]=1;return 8;}
            stats[1]++;
        }
        result=end_latched_memory_clock(p,fault);if(result)return result;
        stats[0]++;
    }
    fault[0]=0;return 0;
}
