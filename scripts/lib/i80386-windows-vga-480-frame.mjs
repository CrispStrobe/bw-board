import {createHash} from 'node:crypto';

const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const validBytes=(values,length,max=0xff)=>Array.isArray(values)&&values.length===length&&
  values.every(value=>Number.isInteger(value)&&value>=0&&value<=max);
const sixToEight=value=>(value<<2)|(value>>>4);

/** Render the observed Windows 3.11 640x480x16 planar VGA register state. */
export function renderObservedWindowsVga480(snapshot) {
  const r=snapshot?.registers;
  if(!r||!Number.isInteger(r.misc)||r.misc<0||r.misc>0xff||
      !validBytes(r.seq,8)||!validBytes(r.gc,16)||!validBytes(r.crtc,32)||
      !validBytes(r.attr,32)||!validBytes(r.dac,768,63)||
      !Number.isInteger(r.dacMask)||r.dacMask<0||r.dacMask>0xff)
    throw new Error('snapshot must contain complete byte-valued VGA registers and a six-bit DAC');
  if(r.misc!==0xe3||r.seq[0]!==3||r.seq[1]!==1||r.seq[2]!==15||r.seq[4]!==6||
      (r.gc[5]&0x60)!==0||r.gc[6]!==5||r.crtc[1]!==79||r.crtc[6]!==0x0b||
      r.crtc[7]!==0x3e||r.crtc[8]!==0||r.crtc[9]!==0x40||
      r.crtc[0x0c]!==0||r.crtc[0x0d]!==0||r.crtc[0x12]!==0xdf||
      r.crtc[0x13]!==40||r.crtc[0x14]!==0||r.crtc[0x17]!==0xe3||
      r.crtc[0x18]!==0xff||r.attr[0x10]!==1||r.attr[0x12]!==15||
      r.attr[0x13]!==0||r.attr[0x14]!==0)
    throw new Error('snapshot is outside the observed Windows 640x480 planar state');
  const planes=(snapshot.planeBase64??[]).map(value=>Buffer.from(value,'base64'));
  if(planes.length!==4||planes.some(plane=>plane.length!==0x10000))
    throw new Error('snapshot must contain four 64KiB VGA planes');
  const width=640,height=480,start=0,stride=r.crtc[0x13]*2;
  const indices=new Uint8Array(width*height),rgb=new Uint8Array(width*height*3);
  const colors=new Set();
  for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
    const address=(start+y*stride+(x>>>3))&0xffff,bit=7-(x&7);
    let attribute=0;
    for(let plane=0;plane<4;plane++)attribute|=((planes[plane][address]>>>bit)&1)<<plane;
    let index=r.attr[attribute]&0x3f;
    if(r.attr[0x10]&0x80)index=(index&0x0f)|((r.attr[0x14]&3)<<4);
    index=(index|((r.attr[0x14]&0x0c)<<4))&r.dacMask;
    const pixel=y*width+x;
    indices[pixel]=index;
    const offset=index*3;
    const red=sixToEight(r.dac[offset]),green=sixToEight(r.dac[offset+1]);
    const blue=sixToEight(r.dac[offset+2]);
    rgb[pixel*3]=red;rgb[pixel*3+1]=green;rgb[pixel*3+2]=blue;
    colors.add((red<<16)|(green<<8)|blue);
  }
  return {width,height,start,stride,indices,rgb,uniqueRgbColors:colors.size,
    indexSha256:sha256(indices),rgbSha256:sha256(rgb)};
}
