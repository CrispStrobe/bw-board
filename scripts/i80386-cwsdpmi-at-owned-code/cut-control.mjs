import assert from 'node:assert/strict';
import {bindAtMainCut,consumeVerifiedTextMismatch,observationFingerprint} from
  '../i80386-cwsdpmi-at-loaded-actual/cut.mjs';
import {controlLayout as layout,controlMachine as machine,
  controlTextAddress as textAddress,controlRoleSpecs as specs} from
  '../i80386-cwsdpmi-at-loaded-actual/cut-control.mjs';
import {bindOwnedCodeAtMain} from './cut.mjs';

const exact=machine(),whole=bindOwnedCodeAtMain(exact,layout);
assert.equal(whole.strictWholeText,'PASS');
assert.equal(whole.ownedCodeAtEntry,'PASS');
assert.equal(whole.textMismatch,null);
assert.throws(()=>bindOwnedCodeAtMain(exact,layout),/failed owned-code cut/);

const outside=machine();outside.mem[textAddress+7]^=1;
const prior=observationFingerprint(outside);
const narrow=bindOwnedCodeAtMain(outside,layout);
assert.equal(narrow.strictWholeText,'FAIL');
assert.equal(narrow.ownedCodeAtEntry,'PASS');
assert.equal(narrow.strictFailure,'loaded text differs at byte 7');
assert.equal(narrow.textMismatch.changedBytes,1);
assert.equal(Object.keys(narrow.textMismatch.roles).length,8);
assert.equal(Object.values(narrow.textMismatch.roles).every(role=>role.equal),true);
assert.deepEqual(narrow.before,prior);
assert.deepEqual(narrow.after,prior);
assert.deepEqual(observationFingerprint(outside),prior);
assert.throws(()=>bindOwnedCodeAtMain(outside,layout),/failed owned-code cut/);

// Every complete owned role must fail if even one byte changes; a background
// mismatch cannot be used to hide a changed main or wrapper byte.
for(const [name,,address] of specs){
  const changed=machine();changed.mem[address]^=1;
  assert.throws(()=>bindOwnedCodeAtMain(changed,layout),/owned main\/wrapper bytes differ/,
    `altered role ${name}`);
}
const combined=machine();combined.mem[textAddress+7]^=1;
combined.mem[layout.roles.simulateInt.address]^=1;
assert.throws(()=>bindOwnedCodeAtMain(combined,layout),/owned main\/wrapper bytes differ/);

for(const mutate of [
  m=>{m.cpu.eip++;},m=>{m.cpu.cr0=0;},
  m=>{m.cpu.eflags|=0x20000;},m=>{m.cpu.segmentCaches[1].default32=false;},
  m=>{m.cpu.segmentCaches[1].base=0x100000;},
]){
  const wrong=machine();mutate(wrong);
  assert.throws(()=>bindOwnedCodeAtMain(wrong,layout));
}
assert.throws(()=>bindOwnedCodeAtMain(machine(),{...layout}),/unverified/);

// A caller-thrown Error can copy every public diagnostic field. It still has
// no private cut capability, even when caught locally by the wrapper.
const forged=new Error('loaded text differs at byte 7');
forged.textMismatch=narrow.textMismatch;
forged.observation={before:prior,after:prior};
const hostile=new Proxy(machine(),{getOwnPropertyDescriptor(){throw forged;}});
assert.throws(()=>bindOwnedCodeAtMain(hostile,layout),/unverified text mismatch owner/);

