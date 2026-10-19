import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';

const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const integer=value=>Number.isInteger(value);
const rectOk=(rect,width,height)=>rect&&[rect.x,rect.y,rect.width,rect.height].every(integer)&&
  rect.x>=0&&rect.y>=0&&rect.width>0&&rect.height>0&&
  rect.x+rect.width<=width&&rect.y+rect.height<=height;
const overlap=(a,b)=>a.x<b.x+b.width&&a.x+a.width>b.x&&
  a.y<b.y+b.height&&a.y+a.height>b.y;
const validateFrame=frame=>{
  if(frame?.width!==640||frame?.height!==480||
      !(frame.rgb instanceof Uint8Array||Buffer.isBuffer(frame.rgb))||
      frame.rgb.length!==640*480*3)
    throw new Error('pointer feedback needs a decoded 640x480 RGB frame');
};
const PPM_HEADER=Buffer.from('P6\n640 480\n255\n');
export function readPointerPpm(bytes){
  const data=Buffer.from(bytes);
  if(data.length!==PPM_HEADER.length+640*480*3||
      !data.subarray(0,PPM_HEADER.length).equals(PPM_HEADER))
    throw new Error('pointer checkpoint must be an exact 640x480 P6 frame');
  return {width:640,height:480,rgb:data.subarray(PPM_HEADER.length)};
}
const changedIn=(left,right,rect)=>{
  let changed=0;
  for(let y=rect.y;y<rect.y+rect.height;y++)for(let x=rect.x;x<rect.x+rect.width;x++){
    const offset=(y*640+x)*3;
    if(left.rgb[offset]!==right.rgb[offset]||left.rgb[offset+1]!==right.rgb[offset+1]||
        left.rgb[offset+2]!==right.rgb[offset+2])changed++;
  }
  return changed;
};
const cropHash=(frame,rect)=>{
  const crop=Buffer.alloc(rect.width*rect.height*3);
  for(let y=0;y<rect.height;y++){
    const source=((rect.y+y)*640+rect.x)*3;
    crop.set(frame.rgb.subarray(source,source+rect.width*3),y*rect.width*3);
  }
  return sha256(crop);
};
export function pointerCropSha256(frame,rect){
  validateFrame(frame);
  if(!rectOk(rect,640,480))throw new Error('invalid cursor crop');
  return cropHash(frame,rect);
}
const validateRects=(application,parking)=>{
  if(!rectOk(application,640,480)||!rectOk(parking,640,480))
    throw new Error('application and parking rectangles must fit the 640x480 frame');
  if(overlap(application,parking))throw new Error('application and parking rectangles overlap');
};

/** Compare a named application region, excluding a separately proven cursor parking area. */
export function comparePointerApplicationFrames(control,candidate,
    {application,parking,minChangedPixels=500,controlParking,candidateParking}={}){
  validateFrame(control);validateFrame(candidate);validateRects(application,parking);
  if(!integer(minChangedPixels)||minChangedPixels<1||minChangedPixels>application.width*application.height)
    throw new Error('invalid application change threshold');
  const changedPixels=changedIn(control,candidate,application);
  const parked=controlParking?.parked===true&&candidateParking?.parked===true&&
    JSON.stringify(controlParking.parking)===JSON.stringify(parking)&&
    JSON.stringify(candidateParking.parking)===JSON.stringify(parking);
  return {changedPixels,minChangedPixels,parked,
    accepted:parked&&changedPixels>=minChangedPixels};
}

