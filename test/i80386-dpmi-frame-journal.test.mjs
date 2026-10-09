import assert from 'node:assert/strict';
import test from 'node:test';
import I80386, { I80386Fault, UnsupportedI80386 } from '../src/experimental/i80386.js';

const START = 0x20;
const CODE = 0x140000;
const HANDLER = 0x100000;
const MIXED_PROFILE = 'gate14-code16-stack32-same-cpl3.v1';

function fixture({ onRead = null } = {}) {
  const memory = new Map();
  const cpu = new I80386({
    read: address => {
      onRead?.(cpu, address);
      return memory.get(address >>> 0) ?? 0;
    },
    fetch: address => memory.get(address >>> 0) ?? 0,
    write: (address, value) => memory.set(address >>> 0, value & 255),
  });
  const put = (address, bytes) => bytes.forEach((value, index) =>
    memory.set((address + index) >>> 0, value & 255));
  const descriptor = (base, access) =>
    [255, 255, base, base >>> 8, base >>> 16, access, 0xcf, base >>> 24]
      .map(value => value & 255);
  const gate = (offset, selector, type = 14) =>
    [offset, offset >>> 8, selector, selector >>> 8, 0,
      0xe0 | type, offset >>> 16, offset >>> 24]
      .map(value => value & 255);
  cpu.cr0 = 1;
  cpu.gdtr = { base: 0x200, limit: 0x2f };
  cpu.idtr = { base: 0x300, limit: 0x1ff };
  cpu.tr = { selector: 0x30, base: 0x600, limit: 0x67, present: true, type: 11 };
  put(0x208, descriptor(HANDLER, 0x9a));
  put(0x210, descriptor(0x120000, 0x92));
  put(0x218, descriptor(CODE, 0xfa));
  put(0x220, descriptor(0x160000, 0xf2));
  put(0x604, [0, 4, 0, 0, 0x10, 0]);
  put(0x300 + 0x31 * 8, gate(0x100, 8));
  cpu.cs = 0x1b;
  cpu.ss = 0x23;
  cpu.esp = 0x800;
  cpu.eip = START;
  cpu.eflags = 0x202;
  cpu.segmentCaches[1] = cpu._ringCodeDescriptor(0x1b);
  cpu.segmentCaches[2] = cpu._ringStackDescriptor(0x23, 3, { returnPath: true });
  cpu.ax = 0x0501;
  cpu.bx = 0;
  cpu.cx = 4096;
  put(CODE + START, [0xcd, 0x31, 0xf4]);
  put(HANDLER + 0x100, [0xcf]);
  const arm = (extra = {}) => cpu.armOwned0501FrameJournal({
    cs: 0x1b, startEip: START, endEip: START + 3,
    maxActiveSteps: 10, ...extra,
  });
  return { cpu, memory, put, arm };
}

test('decoded owned 0501 delivery and matching IRETD publish one copied pair', () => {
  const f = fixture();
  const token = f.arm();
  assert.equal(f.cpu.owned0501FrameStatus(token).phase, 'armed');
  assert.equal(f.cpu.step(), 1);
  assert.equal(f.cpu.owned0501FrameStatus(token).phase, 'open');
  assert.equal(f.cpu.takeOwned0501FrameObservation(token), null);
  assert.equal(f.cpu.eip, 0x100);
  assert.equal(f.cpu.esp, 0x3ec);
  f.cpu.bx = 0x49;
  f.cpu.cx = 0x1234;
  assert.equal(f.cpu.step(), 1);
  assert.equal(f.cpu.owned0501FrameStatus(token).phase, 'complete');
  const result = f.cpu.takeOwned0501FrameObservation(token);
  assert.deepEqual([result.phase, result.entry.instructionStart,
    result.entry.returnEip, result.entry.returnCs, result.entry.returnSs,
    result.entry.returnEsp, result.entry.oldCpl, result.entry.newCpl],
    ['complete', START, START + 2, 0x1b, 0x23, 0x800, 3, 0]);
  assert.deepEqual([result.entry.handlerCs, result.entry.handlerEip,
    result.entry.handlerSs, result.entry.handlerEsp, result.entry.frameBytes],
    [8, 0x100, 0x10, 0x3ec, 20]);
  assert.deepEqual([result.returned.consumedEip, result.returned.returnedCs,
    result.returned.returnedSs, result.returned.returnedEsp,
    result.returned.returnedBx, result.returned.returnedCx],
    [START + 2, 0x1b, 0x23, 0x800, 0x49, 0x1234]);
  assert.throws(() => f.cpu.owned0501FrameStatus(token), /stale/);
});

test('opt-in gate32 code16 stack32 same-CPL3 records decoded 32-bit IRET', () => {
  const f = fixture();
  // Ring-3 handler code with D=0; the gate remains type 14 and width 32.
  f.memory.set(0x208 + 5, 0xfa);
  f.memory.set(0x208 + 6, 0x8f);
  f.put(0x300 + 0x31 * 8, [0, 1, 0x0b, 0, 0, 0xee, 0, 0]);
  f.put(HANDLER + 0x100, [0x66, 0xcf]);
  const token = f.arm({profile:MIXED_PROFILE});
  assert.equal(f.cpu.step(), 1);
  assert.equal(f.cpu.owned0501FrameStatus(token).phase, 'open');
  assert.equal(f.cpu.segmentCaches[1].default32, false);
  assert.equal(f.cpu.esp, 0x7f4);
  f.cpu.bx=0x49; f.cpu.cx=0x1234;
  assert.equal(f.cpu.step(), 1);
  const result=f.cpu.takeOwned0501FrameObservation(token);
  assert.deepEqual([result.phase,result.profile,result.entry.profile,
    result.entry.gateType,result.entry.frameBytes,result.entry.oldCpl,
    result.entry.newCpl,result.returned.width,result.returned.profile],
    ['complete',MIXED_PROFILE,MIXED_PROFILE,14,12,3,3,32,MIXED_PROFILE]);
});

test('mixed profile preserves the guest fault from 16-bit IRET on a 32-bit frame', () => {
  const f=fixture();
  f.memory.set(0x208 + 5, 0xfa);
  f.memory.set(0x208 + 6, 0x8f);
  f.put(0x300 + 0x31 * 8, [0, 1, 0x0b, 0, 0, 0xee, 0, 0]);
  const token=f.arm({profile:MIXED_PROFILE});
  f.cpu.step();
  assert.equal(f.cpu.owned0501FrameStatus(token).phase,'open');
  assert.throws(() => f.cpu.step(), error =>
    error instanceof I80386Fault && error.vector === 13 &&
    error.message === 'IRET return privilege');
  const result=f.cpu.takeOwned0501FrameObservation(token);
  assert.equal(result.phase,'invalid');
  assert.equal(result.failure,'unsupported-owned-iret');
  assert.equal(result.returned,null);
});

test('mixed handler descriptor change invalidates only observation', () => {
  const f=fixture();
  f.memory.set(0x208+5,0xfa);
  f.memory.set(0x208+6,0x8f);
  f.put(0x300+0x31*8,[0,1,0x0b,0,0,0xee,0,0]);
  f.put(HANDLER+0x100,[0x66,0xcf]);
  const token=f.arm({profile:MIXED_PROFILE});
  f.cpu.step();
  const cache=f.cpu.segmentCaches[1];
  cache.access ^= 2;
  f.cpu.step();
  const result=f.cpu.takeOwned0501FrameObservation(token);
  assert.equal(result.failure,'owned-handler-context-excursion');
  assert.equal(result.returned,null);
  assert.equal(f.cpu.cs,0x1b); // original IRET still restored the caller
});

test('mixed observer descriptor read failure cannot throw into guest IRET', () => {
  const f=fixture();
  f.memory.set(0x208+5,0xfa);
  f.memory.set(0x208+6,0x8f);
  f.put(0x300+0x31*8,[0,1,0x0b,0,0,0xee,0,0]);
  f.put(HANDLER+0x100,[0x66,0xcf]);
  const token=f.arm({profile:MIXED_PROFILE});
  f.cpu.step();
  Object.defineProperty(f.cpu.segmentCaches[1],'address',{
    get(){throw new Error('observer-only address read');},configurable:true});
  assert.equal(f.cpu.step(),1);
  const result=f.cpu.takeOwned0501FrameObservation(token);
  assert.equal(result.failure,'observer-handler-context-failure');
  assert.equal(result.returned,null);
  assert.equal(f.cpu.cs,0x1b);
});

test('mixed handler mutation during IRET frame read cannot earn a pair', () => {
  let duringIret=false, changed=false;
  const f=fixture({onRead(cpu,address){
    if(duringIret && !changed && address>=0x1607f4 && address<0x160800){
      cpu.segmentCaches[1].access ^= 2;
      changed=true;
    }
  }});
  f.memory.set(0x208+5,0xfa);
  f.memory.set(0x208+6,0x8f);
  f.put(0x300+0x31*8,[0,1,0x0b,0,0,0xee,0,0]);
  f.put(HANDLER+0x100,[0x66,0xcf]);
  const token=f.arm({profile:MIXED_PROFILE});
  f.cpu.step();
  assert.equal(f.cpu.owned0501FrameStatus(token).phase,'open');
  duringIret=true;
  f.cpu.step();
  assert.equal(changed,true);
  const result=f.cpu.takeOwned0501FrameObservation(token);
  assert.equal(result.failure,'owned-handler-context-excursion');
  assert.equal(result.returned,null);
  assert.equal(f.cpu.cs,0x1b);
});

