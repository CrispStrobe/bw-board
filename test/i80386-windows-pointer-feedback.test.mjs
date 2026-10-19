import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync, readFileSync, writeFileSync, renameSync, rmSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createPointerFeedbackSession, comparePointerApplicationFrames, verifyPointerParking,
  validatePointerPair,validatePointerClickDifference,readPointerPpm} from
  '../scripts/lib/i80386-windows-pointer-feedback.mjs';
import {publishPointerCommand} from '../scripts/send-i80386-windows-pointer-command.mjs';

const WIDTH=640,HEIGHT=480;
const frame=()=>({width:WIDTH,height:HEIGHT,rgb:Buffer.alloc(WIDTH*HEIGHT*3)});
const paint=(f,rect,value)=>{
  for(let y=rect.y;y<rect.y+rect.height;y++)for(let x=rect.x;x<rect.x+rect.width;x++)
    f.rgb.fill(value,(y*WIDTH+x)*3,(y*WIDTH+x+1)*3);
};

// Solitaire's stock/waste area is away from the lower-right cursor parking box.
const application={x:15,y:47,width:155,height:98};
const parking={x:520,y:360,width:80,height:80};
const cursorCrop={x:540,y:380,width:16,height:20};
const cropHash=f=>{
  const bytes=Buffer.alloc(cursorCrop.width*cursorCrop.height*3);
  for(let y=0;y<cursorCrop.height;y++)bytes.set(f.rgb.subarray(
    ((cursorCrop.y+y)*WIDTH+cursorCrop.x)*3,
    ((cursorCrop.y+y)*WIDTH+cursorCrop.x+cursorCrop.width)*3),y*cursorCrop.width*3);
  return createHash('sha256').update(bytes).digest('hex');
};

test('application gate refuses cursor-only differences and accepts a stock/waste change',()=>{
  const control=frame(),candidate=frame();
  paint(candidate,{x:540,y:380,width:12,height:16},255);
  assert.deepEqual(comparePointerApplicationFrames(control,candidate,
    {application,parking,minChangedPixels:500}).accepted,false);
  paint(candidate,{x:100,y:65,width:32,height:32},255);
  const beforePark=frame(),afterPark=frame();
  paint(afterPark,{x:540,y:380,width:12,height:16},255);
  const proof=verifyPointerParking(beforePark,afterPark,
    {application,parking,cursorTip:{x:540,y:380},cursorCrop,
      reviewedCropSha256:cropHash(afterPark)});
  assert.equal(proof.parked,true);
  const result=comparePointerApplicationFrames(control,candidate,
    {application,parking,minChangedPixels:500,controlParking:proof,candidateParking:proof});
  assert.equal(result.changedPixels,1024);
  assert.equal(result.accepted,true);
  assert.throws(()=>verifyPointerParking(beforePark,afterPark,
    {application,parking,cursorTip:{x:100,y:65},cursorCrop,
      reviewedCropSha256:cropHash(afterPark)}),/inside the parking/);
  assert.throws(()=>verifyPointerParking(beforePark,afterPark,
    {application,parking,cursorTip:{x:540,y:380},cursorCrop,
      reviewedCropSha256:'0'.repeat(64)}),/matching reviewed/);
  assert.throws(()=>comparePointerApplicationFrames(control,candidate,
    {application,parking:{x:100,y:65,width:80,height:80},minChangedPixels:500}),/overlap/);
});

test('pair gate permits only a click between shared movement and parking',()=>{
  const steps=[10,20,30,40,50];
  const entries=steps.map((step,seq)=>({seq,step,nextStep:steps[seq+1]??null,
    accepted:null,mouse:null}));
  const control=structuredClone(entries),candidate=structuredClone(entries);
  for(const arm of [control,candidate]){
    arm[0].mouse={dx:10,dy:-8,buttons:0};arm[0].accepted=true;
    arm[3].mouse={dx:12,dy:5,buttons:0};arm[3].accepted=true;
  }
  candidate[1].mouse={dx:0,dy:0,buttons:1};candidate[1].accepted=true;
  candidate[2].mouse={dx:0,dy:0,buttons:0};candidate[2].accepted=true;
  assert.deepEqual(validatePointerClickDifference(
    {pointerFeedback:control},{pointerFeedback:candidate}),[]);
  candidate[3].mouse.dx++;
  assert.match(validatePointerClickDifference(
    {pointerFeedback:control},{pointerFeedback:candidate}).join(' '),/movement packets differ/);
});

test('PPM checkpoint reader requires exact 640x480 P6 payload',()=>{
  const bytes=Buffer.concat([Buffer.from('P6\n640 480\n255\n'),frame().rgb]);
  assert.equal(readPointerPpm(bytes).rgb.length,WIDTH*HEIGHT*3);
  assert.throws(()=>readPointerPpm(bytes.subarray(0,-1)),/exact 640x480/);
});