// Public Error fields can be replaced after the real strict failure. A wrong
// owner lookup must not consume another owner's private proof.
const direct=machine();direct.mem[textAddress+7]^=1;
let error;
try {bindAtMainCut(direct,layout);}catch(caught){error=caught;}
assert.equal(error?.message,'loaded text differs at byte 7');
assert.equal(Object.isFrozen(error.textMismatch),true);
assert.equal(Object.isFrozen(error.textMismatch.roles.main),true);
assert.throws(()=>{error.textMismatch.roles.main.equal=false;},TypeError);
error.textMismatch={schema:'forged',roles:{}};
error.observation={before:{cpuSha256:'forged'},after:{cpuSha256:'forged'}};
assert.throws(()=>consumeVerifiedTextMismatch(machine(),layout,error),/owner/);
assert.throws(()=>consumeVerifiedTextMismatch(direct,{...layout},error),/owner/);
const verified=consumeVerifiedTextMismatch(direct,layout,error);
assert.equal(verified.diagnostic.roles.main.equal,true);
assert.equal(verified.diagnostic.firstOffset,7);
assert.throws(()=>consumeVerifiedTextMismatch(direct,layout,error),/unverified/);

const delayed=machine();delayed.mem[textAddress+7]^=1;
let delayedError;
try {bindAtMainCut(delayed,layout);}catch(caught){delayedError=caught;}
delayed.cpu.eax++;
assert.throws(()=>consumeVerifiedTextMismatch(delayed,layout,delayedError),/source changed/);

// Swallowed nested consumption poisons the outer owner attempt.
const reentryBase=machine();reentryBase.mem[textAddress+7]^=1;
let nested=false,reenter=false,reentryError;
const reentrant=new Proxy(reentryBase,{getOwnPropertyDescriptor(target,key){
  if(reenter&&key==='cpu'&&!nested){
    try {consumeVerifiedTextMismatch(reentrant,layout,reentryError);}catch{nested=true;}
  }
  return Reflect.getOwnPropertyDescriptor(target,key);
}});
try {bindAtMainCut(reentrant,layout);}catch(caught){reentryError=caught;}
reenter=true;
assert.throws(()=>consumeVerifiedTextMismatch(reentrant,layout,reentryError),/source changed/);
assert.equal(nested,true);

let wrapperNested=false;
const wrapperBase=machine();
const wrapperProxy=new Proxy(wrapperBase,{getOwnPropertyDescriptor(target,key){
  if(key==='config'&&!wrapperNested){
    try {bindOwnedCodeAtMain(wrapperProxy,layout);}catch{wrapperNested=true;}
  }
  return Reflect.getOwnPropertyDescriptor(target,key);
}});
assert.throws(()=>bindOwnedCodeAtMain(wrapperProxy,layout),/failed owned-code cut/);
assert.equal(wrapperNested,true);

// A descriptor trap changes CS.base after the first captured read. The plain
// binder view must be reconciled with the source before any passive copy.
function driftMachine() {
  const drifting=machine();let defaultReads=0;
  const originalCode=drifting.cpu.segmentCaches[1];
  drifting.cpu.segmentCaches[1]=new Proxy(originalCode,{getOwnPropertyDescriptor(target,key){
    if(key==='default32'&&++defaultReads===2)target.base=0x1000;
    return Reflect.getOwnPropertyDescriptor(target,key);
  }});
  return drifting;
}
assert.throws(()=>bindAtMainCut(driftMachine(),layout),/binding CPU source changed/);
assert.throws(()=>bindOwnedCodeAtMain(driftMachine(),layout),/unverified/);

// Error-field attachment is diagnostic only. A swallowed callback during the
// outer catch cannot turn the private ticket into a successful narrow cut.
const setterMachine=machine();setterMachine.mem[textAddress+7]^=1;
let setterNested=false;
const previousObservation=Object.getOwnPropertyDescriptor(Error.prototype,'observation');
try {
  Object.defineProperty(Error.prototype,'observation',{configurable:true,set(){
    try {bindAtMainCut(setterMachine,layout);}catch{setterNested=true;}
  }});
  let setterError;
  try {bindAtMainCut(setterMachine,layout);}catch(caught){setterError=caught;}
  assert.equal(setterNested,true);
  assert.throws(()=>consumeVerifiedTextMismatch(setterMachine,layout,setterError),
    /source changed/);
} finally {
  if(previousObservation)Object.defineProperty(Error.prototype,'observation',previousObservation);
  else delete Error.prototype.observation;
}

console.log('CWSDPMI separate owned-code cut controls PASS');