test('mixed live handler-cache replacement during IRET frame read is refused', () => {
  let duringIret=false,changed=false;
  const f=fixture({onRead(cpu,address){
    if(duringIret && !changed && address>=0x1607f4 && address<0x160800){
      cpu.segmentCaches[1]={...cpu.segmentCaches[1]};
      changed=true;
    }
  }});
  f.memory.set(0x208+5,0xfa);
  f.memory.set(0x208+6,0x8f);
  f.put(0x300+0x31*8,[0,1,0x0b,0,0,0xee,0,0]);
  f.put(HANDLER+0x100,[0x66,0xcf]);
  const token=f.arm({profile:MIXED_PROFILE});
  f.cpu.step();
  duringIret=true;
  f.cpu.step();
  assert.equal(changed,true);
  const result=f.cpu.takeOwned0501FrameObservation(token);
  assert.equal(result.failure,'owned-handler-context-excursion');
  assert.equal(result.returned,null);
  assert.equal(f.cpu.cs,0x1b);
});

test('mixed profile refuses trap gate and outer-CPL delivery', () => {
  for (const gateByte of [0xef,0xee]) {
    const f=fixture();
    if(gateByte===0xef){
      f.memory.set(0x208+5,0xfa);
      f.memory.set(0x208+6,0x8f);
    }
    f.put(0x300+0x31*8,[0,1,gateByte===0xef?0x0b:8,0,0,gateByte,0,0]);
    const token=f.arm({profile:MIXED_PROFILE});
    f.cpu.step();
    const result=f.cpu.takeOwned0501FrameObservation(token);
    assert.equal(result.failure,'unsupported-owned-delivery');
    assert.equal(result.entry,null);
  }
});

test('mixed profile refuses gate16 and same-CPL stack16 after guest delivery', () => {
  for(const variant of ['gate16','stack16']){
    const f=fixture();
    f.memory.set(0x208+5,0xfa);
    f.memory.set(0x208+6,0x8f);
    if(variant==='stack16'){
      f.memory.set(0x220+6,0x8f);
      f.cpu.segmentCaches[2]=f.cpu._ringStackDescriptor(0x23,3,
        {returnPath:true});
    }
    f.put(0x300+0x31*8,[0,1,0x0b,0,0,
      variant==='gate16'?0xe6:0xee,0,0]);
    const token=f.arm({profile:MIXED_PROFILE});
    assert.equal(f.cpu.step(),1);
    const result=f.cpu.takeOwned0501FrameObservation(token);
    assert.equal(result.failure,'unsupported-owned-delivery');
    assert.equal(result.entry,null);
    assert.equal(result.rejectedDelivery.width,variant==='gate16'?16:32);
    assert.equal(result.rejectedDelivery.handlerStackDefault32,
      variant==='gate16');
  }
});

test('prefix-derived post-immediate return EIP is recorded, not guessed', () => {
  const f = fixture();
  f.put(CODE + START, [0x66, 0x66, 0xcd, 0x31]);
  const token = f.arm({ endEip: START + 4 });
  f.cpu.step();
  assert.equal(f.cpu.owned0501FrameStatus(token).phase, 'open');
  f.cpu.step();
  assert.equal(f.cpu.takeOwned0501FrameObservation(token).entry.returnEip,
    START + 4);
});

test('a decoded immediate crossing the admitted wrapper end is refused', () => {
  const f = fixture();
  f.put(CODE + START, [0x66, 0x66, 0xcd, 0x31]);
  const token = f.arm({ endEip: START + 3 });
  f.cpu.step();
  assert.equal(f.cpu.takeOwned0501FrameObservation(token).failure,
    'owned-0501-instruction-profile');
});

test('a 32-bit gate with a 16-bit handler stack is excluded after delivery', () => {
  const f = fixture();
  f.memory.set(0x210 + 6, 0x8f);
  f.put(0x604, [0, 4, 1, 0, 0x10, 0]);
  const token = f.arm();
  f.cpu.step();
  assert.deepEqual([f.cpu.cs, f.cpu.eip], [8, 0x100]);
  const observation = f.cpu.takeOwned0501FrameObservation(token);
  assert.equal(observation.failure, 'unsupported-owned-delivery');
  assert.equal(observation.entry, null);
  assert.deepEqual([observation.rejectedDelivery.schema,
    observation.rejectedDelivery.source, observation.rejectedDelivery.vector,
    observation.rejectedDelivery.gateType, observation.rejectedDelivery.width,
    observation.rejectedDelivery.handlerCodeDefault32,
    observation.rejectedDelivery.handlerStackDefault32,
    observation.rejectedDelivery.frameKind,
    observation.rejectedDelivery.frameBytes],
  ['bw.i80386-owned-0501.delivery-rejection.v1',
    'owned-intent-delivery-attempt', 0x31, 14, 32, true, false, 'inner', 20]);
  assert.equal(Object.isFrozen(observation.rejectedDelivery), true);
});

test('a 32-bit gate into 16-bit handler code is not a protected32 frame', () => {
  const f = fixture();
  f.memory.set(0x208 + 6, 0x8f);
  const token = f.arm();
  f.cpu.step();
  const observation = f.cpu.takeOwned0501FrameObservation(token);
  assert.equal(observation.failure, 'unsupported-owned-delivery');
  assert.deepEqual([observation.rejectedDelivery.gateType,
    observation.rejectedDelivery.width,
    observation.rejectedDelivery.handlerCodeDefault32,
    observation.rejectedDelivery.handlerStackDefault32], [14, 32, false, true]);
});

test('a successful 16-bit gate effect records width but no frame entry', () => {
  const f = fixture();
  f.put(0x300 + 0x31 * 8, [0, 1, 8, 0, 0, 0xe6, 0, 0]);
  const token = f.arm();
  assert.equal(f.cpu.step(), 1);
  const observation = f.cpu.takeOwned0501FrameObservation(token);
  assert.deepEqual([observation.failure, observation.entry,
    observation.rejectedDelivery.gateType,
    observation.rejectedDelivery.width],
  ['unsupported-owned-delivery', null, 6, 16]);
});

test('rejected delivery at the active-step cap cannot publish a diagnostic', () => {
  const f = fixture();
  f.put(CODE + START, [0x90, 0xcd, 0x31]);
  f.memory.set(0x208 + 6, 0x8f);
  const token = f.arm({ maxActiveSteps: 1 });
  assert.equal(f.cpu.step(), 1);
  assert.equal(f.cpu.owned0501FrameStatus(token).activeSteps, 1);
  assert.equal(f.cpu.step(), 1);
  const observation = f.cpu.takeOwned0501FrameObservation(token);
  assert.equal(observation.failure, 'unsupported-owned-delivery');
  assert.equal(observation.rejectedDelivery, null);
});

test('post-delivery step exception cannot publish staged rejection facts', () => {
  const f = fixture();
  f.memory.set(0x208 + 6, 0x8f);
  const token = f.arm();
  const instruction = f.cpu._stepInstruction.bind(f.cpu);
  const fault = new Error('test host interruption after delivery');
  f.cpu._stepInstruction = () => { instruction(); throw fault; };
  assert.throws(() => f.cpu.step(), error => error === fault);
  const observation = f.cpu.takeOwned0501FrameObservation(token);
  assert.equal(observation.failure, 'unsupported-owned-delivery');
  assert.equal(observation.rejectedDelivery, null);
});

test('zero-result enclosing step does not publish rejected-delivery facts', () => {
  const f = fixture();
  f.memory.set(0x208 + 6, 0x8f);
  const token = f.arm();
  const instruction = f.cpu._stepInstruction.bind(f.cpu);
  f.cpu._stepInstruction = () => { instruction(); return 0; };
  assert.equal(f.cpu.step(), 0);
  const observation = f.cpu.takeOwned0501FrameObservation(token);
  assert.equal(observation.failure, 'unsupported-owned-delivery');
  assert.equal(observation.rejectedDelivery, null);
});

test('reset revokes a completed rejection receipt without replacing first failure', () => {
  const f = fixture();
  f.memory.set(0x208 + 6, 0x8f);
  const token = f.arm();
  assert.equal(f.cpu.step(), 1);
  assert.equal(f.cpu.owned0501FrameStatus(token).failure,
    'unsupported-owned-delivery');
  f.cpu.reset();
  const observation = f.cpu.takeOwned0501FrameObservation(token);
  assert.equal(observation.failure, 'unsupported-owned-delivery');
  assert.equal(observation.rejectedDelivery, null);
});

test('rejection-record failure leaves delivered guest frame intact', () => {
  const f = fixture();
  f.memory.set(0x208 + 6, 0x8f);
  const token = f.arm();
  const freeze = Object.freeze;
  Object.freeze = value => {
    if (value?.schema === 'bw.i80386-owned-0501.delivery-rejection.v1')
      throw new Error('observer');
    return freeze(value);
  };
  try {
    assert.equal(f.cpu.step(), 1);
  } finally {
    Object.freeze = freeze;
  }
  assert.deepEqual([f.cpu.cs, f.cpu.eip, f.cpu.ss, f.cpu.esp],
    [8, 0x100, 0x10, 0x3ec]);
  const observation = f.cpu.takeOwned0501FrameObservation(token);
  assert.equal(observation.failure, 'unsupported-owned-delivery');
  assert.equal(observation.rejectedDelivery, null);
});

test('swallowed recorder reentry cancels a post-effect rejection receipt', () => {
  const f = fixture();
  f.memory.set(0x208 + 6, 0x8f);
  const token = f.arm();
  const freeze = Object.freeze;
  let reentered = false;
  Object.freeze = value => {
    if (!reentered && value?.schema ===
        'bw.i80386-owned-0501.delivery-rejection.v1') {
      reentered = true;
      assert.equal(f.cpu.owned0501FrameStatus(token).phase, 'invalid');
    }
    return freeze(value);
  };
  try {
    assert.equal(f.cpu.step(), 1);
  } finally {
    Object.freeze = freeze;
  }
  assert.equal(reentered, true);
  const observation = f.cpu.takeOwned0501FrameObservation(token);
  assert.equal(observation.failure, 'unsupported-owned-delivery');
  assert.equal(observation.rejectedDelivery, null);
});

