import test from 'node:test';
import assert from 'node:assert/strict';
import {renderObservedWindowsEga} from '../scripts/lib/i80386-windows-vga-frame.mjs';

const fixture=()=>{
  const planes=Array.from({length:4},()=>Buffer.alloc(0x10000));
  planes[0][0]=0x80;planes[1][0]=0x40;
  const dac=Array(768).fill(0);dac[3]=63;dac[7]=63;
  const crtc=Array(0x20).fill(0);Object.assign(crtc,{1:79,6:0xbf,7:0x1f,8:0,9:0x40,
    0x12:0x5d,0x13:40,0x14:0x0f,0x17:0xe3});
  const attr=Array(0x20).fill(0);for(let i=0;i<16;i++)attr[i]=i;
  attr[0x10]=1;attr[0x12]=0x0f;
  const seq=Array(8).fill(0);Object.assign(seq,{0:3,1:1,2:0x0f,4:6});
  const gc=Array(16).fill(0);gc[6]=5;
  return {planeBase64:planes.map(value=>value.toString('base64')),registers:{misc:0xa3,
    seq,gc,crtc,attr,dac,dacMask:0xff}};
};

test('renders the exact observed Windows 640x350 four-plane state',()=>{
  const frame=renderObservedWindowsEga(fixture());
  assert.deepEqual([frame.width,frame.height,frame.stride,frame.start],[640,350,80,0]);
  assert.deepEqual([...frame.indices.slice(0,3)],[1,2,0]);
  assert.deepEqual([...frame.rgb.slice(0,9)],[255,0,0,0,255,0,0,0,0]);
});

test('rejects omitted display controls, non-six-bit DAC, and unrelated layouts',()=>{
  const noStart=fixture();delete noStart.registers.crtc[0x0c];
  assert.throws(()=>renderObservedWindowsEga(noStart),/complete byte-valued/);
  const noGc5=fixture();delete noGc5.registers.gc[5];
  assert.throws(()=>renderObservedWindowsEga(noGc5),/complete byte-valued/);
  const noPalette=fixture();delete noPalette.registers.attr[0];
  assert.throws(()=>renderObservedWindowsEga(noPalette),/complete byte-valued/);
  const panned=fixture();panned.registers.crtc[8]=1;
  assert.throws(()=>renderObservedWindowsEga(panned),/outside the observed/);
  const mask=fixture();delete mask.registers.dacMask;
  assert.throws(()=>renderObservedWindowsEga(mask),/invalid DAC mask/);
  for(const value of [64,257,-255]) {
    const dac=fixture();dac.registers.dac[0]=value;
    assert.throws(()=>renderObservedWindowsEga(dac),/six-bit DAC/);
  }
  const stride=fixture();stride.registers.crtc[0x13]=80;
  assert.throws(()=>renderObservedWindowsEga(stride),/outside the observed/);
});

test('honors CRTC start address, attribute palette, and DAC mask',()=>{
  const snapshot=fixture();snapshot.registers.crtc[0x0c]=0x40;
  const planes=snapshot.planeBase64.map(value=>Buffer.from(value,'base64'));
  planes[0][0]=0;planes[0][0x4000]=0x80;snapshot.planeBase64=planes.map(value=>value.toString('base64'));
  snapshot.registers.dacMask=0x0f;
  const frame=renderObservedWindowsEga(snapshot);
  assert.equal(frame.start,0x4000);assert.equal(frame.indices[0],1);
});
