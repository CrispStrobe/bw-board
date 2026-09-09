/* Owned freestanding prototype. No CPU, timing, device or full-board claim. */
typedef unsigned int u32;
typedef unsigned char u8;
_Static_assert(sizeof(u32)==4,"32-bit index required");
static u8 arena[2*1024*1024] __attribute__((aligned(16)));
u8 *arena_ptr(void){return arena;}
u32 arena_capacity(void){return sizeof(arena);}

/* Caller supplies disjoint, in-bounds arena arrays. Validate the whole image
 * before touching any output, including codes on unconnected driver records.
 * Return 1 for malformed offsets/IDs and 2 for a non-four-state driver code. */
u32 resolve_nets(u32 nets,u32 drivers,const u32 *offsets,const u32 *ids,
                 const u8 *levels,u8 *resolved,u8 *conflicts) {
    if(offsets[0]!=0||offsets[nets]!=drivers)return 1;
    for(u32 d=0;d<drivers;d++)if(levels[d]>3)return 2;
    for(u32 n=0;n<nets;n++) {
        if(offsets[n]>offsets[n+1]||offsets[n+1]>drivers)return 1;
        for(u32 p=offsets[n];p<offsets[n+1];p++)if(ids[p]>=drivers)return 1;
    }
    for(u32 n=0;n<nets;n++) {
        u32 mask=0;
        for(u32 p=offsets[n];p<offsets[n+1];p++) {
            u8 code=levels[ids[p]];if(code!=3)mask|=1u<<code;
        }
        u8 conflict=(mask&3)==3;
        resolved[n]=!mask?3:conflict||(mask&4)?2:(mask&1)?0:1;
        conflicts[n]=conflict;
    }
    return 0;
}
