/** Bounded standard three-byte PS/2 mouse, attached to an AT 8042 aux port. */
export class ATPS2Mouse {
    constructor() { this.reset(); }
    reset() {
        this.reporting=false;
        this.remote=false;
        this.scaling21=false;
        this.resolution=2;
        this.sampleRate=100;
        this.buttons=0;
        this.pending=null;
        this.lastReply=0xfa;
    }
    packet(dx=0,dy=0,buttons=this.buttons) {
        if(!Number.isInteger(dx)||!Number.isInteger(dy)||!Number.isInteger(buttons)||
            buttons<0||buttons>7)throw new TypeError('PS/2 mouse input requires integer dx, dy and buttons 0..7');
        // Host +Y is screen-down; the PS/2 wire convention is +Y up.
        const x=Math.max(-255,Math.min(255,dx));
        const y=Math.max(-255,Math.min(255,-dy));
        this.buttons=buttons;
        return [0x08|buttons|(x<0?0x10:0)|(y<0?0x20:0)|
            (dx!==x?0x40:0)|(dy!==-y?0x80:0),x&255,y&255];
    }
    command(value) {
        value&=255;
        let reply=[0xfa];
        if(this.pending!==null) {
            if(this.pending===0xf3)this.sampleRate=value;
            else this.resolution=value&3;
            this.pending=null;
        } else if(value===0xff) { this.reset(); reply=[0xfa,0xaa,0x00]; }
        else if(value===0xf2) reply=[0xfa,0x00];
        else if(value===0xf4)this.reporting=true;
        else if(value===0xf5)this.reporting=false;
        else if(value===0xf6)this.reset();
        else if(value===0xf3||value===0xe8)this.pending=value;
        else if(value===0xe6)this.scaling21=false;
        else if(value===0xe7)this.scaling21=true;
        else if(value===0xea)this.remote=false;
        else if(value===0xf0)this.remote=true;
        else if(value===0xe9)reply=[0xfa,(this.remote?0x40:0)|(this.reporting?0x20:0)|
            (this.scaling21?0x10:0)|this.buttons,this.resolution,this.sampleRate];
        else if(value===0xeb)reply=[0xfa,...this.packet()];
        else if(value===0xfe)reply=[this.lastReply];
        else return null;
        this.lastReply=reply.at(-1);
        return reply;
    }
    getState() { return {reporting:this.reporting,remote:this.remote,scaling21:this.scaling21,
        resolution:this.resolution,sampleRate:this.sampleRate,buttons:this.buttons,
        pending:this.pending,lastReply:this.lastReply}; }
    setState(s) {
        if(!s||typeof s.reporting!=='boolean'||typeof s.remote!=='boolean'||
            typeof s.scaling21!=='boolean'||!Number.isInteger(s.resolution)||s.resolution<0||
            s.resolution>3||!Number.isInteger(s.sampleRate)||s.sampleRate<0||s.sampleRate>255||
            !Number.isInteger(s.buttons)||s.buttons<0||s.buttons>7||
            ![null,0xf3,0xe8].includes(s.pending)||!Number.isInteger(s.lastReply)||
            s.lastReply<0||s.lastReply>255)throw new Error('AT PS/2 mouse state is invalid');
        Object.assign(this,s);
    }
}
