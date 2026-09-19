/**
 * PS/2 mouse — board-side device model, the pointer counterpart of
 * ps2-device.js. The board part holds a PS2Mouse whose move/press/release
 * queue standard 3-byte packets; the actual paced-frame delivery runs on the
 * MACHINE side through the same PS2Capture + ps2On8255/ps2OnVia path the
 * keyboard uses (a mouse is just another PS/2 device on the wire). The adapter
 * detects the drawn `ps2mouse` part's wiring (d0-d7 -> a port, da -> a status
 * bit) and bridges `state._mouse` — see i8086-adapter.js bridgePS2.
 *
 * The device declares terminals for the designer UI's wiring display only;
 * protocol delivery is machine-side, so there is no stamp/update here.
 *
 * @module
 */

import { registerDevice } from '../devices.js';
import { PS2Mouse } from '../ps2.js';

export function registerPS2MouseDevice() {

  const BUTTONS = new Set(['left', 'right', 'middle']);

  const model = {
    terminals: ['d0', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'da'],

    init(part) {
      const mouse = new PS2Mouse();
      return {
        drives: {},

        // The PS2Mouse that turns motion/clicks into packet bytes. The adapter
        // reads this (state._mouse) to wire the capture on the machine side.
        _mouse: mouse,

        // ── Face-side API ──────────────────────────────────────
        /** Move by a signed delta (a report with the current buttons held). */
        move(dx, dy = 0) { mouse.move(dx, dy); },
        /** @param {'left'|'right'|'middle'} button */
        press(button) { mouse.press(button); },
        /** @param {'left'|'right'|'middle'} button */
        release(button) { mouse.release(button); },
        /** Convenience: press+release one button. */
        click(button = 'left') { mouse.press(button); mouse.release(button); },
      };
    },

    // Controller widgets deliver pointer intent. A joystick/slider binding
    // sends 'move' with {dx,dy} (or a scalar dx); a button sends
    // 'press'/'release'/'click' with a button name.
    control(part, state, verb, value) {
      if (verb === 'move') {
        if (value && typeof value === 'object') state.move(Number(value.dx) || 0, Number(value.dy) || 0);
        else state.move(Number(value) || 0, 0);
        return true;
      }
      if (verb === 'press' || verb === 'release' || verb === 'click') {
        const button = BUTTONS.has(value) ? value : 'left';
        state[verb](button);
        return true;
      }
      return false;
    },
  };

  registerDevice('ps2mouse', model);
}