test('guest delivery gate requires auxiliary byte triplet and IRQ12 after packet',async()=>{
  const {validatePointerGuestDelivery}=await import('../scripts/lib/i80386-windows-pointer-feedback.mjs');
  const mouse={dx:2,dy:3,buttons:0};
  const report={pointerFeedback:[{step:10,mouse}],pointerDelivery:[{step:10,mouse,
    auxPorts:[
      {step:11,dir:'in',port:0x64,value:0x21},{step:11,dir:'in',port:0x60,value:0x08},
      {step:12,dir:'in',port:0x64,value:0x21},{step:12,dir:'in',port:0x60,value:0x02},
      {step:13,dir:'in',port:0x64,value:0x21},{step:13,dir:'in',port:0x60,value:0xfd}],
    irq12:[{step:10,vector:0x74}]}]};
  assert.deepEqual(validatePointerGuestDelivery(report),[]);
  report.pointerDelivery[0].irq12=[];
  assert.match(validatePointerGuestDelivery(report).join(' '),/IRQ12/);
});

test('paired run identity requires the same mouse-enabled boot/source/keyboard budget',()=>{
  const common={executionRevision:'a'.repeat(40),sourceSha256:{cpu:'b'.repeat(64)},
    stepLimit:170_000_000,keyScriptSha256:'c'.repeat(64),
    input:{bios:{sha256:'d'.repeat(64)},vga:{sha256:'e'.repeat(64)},
      hdd:{sha256:'f'.repeat(64),geometry:{cylinders:1000,heads:4,sectors:17},cmosType:47},
      mouseEnabled:true,cmosEquipment:5}};
  assert.deepEqual(validatePointerPair(common,{...structuredClone(common),mouseScriptSha256:'0'.repeat(64)}),[]);
  const other=structuredClone(common);other.input.mouseEnabled=false;
  assert.match(validatePointerPair(common,other).join(' '),/mouseEnabled/);
  other.input.mouseEnabled=true;other.executionRevision='1'.repeat(40);
  assert.match(validatePointerPair(common,other).join(' '),/executionRevision/);
});

test('checkpoint handshake writes frame, accepts one bounded command, then fails closed on timeout',async()=>{
  const root=mkdtempSync(path.join(tmpdir(),'win-pointer-test-'));
  try {
    const directory=path.join(root,'run');
    const injected=[];
    const session=createPointerFeedbackSession({directory,firstStep:10,limit:100,
      timeoutMs:500,readFrame:()=>frame(),injectMouse:event=>{injected.push(event);return true;}});
    const pending=session.checkpoint(10);
    for(let i=0;i<50&&!existsSync(path.join(directory,'ready-0.json'));i++)
      await new Promise(resolve=>setTimeout(resolve,5));
    const ready=JSON.parse(readFileSync(path.join(directory,'ready-0.json'),'utf8'));
    assert.equal(ready.step,10);
    assert.match(readFileSync(path.join(directory,'frame-0.ppm')).subarray(0,16).toString(),/^P6\n640 480\n255/);
    const command={seq:0,atStep:10,nextStep:20,mouse:{dx:-20,dy:-10,buttons:0}};
    const temp=path.join(directory,'command-0.tmp');
    writeFileSync(temp,JSON.stringify(command));renameSync(temp,path.join(directory,'command-0.json'));
    assert.equal(await pending,20);
    assert.deepEqual(injected,[command.mouse]);
    assert.equal(session.events[0].accepted,true);
    const waiting=session.checkpoint(20);
    await assert.rejects(waiting,/timed out/);
    assert.equal(session.nextStep,20,'timeout does not silently skip an input checkpoint');
  } finally { rmSync(root,{recursive:true,force:true}); }
});

test('producer publishes only an atomic ready-step command once',()=>{
  const root=mkdtempSync(path.join(tmpdir(),'win-pointer-producer-'));
  try{
    writeFileSync(path.join(root,'ready-3.json'),JSON.stringify({
      schema:'bw.i80386-windows-pointer-ready.v1',seq:3,step:100}));
    const command=publishPointerCommand(root,3,200,{dx:12,dy:-7,buttons:0});
    assert.deepEqual(command,{seq:3,atStep:100,nextStep:200,
      mouse:{dx:12,dy:-7,buttons:0}});
    assert.deepEqual(JSON.parse(readFileSync(path.join(root,'command-3.json'),'utf8')),command);
    assert.throws(()=>publishPointerCommand(root,3,200,null),/already published/);
    assert.throws(()=>publishPointerCommand(root,3,99,null),/does not match/);
  }finally{rmSync(root,{recursive:true,force:true});}
});
