/* Owned freestanding prototype. No CPU, timing, device or full-board claim. */
typedef unsigned int u32;
typedef unsigned char u8;
_Static_assert(sizeof(u32)==4,"32-bit index required");
static u8 arena[2*1024*1024] __attribute__((aligned(16)));
u8 *arena_ptr(void){return arena;}
u32 arena_capacity(void){return sizeof(arena);}
u32 owned_kernel_version(void){return 1;}

/* Caller supplies disjoint, in-bounds arena arrays. Validate the whole image
 * before touching any output, including codes on unconnected driver records.
 * Return 1 for malformed offsets/IDs and 2 for a non-four-state driver code. */
static u32 validate_nets(u32 nets,u32 drivers,const u32 *offsets,const u32 *ids,const u8 *levels) {
    if(offsets[0]!=0||offsets[nets]!=drivers)return 1;
    for(u32 d=0;d<drivers;d++)if(levels[d]>3)return 2;
    for(u32 n=0;n<nets;n++) {
        if(offsets[n]>offsets[n+1]||offsets[n+1]>drivers)return 1;
        for(u32 p=offsets[n];p<offsets[n+1];p++)if(ids[p]>=drivers)return 1;
    }
    return 0;
}
static void resolve_valid(u32 nets,const u32 *offsets,const u32 *ids,const u8 *levels,u8 *resolved,u8 *conflicts) {
    for(u32 n=0;n<nets;n++) {
        u32 mask=0;
        for(u32 p=offsets[n];p<offsets[n+1];p++) {
            u8 code=levels[ids[p]];if(code!=3)mask|=1u<<code;
        }
        u8 conflict=(mask&3)==3;
        resolved[n]=!mask?3:conflict||(mask&4)?2:(mask&1)?0:1;
        conflicts[n]=conflict;
    }
}
u32 resolve_nets(u32 nets,u32 drivers,const u32 *offsets,const u32 *ids,
                 const u8 *levels,u8 *resolved,u8 *conflicts) {
    u32 error=validate_nets(nets,drivers,offsets,ids,levels);if(error)return error;
    resolve_valid(nets,offsets,ids,levels,resolved,conflicts);return 0;
}

/* Fixed 32-word records for three owned evaluator implementations. */
static u32 validate_operations(u32 count,const u32 *ops,u32 nets,u32 drivers,const u32 *dep_offsets,const u32 *deps,u32 dep_count) {
    if(dep_offsets[0]!=0||dep_offsets[count]!=dep_count)return 4;
    for(u32 i=0;i<count;i++) {
        if(dep_offsets[i]>dep_offsets[i+1]||dep_offsets[i+1]>dep_count)return 4;
        for(u32 p=dep_offsets[i];p<dep_offsets[i+1];p++)if(deps[p]>=nets)return 4;
        const u32 *r=ops+i*32;
        if(r[0]==1) {
            if(r[1]>1||r[2]>=r[3]||r[3]>0x1000000||r[4]>1||r[5]>=nets||r[6]>=nets||r[7]>=drivers)return 4;
            for(u32 b=0;b<24;b++)if(r[8+b]>=nets)return 4;
        }else if(r[0]==2) {
            if(r[1]>=nets||r[2]>=nets||r[3]>=drivers)return 4;
        }else if(r[0]==3) {
            if(r[1]>=nets||r[2]>1)return 4;
            for(u32 b=0;b<4;b++)if(r[3+b]>=nets||(r[2]&&r[7+b]>=nets)||r[11+b]>=drivers)return 4;
        }else return 4;
    }
    return 0;
}
static void evaluate_operations(u32 count,const u32 *ops,const u8 *nets,u8 *staged,
                                const u32 *dep_offsets,const u32 *deps,const u8 *changed) {
    for(u32 i=0;i<count;i++) {
        u32 affected=0;
        for(u32 p=dep_offsets[i];p<dep_offsets[i+1];p++)if(changed[deps[p]]){affected=1;break;}
        if(!affected)continue;
        const u32 *r=ops+i*32;
        if(r[0]==1) {
            u8 mio=nets[r[5]],enable=nets[r[1]?r[6]:r[8]],out=2;
            if(mio==0||enable==1)out=1;
            else {
                u32 address=0,known=1;
                for(u32 b=0;b<24;b++){u8 bit=nets[r[8+b]];if(bit>1){known=0;break;}address|=(u32)bit<<b;}
                if(known&&mio==1&&(!r[1]||enable==0))out=!((address>=r[2]&&address<r[3])||(r[4]&&address>=0xf0000&&address<0x100000));
            }
            staged[r[7]]=out;
        }else if(r[0]==2) {
            u8 a=nets[r[1]],b=nets[r[2]];staged[r[3]]=a<2&&b<2?(a|b):2;
        }else {
            u8 held=nets[r[1]];u32 passive=!r[2]||(nets[r[8]]==1&&nets[r[7]]==1);
            for(u32 b=0;b<4;b++)staged[r[11+b]]=held==0?nets[r[3+b]]:held==1?(passive?(b<2):nets[r[7+b]]):2;
        }
    }
}
/* Success is delta+1. High-bit results are errors; published outputs remain
 * unchanged on every error, including nonconvergence. Live drivers can change
 * during failed settling, matching the separate pending/published contract. */
