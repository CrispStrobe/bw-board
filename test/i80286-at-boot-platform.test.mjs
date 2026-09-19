import assert from 'node:assert/strict';
import test from 'node:test';

import { AT8042A20 } from '../src/at-8042-a20.js';
import { ATDMAPageRegisters, ATSystemControl } from '../src/at-system-control.js';
import { I8237 } from '../src/i8237.js';
import { I8086Machine, PCAT80286_BOOT } from '../src/i8086-machine.js';

test('AT DMA page latches are independent and reset controller page state', () => {
    const primary = new I8237();
    const secondary = new I8237();
    const pages = new ATDMAPageRegisters({primary, secondary});

    for(let reg=0;reg<16;reg++)pages.write(reg,0x80+reg);
    assert.deepEqual(Array.from({length:16},(_,reg)=>pages.read(reg)),
        Array.from({length:16},(_,reg)=>0x80+reg));
    assert.equal(primary.channels[2].page,0x81);
    assert.equal(primary.channels[0].page,0x87);
    assert.equal(secondary.channels[2].page,0x89);
    assert.equal(secondary.channels[0].page,0x8f);

    pages.reset();
    assert.deepEqual([...pages.bytes],new Array(16).fill(0));
    assert.deepEqual(primary.channels.map(channel=>channel.page),[0,0,0,0]);
    assert.deepEqual(secondary.channels.map(channel=>channel.page),[0,0,0,0]);
});

test('AT port 61h reports refresh edges and timer-2 output separately', () => {
    const gates=[];
    const control=new ATSystemControl({onTimer2Gate:level=>gates.push(level)});
    control.write(0,3);
    control.setRefresh(true);
    control.setRefresh(true);
    control.setTimer2(true);
    assert.equal(control.read(),0x33);
    control.setRefresh(false);
    control.setRefresh(true);
    assert.equal(control.read(),0x23);
    assert.deepEqual(gates,[false,true]);
});

test('8042 self-test returns 55h while command-byte bit 2 controls system flag', () => {
    let resets=0;
    const controller=new AT8042A20({a20Enabled:true,inputBusyCycles:12,responseDelayCycles:32,
        allowReset:true,onResetRequest:()=>resets++});
    controller.writeCommand(0xaa);
    assert.equal(controller.readStatus()&7,2,'self-test makes the input buffer busy');
    assert.equal(controller.readStatus()&7,2,'polling does not advance controller time');
    controller.advance(11);
    assert.equal(controller.readStatus()&7,2);
    controller.advance(1);
    assert.equal(controller.readStatus()&7,0,'input acceptance precedes output response');
    controller.advance(20);
    assert.equal(controller.readStatus()&5,1,'response becomes available after elapsed cycles');
    const independentlyPolled=new AT8042A20({inputBusyCycles:12,responseDelayCycles:32});
    const unpolled=new AT8042A20({inputBusyCycles:12,responseDelayCycles:32});
    independentlyPolled.writeCommand(0xaa);
    unpolled.writeCommand(0xaa);
    for(let i=0;i<100;i++)independentlyPolled.readStatus();
    independentlyPolled.advance(32);unpolled.advance(32);
    assert.deepEqual(independentlyPolled.getState(),unpolled.getState(),
        'equal elapsed cycles produce equal state regardless of status-read count');
    assert.equal(controller.readData(),0x55);
    controller.writeCommand(0x60);controller.writeData(controller.commandByte&~4);
    assert.equal(controller.readStatus()&4,0,'command-byte system flag is visible in status');
    controller.writeCommand(0x60);controller.writeData(controller.commandByte|4);
    assert.equal(controller.readStatus()&4,4);
    controller.writeCommand(0xe0);controller.advance(32);
    assert.equal(controller.readData(),3,'E0 reports idle-high keyboard clock and data inputs');
    controller.writeCommand(0xad);controller.writeCommand(0xe0);controller.advance(32);
    assert.equal(controller.readData(),2,'E0 reports disabled clock and idle-high data input');
    controller.writeCommand(0xfe);
    assert.equal(resets,1);
    assert.equal(controller.readStatus()&4,4);
    assert.equal(controller.outputPort&3,3,'CPU reset request does not disable A20');
});

test('machine checkpoint preserves an in-flight timed 8042 response', () => {
    const config={clockHz:6_000_000,memoryBytes:1<<20,
        a20:{controller:'8042',inputBusyCycles:12,responseDelayCycles:32},
        regions:[{kind:'ram',start:0,end:0xfffff}],chips:[]};
    const machine=new I8086Machine(config);
    machine._a20Controller.writeCommand(0xaa);
    machine._a20Controller.advance(7);
    const checkpoint=machine.saveState();
    machine._a20Controller.advance(25);
    assert.equal(machine._a20Controller.readStatus()&1,1);
    machine.loadState(checkpoint);
    assert.equal(machine._a20Controller.readStatus()&7,2);
    machine._a20Controller.advance(25);
    assert.equal(machine._a20Controller.readStatus()&5,1);
});