test('direct protected-delivery helper during recording cancels stale facts', () => {
  const f = fixture();
  f.memory.set(0x208 + 6, 0x8f);
  const token = f.arm();
  const freeze = Object.freeze;
  let direct = false;
  Object.freeze = value => {
    if (!direct && value?.schema ===
        'bw.i80386-owned-0501.delivery-rejection.v1') {
      direct = true;
      try {
        f.cpu._deliverProtected(0x31, f.cpu.eip, null, { software: true });
      } catch { // Either guest-visible effect or original helper refusal cancels.
      }
    }
    return freeze(value);
  };
  try {
    assert.equal(f.cpu.step(), 1);
  } finally {
    Object.freeze = freeze;
  }
  assert.equal(direct, true);
  const observation = f.cpu.takeOwned0501FrameObservation(token);
  assert.equal(observation.failure, 'unsupported-owned-delivery');
  assert.equal(observation.rejectedDelivery, null);
});

test('wrong request, rejected gate, and direct delivery cannot mint a pair', () => {
  const wrong = fixture();
  wrong.cpu.cx = 4095;
  const wrongToken = wrong.arm();
  wrong.cpu.step();
  assert.equal(wrong.cpu.takeOwned0501FrameObservation(wrongToken).phase,
    'invalid');

  const denied = fixture();
  denied.put(0x300 + 0x31 * 8,
    [0x00, 0x01, 0x08, 0x00, 0, 0x8e, 0, 0]);
  const deniedToken = denied.arm();
  assert.throws(() => denied.cpu.step());
  assert.equal(denied.cpu.takeOwned0501FrameObservation(deniedToken).phase,
    'invalid');

  const direct = fixture();
  const directToken = direct.arm();
  direct.cpu._deliver(0x31, START + 2, null, { software: true });
  assert.equal(direct.cpu.owned0501FrameStatus(directToken).phase, 'armed');
});

test('reset and first-arm callback reentry cannot pair across epochs', () => {
  const f = fixture();
  const token = f.arm();
  f.cpu.step();
  f.cpu.reset();
  assert.equal(f.cpu.takeOwned0501FrameObservation(token).failure, 'cpu-reset');

  let attempted = false, duringStep = false;
  const reentrant = fixture({ onRead: cpu => {
    if (duringStep && !attempted) {
      attempted = true;
      assert.equal(cpu.owned0501FrameStatus(Object.freeze({})).phase, 'invalid');
      assert.equal(cpu.takeOwned0501FrameObservation(Object.freeze({})), null);
      assert.equal(cpu.armOwned0501FrameJournal({
        cs: 0x1b, startEip: START, endEip: START + 3,
        maxActiveSteps: 10,
      }), null);
    }
  } });
  duringStep = true;
  reentrant.cpu.step();
  assert.equal(attempted, true);
  const later = reentrant.arm();
  assert.equal(reentrant.cpu.owned0501FrameStatus(later).phase, 'armed');
});

