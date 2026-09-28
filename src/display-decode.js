/**
 * The engine's display payloads (labwired `get_display`) -> RGBA, in the
 * `{width, height, rgba, frame, signal}` shape every video() here returns.
 *
 * Formats are the engine's own names (labwired core `inspect::format`):
 *   ssd1306_page / sh1107_page / pcd8544_bank  page-packed mono: byte
 *       page*width + x, bit k is pixel (x, page*8 + k), 1 = lit;
 *   rgb565_be   two bytes per pixel, big-endian, row-major.
 * Anything else (e-paper planes, 7-segment, text) is refused by returning
 * null with `refused` set, never drawn as something it is not.
 * @module
 */

const MONO_PAGE = new Set(['ssd1306_page', 'sh1107_page', 'pcd8544_bank']);

/**
 * @param {{format: string, width: number, height: number, bytes: ArrayLike<number>}} d
 * @returns {{width:number,height:number,rgba:Uint8ClampedArray}|{refused:string}}
 */
export function decodeDisplay (d) {
  if (!d || !d.bytes) return { refused: 'no pixels reported' };
  const { format, width: w, height: h } = d;
  if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0) {
    return { refused: `display ${format} reported no geometry` };
  }
  const bytes = d.bytes;
  const rgba = new Uint8ClampedArray(w * h * 4);
  if (MONO_PAGE.has(format)) {
    // An LCD (PCD8544) draws dark ink on a light panel; an OLED lights pixels.
    const lcd = format === 'pcd8544_bank';
    const on = lcd ? [20, 30, 20] : [230, 240, 255];
    const off = lcd ? [170, 190, 160] : [0, 0, 0];
    for (let y = 0; y < h; y++) {
      const page = y >> 3, bit = y & 7;
      for (let x = 0; x < w; x++) {
        const lit = ((bytes[page * w + x] ?? 0) >> bit) & 1;
        const c = lit ? on : off;
        const o = (y * w + x) * 4;
        rgba[o] = c[0]; rgba[o + 1] = c[1]; rgba[o + 2] = c[2]; rgba[o + 3] = 255;
      }
    }
    return { width: w, height: h, rgba };
  }
  if (format === 'rgb565_be') {
    for (let i = 0; i < w * h; i++) {
      const v = ((bytes[2 * i] ?? 0) << 8) | (bytes[2 * i + 1] ?? 0);
      const o = i * 4;
      rgba[o] = ((v >> 11) & 0x1f) * 255 / 31;
      rgba[o + 1] = ((v >> 5) & 0x3f) * 255 / 63;
      rgba[o + 2] = (v & 0x1f) * 255 / 31;
      rgba[o + 3] = 255;
    }
    return { width: w, height: h, rgba };
  }
  return { refused: `this tier does not draw '${format}' yet` };
}
