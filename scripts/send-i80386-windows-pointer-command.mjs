#!/usr/bin/env node
/** Publish one complete command to a paused private Windows pointer probe. */
import {closeSync,existsSync,fsyncSync,openSync,readFileSync,renameSync,
  unlinkSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

export function publishPointerCommand(directory,seq,nextStep,mouse){
  if(!Number.isInteger(seq)||seq<0||
      !(nextStep===null||(Number.isInteger(nextStep)&&nextStep>0))||
      (mouse!==null&&(!Number.isInteger(mouse?.dx)||mouse.dx< -255||mouse.dx>255||
        !Number.isInteger(mouse?.dy)||mouse.dy< -255||mouse.dy>255||
        !Number.isInteger(mouse?.buttons)||mouse.buttons<0||mouse.buttons>7)))
    throw new Error('invalid pointer command arguments');
  const ready=JSON.parse(readFileSync(path.join(directory,`ready-${seq}.json`),'utf8'));
  if(ready.schema!=='bw.i80386-windows-pointer-ready.v1'||ready.seq!==seq||
      !Number.isInteger(ready.step)||ready.step<0||
      (nextStep!==null&&nextStep<=ready.step))
    throw new Error('command does not match a ready checkpoint');
  const destination=path.join(directory,`command-${seq}.json`);
  if(existsSync(destination))throw new Error('command already published');
  const command={seq,atStep:ready.step,nextStep,...(mouse===null?{}:{mouse})};
  const temporary=path.join(directory,`command-${seq}.${process.pid}.tmp`);
  const fd=openSync(temporary,'wx');
  try{
    writeFileSync(fd,`${JSON.stringify(command)}\n`);fsyncSync(fd);
  }finally{closeSync(fd);}
  try{
    if(existsSync(destination))throw new Error('command already published');
    renameSync(temporary,destination);
  }finally{if(existsSync(temporary))unlinkSync(temporary);}
  return command;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const [directory,seqText,nextStepText,dxText,dyText,buttonsText]=process.argv.slice(2);
  if(!directory||!seqText||!nextStepText||
      !((dxText===undefined&&dyText===undefined&&buttonsText===undefined)||
        (dxText!==undefined&&dyText!==undefined&&buttonsText!==undefined)))
    throw new Error('usage: send-i80386-windows-pointer-command.mjs DIR SEQ NEXT_STEP|end [DX DY BUTTONS]');
  const command=publishPointerCommand(directory,Number(seqText),
    nextStepText==='end'?null:Number(nextStepText),
    dxText===undefined?null:{dx:Number(dxText),dy:Number(dyText),buttons:Number(buttonsText)});
  process.stdout.write(`${JSON.stringify(command)}\n`);
}
