/* Owned ideal latch / memory-phase controller, not a full 82C288 model. */
typedef unsigned int u32;
typedef unsigned char u8;
#define NONE 0xffffffffu
/* Controller words: state(TI=0,TS=1,TC=2),phase,open,tcCount low/high,kind.
 * Kind: null=0,memread=1,memwrite=2,code=3,ioread=4,iowrite=5,ack=6,
 * shutdown=7,reserved=8,passive=9. Inputs reset,ready,s1,s0,cod,mio. */
static u32 phase_fault(u32 code,u32 pin,u32 *fault){fault[0]=code;fault[1]=pin;return code;}
static u32 phase_known(const u8 *in,const u8 *conflicts,u32 pin,u32 *fault) {
    return in[pin]<2?0:phase_fault(in[pin]==3?1:conflicts[pin]?3:2,pin,fault);
}
static u32 phase_inputs(const u8 *in,const u8 *cf,u32 count,u32 *fault) {
    for(u32 i=0;i<count;i++)if(in[i]>3||cf[i]>1||(cf[i]&&in[i]!=2))return phase_fault(4,i,fault);
    return 0;
}
static u32 phase_state(const u32 *s,u32 io,u32 intr,u32 *fault) {
    if(io>1||intr>1||s[0]>2||s[1]<1||s[1]>2||s[2]>1||s[4]>0x1fffff||s[5]>9)return phase_fault(5,NONE,fault);
    return 0;
}
static u32 phase_decode(const u8 *in) {
    u32 s1=in[2],s0=in[3],cod=in[4],mio=in[5];
    if(s1&&s0)return 9;
    if(mio&&!s1&&s0)return cod?3:1;
    if(mio&&s1&&!s0&&!cod)return 2;
    if(!mio&&!s1&&s0&&cod)return 4;
    if(!mio&&s1&&!s0&&cod)return 5;
    if(!mio&&!s1&&!s0&&!cod)return 6;
    if(mio&&!s1&&!s0&&!cod)return 7;
    return 8;
}
/* Outputs ALE,MRD,MWR,IOR,IOW,INTA,INTA_WAIT. Config controls visibility. */
static void phase_commands(const u32 *s,u8 *out) {
    u32 ack=s[5]==6,tc=s[0]==2;
    out[0]=s[0]==1&&s[1]==2&&!ack;
    out[1]=!(tc&&(s[5]==1||s[5]==3));out[2]=!(tc&&s[5]==2);
    out[3]=!(tc&&s[5]==4);out[4]=!(tc&&s[5]==5);
    out[5]=!(tc&&ack);out[6]=tc&&ack&&!s[3]&&!s[4];
}
u32 phase_components_version(void){return 1;}
void read_memory_phase_commands(const u32 *s,u8 *out){phase_commands(s,out);}
u32 begin_memory_phase(u32 *s,u32 io,u32 intr,const u8 *in,const u8 *cf,u8 *out,u32 *fault) {
    u32 error=phase_state(s,io,intr,fault);if(error)return error;
    if(s[2])return phase_fault(6,NONE,fault);
    if((error=phase_inputs(in,cf,6,fault)))return error;
    if((error=phase_known(in,cf,0,fault)))return error;
    if(in[0]){s[0]=0;s[1]=1;s[3]=s[4]=s[5]=0;}
    else {
        for(u32 pin=2;pin<6;pin++)if((error=phase_known(in,cf,pin,fault)))return error;
        u32 kind=phase_decode(in);
        if(s[0]==0&&kind!=9) {
            if(kind>6||(kind==6&&!intr)||((kind==4||kind==5)&&!io))return phase_fault(7,kind,fault);
            s[0]=1;s[1]=1;s[5]=kind;s[3]=s[4]=0;
        }else if((s[0]==1&&kind!=s[5])||(s[0]==2&&kind!=9))return phase_fault(8,kind,fault);
    }
    s[2]=1;phase_commands(s,out);fault[0]=0;return 0;
}
/* Preview has no state mutation; saved READY is consumed only by finish. */
u32 preview_memory_phase_end(const u32 *s,const u8 *in,const u8 *cf,u32 *ready,u32 *fault) {
    u32 error=phase_state(s,0,0,fault);if(error)return error;
    if(!s[2])return phase_fault(6,NONE,fault);
    if((error=phase_inputs(in,cf,6,fault)))return error;
    if(s[0]==2&&s[1]==2) {
        if((error=phase_known(in,cf,1,fault)))return error;
        *ready=in[1];
    }else *ready=NONE;
    fault[0]=0;return 0;
}
u32 finish_memory_phase(u32 *s,u32 ready,u8 *out,u8 *present,u32 *fault) {
    u32 error=phase_state(s,0,0,fault);if(error)return error;
    if(ready>1&&ready!=NONE)return phase_fault(4,1,fault);
    if(s[0]==2&&s[1]==2&&s[3]==NONE&&s[4]==0x1fffff)return phase_fault(9,NONE,fault);
    s[2]=0;
    if(s[0]==1) {
        if(s[1]==1)s[1]=2;else{s[0]=2;s[1]=1;}
    }else if(s[0]==2) {
        if(s[1]==2){s[3]++;if(!s[3])s[4]++;}
        if(s[1]==1)s[1]=2;else if(ready==0){s[0]=0;s[1]=1;}else s[1]=1;
    }
    *present=s[0]==0;if(*present)phase_commands(s,out);
    fault[0]=0;return 0;
}
/* ALE,24 address bits,BHE,MIO. Validate every sampled bit before latching. */
u32 update_address_latch(u8 *values,const u8 *in,const u8 *cf,u8 *out,u32 *fault) {
    u32 error=phase_inputs(in,cf,27,fault);if(error)return error;
    if((error=phase_known(in,cf,0,fault)))return error;
    if(in[0]) {
        for(u32 pin=1;pin<27;pin++)if((error=phase_known(in,cf,pin,fault)))return error;
        for(u32 pin=0;pin<26;pin++)values[pin]=in[pin+1];
    }
    for(u32 pin=0;pin<26;pin++)out[pin]=values[pin];
    fault[0]=0;return 0;
}
