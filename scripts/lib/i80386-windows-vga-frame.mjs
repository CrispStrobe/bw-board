import {createHash} from 'node:crypto';

const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const sixToEight=value=>(value<<2)|(value>>>4);

/** Render only the exact 640x350x16 EGA-compatible VGA state observed in Windows 3.0. */
export function renderObservedWindowsEga(snapshot) {
  const r=snapshot?.registers;
  if(!r||r.misc!==0xa3||r.seq?.[0]!==3||r.seq?.[1]!==1||r.seq?.[2]!==0x0f||r.seq?.[4]!==6||
      (r.gc?.[5]&0x60)!==0||r.gc?.[6]!==5||r.crtc?.[1]!==79||r.crtc?.[6]!==0xbf||
      r.crtc?.[7]!==0x1f||r.crtc?.[8]!==0||r.crtc?.[9]!==0x40||r.crtc?.[0x12]!==0x5d||
      r.crtc?.[0x13]!==40||r.crtc?.[0x14]!==0x0f||r.crtc?.[0x17]!==0xe3||
      r.attr?.[0x10]!==1||r.attr?.[0x12]!==0x0f||r.attr?.[0x13]!==0||r.attr?.[0x14]!==0)
    throw new Error('snapshot is outside the observed Windows 640x350 planar state');
  if(!Number.isInteger(r.crtc[0x0c])||!Number.isInteger(r.crtc[0x0d]))
    throw new Error('snapshot must contain an explicit CRTC start address');
  if(!Number.isInteger(r.dacMask)||r.dacMask<0||r.dacMask>0xff)
    throw new Error('invalid DAC mask');
  const dac=Uint8Array.from(r.dac??[]);
  if(dac.length!==768||dac.some(value=>value>63))
    throw new Error('snapshot must contain 256 six-bit DAC entries');
  const planes=(snapshot.planeBase64??[]).map(value=>Buffer.from(value,'base64'));
  if(planes.length!==4||planes.some(plane=>plane.length!==0x10000))
    throw new Error('snapshot must contain four 64KiB VGA planes');
  const width=640,height=350,stride=r.crtc[0x13]*2;
  const start=((r.crtc[0x0c]<<8)|r.crtc[0x0d])&0xffff;
  const indices=new Uint8Array(width*height),rgb=new Uint8Array(width*height*3),colors=new Set();
  for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
    const address=(start+y*stride+(x>>>3))&0xffff,bit=7-(x&7);
    let attribute=0;
    for(let plane=0;plane<4;plane++)attribute|=((planes[plane][address]>>>bit)&1)<<plane;
    let index=r.attr[attribute]&0x3f;
    if(r.attr[0x10]&0x80)index=(index&0x0f)|((r.attr[0x14]&3)<<4);
    index=(index|((r.attr[0x14]&0x0c)<<4))&r.dacMask;
    const pixel=y*width+x;indices[pixel]=index;
    const components=[dac[index*3],dac[index*3+1],dac[index*3+2]].map(sixToEight);
    colors.add((components[0]<<16)|(components[1]<<8)|components[2]);rgb.set(components,pixel*3);
  }
  return {width,height,start,stride,indices,rgb,uniqueRgbColors:colors.size,
    indexSha256:sha256(indices),rgbSha256:sha256(rgb)};
}

export function ppmFromWindowsEga(frame) {
  return Buffer.concat([Buffer.from(`P6\n${frame.width} ${frame.height}\n255\n`),frame.rgb]);
}
