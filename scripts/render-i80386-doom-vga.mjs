#!/usr/bin/env node
import fs from 'node:fs';
import {renderObservedDoomVga,ppmFromDoomVgaFrame} from './lib/i80386-doom-vga-frame.mjs';

const [input,output]=process.argv.slice(2);
if(!input||!output)throw new Error('usage: render-i80386-doom-vga.mjs REPORT.json OUTPUT.ppm');
const report=JSON.parse(fs.readFileSync(input,'utf8'));
const snapshot=report.vgaEvidence?.latestGraphicsSnapshot??report.vga?.latest;
if(snapshot?.dacMask===undefined&&report.vgaDiagnostics?.state?.dacMask!==undefined)
  snapshot.dacMask=report.vgaDiagnostics.state.dacMask;
const frame=renderObservedDoomVga(snapshot);
fs.writeFileSync(output,ppmFromDoomVgaFrame(frame));
process.stdout.write(`${JSON.stringify({input,output,width:frame.width,height:frame.height,
  start:frame.start,planeStride:frame.planeStride,uniqueRgbColors:frame.uniqueRgbColors,
  indexSha256:frame.indexSha256,rgbSha256:frame.rgbSha256},null,2)}\n`);
