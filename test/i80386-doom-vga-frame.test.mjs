import assert from 'node:assert/strict';
import test from 'node:test';
import {renderObservedDoomVga,ppmFromDoomVgaFrame} from '../scripts/lib/i80386-doom-vga-frame.mjs';

const fixture=()=>{
  const planes=Array.from({length:4},()=>Buffer.alloc(0x10000));
  const dac=Buffer.alloc(768);dac.set([0,0,0,63,32,1]);
  for(let x=0;x<320;x++)planes[x&3][x>>>2]=x&1;
  return {seq:[0,0,0,0,6],gc:[0,0,0,0,0,0x40,5],
    crtc:Object.assign(Array(0x20).fill(0),{1:79,6:0xbf,7:0x1f,9:0x41,0x12:0x8f,
      0x13:40,0x14:0,0x17:0xe3,0x18:0xff}),
    attr:Object.assign(Array(0x20).fill(0),{0x10:0x41,0x12:0x0f,0x13:0,0x14:0}),
    dacMask:0xff,
    dacBase64:dac.toString('base64'),planesBase64:planes.map(plane=>plane.toString('base64'))};
};

test('renders the exact observed Doom planar scan and six-bit DAC',()=>{
  const frame=renderObservedDoomVga(fixture());
  assert.equal(frame.width,320);assert.equal(frame.height,200);assert.equal(frame.planeStride,80);
  assert.deepEqual(Array.from(frame.indices.slice(0,6)),[0,1,0,1,0,1]);
  assert.deepEqual(Array.from(frame.rgb.slice(0,6)),[0,0,0,255,130,4]);
  assert.equal(frame.uniqueRgbColors,2);
  assert.match(ppmFromDoomVgaFrame(frame).subarray(0,20).toString(),/^P6\n320 200\n255\n/);
});

test('rejects an unobserved chain-4 or CRTC layout',()=>{
  const chain4=fixture();chain4.seq[4]=0x0e;
  assert.throws(()=>renderObservedDoomVga(chain4),/outside the observed/);
  const stride=fixture();stride.crtc[0x13]=80;
  assert.throws(()=>renderObservedDoomVga(stride),/outside the observed/);
  const missing=fixture();delete missing.dacMask;
  assert.throws(()=>renderObservedDoomVga(missing),/invalid DAC mask/);
});

test('honors the observed alternate page start and DAC pixel mask',()=>{
  const snapshot=fixture();snapshot.crtc[0x0c]=0x80;snapshot.dacMask=0;
  const planes=snapshot.planesBase64.map(value=>Buffer.from(value,'base64'));
  planes[0][0]=1;planes[0][0x8000]=0;
  snapshot.planesBase64=planes.map(plane=>plane.toString('base64'));
  const frame=renderObservedDoomVga(snapshot);
  assert.equal(frame.start,0x8000);
  assert.equal(frame.indices[0],0);
  assert.equal(frame.uniqueRgbColors,1);
});
