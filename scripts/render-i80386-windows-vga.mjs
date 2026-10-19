#!/usr/bin/env node
import fs from 'node:fs';
import {renderObservedWindowsEga,ppmFromWindowsEga} from './lib/i80386-windows-vga-frame.mjs';

const [input,output]=process.argv.slice(2);
if(!input||!output)throw new Error('usage: render-i80386-windows-vga.mjs REPORT.json OUTPUT.ppm');
const report=JSON.parse(fs.readFileSync(input,'utf8'));
const frame=renderObservedWindowsEga(report.vga?.snapshot??report.vga);
fs.writeFileSync(output,ppmFromWindowsEga(frame));
process.stdout.write(`${JSON.stringify({input,output,width:frame.width,height:frame.height,
  start:frame.start,stride:frame.stride,uniqueRgbColors:frame.uniqueRgbColors,
  indexSha256:frame.indexSha256,rgbSha256:frame.rgbSha256},null,2)}\n`);
