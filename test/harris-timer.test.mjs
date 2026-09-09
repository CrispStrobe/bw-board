import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Harris8254Adapter,HarrisTimerClock} from '../src/experimental/harris-8254-adapter.js';
import {Harris8259Adapter} from '../src/experimental/harris-8259-adapter.js';
import {HarrisBootCPU} from '../src/experimental/harris-80c286-boot-cpu.js';
import {createHarrisMemoryBoard} from '../src/experimental/harris-80c286-memory-board.js';
import {createHarrisBootROM} from '../src/experimental/harris-boot-rom.js';
import {assembleRaw} from '../src/i8086-asm.js';
import {registerBusMemory} from '../src/devices/bus-memory.js';
import {bitPins,bitDrives} from '../src/experimental/digital-circuit.js';
registerBusMemory();
const A=bitPins('a',24),D=bitPins('d',16);
function peer() {
    const timer=new Harris8254Adapter({enabled:true});
    const pins={reset:0,clk0:0,gate0:1,ior_n:1,iow_n:1,bhe_n:1,m_io:0,...bitDrives(A,0x40),...bitDrives(D,0)};
    const update=(changes={})=>{Object.assign(pins,changes);return timer.update(p=>pins[p]);};
    const port=(reg,value=0)=>({...bitDrives(A,0x40+reg),bhe_n:1-(reg&1),...bitDrives(D,value<<((reg&1)*8))});
    const write=(reg,value)=>{update({...port(reg,value),iow_n:0});update({iow_n:1});};
    const tick=()=>{update({clk0:1});return update({clk0:0});};
    const program=(mode,n)=>{write(3,0x30|(mode<<1));write(0,n&255);write(0,n>>8);};
    const read=()=>{const data=update({...port(0),ior_n:0});update({ior_n:1});return D.slice(0,8).reduce((v,p,i)=>v+(data[p]<<i),0);};
    return {timer,pins,update,port,write,tick,program,read};
}
test('timer and independent clock are gated and board rejects missing PIC and conflicting ports',()=>{
    assert.throws(()=>new Harris8254Adapter(),{code:'EXPERIMENT_DISABLED'});
    assert.throws(()=>new HarrisTimerClock(),{code:'EXPERIMENT_DISABLED'});
    assert.throws(()=>new HarrisTimerClock({enabled:true,halfPeriod:0}),RangeError);
    assert.throws(()=>createHarrisMemoryBoard({enabled:true,timerDevice:peer().timer}),/PIC/);
    assert.throws(()=>createHarrisMemoryBoard({enabled:true,intrEnabled:true,ioEnabled:true,
        interruptDevice:new Harris8259Adapter({enabled:true,portBase:0x42}),timerDevice:peer().timer}),{code:'IO_PORT_CONFLICT'});
});
test('mode 2 has a whole low clock, reloads every N clocks, and settle calls do not count',()=>{
    const p=peer();p.program(2,4);assert.equal(p.timer.inspect().loaded,false);
    p.tick();assert.equal(p.timer.inspect().count,4);
    const trace=[];
    for(let i=0;i<8;i++){trace.push([p.tick().out0,p.timer.inspect().count]);for(let j=0;j<5;j++)p.update();}
    assert.deepEqual(trace,[[1,3],[1,2],[0,1],[1,4],[1,3],[1,2],[0,1],[1,4]]);
    assert.equal(p.timer.inspect().ticks,9);
});
test('even mode 3 halves have N/2 ticks and counts decrement by two',()=>{
    for(const n of [2,4,6,64,256]) {
        const p=peer();p.program(3,n);p.tick();
        for(let t=1;t<=n*2;t++) {
            assert.equal(p.tick().out0,1-(Math.floor(t/(n/2))%2));
            assert.equal(p.timer.inspect().count,n-2*(t%(n/2)));
        }
    }
});
test('zero divisor means 65536 and mode 0 reaches terminal count only after load plus N ticks',()=>{
    const p=peer();p.program(0,3);assert.equal(p.tick().out0,0);
    assert.equal(p.tick().out0,0);assert.equal(p.tick().out0,0);assert.equal(p.tick().out0,1);
    const q=peer();q.program(2,0);q.tick();assert.equal(q.timer.inspect().count,65536);
    q.tick();assert.equal(q.timer.inspect().count,65535);
});
test('GATE pauses mode 0 and forces/restarts periodic modes through resolved transitions',()=>{
    const p=peer();p.program(0,4);p.tick();p.update({gate0:0});p.tick();p.tick();assert.equal(p.timer.inspect().count,4);
    p.update({gate0:1});p.tick();assert.equal(p.timer.inspect().count,3);
    for(const mode of [2,3]) {
        const q=peer();q.program(mode,4);q.tick();while(q.timer.inspect().out)q.tick();
        assert.equal(q.update({gate0:0}).out0,1);q.tick();q.tick();
        q.update({gate0:1});q.tick();assert.equal(q.timer.inspect().count,4);assert.equal(q.timer.inspect().out,1);
    }
});
test('LSB/MSB writes commit once at trailing WR; initial load waits for a clock',()=>{
    const p=peer();p.write(3,0x34);p.write(0,0x34);
    for(let i=0;i<8;i++)p.update({...p.port(0,0x12),iow_n:0});
    assert.equal(p.timer.inspect().writes,2);assert.equal(p.timer.inspect().divisor,null);
    p.update({iow_n:1});assert.equal(p.timer.inspect().divisor,0x1234);assert.equal(p.timer.inspect().loaded,false);
    p.tick();assert.equal(p.timer.inspect().count,0x1234);
});
test('latched two-byte reads survive clocks and stretched RD without consuming the next byte',()=>{
    const p=peer();p.program(2,0x1234);p.tick();p.write(3,0);
    for(let i=0;i<10;i++) {
        p.tick();const data=p.update({...p.port(0),ior_n:0});
        assert.equal(D.slice(0,8).reduce((v,p,i)=>v+(data[p]<<i),0),0x34);
    }
    assert.equal(p.timer.inspect().reads,1);p.update({ior_n:1});
    assert.equal(p.read(),0x12);assert.equal(p.timer.inspect().latched,null);
    p.write(3,0);assert.equal(p.read(),0x2a);assert.equal(p.read(),0x12);
});
test('RESET cancels a partial count/write and restarts the divider deterministically',()=>{
    const p=peer();p.write(3,0x34);p.write(0,10);p.update({...p.port(0,0),iow_n:0});
    p.update({reset:1});p.update({reset:0,iow_n:1});assert.equal(p.timer.inspect().divisor,null);assert.equal(p.timer.inspect().configured,false);
    const c=new HarrisTimerClock({enabled:true,halfPeriod:2});
    assert.deepEqual(Array.from({length:8},()=>c.advance(()=>0).clk),[0,1,1,0,0,1,1,0]);
    assert.equal(c.advance(()=>1).clk,0);assert.equal(c.advance(()=>0).clk,0);
});
test('unsupported modes, channels, odd square-wave count, live reload and broken nets fail explicitly',()=>{
    for(const cw of [0x10,0x32,0x38,0x3a,0x35,0x74,0xc2])assert.throws(()=>peer().write(3,cw),{code:'UNSUPPORTED_PIT_MODE'});
    assert.throws(()=>peer().program(3,3),{code:'UNSUPPORTED_PIT_COUNT'});
    assert.throws(()=>peer().program(2,1),{code:'UNSUPPORTED_PIT_COUNT'});
    const p=peer();p.program(2,4);assert.throws(()=>p.write(0,8),{code:'UNSUPPORTED_PIT_RELOAD'});
    assert.throws(()=>peer().write(1,0),{code:'UNSUPPORTED_PIT_CHANNEL'});
    for(const pin of ['clk0','gate0','iow_n'])assert.throws(()=>peer().update({[pin]:'Z'}),{code:'FLOATING'});
    assert.throws(()=>peer().update({iow_n:0,d0:'Z'}),{code:'FLOATING'});
});

