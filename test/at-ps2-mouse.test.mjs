import test from 'node:test';
import assert from 'node:assert/strict';
import {AT8042A20} from '../src/at-8042-a20.js';
import Machine,{PCAT80386_EXPERIMENTAL_4M_HDD_FREEDOS_VGA} from '../src/experimental/i80386-at-machine.js';

const send=(controller,command)=>{controller.writeCommand(0xd4);controller.writeData(command);};
const drain=controller=>{const bytes=[];while(controller.readStatus()&1)bytes.push(controller.readData());return bytes;};

test('mouse is absent by default and opt-in aux bytes carry status bit 5 and IRQ12 edges',()=>{
  const absent=new AT8042A20();
  send(absent,0xff);
  assert.equal(absent.readStatus()&1,0);
  assert.equal(absent.injectMouse({dx:1}),false);

  const irq=[];
  const controller=new AT8042A20({mouse:true,onAuxIRQ:active=>irq.push(active)});
  controller.writeCommand(0x60);controller.writeData(3);
  send(controller,0xff);
  assert.equal(controller.readStatus()&0x20,0x20);
  assert.deepEqual(drain(controller),[0xfa,0xaa,0x00]);
  assert.deepEqual(irq.slice(1),[true,false,true,false,true,false]);
  send(controller,0xf2);
  assert.deepEqual(drain(controller),[0xfa,0x00]);
  assert.equal(controller.injectMouse({dx:1}),false);
  send(controller,0xf4);
  assert.deepEqual(drain(controller),[0xfa]);
  assert.equal(controller.injectMouse({dx:5,dy:3,buttons:1}),true);
  assert.deepEqual(drain(controller),[0x29,5,0xfd]);
});

test('mouse commands and checkpoint preserve reporting, parameters and pending aux data',()=>{
  const controller=new AT8042A20({mouse:true});
  controller.writeCommand(0x60);controller.writeData(3);
  send(controller,0xf3);send(controller,80);
  send(controller,0xe8);send(controller,1);
  send(controller,0xf4);
  drain(controller);
  assert.equal(controller.injectMouse({dx:-2,dy:-1,buttons:2}),true);
  const state=controller.getState();
  const restored=new AT8042A20({mouse:true});
  restored.setState(state);
  assert.deepEqual(drain(restored),[0x1a,0xfe,1]);
  send(restored,0xe9);
  assert.deepEqual(drain(restored),[0xfa,0x22,1,80]);
  send(restored,0xf5);drain(restored);
  assert.equal(restored.injectMouse({dx:1}),false);
  assert.throws(()=>new AT8042A20().setState(state),/state is invalid/);
  const corrupted=structuredClone(state);corrupted.mouse.buttons=8;
  assert.throws(()=>restored.setState(corrupted),/mouse state is invalid/);
  restored.writeCommand(0xa7);
  send(restored,0xf4);drain(restored);
  assert.equal(restored.injectMouse({dx:1}),false);
  restored.writeCommand(0xa8);
  send(restored,0xf0);drain(restored);
  assert.equal(restored.injectMouse({dx:1}),false);
  send(restored,0xea);drain(restored);
  assert.equal(restored.injectMouse({dx:1}),true);
  drain(restored);
  restored.reset();
  assert.equal(restored.getState().v,8);
  assert.equal(restored.injectMouse({dx:1}),false);
});

test('opt-in 386 machine routes mouse packets through the slave PIC and retains legacy default',()=>{
  const defaultMachine=new Machine(PCAT80386_EXPERIMENTAL_4M_HDD_FREEDOS_VGA);
  assert.equal(defaultMachine.canTakeMouse(),false);
  const profile=structuredClone(PCAT80386_EXPERIMENTAL_4M_HDD_FREEDOS_VGA);
  profile.a20.mouse=true;
  const machine=new Machine(profile);
  assert.equal(machine.canTakeMouse(),true);
  const controller=machine._a20Controller;
  controller.writeCommand(0x60);controller.writeData(3);
  send(controller,0xf4);drain(controller);
  assert.equal(machine.mouseIn({dx:4,dy:2,buttons:1}),true);
  assert.equal(controller.readStatus()&0x20,0x20);
  assert.equal(machine.chips.pic2.getState().irr&0x10,0x10);
  assert.deepEqual(drain(controller),[0x29,4,0xfe]);
});
