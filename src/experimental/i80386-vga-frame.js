import {renderMode} from '../i8086-cga.js';

const sixToEight = value => (value << 2) | (value >>> 4);

/** The Windows 3.11 mode observed by the external QEMU oracle. Other planar
 * timings remain with the existing renderer until independently qualified. */
function isObserved480(r) {
  return r.misc === 0xe3 && r.seq[0] === 3 && r.seq[1] === 1 &&
    r.seq[2] === 15 && r.seq[4] === 6 && (r.gc[5] & 0x60) === 0 &&
    r.gc[6] === 5 && r.crtc[1] === 79 && r.crtc[6] === 0x0b &&
    r.crtc[7] === 0x3e && r.crtc[8] === 0 && r.crtc[9] === 0x40 &&
    r.crtc[0x0c] === 0 && r.crtc[0x0d] === 0 && r.crtc[0x12] === 0xdf &&
    r.crtc[0x13] === 40 && r.crtc[0x14] === 0 && r.crtc[0x17] === 0xe3 &&
    r.crtc[0x18] === 0xff && r.attr[0x10] === 1 && r.attr[0x12] === 15 &&
    r.attr[0x13] === 0 && r.attr[0x14] === 0;
}

/** Render from the live VGA planes. The generic 8086 debug target reads its
 * conventional RAM map, but a 386 VGA write goes to these planes instead. */
export function renderI80386VgaFrame(machine) {
  const memory = machine?.vgaMemory;
  const card = memory?.registerSource;
  if (!memory || !card?.getVideoState) return null;
  const r = card.getVideoState();
  if (!r.misc) return null;
  const planes = memory.planes;
  if ((r.gc[6] & 1) === 0) {
    // Text mode's CPU A0 selects character/attribute planes; both use the
    // even-address index after the VGA odd/even substitution.
    const frame = renderMode(0x03, address => {
      const offset = address - 0xb8000;
      return planes[offset & 1][(offset & ~1) & 0xffff];
    }, r.dac.some(value => value !== 0) ? {dac: r.dac} : {});
    return {...frame, frame: machine.displayRevision >>> 0, mode: 0x03,
      why: '386 VGA text planes'};
  }
  const chain4 = (r.seq[4] & 0x08) !== 0;
  const eightBit = (r.attr[0x10] & 0x40) !== 0;
  if (chain4 && eightBit && (r.gc[6] & 0x0c) === 4 && r.crtc[0x13] === 40) {
    const width = 320, height = 200;
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const address = y * width + x;
        const index = planes[address & 3][address & ~3] & r.dacMask;
        const pixel = address * 4, dac = index * 3;
        rgba[pixel] = sixToEight(r.dac[dac]);
        rgba[pixel + 1] = sixToEight(r.dac[dac + 1]);
        rgba[pixel + 2] = sixToEight(r.dac[dac + 2]);
        rgba[pixel + 3] = 255;
      }
    }
    return {width, height, rgba, frame: machine.displayRevision >>> 0,
      mode: 0x13, why: '386 VGA chain-4 planes'};
  }
  if (!isObserved480(r)) return {unsupported:
    '386 VGA graphics mode is outside qualified chain-4 320x200 and Windows 640x480 states'};

  const width = 640, height = 480, stride = r.crtc[0x13] * 2;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const row = y * stride;
    for (let x = 0; x < width; x++) {
      const address = (row + (x >>> 3)) & 0xffff;
      const bit = 7 - (x & 7);
      let attribute = 0;
      for (let plane = 0; plane < 4; plane++)
        attribute |= ((planes[plane][address] >>> bit) & 1) << plane;
      let index = r.attr[attribute] & 0x3f;
      if (r.attr[0x10] & 0x80) index = (index & 0x0f) | ((r.attr[0x14] & 3) << 4);
      index = (index | ((r.attr[0x14] & 0x0c) << 4)) & r.dacMask;
      const pixel = (y * width + x) * 4;
      const dac = index * 3;
      rgba[pixel] = sixToEight(r.dac[dac]);
      rgba[pixel + 1] = sixToEight(r.dac[dac + 1]);
      rgba[pixel + 2] = sixToEight(r.dac[dac + 2]);
      rgba[pixel + 3] = 255;
    }
  }
  return {width, height, rgba, frame: machine.displayRevision >>> 0, mode: 0x12,
    why: 'observed Windows 3.11 640x480 planar VGA'};
}
