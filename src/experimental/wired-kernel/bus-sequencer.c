/* Owned, standalone, ideal-system-period memory bus subset. No CPU or RAM.
 * Private instance state; raw ABI is trusted internal input, not a snapshot API.
 * Input codes: 0/1/X=2/Z=3; private bridge code 4 means resolved contention.
 * Sampling order matches Harris80C286Bus. */
#include <stdint.h>
typedef uint32_t u32;
typedef uint64_t u64;
enum { REQUIRED, RESET, INIT, TI, TS, TC };
enum { OK, ORDER, OVERFLOW, FLOATING, UNKNOWN, FAULTED, NEED_RESET,
       SHORT_RESET, HOLD, INPUT, WAIT_LIMIT, UNAVAILABLE, TRANSACTION, CONTENTION };
enum { I_RESET, I_HOLD, I_PEREQ, I_INTR, I_NMI, I_BUSY, I_ERROR, I_READY, I_DATA };
typedef struct {u32 kind,address,width,data,a0,bhe;} Transfer;
static struct {
    u32 state,phase,open,faulted,init,write_hold,address,bhe,s1,s0,cod,mio;
    u32 period_state,period_phase,period_held,has_pending,index,count,byte_count;
    u32 bytes[2],held[16];
    u64 clock,reset,max_wait,waits;
    Transfer transfers[2];
} b;
static u32 inputs[24], outputs[48], output_changes[2], completion[9], error_pin, first_outputs;
u32 bus_sequencer_version(void) {return 1;}
u32 bus_input_ptr(void) {return (u32)(uintptr_t)inputs;}
u32 bus_output_ptr(void) {return (u32)(uintptr_t)outputs;}
u32 bus_output_change_word(u32 word) {return word<2?output_changes[word]:0;}
u32 bus_completion_ptr(void) {return (u32)(uintptr_t)completion;}
u32 bus_error_pin(void) {return error_pin;}
static u32 known(u32 pin) {
    error_pin=pin;
    return inputs[pin]<2 ? OK : inputs[pin]==3 ? FLOATING : inputs[pin]==4 ? CONTENTION : UNKNOWN;
}
static u32 fault(u32 code) {b.faulted=1;return code;}
void bus_initialize(double maximum) {
    unsigned char *p=(unsigned char *)&b;
    for(u32 i=0;i<sizeof(b);i++) p[i]=0;
    b.max_wait=(u64)maximum;b.phase=1;b.address=0xffffff;b.bhe=b.s1=b.s0=1;
    for(u32 i=0;i<16;i++)b.held[i]=3;
    for(u32 i=0;i<48;i++)outputs[i]=3;
    output_changes[0]=output_changes[1]=0;first_outputs=1;
    for(u32 i=0;i<9;i++)completion[i]=0;
}
static void set_output(u32 pin,u32 value) {
    /* Compare raw driver codes against the last successful final image. */
    if(first_outputs||outputs[pin]!=value)output_changes[pin>>5]|=1u<<(pin&31);
    outputs[pin]=value;
}
static Transfer transfer(u32 kind,u32 address,u32 width,u32 value) {
    Transfer t={kind,address,width,width==1&&(address&1)?value<<8:value,address&1,
        width==2||(address&1)?0:1};return t;
}
u32 bus_submit(u32 kind,double address,u32 width,double value,u32 locked) {
    if(b.faulted||b.open||b.has_pending||b.state!=TI)return UNAVAILABLE;
    if(kind>2||locked||address!=address||value!=value||address<0||address>0xffffff||address!=(double)(u32)address||
       (width!=1&&width!=2)||address+width-1>0xffffff||value<0||
       value>=(width==1?256:65536)||value!=(double)(u32)value)return TRANSACTION;
    u32 a=(u32)address,v=(u32)value;
    b.count=width==2&&(a&1)?2:1;
    b.transfers[0]=transfer(kind,a,b.count==2?1:width,b.count==2?v&255:v);
    if(b.count==2)b.transfers[1]=transfer(kind,a+1,1,v>>8);
    b.has_pending=1;b.index=0;b.byte_count=0;b.waits=0;return OK;
}
u32 bus_begin(void) {
    if(b.open)return ORDER;
    if(b.clock>=9007199254740991ULL)return OVERFLOW;
    u32 e=known(I_RESET);if(e)return fault(e);
    u32 reset=inputs[I_RESET];
    if(reset) {
        if(b.state!=RESET||b.faulted)b.reset=0;
        b.state=RESET;b.phase=1;b.has_pending=0;b.write_hold=0;
        b.address=0xffffff;b.bhe=b.s1=b.s0=1;b.cod=b.mio=0;b.faulted=0;
    } else {
        if(b.faulted)return fault(FAULTED);
        if(b.state==REQUIRED)return fault(NEED_RESET);
        if(b.state==RESET) {
            if(b.reset<17)return fault(SHORT_RESET);
            b.state=INIT;b.init=50;b.phase=1;
        }
    }
    e=known(I_HOLD);if(e)return fault(e);
    if(inputs[I_HOLD])return fault(HOLD);
    if(!reset) {
        for(u32 pin=I_PEREQ;pin<=I_NMI;pin++) {
            e=known(pin);if(e)return fault(e);
            if(inputs[pin]){error_pin=pin;return fault(INPUT);}
        }
        for(u32 pin=I_BUSY;pin<=I_ERROR;pin++) {
            e=known(pin);if(e)return fault(e);
            if(!inputs[pin]){error_pin=pin;return fault(INPUT);}
        }
    }
    if(b.state==TI&&b.phase==1&&b.has_pending) {
        Transfer *t=&b.transfers[b.index];b.state=TS;b.address=t->address;
        b.bhe=t->bhe;b.s1=t->kind==2?1:0;b.s0=t->kind==2?0:1;b.cod=t->kind==1;b.mio=1;
    }
    output_changes[0]=output_changes[1]=0;
    for(u32 i=0;i<24;i++)set_output(i,(b.address>>i)&1);
    Transfer *active=b.has_pending&&b.transfers[b.index].kind==2&&
        (b.state==TC||(b.state==TS&&b.phase==2))?&b.transfers[b.index]:0;
    for(u32 i=0;i<16;i++) {
        u32 value=b.write_hold?b.held[i]:3;
        if(active)value=(i<8?active->a0!=0:active->bhe!=0)?3:(active->data>>i)&1;
        set_output(24+i,value);
    }
    b.period_state=b.state;b.period_phase=b.phase;b.period_held=b.write_hold>0;
    set_output(40,b.bhe);set_output(41,b.state==TS?b.s1:1);set_output(42,b.state==TS?b.s0:1);
    set_output(43,b.cod);set_output(44,b.mio);
    set_output(45,1);set_output(46,0);set_output(47,1);first_outputs=0;b.open=1;return OK;
}
u32 bus_end(void) {
    if(!b.open)return ORDER;
    b.open=0;b.clock++;completion[0]=0;
    u32 state=b.period_state,phase=b.period_phase;
    if(b.period_held)b.write_hold--;
    if(state==RESET)b.reset++;
    else if(state==INIT) {if(--b.init==0){b.state=TI;b.phase=2;}}
    else if(state==TS&&phase==2)b.state=TC;
    else if(state==TC&&phase==2) {
        u32 e=known(I_READY);if(e)return fault(e);
        if(inputs[I_READY]) {if(++b.waits>=b.max_wait)return fault(WAIT_LIMIT);}
        else {
            Transfer *t=&b.transfers[b.index];u32 bytes[2],count=0;
            for(u32 start=0;start<16;start+=8) {
                if(start==0?t->a0!=0:t->bhe!=0)continue;
                u32 byte=0;
                for(u32 i=0;i<8;i++){e=known(I_DATA+start+i);if(e)return fault(e);byte|=inputs[I_DATA+start+i]<<i;}
                bytes[count++]=byte;
            }
            completion[0]=1;completion[1]=t->kind;completion[2]=t->address;completion[3]=t->width;
            completion[4]=bytes[0]|(count==2?bytes[1]<<8:0);
            completion[5]=(u32)b.waits;completion[6]=(u32)(b.waits>>32);
            completion[7]=b.index==b.count-1;
            for(u32 i=0;i<count;i++)b.bytes[b.byte_count++]=bytes[i];
            if(t->kind==2){b.write_hold=1;for(u32 i=0;i<16;i++)b.held[i]=outputs[24+i];}
            if(completion[7]){completion[8]=b.bytes[0]|(b.byte_count==2?b.bytes[1]<<8:0);b.has_pending=0;}
            else{b.index++;b.waits=0;}
            b.state=TI;
        }
    }
    if(state!=RESET)b.phase=b.phase==1?2:1;
    return OK;
}
double bus_inspect(u32 field) {
    switch(field) {
    case 0:return b.state;case 1:return b.phase;case 2:return b.open;case 3:return b.faulted;
    case 4:return (double)b.clock;case 5:return (double)b.reset;case 6:return b.init;
    case 7:return b.write_hold;case 8:return b.address;case 9:return b.has_pending;
    case 10:return b.index;case 11:return (double)b.waits;case 12:return b.byte_count;
    case 13:return b.bytes[0];case 14:return b.bytes[1];case 15:return b.count;
    default:return 0;
    }
}
