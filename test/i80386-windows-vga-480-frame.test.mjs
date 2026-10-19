import test from 'node:test';
import assert from 'node:assert/strict';
import {renderObservedWindowsVga480} from '../scripts/lib/i80386-windows-vga-480-frame.mjs';

function fixture() {
  const registers={misc:0xe3,seq:Array(8).fill(0),gc:Array(16).fill(0),
    crtc:Array(32).fill(0),attr:Array(32).fill(0),dac:Array(768).fill(0),
    dacMask:255};
  Object.assign(registers.seq,{0:3,1:1,2:15,4:6});
  registers.gc[6]=5;
  Object.assign(registers.crtc,{1:79,6:11,7:62,9:64,18:223,19:40,23:227,24:255});
  Object.assign(registers.attr,{1:1,2:2,16:1,18:15});
  registers.dac[3]=63;registers.dac[7]=42;
  const planes=Array.from({length:4},()=>Buffer.alloc(0x10000));
  planes[0][0]=0x80;planes[1][0]=0x40;planes[0][80]=0x80;
  return {registers,planeBase64:planes.map(plane=>plane.toString('base64'))};
}

test('synthetic 640x480 planar frame decodes scanlines, palettes, and DAC',()=>{
  const frame=renderObservedWindowsVga480(fixture());
  assert.equal(frame.width,640);assert.equal(frame.height,480);
  assert.equal(frame.stride,80);assert.equal(frame.uniqueRgbColors,3);
  assert.deepEqual(Array.from(frame.indices.slice(0,3)),[1,2,0]);
  assert.equal(frame.indices[640],1);
  assert.deepEqual(Array.from(frame.rgb.slice(0,9)),[255,0,0,0,170,0,0,0,0]);
});

test('640x480 renderer rejects another VGA mode or an incomplete snapshot',()=>{
  const snapshot=fixture();
  snapshot.registers.crtc[18]=0x5d;
  assert.throws(()=>renderObservedWindowsVga480(snapshot),/outside the observed/);
  snapshot.registers.crtc[18]=0xdf;
  snapshot.registers.dac[3]=64;
  assert.throws(()=>renderObservedWindowsVga480(snapshot),/six-bit DAC/);
  snapshot.registers.dac[3]=63;
  snapshot.planeBase64.pop();
  assert.throws(()=>renderObservedWindowsVga480(snapshot),/four 64KiB/);
});