test('admission getter reentry refuses outer arm before it creates a session', () => {
  const f = fixture();
  const options = { cs: 0x1b, startEip: START, endEip: START + 3,
    maxActiveSteps: 10 };
  const hostile = new Proxy(options, {
    getOwnPropertyDescriptor(target, key) {
      if (key === 'startEip')
        assert.equal(f.cpu.armOwned0501FrameJournal(options), null);
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  assert.throws(() => f.cpu.armOwned0501FrameJournal(hostile), /admission/);
});

test('completed pair is invalidated by reset before consumption', () => {
  const f = fixture();
  const token = f.arm();
  f.cpu.step();
  f.cpu.step();
  assert.equal(f.cpu.owned0501FrameStatus(token).phase, 'complete');
  f.cpu.reset();
  assert.equal(f.cpu.takeOwned0501FrameObservation(token).phase, 'invalid');
});

test('reset preserves the first invalid reason and partial entry', () => {
  const f = fixture();
  const token = f.arm({ maxActiveSteps: 1 });
  f.cpu.step();
  f.cpu.step();
  assert.equal(f.cpu.owned0501FrameStatus(token).failure, 'active-step-cap');
  f.cpu.reset();
  const result = f.cpu.takeOwned0501FrameObservation(token);
  assert.equal(result.failure, 'active-step-cap');
  assert.equal(result.entry.returnEip, START + 2);
});

test('a public shadow property cannot disable private active-session accounting', () => {
  const f = fixture();
  const token = f.arm();
  f.cpu._owned0501JournalActive = false;
  f.cpu.step();
  f.cpu._owned0501JournalActive = true;
  f.cpu.step();
  assert.equal(f.cpu.takeOwned0501FrameObservation(token).phase, 'complete');
});

test('a task-switch attempt while a selected frame is open invalidates it', () => {
  const f = fixture();
  const token = f.arm();
  f.cpu.step();
  const before = f.cpu._snapshotInstruction();
  assert.throws(() => f.cpu._taskSwitch(0, 'jmp'), I80386Fault);
  assert.deepEqual(f.cpu._snapshotInstruction(), before);
  const result = f.cpu.takeOwned0501FrameObservation(token);
  assert.equal(result.failure, 'task-switch-during-owned-frame');
  assert.equal(result.entry.source, 'decoded-software-int31');
  assert.equal(result.returned, null);
  assert.deepEqual(result.taskSwitchAttempt, {
    schema: 'bw.i80386-owned-0501.task-switch-attempt.v1',
    kind: 'jmp', selector: 0, sourceCs: 8, attemptEip: 0x100,
    sourceCpl: 0, nt: false, trSelector: 0x30, trType: 11,
    activeSteps: 1,
  });
  assert.equal(Object.isFrozen(result.taskSwitchAttempt), true);
  assert.deepEqual(result.taskSwitchOutcome, {
    schema: 'bw.i80386-owned-0501.task-switch-outcome.v1',
    status: 'fault-without-taskCommitted', postCs: 8, postEip: 0x100,
    postCpl: 0, postVm86: false, postNt: false, postTrSelector: 0x30,
    postTrType: 11, activeSteps: 1,
  });
  assert.equal(Object.isFrozen(result.taskSwitchOutcome), true);
});

test('mixed same-CPL handler retains one attempted-task fact without return credit', () => {
  const f = fixture();
  f.memory.set(0x208 + 5, 0xfa);
  f.memory.set(0x208 + 6, 0x8f);
  f.put(0x300 + 0x31 * 8, [0, 1, 0x0b, 0, 0, 0xee, 0, 0]);
  const token = f.arm({ profile: MIXED_PROFILE });
  assert.equal(f.cpu.step(), 1);
  assert.throws(() => f.cpu._taskSwitch(0, 'call'), I80386Fault);
  const result = f.cpu.takeOwned0501FrameObservation(token);
  assert.equal(result.phase, 'invalid');
  assert.equal(result.failure, 'task-switch-during-owned-frame');
  assert.equal(result.returned, null);
  assert.deepEqual([result.taskSwitchAttempt.kind,
    result.taskSwitchAttempt.selector, result.taskSwitchAttempt.sourceCs,
    result.taskSwitchAttempt.attemptEip, result.taskSwitchAttempt.sourceCpl,
    result.taskSwitchAttempt.profile],
    ['call', 0, 0x0b, 0x100, 3, MIXED_PROFILE]);
  assert.equal(result.taskSwitchOutcome.status, 'fault-without-taskCommitted');
});

test('task-switch diagnostic never invokes an accessor or changes first refusal', () => {
  const f = fixture();
  const token = f.arm();
  assert.equal(f.cpu.step(), 1);
  let reads = 0;
  Object.defineProperty(f.cpu.tr, 'type', {
    configurable: true,
    get() { reads++; throw new Error('diagnostic getter'); },
  });
  assert.throws(() => f.cpu._taskSwitch(0, 'jmp'), I80386Fault);
  assert.equal(reads, 0);
  const result = f.cpu.takeOwned0501FrameObservation(token);
  assert.equal(result.failure, 'task-switch-during-owned-frame');
  assert.equal(result.taskSwitchAttempt, undefined);
  assert.equal(result.taskSwitchOutcome, undefined);
  assert.equal(result.entry.source, 'decoded-software-int31');
});

test('NT task-return attempt keeps the original TSS fault and first refusal', () => {
  const f = fixture();
  const token = f.arm();
  assert.equal(f.cpu.step(), 1);
  f.cpu.eflags |= 0x4000;
  assert.throws(() => f.cpu._taskSwitch(0, 'iret'), error =>
    error instanceof I80386Fault && error.vector === 10);
  const result = f.cpu.takeOwned0501FrameObservation(token);
  assert.equal(result.phase, 'invalid');
  assert.equal(result.failure, 'task-switch-during-owned-frame');
  assert.equal(result.returned, null);
  assert.deepEqual([result.taskSwitchAttempt.kind,
    result.taskSwitchAttempt.selector, result.taskSwitchAttempt.nt,
    result.taskSwitchAttempt.trSelector, result.taskSwitchAttempt.activeSteps],
    ['iret', 0, true, 0x30, 1]);
  assert.equal(result.taskSwitchOutcome.status, 'fault-without-taskCommitted');
});

test('external task fault keeps original error mutation and records no marker', () => {
  const f = fixture();
  const token = f.arm();
  assert.equal(f.cpu.step(), 1);
  assert.throws(() => f.cpu._taskSwitch(0, 'jmp', { external: true }), error =>
    error instanceof I80386Fault && error.vector === 13 &&
    error.errorCode === 1);
  const result = f.cpu.takeOwned0501FrameObservation(token);
  assert.equal(result.failure, 'task-switch-during-owned-frame');
  assert.equal(result.taskSwitchOutcome.status, 'fault-without-taskCommitted');
  assert.equal(result.returned, null);
});

test('synthetic core return records post-task primitives without frame credit', () => {
  const f = fixture();
  const token = f.arm();
  assert.equal(f.cpu.step(), 1);
  const core = f.cpu._taskSwitchCore;
  f.cpu._taskSwitchCore = function (selector, kind, options) {
    assert.throws(() => core.call(this, selector, kind, options), I80386Fault);
    this.cs = 0x23;
    this.eip = 0x1234;
    this.eflags |= 0x4000;
    this.tr = { selector: 0x48, type: 11 };
    return 7;
  };
  assert.equal(f.cpu._taskSwitch(0, 'jmp'), 7);
  const result = f.cpu.takeOwned0501FrameObservation(token);
  assert.equal(result.failure, 'task-switch-during-owned-frame');
  assert.deepEqual(result.taskSwitchOutcome, {
    schema: 'bw.i80386-owned-0501.task-switch-outcome.v1',
    status: 'core-return', postCs: 0x23, postEip: 0x1234,
    postCpl: 3, postVm86: false, postNt: true, postTrSelector: 0x48,
    postTrType: 11, activeSteps: 1,
  });
  assert.equal(result.returned, null);
});

test('synthetic taskCommitted fault remains the same thrown object', () => {
  const f = fixture();
  const token = f.arm();
  assert.equal(f.cpu.step(), 1);
  const core = f.cpu._taskSwitchCore;
  const fault = new I80386Fault(10, 0x48, 'synthetic post-marker fault');
  fault.taskCommitted = true;
  f.cpu._taskSwitchCore = function (selector, kind, options) {
    assert.throws(() => core.call(this, selector, kind, options), I80386Fault);
    this.tr = { selector: 0x48, type: 11 };
    throw fault;
  };
  assert.throws(() => f.cpu._taskSwitch(0, 'jmp'), error => error === fault);
  const result = f.cpu.takeOwned0501FrameObservation(token);
  assert.equal(result.failure, 'task-switch-during-owned-frame');
  assert.equal(result.taskSwitchOutcome.status, 'fault-with-taskCommitted');
  assert.equal(result.taskSwitchOutcome.postTrSelector, 0x48);
  assert.equal(result.returned, null);
});

test('synthetic VM86 core return reports CPL3 even with ring-zero CS bits', () => {
  const f = fixture();
  const token = f.arm();
  assert.equal(f.cpu.step(), 1);
  const core = f.cpu._taskSwitchCore;
  f.cpu._taskSwitchCore = function (selector, kind, options) {
    assert.throws(() => core.call(this, selector, kind, options), I80386Fault);
    this.cs = 0x20;
    this.eip = 0x4321;
    this.eflags |= 0x20000;
    return 5;
  };
  assert.equal(f.cpu._taskSwitch(0, 'jmp'), 5);
  const result = f.cpu.takeOwned0501FrameObservation(token);
  assert.equal(result.failure, 'task-switch-during-owned-frame');
  assert.equal(result.taskSwitchOutcome.status, 'core-return');
  assert.deepEqual([result.taskSwitchOutcome.postCs,
    result.taskSwitchOutcome.postVm86, result.taskSwitchOutcome.postCpl],
    [0x20, true, 3]);
  assert.equal(result.returned, null);
});

test('task outcome refuses mode accessors without changing the guest fault', () => {
  const f = fixture();
  const token = f.arm();
  assert.equal(f.cpu.step(), 1);
  const core = f.cpu._taskSwitchCore;
  let reads = 0;
  f.cpu._taskSwitchCore = function (selector, kind, options) {
    try { return core.call(this, selector, kind, options); }
    catch (error) {
      Object.defineProperty(this, '_retainedRealCs', {
        configurable: true,
        get() { reads++; throw new Error('mode accessor'); },
      });
      throw error;
    }
  };
  assert.throws(() => f.cpu._taskSwitch(0, 'jmp'), I80386Fault);
  assert.equal(reads, 0);
  const result = f.cpu.takeOwned0501FrameObservation(token);
  assert.equal(result.failure, 'task-switch-during-owned-frame');
  assert.equal(result.taskSwitchOutcome, undefined);
});

test('unsupported task fault with an own marker is distinguished from completion', () => {
  const f = fixture();
  const token = f.arm();
  assert.equal(f.cpu.step(), 1);
  const core = f.cpu._taskSwitchCore;
  const fault = new UnsupportedI80386('synthetic marked task refusal');
  fault.taskCommitted = true;
  f.cpu._taskSwitchCore = function (selector, kind, options) {
    assert.throws(() => core.call(this, selector, kind, options), I80386Fault);
    throw fault;
  };
  assert.throws(() => f.cpu._taskSwitch(0, 'jmp'), error => error === fault);
  const result = f.cpu.takeOwned0501FrameObservation(token);
  assert.equal(result.failure, 'task-switch-during-owned-frame');
  assert.equal(result.taskSwitchOutcome.status, 'fault-with-taskCommitted');
  assert.equal(result.returned, null);
});

test('unclassified null throw cannot be mistaken for a normal core return', () => {
  const f = fixture();
  const token = f.arm();
  assert.equal(f.cpu.step(), 1);
  const core = f.cpu._taskSwitchCore;
  f.cpu._taskSwitchCore = function (selector, kind, options) {
    assert.throws(() => core.call(this, selector, kind, options), I80386Fault);
    throw null;
  };
  let caught = Symbol('not thrown');
  try { f.cpu._taskSwitch(0, 'jmp'); } catch (error) { caught = error; }
  assert.equal(caught, null);
  const result = f.cpu.takeOwned0501FrameObservation(token);
  assert.equal(result.failure, 'task-switch-during-owned-frame');
  assert.equal(result.taskSwitchOutcome.status, 'unclassified-throw');
  assert.equal(result.returned, null);
});

test('task outcome refuses an accessor marker and swallowed nested wrapper', () => {
  const f = fixture();
  const token = f.arm();
  assert.equal(f.cpu.step(), 1);
  const core = f.cpu._taskSwitchCore;
  let reads = 0;
  const fault = new I80386Fault(10, 0x48, 'synthetic accessor fault');
  Object.defineProperty(fault, 'taskCommitted', {
    get() { reads++; throw new Error('marker getter'); },
  });
  f.cpu._taskSwitchCore = function (selector, kind, options) {
    assert.throws(() => core.call(this, selector, kind, options), I80386Fault);
    throw fault;
  };
  assert.throws(() => f.cpu._taskSwitch(0, 'jmp'), error => error === fault);
  assert.equal(reads, 0);
  let result = f.cpu.takeOwned0501FrameObservation(token);
  assert.equal(result.failure, 'task-switch-during-owned-frame');
  assert.equal(result.taskSwitchOutcome, undefined);

  const nested = fixture();
  const nestedToken = nested.arm();
  assert.equal(nested.cpu.step(), 1);
  const nestedCore = nested.cpu._taskSwitchCore;
  let entered = false;
  nested.cpu._taskSwitchCore = function (selector, kind, options) {
    if (!entered) {
      entered = true;
      assert.throws(() => this._taskSwitch(0, 'jmp'), I80386Fault);
    }
    return nestedCore.call(this, selector, kind, options);
  };
  assert.throws(() => nested.cpu._taskSwitch(0, 'jmp'), I80386Fault);
  result = nested.cpu.takeOwned0501FrameObservation(nestedToken);
  assert.equal(result.failure, 'task-switch-during-owned-frame');
  assert.equal(result.taskSwitchOutcome, undefined);
});

test('disabled journal leaves original invalid task-switch fault untouched', () => {
  const f = fixture();
  assert.throws(() => f.cpu._taskSwitch(0, 'jmp'), error =>
    error instanceof I80386Fault && error.vector === 13);
  assert.equal(Object.hasOwn(f.cpu, 'taskSwitchAttempt'), false);
  assert.equal(Object.hasOwn(f.cpu, 'taskSwitchOutcome'), false);
});

function openedMixedExcursion() {
  const f = fixture();
  f.memory.set(0x208 + 5, 0xfa);
  f.memory.set(0x208 + 6, 0x8f);
  f.put(0x300 + 0x31 * 8, [0, 1, 0x0b, 0, 0, 0xee, 0, 0]);
  f.put(HANDLER + 0x100, [0x66, 0xcf]);
  const frameToken = f.arm({ profile: MIXED_PROFILE });
  assert.equal(f.cpu.step(), 1);
  assert.equal(f.cpu.owned0501FrameStatus(frameToken).phase, 'open');
  const excursionToken = f.cpu.armOwned0501TaskExcursion(frameToken);
  assert.ok(excursionToken);
  return { ...f, frameToken, excursionToken };
}

function openedMixedMode() {
  const f = fixture();
  f.memory.set(0x208 + 5, 0xfa);
  f.memory.set(0x208 + 6, 0x8f);
  f.put(0x300 + 0x31 * 8, [0, 1, 0x0b, 0, 0, 0xee, 0, 0]);
  f.put(HANDLER + 0x100, [0x66, 0xcf]);
  const frameToken = f.arm({ profile: MIXED_PROFILE });
  assert.equal(f.cpu.step(), 1);
  assert.equal(f.cpu.owned0501FrameStatus(frameToken).phase, 'open');
  const modeToken = f.cpu.armOwned0501TaskMode(frameToken);
  assert.ok(modeToken);
  return { ...f, frameToken, modeToken };
}

test('mode arm ignores overridden public excursion method and prior session', () => {
  const f = fixture();
  f.memory.set(0x208 + 5, 0xfa);
  f.memory.set(0x208 + 6, 0x8f);
  f.put(0x300 + 0x31 * 8, [0, 1, 0x0b, 0, 0, 0xee, 0, 0]);
  f.put(HANDLER + 0x100, [0x66, 0xcf]);
  const frameToken = f.arm({ profile: MIXED_PROFILE });
  assert.equal(f.cpu.step(), 1);
  let invoked = 0;
  f.cpu.armOwned0501TaskExcursion = () => { invoked++; return {}; };
  const modeToken = f.cpu.armOwned0501TaskMode(frameToken);
  assert.ok(modeToken);
  assert.equal(invoked, 0);
  assert.equal(f.cpu.owned0501TaskModeStatus(modeToken).phase, 'observing');
  assert.throws(() => f.cpu.armOwned0501TaskMode(frameToken), /consume prior/);
  assert.equal(f.cpu.owned0501TaskModeStatus(modeToken).phase, 'observing');
});

test('mode arm checks reentry after its final source reflection', () => {
  const f = fixture();
  f.memory.set(0x208 + 5, 0xfa);
  f.memory.set(0x208 + 6, 0x8f);
  f.put(0x300 + 0x31 * 8, [0, 1, 0x0b, 0, 0, 0xee, 0, 0]);
  f.put(HANDLER + 0x100, [0x66, 0xcf]);
  const frameToken = f.arm({ profile: MIXED_PROFILE });
  assert.equal(f.cpu.step(), 1);
  const originalTr = f.cpu.tr;
  let reflected = 0, nested = 0;
  f.cpu.tr = new Proxy(originalTr, {
    getOwnPropertyDescriptor(target, key) {
      if (++reflected === 21) {
        try { f.cpu.owned0501TaskModeStatus({}); }
        catch { nested++; }
      }
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  assert.throws(() => f.cpu.armOwned0501TaskMode(frameToken), /changed/);
  assert.equal(nested, 1);
  assert.ok(reflected >= 21);
  assert.equal(f.cpu.owned0501FrameStatus(frameToken).phase, 'open');
  f.cpu.tr = originalTr;
  const token = f.cpu.armOwned0501TaskMode(frameToken);
  assert.ok(token);
});

test('mode arm never coerces malformed primitive data', () => {
  const f = fixture();
  f.memory.set(0x208 + 5, 0xfa);
  f.memory.set(0x208 + 6, 0x8f);
  f.put(0x300 + 0x31 * 8, [0, 1, 0x0b, 0, 0, 0xee, 0, 0]);
  f.put(HANDLER + 0x100, [0x66, 0xcf]);
  const frameToken = f.arm({ profile: MIXED_PROFILE });
  assert.equal(f.cpu.step(), 1);
  let invoked = 0;
  f.cpu.cr0 = { valueOf() { invoked++; return 1; } };
  assert.throws(() => f.cpu.armOwned0501TaskMode(frameToken),
    /invalid source-owned task excursion context/);
  assert.equal(invoked, 0);
});

test('separate mode profile records committed decoded MOV CR0, not frame return', () => {
  const f = openedMixedMode();
  assert.throws(() => f.cpu.takeOwned0501TaskExcursionObservation(f.modeToken),
    /task mode/);
  // A prior committed task transfer can enter CPL0. This test supplies only
  // that source-visible post-state; the hosted guest must prove the transfer.
  f.cpu._stepInstruction = function () {
    this.cs = 0x18; this.eip = 0x120; return 1;
  };
  assert.equal(f.cpu.step(), 1);
  f.cpu.eax = 0;
  f.cpu._fetch8 = (() => { const bytes = [0x22, 0xc0];
    return () => bytes.shift(); })();
  f.cpu._stepInstruction = function () {
    this._step0f(false, null, 32); return 1;
  };
  assert.equal(f.cpu.step(), 1);
  const status = f.cpu.owned0501TaskModeStatus(f.modeToken);
  assert.equal(status.phase, 'observing');
  assert.equal(status.modeChanges, 1);
  f.cpu.abortOwned0501TaskMode(f.modeToken, 'observer-step-bound');
  const observed = f.cpu.takeOwned0501TaskModeObservation(f.modeToken);
  assert.equal(observed.schema, 'bw.i80386-owned-0501.task-mode-diagnostic.v1');
  assert.equal(observed.modeChanges[0].operation.kind, 'decoded-mov-cr0');
  assert.deepEqual([observed.modeChanges[0].before.mode,
    observed.modeChanges[0].after.mode], ['protected', 'pe-clear']);
  assert.equal(observed.modeChanges[0].enclosingStepCommitted, true);
  assert.equal(observed.frameReturnQualified, false);
  assert.equal(f.cpu.owned0501FrameStatus(f.frameToken).phase, 'invalid');
});

test('mode ticket must match final source-owned CR0 in the same step', () => {
  const f = openedMixedMode();
  f.cpu._stepInstruction = function () {
    this.cs = 0x18; this.eip = 0x120; return 1;
  };
  assert.equal(f.cpu.step(), 1);
  f.cpu.eax = 0;
  f.cpu._fetch8 = (() => { const bytes = [0x22, 0xc0];
    return () => bytes.shift(); })();
  f.cpu._stepInstruction = function () {
    this._step0f(false, null, 32);
    this.cr0 = 2; // A distinct source change after the decoded write.
    return 1;
  };
  assert.equal(f.cpu.step(), 1);
  const observed = f.cpu.takeOwned0501TaskModeObservation(f.modeToken);
  assert.equal(observed.firstFailure, 'mode-operation-context-mismatch');
  assert.equal(observed.modeChanges.length, 0);
  assert.equal(f.cpu.cr0, 2);
});

test('MOV CR0 ticket cannot attribute a co-occurring VM86 flag change', () => {
  const f = openedMixedMode();
  f.cpu._stepInstruction = function () {
    this.cs = 0x18; this.eip = 0x120; return 1;
  };
  assert.equal(f.cpu.step(), 1);
  f.cpu.eax = 0;
  f.cpu._fetch8 = (() => { const bytes = [0x22, 0xc0];
    return () => bytes.shift(); })();
  f.cpu._stepInstruction = function () {
    this._step0f(false, null, 32);
    this.eflags |= 0x20000;
    return 1;
  };
  assert.equal(f.cpu.step(), 1);
  const observed = f.cpu.takeOwned0501TaskModeObservation(f.modeToken);
  assert.equal(observed.firstFailure, 'mode-operation-context-mismatch');
  assert.equal(observed.modeChanges.length, 0);
});

test('mode profile refuses unattributed changes while preserving guest step', () => {
  const f = openedMixedMode();
  f.cpu._stepInstruction = function () { this.cr0 = 0; return 1; };
  assert.equal(f.cpu.step(), 1);
  const observed = f.cpu.takeOwned0501TaskModeObservation(f.modeToken);
  assert.equal(observed.firstFailure, 'unattributed-mode-change');
  assert.deepEqual(observed.modeChanges, []);
  assert.equal(observed.modeRefusal.enclosingStepCommitted, true);
  assert.deepEqual([observed.modeRefusal.before.mode,
    observed.modeRefusal.after.mode], ['protected', 'pe-clear']);
  assert.equal(f.cpu.cr0, 0);
  assert.equal(observed.frameReturnQualified, false);
});

test('mode profile refuses between-step source changes and wrong tokens', () => {
  const f = openedMixedMode();
  assert.throws(() => f.cpu.owned0501TaskModeStatus({}), /stale/);
  f.cpu.cr0 = 0;
  f.cpu._stepInstruction = () => 1;
  assert.equal(f.cpu.step(), 1);
  const observed = f.cpu.takeOwned0501TaskModeObservation(f.modeToken);
  assert.equal(observed.firstFailure, 'unattributed-between-step-change');
  assert.equal(observed.modeChanges.length, 0);
  assert.equal(observed.modeRefusal.enclosingStepCommitted, false);
});

test('mode profile retains fault facts before uncommitted mode attempt', () => {
  const f = openedMixedMode();
  f.cpu._stepInstruction = function () {
    this.cr0 = 0;
    throw new I80386Fault(13, 0, 'synthetic mode fault');
  };
  assert.throws(() => f.cpu.step(), error =>
    error instanceof I80386Fault && error.vector === 13);
  const observed = f.cpu.takeOwned0501TaskModeObservation(f.modeToken);
  assert.equal(observed.firstFailure, 'step-failure');
  assert.deepEqual([observed.deliveries[0].kind,
    observed.deliveries[0].fault.vector,
    observed.deliveries[0].enclosingStepCommitted],
    ['cpu-fault', 13, false]);
  assert.equal(observed.uncommittedModes.length, 1);
  assert.equal(observed.uncommittedModes[0].enclosingStepCommitted, false);
  assert.equal(observed.modeChanges.length, 0);
});

test('mode profile refuses mutated between-step descriptor scalars', () => {
  const f = openedMixedMode();
  // The fixture starts at the largest valid uint32 limit. Keep this changed
  // scalar in range so the test reaches between-step identity comparison.
  f.cpu.segmentCaches[1].limit--;
  f.cpu._stepInstruction = () => 1;
  assert.equal(f.cpu.step(), 1);
  const observed = f.cpu.takeOwned0501TaskModeObservation(f.modeToken);
  assert.equal(observed.firstFailure, 'unattributed-between-step-change');
  assert.equal(observed.modeRefusal.before.codeCache.limit - 1,
    observed.modeRefusal.after.codeCache.limit);
});

test('mode profile rejects malformed numeric and boolean cache roles', () => {
  for (const [key, value] of [['base', 1.5], ['default32', 7]]) {
    const f = openedMixedMode();
    f.cpu._stepInstruction = function () {
      this.segmentCaches[1][key] = value; return 1;
    };
    assert.equal(f.cpu.step(), 1);
    const observed = f.cpu.takeOwned0501TaskModeObservation(f.modeToken);
    assert.equal(observed.firstFailure, 'observer-step-record-failure');
    assert.equal(observed.modeChanges.length, 0);
    assert.equal(f.cpu.segmentCaches[1][key], value);
  }
});

test('mode profile reports VM86 as CPL3 but refuses unattributed entry', () => {
  const f = openedMixedMode();
  f.cpu._stepInstruction = function () {
    this.cs = 0x18; this.eflags |= 0x20000;
    this.segmentCaches[1] = this._virtualSegmentCache(1, this.cs);
    this.segmentCaches[2] = this._virtualSegmentCache(2, this.ss);
    return 1;
  };
  assert.equal(f.cpu.step(), 1);
  const observed = f.cpu.takeOwned0501TaskModeObservation(f.modeToken);
  assert.equal(observed.firstFailure, 'unattributed-mode-change');
  assert.deepEqual([observed.modeRefusal.after.mode,
    observed.modeRefusal.after.cpl], ['vm86', 3]);
  assert.equal(observed.modeRefusal.after.codeCache.access, null);
  assert.equal(observed.frameReturnQualified, false);
});

test('mode status wrong-token reentry is latched before token rejection', () => {
  const f = openedMixedMode();
  f.cpu._stepInstruction = function () {
    assert.throws(() => this.owned0501TaskModeStatus({}), /stale/);
    return 1;
  };
  assert.equal(f.cpu.step(), 1);
  const observed = f.cpu.takeOwned0501TaskModeObservation(f.modeToken);
  assert.equal(observed.firstFailure, 'observer-reentry');
  assert.equal(observed.modeChanges.length, 0);
});

test('protected-only excursion still rejects PE clear', () => {
  const f = openedMixedExcursion();
  f.cpu._stepInstruction = function () { this.cr0 = 0; return 1; };
  assert.equal(f.cpu.step(), 1);
  const observed = f.cpu.takeOwned0501TaskExcursionObservation(f.excursionToken);
  assert.equal(observed.firstFailure, 'unsupported-task-excursion-mode');
});

test('task excursion requires a committed private mixed frame and one arm', () => {
  const f = fixture();
  const frameToken = f.arm({ profile: MIXED_PROFILE });
  assert.throws(() => f.cpu.armOwned0501TaskExcursion(frameToken), /committed/);
  assert.throws(() => f.cpu.armOwned0501TaskExcursion({}), /committed/);
  const open = openedMixedExcursion();
  assert.throws(() => open.cpu.armOwned0501TaskExcursion(open.frameToken), /consume prior/);
  assert.equal(open.cpu.owned0501TaskExcursionStatus(open.excursionToken).phase,
    'observing');
  open.cpu.reset();
  const result = open.cpu.takeOwned0501TaskExcursionObservation(open.excursionToken);
  assert.equal(result.firstFailure, 'cpu-reset');
  assert.equal(result.frameReturnQualified, false);
  assert.throws(() => open.cpu.owned0501TaskExcursionStatus(open.excursionToken), /stale/);
});

test('task excursion source commit is separate from strict frame refusal', () => {
  const f = openedMixedExcursion();
  const sourceTask = { ...f.cpu.tr };
  const originalCore = f.cpu._taskSwitchCore;
  let switches = 0;
  f.cpu._taskSwitchCore = function (_selector, kind, options) {
    assert.equal(kind, 'jmp');
    if (++switches === 1) {
      // The real core still reaches the old strict guard before its descriptor fault.
      assert.throws(() => originalCore.call(this, 0, kind, options), I80386Fault);
      this.tr = { selector: 0x38, base: 0x700, limit: 0x67,
        present: true, type: 11 };
      this.cs = 0x08; this.ss = 0x10; this.eip = 0x1234;
      this.esp = 0x400; this.cr3 = 0x1000;
    } else {
      this.tr = { ...sourceTask };
      this.cs = 0x0b; this.ss = 0x23; this.eip = 0x100;
      this.esp = 0x7f4; this.cr3 = 0;
      // A real task return reloads segment cache objects; scalar roles, not
      // object identity, are the diagnostic candidate comparison.
      this.segmentCaches[1] = { ...this.segmentCaches[1] };
      this.segmentCaches[2] = { ...this.segmentCaches[2] };
      this.segmentCaches[1].access |= 1; // descriptor Accessed set on reload
      this.segmentCaches[2].access |= 1;
    }
    return 7;
  };
  f.cpu._stepInstruction = function () {
    this._taskSwitch(switches ? 0x30 : 0x38, 'jmp');
    return 1;
  };
  assert.equal(f.cpu.step(), 1);
  assert.equal(f.cpu.owned0501FrameStatus(f.frameToken).phase, 'invalid');
  assert.equal(f.cpu.owned0501TaskExcursionStatus(f.excursionToken).phase,
    'observing');
  assert.equal(f.cpu.step(), 1);
  assert.equal(f.cpu.owned0501TaskExcursionStatus(f.excursionToken).phase,
    'candidate');
  f.cpu._stepInstruction=function(){this.eip=0x101;return 1;};
  assert.equal(f.cpu.step(),1);
  assert.equal(f.cpu.eip,0x101);
  const diagnostic=f.cpu.takeOwned0501TaskExcursionObservation(f.excursionToken);
  assert.equal(diagnostic.phase, 'invalid');
  assert.equal(diagnostic.firstFailure, 'post-candidate-step');
  assert.equal(diagnostic.transitions.length, 2);
  assert.equal(diagnostic.transitions.every(x => x.enclosingStepCommitted), true);
  assert.deepEqual([diagnostic.resumeCandidate.originalTr,
    diagnostic.resumeCandidate.savedContinuation,
    diagnostic.resumeCandidate.handlerContext,
    diagnostic.resumeCandidate.taskContext], [true, true, true, true]);
  assert.equal(diagnostic.frameReturnQualified, false);
  const strict=f.cpu.takeOwned0501FrameObservation(f.frameToken);
  assert.equal(strict.failure, 'task-switch-during-owned-frame');
  assert.equal(strict.returned, null);
});

function candidateMixedExcursion() {
  const f = openedMixedExcursion();
  const originalTr = { ...f.cpu.tr };
  let switched = false;
  f.cpu._taskSwitchCore = function () {
    if (!switched) {
      switched = true;
      this.tr = { selector: 0x38, base: 0x700, limit: 0x67,
        present: true, type: 11 };
      this.cs = 0x08; this.ss = 0x10; this.eip = 0x1234;
      this.esp = 0x400; this.cr3 = 0x1000;
    } else {
      this.tr = { ...originalTr };
      this.cs = 0x0b; this.ss = 0x23; this.eip = 0x100;
      this.esp = 0x7f4; this.cr3 = 0;
      this.segmentCaches[1] = { ...this.segmentCaches[1] };
      this.segmentCaches[2] = { ...this.segmentCaches[2] };
      this.segmentCaches[1].access |= 1;
      this.segmentCaches[2].access |= 1;
    }
    return 7;
  };
  f.cpu._stepInstruction = function () {
    this._taskSwitch(switched ? 0x30 : 0x38, 'jmp');
    return 1;
  };
  assert.equal(f.cpu.step(), 1);
  assert.equal(f.cpu.step(), 1);
  assert.equal(f.cpu.owned0501TaskExcursionStatus(f.excursionToken).phase,
    'candidate');
  return f;
}

test('task excursion candidate is invalidated by reset before consumption', () => {
  const f=candidateMixedExcursion();
  f.cpu.reset();
  const result = f.cpu.takeOwned0501TaskExcursionObservation(f.excursionToken);
  assert.equal(result.phase, 'invalid');
  assert.equal(result.firstFailure, 'cpu-reset');
  assert.equal(result.resumeCandidate.savedContinuation, true);
  assert.equal(result.frameReturnQualified, false);
});

test('task excursion owner abort preserves candidate facts without promotion', () => {
  const f=candidateMixedExcursion();
  const before={eip:f.cpu.eip,cs:f.cpu.cs,ss:f.cpu.ss,cycles:f.cpu.cycles};
  const status=f.cpu.abortOwned0501TaskExcursion(f.excursionToken,
    'observer-progress-failure');
  assert.equal(status.phase,'invalid');
  assert.equal(status.firstFailure,'observer-progress-failure');
  assert.deepEqual({eip:f.cpu.eip,cs:f.cpu.cs,ss:f.cpu.ss,cycles:f.cpu.cycles},
    before);
  const result=f.cpu.takeOwned0501TaskExcursionObservation(f.excursionToken);
  assert.equal(result.phase,'invalid');
  assert.equal(result.firstFailure,'observer-progress-failure');
  assert.equal(result.resumeCandidate.savedContinuation,true);
  assert.equal(result.frameReturnQualified,false);
});

test('task excursion owner abort is bounded, token-bound and guest-neutral', () => {
  const f = openedMixedExcursion();
  const before={eip:f.cpu.eip,cs:f.cpu.cs,ss:f.cpu.ss,
    cycles:f.cpu.cycles,frame:f.cpu.owned0501FrameStatus(f.frameToken)};
  assert.throws(() => f.cpu.abortOwned0501TaskExcursion({},
    'observer-step-bound'),/stale/);
  assert.throws(() => f.cpu.abortOwned0501TaskExcursion(f.excursionToken,
    'unreviewed-reason'),/unreviewed/);
  let getterCalls=0;
  const hostile={get toString(){getterCalls++;return ()=>'observer-step-bound';}};
  assert.throws(() => f.cpu.abortOwned0501TaskExcursion(f.excursionToken,
    hostile),/unreviewed/);
  assert.equal(getterCalls,0);
  const status=f.cpu.abortOwned0501TaskExcursion(f.excursionToken,
    'observer-step-bound');
  assert.equal(status.phase,'invalid');
  assert.equal(status.firstFailure,'observer-step-bound');
  assert.deepEqual({eip:f.cpu.eip,cs:f.cpu.cs,ss:f.cpu.ss,
    cycles:f.cpu.cycles,frame:f.cpu.owned0501FrameStatus(f.frameToken)},before);
  const again=f.cpu.abortOwned0501TaskExcursion(f.excursionToken,
    'observer-wall-bound');
  assert.equal(again.firstFailure,'observer-step-bound');
  const result=f.cpu.takeOwned0501TaskExcursionObservation(f.excursionToken);
  assert.equal(result.firstFailure,'observer-step-bound');
  assert.equal(result.frameReturnQualified,false);
  assert.throws(() => f.cpu.abortOwned0501TaskExcursion(f.excursionToken,
    'observer-step-bound'),/stale/);
  const disabled=fixture();
  assert.throws(() => disabled.cpu.abortOwned0501TaskExcursion({},
    'observer-step-bound'),/stale/);
});

test('wrong-token abort during a CPU step leaves live task observer armed', () => {
  const f=openedMixedExcursion();
  f.cpu._stepInstruction=function(){
    assert.throws(()=>this.abortOwned0501TaskExcursion({},
      'observer-step-bound'),/stale/);
    this.eip=(this.eip+1)>>>0;
    return 1;
  };
  assert.equal(f.cpu.step(),1);
  assert.equal(f.cpu.owned0501TaskExcursionStatus(f.excursionToken).phase,
    'observing');
});

test('swallowed abort during admission cannot mint an excursion token', () => {
  const f=fixture();
  f.memory.set(0x208+5,0xfa);f.memory.set(0x208+6,0x8f);
  f.put(0x300+0x31*8,[0,1,0x0b,0,0,0xee,0,0]);
  f.put(HANDLER+0x100,[0x66,0xcf]);
  const frameToken=f.arm({profile:MIXED_PROFILE});
  assert.equal(f.cpu.step(),1);
  const originalTr=f.cpu.tr;
  let trapped=false;
  f.cpu.tr=new Proxy(originalTr,{getOwnPropertyDescriptor(target,key){
    if(!trapped){
      trapped=true;
      assert.throws(()=>f.cpu.abortOwned0501TaskExcursion({},
        'observer-step-bound'),/stale/);
    }
    return Reflect.getOwnPropertyDescriptor(target,key);
  }});
  assert.throws(()=>f.cpu.armOwned0501TaskExcursion(frameToken),
    /admission refused|changed during admission/);
  assert.equal(trapped,true);
});

test('task excursion abort during CPU execution invalidates only observer', () => {
  const f=openedMixedExcursion();
  f.cpu._stepInstruction=function(){
    assert.throws(()=>this.abortOwned0501TaskExcursion(f.excursionToken,
      'observer-step-bound'),/outside owner pause/);
    this.eip=(this.eip+1)>>>0;
    return 1;
  };
  const before=f.cpu.eip;
  assert.equal(f.cpu.step(),1);
  assert.equal(f.cpu.eip,(before+1)>>>0);
  const result=f.cpu.takeOwned0501TaskExcursionObservation(f.excursionToken);
  assert.equal(result.firstFailure,'observer-reentry');
  assert.equal(result.frameReturnQualified,false);
});

test('failed task core retains an uncommitted attempt and original fault', () => {
  const f = openedMixedExcursion();
  const fault = new I80386Fault(13, 0x38, 'synthetic task fault');
  f.cpu._taskSwitchCore = () => { throw fault; };
  f.cpu._stepInstruction = function () { this._taskSwitch(0x38, 'jmp'); return 1; };
  assert.throws(() => f.cpu.step(), error => error === fault);
  const diagnostic=f.cpu.takeOwned0501TaskExcursionObservation(f.excursionToken);
  assert.equal(diagnostic.firstFailure, 'task-core-exception');
  assert.deepEqual([diagnostic.transitions.length,
    diagnostic.uncommittedTransitions.length,
    diagnostic.uncommittedTransitions[0].outcome,
    diagnostic.uncommittedTransitions[0].enclosingStepCommitted],
    [0,1,'fault-without-taskCommitted',false]);
  assert.equal(diagnostic.frameReturnQualified, false);
});

test('task excursion admission refuses accessor and direct helper staging', () => {
  const f = openedMixedExcursion();
  let invoked=0;
  Object.defineProperty(f.cpu.tr,'base',{configurable:true,
    get(){invoked++;return 0x600;}});
  const old=f.cpu.takeOwned0501TaskExcursionObservation(f.excursionToken);
  assert.equal(old,null);
  assert.equal(invoked,0);
  assert.throws(() => f.cpu._taskSwitch(0,'jmp'), I80386Fault);
  const result=f.cpu.takeOwned0501TaskExcursionObservation(f.excursionToken);
  assert.equal(result.firstFailure,'task-helper-reentry-or-stale-stage');
  assert.equal(result.transitions.length,0);
  assert.equal(result.frameReturnQualified,false);
  assert.equal(invoked,0);
});

test('task excursion admission never invokes a task descriptor accessor', () => {
  const f=fixture();
  f.memory.set(0x208+5,0xfa);f.memory.set(0x208+6,0x8f);
  f.put(0x300+0x31*8,[0,1,0x0b,0,0,0xee,0,0]);
  const frameToken=f.arm({profile:MIXED_PROFILE});
  assert.equal(f.cpu.step(),1);
  let invoked=0;
  Object.defineProperty(f.cpu.tr,'base',{configurable:true,
    get(){invoked++;return 0x600;}});
  assert.throws(() => f.cpu.armOwned0501TaskExcursion(frameToken), /own data/);
  assert.equal(invoked,0);
  assert.equal(f.cpu.owned0501FrameStatus(frameToken).phase,'open');
});

test('task excursion refuses VM86 mode without revising the strict journal', () => {
  const f=openedMixedExcursion();
  f.cpu._stepInstruction=function(){this.eflags|=0x20000;return 1;};
  assert.equal(f.cpu.step(),1);
  const diagnostic=f.cpu.takeOwned0501TaskExcursionObservation(f.excursionToken);
  assert.equal(diagnostic.firstFailure,'unsupported-task-excursion-mode');
  assert.equal(diagnostic.frameReturnQualified,false);
  const strict=f.cpu.takeOwned0501FrameObservation(f.frameToken);
  assert.equal(strict.returned,null);
});

test('task excursion reentry from a guest read latches observer failure', () => {
  let excursionToken=null, observed=null;
  const f=fixture({onRead(cpu){
    if(excursionToken) observed=cpu.owned0501TaskExcursionStatus(excursionToken);
  }});
  f.memory.set(0x208+5,0xfa);f.memory.set(0x208+6,0x8f);
  f.put(0x300+0x31*8,[0,1,0x0b,0,0,0xee,0,0]);
  f.put(HANDLER+0x100,[0x66,0xcf]);
  const frameToken=f.arm({profile:MIXED_PROFILE});
  assert.equal(f.cpu.step(),1);
  excursionToken=f.cpu.armOwned0501TaskExcursion(frameToken);
  f.cpu._stepInstruction=function(){this.read(0);return 1;};
  assert.equal(f.cpu.step(),1);
  assert.equal(observed.phase,'invalid');
  const result=f.cpu.takeOwned0501TaskExcursionObservation(excursionToken);
  assert.equal(result.firstFailure,'observer-reentry');
  assert.equal(result.frameReturnQualified,false);
  assert.equal(f.cpu.owned0501FrameStatus(frameToken).phase,'open');
  assert.throws(() => f.cpu.armOwned0501TaskExcursion(frameToken), /already used/);
});

test('task excursion admission refuses swallowed descriptor-trap reentry', () => {
  const f=fixture();
  f.memory.set(0x208+5,0xfa);f.memory.set(0x208+6,0x8f);
  f.put(0x300+0x31*8,[0,1,0x0b,0,0,0xee,0,0]);
  const frameToken=f.arm({profile:MIXED_PROFILE});
  assert.equal(f.cpu.step(),1);
  const original=f.cpu.tr;
  let nested=0;
  f.cpu.tr=new Proxy(original,{getOwnPropertyDescriptor(target,key){
    if(key==='base' && !nested){
      nested++;
      const execute=f.cpu._stepInstruction;
      f.cpu._stepInstruction=()=>1;
      try{assert.equal(f.cpu.step(),1);}finally{f.cpu._stepInstruction=execute;}
    }
    return Reflect.getOwnPropertyDescriptor(target,key);
  }});
  assert.throws(() => f.cpu.armOwned0501TaskExcursion(frameToken), /admission/);
  assert.equal(nested,1);
  assert.equal(f.cpu.owned0501FrameStatus(frameToken).phase,'open');
});

test('task excursion checks the reentry latch after final descriptor reflection', () => {
  const f=fixture();
  f.memory.set(0x208+5,0xfa);f.memory.set(0x208+6,0x8f);
  f.put(0x300+0x31*8,[0,1,0x0b,0,0,0xee,0,0]);
  const frameToken=f.arm({profile:MIXED_PROFILE});
  assert.equal(f.cpu.step(),1);
  const code=f.cpu.segmentCaches[1],original=Object.getOwnPropertyDescriptor;
  let reflected=0,nested=0;
  Object.getOwnPropertyDescriptor=function(object,key){
    if(object===code&&key==='access'&&++reflected===2){
      nested++;
      const execute=f.cpu._stepInstruction;
      f.cpu._stepInstruction=()=>1;
      try{assert.equal(f.cpu.step(),1);}finally{f.cpu._stepInstruction=execute;}
    }
    return original.call(Object,object,key);
  };
  try{assert.throws(()=>f.cpu.armOwned0501TaskExcursion(frameToken),/admission/);}
  finally{Object.getOwnPropertyDescriptor=original;}
  assert.equal(nested,1);
  assert.equal(f.cpu.owned0501FrameStatus(frameToken).phase,'open');
});

test('task fault accessors are not invoked by excursion records', () => {
  const f=openedMixedExcursion();
  const fault=new I80386Fault(13,0x38,'synthetic task fault');
  let reads=0;
  for(const name of ['vector','errorCode'])
    Object.defineProperty(fault,name,{configurable:true,
      get(){reads++;throw new Error('observer accessor');}});
  f.cpu._taskSwitchCore=()=>{throw fault;};
  f.cpu._stepInstruction=function(){this._taskSwitch(0x38,'jmp');return 1;};
  assert.throws(()=>f.cpu.step(),error=>error===fault);
  const result=f.cpu.takeOwned0501TaskExcursionObservation(f.excursionToken);
  assert.equal(reads,0);
  assert.equal(result.firstFailure,'task-core-exception');
  assert.equal(result.uncommittedTransitions[0].fault.available,false);
  assert.equal(result.frameReturnQualified,false);
});

test('step-catch fault facts refuse accessors without replacing the guest fault', () => {
  const f=openedMixedExcursion();
  const fault=new I80386Fault(13,0x38,'synthetic instruction fault');
  let reads=0;
  for(const name of ['vector','errorCode'])
    Object.defineProperty(fault,name,{configurable:true,
      get(){reads++;throw new Error('observer accessor');}});
  f.cpu._stepInstruction=()=>{throw fault;};
  assert.throws(()=>f.cpu.step(),error=>error===fault);
  const result=f.cpu.takeOwned0501TaskExcursionObservation(f.excursionToken);
  assert.equal(reads,0);
  assert.equal(result.firstFailure,'step-failure');
  assert.equal(result.deliveries.length,1);
  assert.deepEqual([result.deliveries[0].kind,
    result.deliveries[0].fault.available,
    result.deliveries[0].enclosingStepCommitted],
    ['cpu-fault',false,false]);
  assert.equal(result.frameReturnQualified,false);
});

test('task excursion pre-switch cap is exact at 100000 committed steps', () => {
  const f=openedMixedExcursion();
  f.cpu._stepInstruction=()=>1;
  for(let i=0;i<99999;i++)assert.equal(f.cpu.step(),1);
  assert.equal(f.cpu.owned0501TaskExcursionStatus(f.excursionToken).phase,'observing');
  assert.equal(f.cpu.step(),1);
  const result=f.cpu.takeOwned0501TaskExcursionObservation(f.excursionToken);
  assert.equal(result.firstFailure,'pre-switch-step-cap');
  assert.equal(result.activeSteps,100000);
  assert.equal(result.frameReturnQualified,false);
});

test('task excursion post-switch cap counts only subsequent committed steps', () => {
  const f=openedMixedExcursion();
  const originalCore=f.cpu._taskSwitchCore;
  f.cpu._taskSwitchCore=function(_selector,kind,options){
    assert.throws(()=>originalCore.call(this,0,kind,options),I80386Fault);
    this.tr={selector:0x38,base:0x700,limit:0x67,present:true,type:11};
    this.cs=0x08;this.ss=0x10;this.eip=0x1234;this.esp=0x400;
    return 1;
  };
  let departed=false;
  f.cpu._stepInstruction=function(){
    if(!departed){departed=true;this._taskSwitch(0x38,'jmp');}
    return 1;
  };
  assert.equal(f.cpu.step(),1);
  assert.equal(f.cpu.owned0501TaskExcursionStatus(f.excursionToken).phase,'observing');
  for(let i=0;i<99999;i++)assert.equal(f.cpu.step(),1);
  assert.equal(f.cpu.owned0501TaskExcursionStatus(f.excursionToken).phase,'observing');
  assert.equal(f.cpu.step(),1);
  const result=f.cpu.takeOwned0501TaskExcursionObservation(f.excursionToken);
  assert.equal(result.firstFailure,'post-switch-step-cap');
  assert.equal(result.postOutgoingSteps,100000);
  assert.equal(result.transitions.length,1);
});

test('refused hardware interrupt leaves the pair open; accepted delivery invalidates it', () => {
  const f = fixture();
  const token = f.arm();
  f.cpu.step();
  assert.equal(f.cpu.interrupt(0x31), false);
  assert.equal(f.cpu.owned0501FrameStatus(token).phase, 'open');
  f.cpu.eflags |= 0x200;
  assert.equal(f.cpu.interrupt(0x31), true);
  assert.equal(f.cpu.takeOwned0501FrameObservation(token).phase, 'invalid');
});

test('finite active-step cap refuses a late IRET without changing its guest effect', () => {
  const f = fixture();
  const token = f.arm({ maxActiveSteps: 1 });
  f.cpu.step();
  f.cpu.step();
  assert.deepEqual([f.cpu.cs, f.cpu.eip, f.cpu.ss, f.cpu.esp],
    [0x1b, START + 2, 0x23, 0x800]);
  assert.equal(f.cpu.takeOwned0501FrameObservation(token).failure,
    'active-step-cap');
});

test('the same SS:ESP with a changed stack base cannot consume another frame', () => {
  const f = fixture();
  const token = f.arm();
  f.cpu.step();
  for (let byte = 0; byte < 20; byte++)
    f.memory.set(0x1303ec + byte, f.memory.get(0x1203ec + byte));
  f.cpu.segmentCaches[2] = { ...f.cpu.segmentCaches[2], base: 0x130000 };
  f.cpu.step();
  assert.deepEqual([f.cpu.cs, f.cpu.eip, f.cpu.ss, f.cpu.esp],
    [0x1b, START + 2, 0x23, 0x800]);
  assert.equal(f.cpu.takeOwned0501FrameObservation(token).failure,
    'owned-iret-frame-mismatch');
});

test('a handler-edited saved CF is recorded separately from delivery flags', () => {
  const f = fixture();
  const token = f.arm();
  f.cpu.step();
  f.memory.set(0x1203ec + 8, 0x03);
  f.cpu.step();
  const result = f.cpu.takeOwned0501FrameObservation(token);
  assert.equal(result.phase, 'complete');
  assert.equal(result.entry.savedFlags & 1, 0);
  assert.equal(result.returned.consumedFlags & 1, 1);
  assert.equal(result.returned.returnedFlags & 1, 1);
});

test('IRETD into VM86 cannot later be credited as the protected32 pair', () => {
  const f = fixture();
  const token = f.arm();
  f.cpu.step();
  f.memory.set(0x1203ec + 10, 0x02);
  f.cpu.step();
  assert.equal(f.cpu.takeOwned0501FrameObservation(token).phase, 'invalid');
});

test('a post-IRET trace delivery cannot mint a clean pair', () => {
  const f = fixture();
  f.put(0x300 + 8, [0, 1, 8, 0, 0, 0xee, 0, 0]);
  const token = f.arm();
  f.cpu.step();
  f.cpu.eflags |= 0x100;
  f.cpu.step();
  assert.equal(f.cpu.takeOwned0501FrameObservation(token).phase, 'invalid');
});

test('disabled plain-object throw preserves identity and never reads taskCommitted', () => {
  let enabled = false, getterReads = 0;
  const thrown = { get taskCommitted() { getterReads++; throw new Error('getter'); } };
  const f = fixture({ onRead: () => { if (enabled) throw thrown; } });
  enabled = true;
  assert.throws(() => f.cpu.step(), error => error === thrown);
  assert.equal(getterReads, 0);
});

test('active journal adds no read of a recognized fault taskCommitted getter', () => {
  let enabled = false, getterReads = 0;
  const fault = new I80386Fault(13, 0, 'synthetic bus fault');
  Object.defineProperty(fault, 'taskCommitted', {
    get() { getterReads++; return false; },
  });
  const f = fixture({ onRead: () => { if (enabled) throw fault; } });
  const token = f.arm();
  enabled = true;
  assert.throws(() => f.cpu.step(), error => error === fault);
  assert.equal(getterReads, 1);
  assert.equal(f.cpu.takeOwned0501FrameObservation(token).phase, 'invalid');
});

test('taskCommitted fault preserves original CPU effect while refusing journal success', () => {
  let enabled = false;
  const fault = new I80386Fault(13, 0, 'synthetic committed fault');
  fault.taskCommitted = true;
  const f = fixture({ onRead: cpu => {
    if (enabled) {
      cpu.eax = 0x12345678;
      throw fault;
    }
  } });
  const token = f.arm();
  enabled = true;
  assert.throws(() => f.cpu.step(), error => error === fault);
  assert.equal(f.cpu.eax, 0x12345678);
  assert.equal(f.cpu.takeOwned0501FrameObservation(token).phase, 'invalid');
});

test('a bus callback cannot consume or arm the active session inside delivery', () => {
  let duringStep = false, token, calls = 0;
  const f = fixture({ onRead: cpu => {
    if (!duringStep || calls++) return;
    assert.equal(cpu.takeOwned0501FrameObservation(token), null);
    assert.equal(cpu.armOwned0501FrameJournal({
      cs: 0x1b, startEip: START, endEip: START + 3,
      maxActiveSteps: 10,
    }), null);
  } });
  token = f.arm();
  duringStep = true;
  f.cpu.step();
  assert.equal(f.cpu.takeOwned0501FrameObservation(token).failure,
    'observer-reentry');
});

test('an observer-only allocation failure after delivery leaves guest effects intact', () => {
  const f = fixture();
  const token = f.arm();
  const freeze = Object.freeze;
  Object.freeze = value => {
    if (value?.source === 'decoded-software-int31') throw new Error('observer');
    return freeze(value);
  };
  try {
    assert.equal(f.cpu.step(), 1);
  } finally {
    Object.freeze = freeze;
  }
  assert.deepEqual([f.cpu.cs, f.cpu.eip, f.cpu.ss, f.cpu.esp],
    [8, 0x100, 0x10, 0x3ec]);
  assert.equal(f.cpu.takeOwned0501FrameObservation(token).failure,
    'observer-entry-record-failure');
});

test('an observer-only allocation failure after IRET does not undo the return', () => {
  const f = fixture();
  const token = f.arm();
  f.cpu.step();
  const freeze = Object.freeze;
  Object.freeze = value => {
    if (value?.source === 'decoded-protected-iret') throw new Error('observer');
    return freeze(value);
  };
  try {
    assert.equal(f.cpu.step(), 1);
  } finally {
    Object.freeze = freeze;
  }
  assert.deepEqual([f.cpu.cs, f.cpu.eip, f.cpu.ss, f.cpu.esp],
    [0x1b, START + 2, 0x23, 0x800]);
  assert.equal(f.cpu.takeOwned0501FrameObservation(token).failure,
    'observer-return-record-failure');
});