static u32 settle_validated(u32 nets,u32 drivers,const u32 *offsets,const u32 *ids,u8 *levels,
                 u8 *live,u8 *live_conflicts,u32 count,const u32 *ops,u8 *staged,
                 u8 *published,u8 *published_conflicts,u32 max_deltas,
                 const u32 *dep_offsets,const u32 *deps,u32 dep_count,u8 *previous,u8 *changed_nets) {
    (void)dep_count; /* Immutable dependency bounds already admitted. */
    for(u32 delta=0;delta<max_deltas;delta++) {
        resolve_valid(nets,offsets,ids,levels,live,live_conflicts);
        for(u32 n=0;n<nets;n++){changed_nets[n]=live[n]!=previous[n];previous[n]=live[n];}
        for(u32 d=0;d<drivers;d++)staged[d]=levels[d];
        evaluate_operations(count,ops,live,staged,dep_offsets,deps,changed_nets);
        u32 changed=0;
        for(u32 d=0;d<drivers;d++){if(staged[d]!=levels[d])changed=1;levels[d]=staged[d];}
        if(!changed) {
            for(u32 n=0;n<nets;n++){published[n]=live[n];published_conflicts[n]=live_conflicts[n];}
            return delta+1;
        }
    }
    return 0x80000003u;
}
u32 settle_owned(u32 nets,u32 drivers,const u32 *offsets,const u32 *ids,u8 *levels,
                 u8 *live,u8 *live_conflicts,u32 count,const u32 *ops,u8 *staged,
                 u8 *published,u8 *published_conflicts,u32 max_deltas,
                 const u32 *dep_offsets,const u32 *deps,u32 dep_count,u8 *previous,u8 *changed_nets) {
    u32 error=validate_nets(nets,drivers,offsets,ids,levels);
    if(!error)error=validate_operations(count,ops,nets,drivers,dep_offsets,deps,dep_count);
    if(error)return 0x80000000u|error;
    if(!max_deltas||max_deltas>1024)return 0x80000005u;
    return settle_validated(nets,drivers,offsets,ids,levels,live,live_conflicts,count,ops,staged,published,published_conflicts,
                            max_deltas,dep_offsets,deps,dep_count,previous,changed_nets);
}
/* One private immutable graph per module instance. Only the wrapper owns this
 * arena; this is not admission for caller-mutable serialized state. Runtime
 * host/schedule inputs remain validated, and owned native writers emit 0..3. */
static const u32 *admitted_context;
#define CB(i) ((u8*)(unsigned long)c[i])
#define CW(i) ((u32*)(unsigned long)c[i])
u32 admit_owned_context(const u32 *c) {
    admitted_context=0; /* Failed re-admission must not retain an old grant. */
    u32 error=validate_nets(c[0],c[1],CW(2),CW(3),CB(4));
    if(!error)error=validate_operations(c[7],CW(8),c[0],c[1],CW(13),CW(14),c[15]);
    if(error)return 0x80000000u|error;
    if(!c[12]||c[12]>1024)return 0x80000005u;
    if(c[31]!=1)return 0x80000006u;
    admitted_context=c;return 0;
}
u32 settle_owned_context(const u32 *c) {
    if(c[31]) {
        if(c[31]!=1||admitted_context!=c)return 0x80000006u;
        return settle_validated(c[0],c[1],CW(2),CW(3),CB(4),CB(5),CB(6),c[7],CW(8),CB(9),CB(10),CB(11),c[12],CW(13),CW(14),c[15],CB(16),CB(17));
    }
    return settle_owned(c[0],c[1],CW(2),CW(3),CB(4),CB(5),CB(6),c[7],CW(8),CB(9),CB(10),CB(11),c[12],CW(13),CW(14),c[15],CB(16),CB(17));
}
