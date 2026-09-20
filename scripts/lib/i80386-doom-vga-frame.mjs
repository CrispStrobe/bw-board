import {createHash} from 'node:crypto';

const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const sixToEight=value=>(value<<2)|(value>>>4);

export function renderObservedDoomVga(snapshot) {
  // This renderer is deliberately limited to the title-screen register state
  // observed in the source-bound run.  The card does not yet expose the
  // attribute-controller PAS/display-enable latch, so this is raw raster
  // evidence rather than a complete monitor-output model.
  if(!snapshot||snapshot.seq?.[0]!==0x03||snapshot.seq?.[1]!==0x01||snapshot.seq?.[4]!==0x06||
      snapshot.gc?.[5]!==0x40||snapshot.gc?.[6]!==0x05||
      snapshot.crtc?.[1]!==79||snapshot.crtc?.[6]!==0xbf||snapshot.crtc?.[7]!==0x1f||
      snapshot.crtc?.[8]!==0||snapshot.crtc?.[9]!==0x41||snapshot.crtc?.[0x12]!==0x8f||
      snapshot.crtc?.[0x13]!==40||
      snapshot.crtc?.[0x14]!==0||snapshot.crtc?.[0x17]!==0xe3||snapshot.crtc?.[0x18]!==0xff||
      snapshot.attr?.[0x10]!==0x41||snapshot.attr?.[0x12]!==0x0f||
      snapshot.attr?.[0x13]!==0||snapshot.attr?.[0x14]!==0)
    throw new Error('snapshot is outside the observed Doom unchained 320x200 VGA mode');
  const planes=(snapshot.planesBase64??[]).map(value=>Buffer.from(value,'base64'));
  if(planes.length!==4||planes.some(plane=>plane.length!==0x10000))
    throw new Error('snapshot must contain four 64KiB VGA planes');
  const dac=Buffer.from(snapshot.dacBase64??'','base64');
  if(dac.length!==768)throw new Error('snapshot must contain 768 six-bit DAC bytes');
  if(dac.some(value=>value>63))throw new Error('snapshot DAC contains a component wider than six bits');
  const dacMask=snapshot.dacMask;
  if(!Number.isInteger(dacMask)||dacMask<0||dacMask>0xff)throw new Error('invalid DAC mask');
  if(!Number.isInteger(snapshot.crtc[0x0c])||!Number.isInteger(snapshot.crtc[0x0d]))
    throw new Error('snapshot must contain an explicit CRTC start address');
  const start=((snapshot.crtc[0x0c]<<8)|snapshot.crtc[0x0d])&0xffff;
  if(start!==0&&start!==0x8000)throw new Error('unsupported observed Doom page start');
  const width=320,height=200,planeStride=snapshot.crtc[0x13]*2;
  const indices=new Uint8Array(width*height);
  const rgb=new Uint8Array(indices.length*3);
  const colors=new Set();
  for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
    const pixel=y*width+x;
    const index=planes[x&3][(start+y*planeStride+(x>>>2))&0xffff]&dacMask;
    indices[pixel]=index;
    const components=[dac[index*3],dac[index*3+1],dac[index*3+2]].map(sixToEight);
    colors.add((components[0]<<16)|(components[1]<<8)|components[2]);
    rgb.set(components,pixel*3);
  }
  return {width,height,start,planeStride,indices,rgb,uniqueRgbColors:colors.size,
    indexSha256:sha256(indices),rgbSha256:sha256(rgb)};
}

export function ppmFromDoomVgaFrame(frame) {
  return Buffer.concat([Buffer.from(`P6\n${frame.width} ${frame.height}\n255\n`),frame.rgb]);
}
