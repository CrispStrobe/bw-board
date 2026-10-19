#!/usr/bin/env node
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {createDoomFat16Hdd} from './lib/i80386-doom-fat16-image.mjs';

const [doomExePath,doomWadPath,outputPath]=process.argv.slice(2);
if(!doomExePath||!doomWadPath||!outputPath)
  throw new Error('usage: build-i80386-doom-short-demo.mjs DOOM.EXE DOOM1.WAD OUTPUT.img');
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const EXPECTED_EXE='b8020523561a5ad9706e009a52d61c578f37faafd85ac471962308406292ce27';
const EXPECTED_WAD='1d7d43be501e67d927e415e0b8f3e29c3bf33075e859721816f652a526cac771';
const header=Uint8Array.of(109,2,1,1,0,0,0,0,0,1,0,0,0);
const commands=[];
for(let tic=0;tic<20;tic++)commands.push(25,0,0,0);
for(let tic=0;tic<4;tic++)commands.push(0,0,0,1);
const demo=Uint8Array.from([...header,...commands,0x80]);
const doomExe=fs.readFileSync(doomExePath),doomWad=fs.readFileSync(doomWadPath);
if(sha256(doomExe)!==EXPECTED_EXE||sha256(doomWad)!==EXPECTED_WAD)
  throw new Error('short timedemo requires the pinned Doom 1.9 shareware EXE and IWAD');
const {image,manifest}=createDoomFat16Hdd({doomExe,doomWad,
  extraFiles:[{name:'ASTRA   LMP',bytes:demo}]});
fs.writeFileSync(outputPath,image,{flag:'wx'});
process.stdout.write(`${JSON.stringify({schema:'astra.i80386-doom-short-demo-input.v1',
  scope:'owned 24-tic Doom 1.9 demo: 20 forward commands, four attack commands, then DEMOMARKER',
  inputs:{doomExe:{bytes:doomExe.length,sha256:sha256(doomExe)},
    doomWad:{bytes:doomWad.length,sha256:sha256(doomWad)}},
  demo:{name:'ASTRA.LMP',bytes:demo.length,sha256:sha256(demo),headerBytes:header.length,
    commandTics:24,terminator:0x80},image:{path:outputPath,bytes:image.length,
    sha256:sha256(image)},manifest},null,2)}\n`);