function fixture({mode=3,divisor=128,body='STI\nwait: HLT\nCMP BX,3\nJB wait\nCLI\nHLT',handler='INC BX\nMOV AL,20h\nOUT 20h,AL\nIRET',...options}={}) {
    const timer=new Harris8254Adapter({enabled:true}),pic=new Harris8259Adapter({enabled:true}),rom=createHarrisBootROM();
    rom.set(assembleRaw(`MOV SP,0800h
MOV AX,OFFSET irqhandler
MOV [0100h],AX
MOV AX,0F000h
MOV [0102h],AX
MOV AL,${0x30|(mode<<1)}
OUT 43h,AL
MOV AX,${divisor}
OUT 40h,AL
MOV AL,AH
OUT 40h,AL
MOV AL,13h
OUT 20h,AL
MOV AL,40h
OUT 21h,AL
MOV AL,1
OUT 21h,AL
MOV AL,0FEh
OUT 21h,AL
${body}
irqhandler: ${handler}`,0x100),0x100);
    const board=createHarrisMemoryBoard({enabled:true,rom,romLowAlias:true,intrEnabled:true,ioEnabled:true,
        interruptDevice:pic,timerDevice:timer,timerClockHalfPeriod:2,...options});
    const cpu=new HarrisBootCPU({enabled:true,board});cpu.initialize();return {cpu,board,pic,timer};
}
function until(cpu,predicate,max=8000){for(let i=0;i<max;i++){if(predicate())return;cpu.stepClock();}assert.fail('condition not reached');}
const finished=cpu=>cpu.status==='halted'&&cpu.regs.bx===3&&!(cpu.flags&0x200);
for(const mode of [2,3])for(const deviceScheduling of [false,true])test(`guest-programmed timer mode ${mode} repeatedly wakes HLT through PIC and guest EOI (events=${deviceScheduling})`,()=>{
    const {cpu,pic,timer}=fixture({mode,netBackend:deviceScheduling?'compiled':'reference',deviceScheduling});until(cpu,()=>finished(cpu));
    assert.equal(cpu.intrCount,3);assert.equal(pic.inspect().pairs,3);assert.equal(pic.inspect().isr,0);
    assert.equal(cpu.regs.sp,0x800);assert.equal(timer.inspect().divisor,128);
});
for(const deviceScheduling of [false,true])test(`timer counts and changes OUT while CPU waits on READY; interrupts resume after release (events=${deviceScheduling})`,()=>{
    const {cpu,timer,board}=fixture({netBackend:deviceScheduling?'compiled':'reference',deviceScheduling});until(cpu,()=>cpu.status==='halted');
    // HLT itself keeps clocking. Then hold the first interrupt bus request.
    until(cpu,()=>board.bus.pending!==null);
    const retired=cpu.retired,ticks=timer.inspect().ticks;let edges=0,last=timer.inspect().out;
    for(let i=0;i<512;i++){cpu.stepClock(1);const out=timer.inspect().out;edges+=Number(out!==last);last=out;}
    assert.equal(cpu.retired,retired);assert.equal(timer.inspect().ticks-ticks,128);assert.equal(edges,2);
    until(cpu,()=>finished(cpu));assert.equal(cpu.intrCount,3);
});
test('PIC mask blocks timer IRQ delivery while the oscillator continues',()=>{
    const {cpu,timer,pic}=fixture({body:'MOV AL,0FFh\nOUT 21h,AL\nSTI\nHLT'});
    until(cpu,()=>cpu.status==='halted');const ticks=timer.inspect().ticks;
    for(let i=0;i<1200;i++)cpu.stepClock();
    assert.equal(cpu.intrCount,0);assert.equal(pic.inspect().pairs,0);assert.equal(timer.inspect().ticks-ticks,300);
});
test('guest observes masked timer request via IRR, unmasks it, and receives IRQ0',()=>{
    const {cpu,pic}=fixture({body:`MOV AL,0FFh
OUT 21h,AL
STI
pollirq: IN AL,20h
TEST AL,1
JZ pollirq
MOV AL,0FEh
OUT 21h,AL
HLT
HLT`});
    until(cpu,()=>pic.inspect().imr===255);assert.equal(cpu.intrCount,0);
    until(cpu,()=>cpu.status==='halted'&&cpu.regs.bx===1);
    assert.equal(pic.inspect().imr,0xfe);assert.equal(cpu.intrCount,1);assert.equal(pic.inspect().isr,0);
});
test('resolved GATE input suppresses periodic timer interrupts until an external transition',()=>{
    const {cpu,board,timer}=fixture();board.circuit.drive('timer_inputs',{gate0:0});
    until(cpu,()=>cpu.status==='halted');const ticks=timer.inspect().ticks;
    for(let i=0;i<64;i++)cpu.stepClock();
    assert.equal(timer.inspect().ticks-ticks,16);assert.equal(timer.inspect().loaded,false);assert.equal(cpu.intrCount,0);
    board.circuit.drive('timer_inputs',{gate0:1});until(cpu,()=>finished(cpu));
    assert.equal(cpu.intrCount,3);
});
test('disconnected timer clock/output/control wires fail instead of synthesizing IRQs',()=>{
    for(const [from,pin] of [['timer_clock','clk'],['pit','out0'],['controller','iow_n']]) {
        assert.throws(()=>{
            const f=fixture({editWires:w=>w.filter(x=>!(x.from===from&&x.fromTerminal===pin&&(from!=='controller'||x.to==='pit')))});
            until(f.cpu,()=>finished(f.cpu));
        },{code:'FLOATING'});
    }
});