/** Before/after move evidence that the visible cursor entered an area outside the app ROI. */
export function verifyPointerParking(before,after,
    {application,parking,cursorTip,cursorCrop,reviewedCropSha256,minChangedPixels=8}={}){
  validateFrame(before);validateFrame(after);validateRects(application,parking);
  if(!cursorTip||!integer(cursorTip.x)||!integer(cursorTip.y)||
      cursorTip.x<parking.x||cursorTip.x>=parking.x+parking.width||
      cursorTip.y<parking.y||cursorTip.y>=parking.y+parking.height)
    throw new Error('observed cursor tip must be inside the parking rectangle');
  if(!integer(minChangedPixels)||minChangedPixels<1)
    throw new Error('invalid cursor parking threshold');
  if(!rectOk(cursorCrop,640,480)||!overlap(cursorCrop,parking)||
      cursorCrop.x<parking.x||cursorCrop.y<parking.y||
      cursorCrop.x+cursorCrop.width>parking.x+parking.width||
      cursorCrop.y+cursorCrop.height>parking.y+parking.height||
      cursorTip.x<cursorCrop.x||cursorTip.x>=cursorCrop.x+cursorCrop.width||
      cursorTip.y<cursorCrop.y||cursorTip.y>=cursorCrop.y+cursorCrop.height)
    throw new Error('reviewed cursor crop must contain the tip and fit inside parking');
  const beforeCropSha256=cropHash(before,cursorCrop);
  const afterCropSha256=cropHash(after,cursorCrop);
  if(!/^[0-9a-f]{64}$/.test(reviewedCropSha256)||reviewedCropSha256!==afterCropSha256)
    throw new Error('final cursor crop lacks a matching reviewed SHA-256');
  const changedPixels=changedIn(before,after,parking);
  const cropChangedPixels=changedIn(before,after,cursorCrop);
  return {parking,cursorTip,cursorCrop,beforeFrameSha256:sha256(before.rgb),
    afterFrameSha256:sha256(after.rgb),beforeCropSha256,afterCropSha256,
    changedPixels,cropChangedPixels,
    parked:changedPixels>=minChangedPixels&&cropChangedPixels>=minChangedPixels};
}

/** Refuse a mouse/no-mouse A/B whose guest, hardware profile or source differs. */
export function validatePointerPair(control,candidate){
  const fields=['executionRevision','sourceSha256','steps','stepLimit','milestones',
    'keyScriptSha256','keyboard',
    'input.bios.sha256','input.vga.sha256','input.hdd.sha256','input.hdd.geometry',
    'input.hdd.cmosType','input.mouseEnabled','input.cmosEquipment'];
  const at=(value,field)=>field.split('.').reduce((part,key)=>part?.[key],value);
  const errors=fields.filter(field=>JSON.stringify(at(control,field))!==JSON.stringify(at(candidate,field)));
  if(control?.input?.mouseEnabled!==true||candidate?.input?.mouseEnabled!==true)
    errors.push('both arms must enable the PS/2 mouse');
  return errors;
}

/** Only two zero-motion click packets may differ; all calibrated/parking moves match. */
export function validatePointerClickDifference(control,candidate){
  const checkpoints=report=>(report?.pointerFeedback??[])
    .map(({seq,step,nextStep})=>({seq,step,nextStep}));
  const packets=report=>(report?.pointerFeedback??[]).filter(event=>event.mouse)
    .map(event=>({step:event.step,...event.mouse,accepted:event.accepted}));
  const base=packets(control),changed=packets(candidate);
  const moves=events=>events.filter(event=>event.dx||event.dy);
  const errors=[];
  if(JSON.stringify(checkpoints(control))!==JSON.stringify(checkpoints(candidate)))
    errors.push('feedback checkpoint schedule differs');
  if(JSON.stringify(moves(base))!==JSON.stringify(moves(changed)))
    errors.push('calibrated and parking movement packets differ');
  if(base.some(event=>event.buttons!==0||(!event.dx&&!event.dy)))
    errors.push('control has a button or zero-motion packet');
  const buttons=changed.filter(event=>!event.dx&&!event.dy);
  if(buttons.length!==2||buttons[0].buttons!==1||buttons[1].buttons!==0||
      buttons[0].accepted!==true||buttons[1].accepted!==true||
      !(buttons[0].step<buttons[1].step))
    errors.push('candidate needs one accepted left press and release');
  const changedMoves=moves(changed);
  if(changedMoves.length<2||buttons[0]?.step<=changedMoves.at(-2)?.step||
      buttons[1]?.step>=changedMoves.at(-1)?.step)
    errors.push('click must follow calibration and precede the shared parking move');
  if([...base,...changed].some(event=>event.accepted!==true))
    errors.push('a movement or click packet was not accepted');
  return errors;
}

