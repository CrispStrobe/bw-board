import { registerDevice } from '../devices.js';

/** Board-side shell for a machine-level VGA card. The 6502 adapter attaches
 * the actual SimpleVGA instance after extracting the drawn bus ribbon. */
export function registerSimpleVGACard() {
  registerDevice('simplevga_card', {
    terminals: ['vcc', 'gnd', 'bus', 'bank'],
    init() {
      return {
        drives: {},
        _video: null,
        videoFrame() {
          return this._video && typeof this._video.videoFrame === 'function'
            ? this._video.videoFrame() : null;
        },
      };
    },
  });
}
