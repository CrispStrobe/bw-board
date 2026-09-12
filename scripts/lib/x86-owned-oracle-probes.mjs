// Project-owned architectural probes, not copied upstream test programs.
// No interrupts, protected mode, timing, REP, I/O or undefined opcodes yet.
const common=['8086','80186','80286'];
export const OWNED_ORACLE_PROBES=[
    {name:'mov-word',bytes:[0xb8,0x34,0x12]},
    {name:'add-overflow',bytes:[0x01,0xd8],regs:{ax:0x7fff,bx:1}},
    {name:'adc-carry',bytes:[0x11,0xd8],regs:{ax:0xffff,bx:0,flags:3}},
    {name:'sub-borrow',bytes:[0x29,0xd8],regs:{ax:0,bx:1}},
    {name:'sbb-borrow',bytes:[0x19,0xd8],regs:{ax:0,bx:0xffff,flags:3}},
    {name:'inc-preserves-carry',bytes:[0x40],regs:{ax:0x7fff,flags:3}},
    {name:'dec-preserves-carry',bytes:[0x48],regs:{ax:0x8000,flags:3}},
    {name:'cmp-no-write',bytes:[0x39,0xd8],regs:{ax:1,bx:2}},
    {name:'xor-word',bytes:[0x31,0xd8],regs:{ax:0xaaaa,bx:0x5555},flagsMask:0xfc5,maskReason:'AF is undefined after XOR'},
    {name:'odd-word-store',bytes:[0xa3,0x01,0x20],regs:{ax:0xbeef}},
    {name:'indexed-word-load',bytes:[0x8b,0x42,0x03],regs:{bp:0x2000,si:4},ram:[[0x2007,0x78],[0x2008,0x56]]},
    {name:'memory-xchg',bytes:[0x87,0x06,0x01,0x20],regs:{ax:0x1234},ram:[[0x2001,0xcd],[0x2002,0xab]]},
    {name:'push-word',bytes:[0x50],regs:{ax:0xcafe}},
    {name:'pop-word',bytes:[0x58],ram:[[0x8000,0xcd],[0x8001,0xab]]},
    {name:'near-call',bytes:[0xe8,0x10,0x00]},
    {name:'short-taken-branch',bytes:[0x74,0x10],regs:{flags:0x42}},
    {name:'loop-taken',bytes:[0xe2,0xfe],regs:{cx:2}},
    {name:'move-byte',bytes:[0xa4],regs:{si:0x2000,di:0x3000},ram:[[0x2000,0xa5]]},
    {name:'push-immediate-sign',bytes:[0x6a,0x80],models:['80186','80286']},
    {name:'pusha',bytes:[0x60],models:['80186','80286'],regs:{ax:1,bx:2,cx:3,dx:4,bp:5,si:6,di:7}},
    {name:'enter-frame',bytes:[0xc8,0x08,0x00,0x00],models:['80186','80286'],regs:{bp:0x7000}},
    {name:'neg-word',bytes:[0xf7,0xd8],regs:{ax:0x8000}},
    {name:'not-preserves-flags',bytes:[0xf7,0xd0],regs:{ax:0x1234,flags:0x8d7}},
    {name:'cbw-negative',bytes:[0x98],regs:{ax:0x1280}},
    {name:'cwd-negative',bytes:[0x99],regs:{ax:0x8000,dx:0x1234}},
    {name:'lea-does-not-read-memory',bytes:[0x8d,0x42,0xfd],regs:{bp:0x2000,si:4}},
    {name:'load-es-pointer',bytes:[0xc4,0x06,0x00,0x20],ram:[[0x2000,0x78],[0x2001,0x56],[0x2002,0x34],[0x2003,0x12]]},
    {name:'load-ds-pointer',bytes:[0xc5,0x06,0x00,0x20],ram:[[0x2000,0xcd],[0x2001,0xab],[0x2002,0x12],[0x2003,0x34]]},
    {name:'rotate-left-one',bytes:[0xd1,0xc0],regs:{ax:0x8001,flags:0xd7}},
    {name:'rotate-through-carry-one',bytes:[0xd1,0xd0],regs:{ax:0x8000,flags:3}},
    {name:'shift-left-one',bytes:[0xd1,0xe0],regs:{ax:0x8001},flagsMask:0xfc5,maskReason:'AF is undefined after SHL; one-bit OF is defined'},
    {name:'shift-arithmetic-right-one',bytes:[0xd1,0xf8],regs:{ax:0x8001},flagsMask:0xfc5,maskReason:'AF is undefined after SAR; one-bit OF is defined'},
    {name:'multiply-unsigned-word',bytes:[0xf7,0xe3],regs:{ax:0x8000,bx:2},flagsMask:0xf01,maskReason:'MUL defines CF/OF; SF/ZF/AF/PF are undefined'},
    {name:'multiply-signed-word',bytes:[0xf7,0xeb],regs:{ax:0xfffd,bx:7},flagsMask:0xf01,maskReason:'IMUL defines CF/OF; SF/ZF/AF/PF are undefined'},
    {name:'divide-unsigned-word',bytes:[0xf7,0xf3],regs:{ax:0x2345,dx:1,bx:17},flagsMask:0x700,maskReason:'DIV leaves arithmetic status flags undefined; compare control flags'},
    {name:'divide-signed-word',bytes:[0xf7,0xfb],regs:{ax:0xffef,dx:0xffff,bx:3},flagsMask:0x700,maskReason:'IDIV leaves arithmetic status flags undefined; compare control flags'},
    {name:'store-word-backward',bytes:[0xab],regs:{ax:0xbeef,di:0x3001,flags:0x402}},
    {name:'load-word-forward',bytes:[0xad],regs:{si:0x2001},ram:[[0x2001,0xfe],[0x2002,0xca]]},
    {name:'compare-byte-backward',bytes:[0xa6],regs:{si:0x2000,di:0x3000,flags:0x402},ram:[[0x2000,1],[0x3000,2]]},
    {name:'scan-word',bytes:[0xaf],regs:{ax:0xbeef,di:0x3001},ram:[[0x3001,0xef],[0x3002,0xbe]]},
    {name:'sahf-preserves-control-overflow',bytes:[0x9e],regs:{ax:0xd500,flags:0xe02}},
    {name:'lahf-defined-status',bytes:[0x9f],regs:{ax:0x0034,flags:0x8d7}},
    {name:'leave-frame',bytes:[0xc9],models:['80186','80286'],regs:{bp:0x7000},ram:[[0x7000,0x34],[0x7001,0x12]]},
].map(p=>Object.freeze({models:common,regs:{},ram:[],flagsMask:0xfd5,...p}));

export function probeInitial(probe) {
    const regs={ax:0,bx:0,cx:0,dx:0,sp:0x8000,bp:0,si:0,di:0,cs:0,ds:0,ss:0,es:0,ip:0x100,flags:2,...probe.regs};
    const ram=[...probe.bytes.map((v,i)=>[regs.cs*16+regs.ip+i,v]),...probe.ram];
    return {regs,ram};
}