/** Require a guest auxiliary read triplet and IRQ12 delivery after every injected packet. */
export function validatePointerGuestDelivery(report){
  const inputs=report?.pointerDelivery??[];
  const expected=(report?.pointerFeedback??[]).filter(event=>event.mouse);
  const errors=[];
  if(inputs.length!==expected.length)return ['pointer delivery count differs from accepted input count'];
  for(let i=0;i<inputs.length;i++){
    const input=inputs[i],end=Math.min(input.step+250_001,inputs[i+1]?.step??Infinity);
    if(input.step!==expected[i].step||JSON.stringify(input.mouse)!==JSON.stringify(expected[i].mouse)){
      errors.push(`pointer delivery ${i} input does not match report`);continue;
    }
    const ports=input.auxPorts??[];
    const data=[];
    for(let j=0;j<ports.length-1;j++){
      const status=ports[j],byte=ports[j+1];
      if(status.step>=end)break;
      if(status.dir==='in'&&status.port===0x64&&(status.value&0x20)&&
          byte.dir==='in'&&byte.port===0x60&&byte.step<end)data.push(byte.value);
    }
    if(data.length<3)errors.push(`pointer delivery ${i} lacks three auxiliary reads`);
    if(!(input.irq12??[]).some(irq=>irq.step<end))
      errors.push(`pointer delivery ${i} lacks IRQ12 delivery`);
  }
  return errors;
}

/** Private output directory and atomic command files keep the instruction loop paused safely. */
export function createPointerFeedbackSession({directory,firstStep,limit,timeoutMs=600_000,
    readFrame,injectMouse,maxCommands=16}){
  if(!directory||!integer(firstStep)||firstStep<0||!integer(limit)||firstStep>=limit||
      !integer(timeoutMs)||timeoutMs<20||timeoutMs>600_000||
      !integer(maxCommands)||maxCommands<1||maxCommands>64||
      typeof readFrame!=='function'||typeof injectMouse!=='function')
    throw new Error('invalid pointer feedback session parameters');
  mkdirSync(directory);
  const events=[];
  let nextStep=firstStep;
  let sequence=0;
  const checkpoint=async step=>{
    if(step!==nextStep||sequence>=maxCommands)throw new Error('unexpected pointer feedback checkpoint');
    const frame=readFrame();validateFrame(frame);
    const ppm=Buffer.concat([PPM_HEADER,Buffer.from(frame.rgb)]);
    const ready={schema:'bw.i80386-windows-pointer-ready.v1',seq:sequence,step,
      rgbSha256:sha256(frame.rgb),frame:`frame-${sequence}.ppm`};
    writeFileSync(path.join(directory,ready.frame),ppm,{flag:'wx'});
    writeFileSync(path.join(directory,`ready-${sequence}.json`),`${JSON.stringify(ready,null,2)}\n`,{flag:'wx'});
    const commandFile=path.join(directory,`command-${sequence}.json`);
    const started=Date.now();
    while(!existsSync(commandFile)){
      if(Date.now()-started>=timeoutMs)throw new Error('pointer feedback command timed out');
      await new Promise(resolve=>setTimeout(resolve,10));
    }
    const command=JSON.parse(readFileSync(commandFile,'utf8'));
    if(command?.seq!==sequence||command.atStep!==step||
        !(command.nextStep===null||(integer(command.nextStep)&&command.nextStep>step&&
          command.nextStep<limit))||
        (command.mouse!==undefined&&(!command.mouse||
          !integer(command.mouse.dx)||command.mouse.dx< -255||command.mouse.dx>255||
          !integer(command.mouse.dy)||command.mouse.dy< -255||command.mouse.dy>255||
          !integer(command.mouse.buttons)||command.mouse.buttons<0||command.mouse.buttons>7)))
      throw new Error('invalid pointer feedback command');
    let accepted=null;
    if(command.mouse!==undefined){
      accepted=injectMouse(command.mouse);
      if(accepted!==true)throw new Error('guest refused pointer feedback packet');
    }
    events.push({seq:sequence,step,frameRgbSha256:ready.rgbSha256,
      mouse:command.mouse??null,accepted,nextStep:command.nextStep});
    nextStep=command.nextStep;sequence++;
    return nextStep;
  };
  return {checkpoint,events,get nextStep(){return nextStep;}};
}