test('keyboard power-on and FF reset BAT bytes follow configured cycle deadlines', () => {
    const irq=[];
    const controller=new AT8042A20({powerOnKeyboardBatCycles:4_200_000,
        keyboardAckCycles:60_000,keyboardBatCycles:4_200_000,onIRQ:level=>irq.push(level)});
    controller.writeCommand(0x60);controller.writeData(1);
    controller.writeCommand(0xae);
    assert.equal(controller.keyboardSchedule.length,1,'AE does not synthesize another BAT');
    for(let i=0;i<20;i++)controller.readStatus();
    controller.advance(4_199_999);
    assert.equal(controller.readStatus()&1,0);
    controller.advance(1);
    assert.equal(controller.readData(),0xaa);
    controller.writeData(0xff);
    controller.writeCommand(0xad);
    controller.advance(59_999);
    const saved=controller.getState();
    const restored=new AT8042A20({powerOnKeyboardBatCycles:4_200_000,
        keyboardAckCycles:60_000,keyboardBatCycles:4_200_000,onIRQ:()=>{}});
    restored.setState(saved);
    assert.deepEqual(restored.getState(),saved);
    assert.equal(controller.readStatus()&1,0);
    controller.advance(1);
    assert.equal(controller.readStatus()&1,0,'disabled interface holds a due keyboard ACK');
    assert.equal(controller.nextWake(),Infinity,'held byte cannot create a zero-cycle wake loop');
    controller.writeCommand(0xae);
    assert.equal(controller.readData(),0xfa);
    controller.advance(4_140_000);
    assert.equal(controller.readData(),0xaa);
    assert.deepEqual(irq,[false,true,false,true,false,true,false]);
});

test('second-pass AT page windows participate in I/O conflict validation', () => {
    const config={clockHz:6_000_000,regions:[{kind:'ram',start:0,end:0xfffff}],chips:[
        {kind:'dma',name:'dma1',at:0x00},{kind:'dma',name:'dma2',at:0xc0,stride:2},
        {kind:'atdmapage',name:'pages',at:0x80,primary:'dma1',secondary:'dma2'},
        {kind:'pic',name:'overlap',at:0x88},
    ]};
    assert.throws(()=>new I8086Machine(config),/"overlap" and "pages" both claim I\/O address 88h/);
    config.chips.pop();config.chips[2].at=0x60;
    config.a20={controller:'8042'};
    assert.throws(()=>new I8086Machine(config),/8042 A20 controller conflicts.*"pages"/);
    config.chips[2].at=0x62;config.chips[2].span=1;
    assert.doesNotThrow(()=>new I8086Machine(config));
});

test('boot profile separates 16MiB address space from one MiB installed RAM', () => {
    const machine=new I8086Machine(PCAT80286_BOOT);
    assert.equal(machine.mem.length,16<<20);
    assert.equal(machine._read(0x70000),0);
    assert.equal(machine._read(0x90000),0xff);
    assert.equal(machine._read(0x100000),0);
    assert.equal(machine._read(0x180000),0xff);
    assert(machine.chips.cga1);
    assert(machine.chips.fdc1);
    assert.deepEqual(Array.from(machine.chips.rtc1.ram.slice(0x10,0x19)),
        [0x20,0,0,0,0x21,0,2,0,2]);
    const checksum=machine.chips.rtc1.ram.slice(0x10,0x21).reduce((sum,value)=>(sum+value)&0xffff,0);
    assert.equal(checksum,(machine.chips.rtc1.ram[0x2e]<<8)|machine.chips.rtc1.ram[0x2f]);
    assert.throws(()=>machine.chips.dma2.transfer(()=>0,()=>{}),/secondary DMA transfer is unsupported/);
});

test('8042 reset is applied after OUT completes and preserves board state', () => {
    const machine=new I8086Machine(PCAT80286_BOOT);
    // Reset vector: MOV AL,FEh; OUT 64h,AL. A following HLT must never execute.
    machine.loadRom(Uint8Array.from([0xb0,0xfe,0xe6,0x64,0xf4]),0xfffff0);
    machine.mem[0x1234]=0x5a;
    machine.chips.rtc1.ram[0x0f]=2;
    machine.reset();
    machine._a20Controller.writeCommand(0xaa);
    machine._a20Controller.advance(32);
    machine._a20Controller.readData();
    machine._a20Controller.writeCommand(0x60);
    machine._a20Controller.writeData(4);
    const before=machine.cycles;

    machine.step();
    machine.step();

    assert.equal(machine._cpuResetPending,false);
    assert.equal(machine.cpu.cs,0xf000);
    assert.equal(machine.cpu.ip,0xfff0);
    assert.equal(machine.cpu.halted,false);
    assert.equal(machine.mem[0x1234],0x5a);
    assert.equal(machine.chips.rtc1.ram[0x0f],2);
    assert.equal(machine.a20Enabled,true);
    assert.equal(machine._a20Controller.readStatus()&4,4);
    assert(machine.cycles>before,'warm CPU reset keeps machine time monotonic');
});
