/* Owned ideal-digital SRAM/EEPROM bridge prototype, not an analog solver.
 * State words: cycle, address, output(-1), armed, pending, pending address,
 * pending byte, write-count low/high. Inputs: VCC,GND,OE,WE,SELECT,A0..14,D0..7.
 * The caller supplies disjoint, bounded arrays in its private module arena. */
typedef unsigned int u32;
typedef unsigned char u8;
#define WORDS 9
#define PINS 28
#define SIZE 32768
#define NONE 0xffffffffu
static u32 fail_memory(u32 code,u32 bank,u32 pin,u32 *fault) {
    fault[0]=code;fault[1]=bank;fault[2]=pin;return code;
}
static u32 known_memory(u8 level,u8 conflict,u32 bank,u32 pin,u32 *fault,u8 *value) {
    if(level<2){*value=level;return 0;}
    return fail_memory(level==3?1:conflict?3:2,bank,pin,fault);
}
u32 memory_kernel_version(void){return 1;}
u32 preview_memory_banks(u32 banks,u8 *memory,u32 *states,u32 *staged,const u8 *protected_rom,
                        const u8 *inputs,const u8 *conflicts,u8 *staged_drives,
                        u8 *staged_present,u8 *staged_changed,u32 *fault) {
    if(!banks||banks>32)return fail_memory(8,0,NONE,fault);
    for(u32 b=0;b<banks;b++) {
        if(protected_rom[b]>1)return fail_memory(9,b,NONE,fault);
        for(u32 p=0;p<PINS;p++)if(inputs[b*PINS+p]>3||conflicts[b*PINS+p]>1||(conflicts[b*PINS+p]&&inputs[b*PINS+p]!=2))
            return fail_memory(5,b,p,fault);
        const u32 *s=states+b*WORDS;
        if(s[0]>3||s[1]>=SIZE||(s[2]>255&&s[2]!=NONE)||s[3]>1||s[4]>1||s[5]>=SIZE||s[6]>255||s[8]>0x1fffff)
            return fail_memory(6,b,NONE,fault);
    }
    /* Preflight and preview every bank. No actual state/byte/net-drive commit
     * occurs here; the output buffers are private preview staging as well. */
    for(u32 b=0;b<banks;b++) {
        const u8 *in=inputs+b*PINS,*cf=conflicts+b*PINS;const u32 *s=states+b*WORDS;u32 *n=staged+b*WORDS;
        for(u32 w=0;w<WORDS;w++)n[w]=s[w];
        staged_changed[b]=0;staged_present[b]=1;
        u8 power,oe,we,select=1,bit;u32 error;
        if((error=known_memory(in[0],cf[0],b,0,fault,&power)))return error;
        if(power!=1)return fail_memory(4,b,0,fault);
        if((error=known_memory(in[1],cf[1],b,1,fault,&power)))return error;
        if(power!=0)return fail_memory(4,b,1,fault);
        if((error=known_memory(in[2],cf[2],b,2,fault,&oe)))return error;
        if((error=known_memory(in[3],cf[3],b,3,fault,&we)))return error;
        if((oe!=1||we!=1)&&(error=known_memory(in[4],cf[4],b,4,fault,&select)))return error;
        u32 active=select==0;
        if(!active&&s[0]==1){staged_present[b]=0;continue;}
        u32 address=0,byte=0;
        if(active)for(u32 p=0;p<15;p++) {
            if((error=known_memory(in[5+p],cf[5+p],b,5+p,fault,&bit)))return error;
            address|=(u32)bit<<p;
        }
        if(active&&!we)for(u32 p=0;p<8;p++) {
            if((error=known_memory(in[20+p],cf[20+p],b,20+p,fault,&bit)))return error;
            byte|=(u32)bit<<p;
        }
        u32 cycle=!active?1:!we?3:!oe?2:1;
        if(cycle!=s[0]) {
            n[0]=cycle;n[1]=address;n[2]=NONE;n[4]=n[5]=n[6]=0;
            if(cycle!=3)n[3]=1;
            if(s[0]==3&&s[3]&&s[4]&&!protected_rom[b]) {
                if(s[7]==NONE&&s[8]==0x1fffff)return fail_memory(7,b,NONE,fault);
                n[7]++;if(!n[7])n[8]++;
            }
            staged_changed[b]=1;
        }else if(cycle==1) {
            n[1]=address;n[3]=1;
            if(n[2]!=NONE){n[2]=NONE;staged_changed[b]=1;}
        }else if(cycle==3) {
            n[1]=address;n[4]=1;n[5]=address;n[6]=byte;
        }else {
            byte=memory[b*SIZE+address];
            if(s[1]!=address||s[2]!=byte){n[1]=address;n[2]=byte;staged_changed[b]=1;}
        }
        for(u32 p=0;p<8;p++)staged_drives[b*8+p]=n[2]==NONE?3:(n[2]>>p)&1;
    }
    /* Commit the old pending bytes only after all peer previews succeeded. */
    for(u32 b=0;b<banks;b++) {
        u32 *s=states+b*WORDS,*n=staged+b*WORDS;
        if(s[0]==3&&n[0]!=3&&s[3]&&s[4]&&!protected_rom[b])memory[b*SIZE+s[5]]=(u8)s[6];
        for(u32 w=0;w<WORDS;w++)s[w]=n[w];
    }
    fault[0]=0;return 0;
}
