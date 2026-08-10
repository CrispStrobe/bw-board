/**
 * Serial debug target — boundary D over UART.
 *
 * Same DebugTarget interface as emu8051-debug.js, different capability row.
 * This one talks to real silicon over a serial link, using the protocol in
 * stc/include/live-proto.h. The codec IS a reimplementation in JavaScript
 * (JS cannot #include C headers), making this the fifth implementation of
 * the wire format. The constants and framing match live-proto.h by intent;
 * agreement is verified by testing against the firmware codec running inside
 * emu8051-stc, not by self-round-trip.
 *
 * UART contract: emu8051-stc/docs/UART-ENTRY-POINTS.md (aa59b33).
 * §9 trap: a target passing against an untimed UART model is 2b, not cat 1.
 * Idle-timeout resync is unreachable in emulation (bytes arrive instantly).
 * Only BENCH-UART settles whether the wire works.
 *
 * Key differences from the emulator target:
 *   steps:       ['block']         — no insn (costs P3.2), no line/over/out
 *   breakpoints: ['yield']         — no code BPs (no PSEN on STC12)
 *   writable:    refuses SCON/SBUF/PCON/BRT (they break the UART link)
 *   timeFreezes: true              — measured, not assumed
 *   skewNs:      NON-ZERO          — real board kept running while halted
 *   detached:    YES               — the link can die
 *
 * @module
 */

// ─── Protocol constants (from live-proto.h) ──────────────────────────────

const SOF = 0x7E;
const MAX_PAYLOAD = 64;

const CMD = {
  HELLO: 0x01, READ: 0x02, WRITE: 0x03, REGS: 0x04,
  RUN: 0x05, HALT: 0x06, STEP: 0x07,
  BPSET: 0x08, BPCLR: 0x09, POS: 0x0A, RESET: 0x0B, SYMS: 0x0C,
};

const EVT_HALT = 0xF0;
const NAK = 0xFF;

const SPACE = { code: 0, iram: 1, sfr: 2, xram: 3, bit: 4 };

const STEP_BLOCK = 2;

const BP_YIELD = 1;

// SFRs that must not be written (they break the UART link)
const PROTECTED_SFRS = new Set([
  0x98, // SCON
  0x99, // SBUF
  0x87, // PCON
  0x9C, // BRT
]);

// ─── Frame codec ─────────────────────────────────────────────────────────

/** Build a frame: SOF LEN CMD payload SUM */
function buildFrame(cmd, payload = []) {
  const len = payload.length;
  if (len > MAX_PAYLOAD) throw new Error(`Payload too long: ${len}`);

  const frame = new Uint8Array(4 + len);
  frame[0] = SOF;
  frame[1] = len;
  frame[2] = cmd;
  for (let i = 0; i < len; i++) frame[3 + i] = payload[i];

  // SUM: (LEN + CMD + payload + SUM) & 0xFF === 0
  let sum = len + cmd;
  for (let i = 0; i < len; i++) sum += payload[i];
  frame[3 + len] = (-sum) & 0xFF;

  return frame;
}

// ─── Receiver state machine ──────────────────────────────────────────────

const RX_HUNT = 0, RX_LEN = 1, RX_CMD = 2, RX_DATA = 3, RX_SUM = 4;

class FrameReceiver {
  constructor() {
    this.state = RX_HUNT;
    this.len = 0;
    this.cmd = 0;
    this.n = 0;
    this.sum = 0;
    this.buf = new Uint8Array(MAX_PAYLOAD);
    /** @type {Array<{cmd: number, data: Uint8Array}>} */
    this.frames = [];
  }

  /** Feed bytes. Complete frames appear in this.frames. */
  feed(bytes) {
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i];
      switch (this.state) {
        case RX_HUNT:
          if (b === SOF) this.state = RX_LEN;
          break;
        case RX_LEN:
          this.len = b;
          this.sum = b;
          this.state = RX_CMD;
          break;
        case RX_CMD:
          this.cmd = b;
          this.sum += b;
          this.n = 0;
          this.state = this.len > 0 ? RX_DATA : RX_SUM;
          break;
        case RX_DATA:
          this.buf[this.n++] = b;
          this.sum += b;
          if (this.n >= this.len) this.state = RX_SUM;
          break;
        case RX_SUM:
          this.sum += b;
          if ((this.sum & 0xFF) === 0) {
            this.frames.push({
              cmd: this.cmd,
              data: new Uint8Array(this.buf.buffer, 0, this.len),
            });
          }
          this.state = RX_HUNT;
          break;
      }
    }
  }

  idle() { this.state = RX_HUNT; this.n = 0; }
}

// ─── Serial Debug Target ─────────────────────────────────────────────────

/**
 * Create a DebugTarget that talks to real hardware over UART.
 *
 * @param {object} transport — the serial transport adapter
 * @param {(data: Uint8Array) => Promise<void>} transport.write
 * @param {(callback: (data: Uint8Array) => void) => void} transport.onData
 * @param {(callback: () => void) => void} transport.onClose
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs] — command timeout (default 2000)
 */
export function createSerialDebugTarget(transport, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 2000;

  const rx = new FrameReceiver();
  let state = 'detached'; // 'detached' | 'halted' | 'running'
  let symbols = null;
  let helloCapabilities = null;
  let haltSkewNs = 0n;

  /**
   * Why we are detached — the UI needs to distinguish three cases:
   *   null:          no connection attempted yet ("choose a port")
   *   string:        connection failed or link lost (the reason)
   *   'link-lost':   was connected, link died mid-session
   */
  let detachReason = null;

  /** @type {Array<{resolve: Function, reject: Function, cmd: number}>} */
  let pending = [];

  /** @type {((reason: object) => void) | null} */
  let onHaltCb = null;

  // Wire up transport
  transport.onData((bytes) => {
    rx.feed(bytes);
    while (rx.frames.length > 0) {
      const frame = rx.frames.shift();
      handleFrame(frame);
    }
  });

  transport.onClose(() => {
    const wasConnected = state !== 'detached';
    state = 'detached';
    detachReason = wasConnected ? 'link-lost' : detachReason;
    for (const p of pending) p.reject(new Error('link closed'));
    pending = [];
  });

  function handleFrame(frame) {
    // Unsolicited halt event
    if (frame.cmd === EVT_HALT) {
      state = 'halted';
      if (onHaltCb) {
        const cause = frame.data[0] ?? 0;
        onHaltCb({ cause, raw: frame.data });
      }
      return;
    }

    // Reply to a pending command
    const reply = frame.cmd & 0x7F;
    const idx = pending.findIndex(p => p.cmd === reply);
    if (idx >= 0) {
      const p = pending.splice(idx, 1)[0];
      if (frame.cmd === NAK) {
        p.reject(new Error(`NAK for cmd 0x${reply.toString(16)}: err=${frame.data[1]}`));
      } else {
        p.resolve(frame.data);
      }
    }
  }

  async function sendCommand(cmd, payload = []) {
    if (state === 'detached') throw new Error('not connected');

    const frame = buildFrame(cmd, payload);
    await transport.write(frame);

    return new Promise((resolve, reject) => {
      const entry = { resolve, reject, cmd };
      pending.push(entry);
      setTimeout(() => {
        const idx = pending.indexOf(entry);
        if (idx >= 0) {
          pending.splice(idx, 1);
          reject(new Error(`timeout waiting for reply to 0x${cmd.toString(16)}`));
        }
      }, timeoutMs);
    });
  }

  // ─── DebugTarget interface ─────────────────────────────────────────

  const target = {
    /**
     * Connect and discover capabilities.
     *
     * On reconnect after link loss: the chip kept running. Our position
     * is stale, skewNs is unbounded. The target stays detached until
     * connect() is called explicitly — it does NOT auto-reconnect,
     * because pretending we know the program state would be lying.
     *
     * The front end should tell the user: "Connection lost. The board
     * kept running. Press Connect to restart the debug session."
     */
    async connect() {
      state = 'halted'; // assume halted until proven otherwise
      detachReason = null;
      try {
        const data = await sendCommand(CMD.HELLO);
        helloCapabilities = data;
        return { connected: true };
      } catch (e) {
        state = 'detached';
        detachReason = e.message;
        throw e;
      }
    },

    capabilities() {
      return {
        steps: ['block'],
        breakpoints: ['yield'],
        spaces: {
          code: { read: true, write: false },
          iram: { read: true, write: true },
          sfr: { read: true, write: 'curated' },
          xram: { read: true, write: true },
        },
        writable_sfr_refusals: {
          0x98: 'SCON: writing breaks the UART link',
          0x99: 'SBUF: writing breaks the UART link',
          0x87: 'PCON: writing may enter power-down',
          0x9C: 'BRT: writing changes the baud rate',
        },
        timeFreezes: true,
        consumes: ['timer0', 'timer1', 'uart1', 'brt'],
        detachable: true,
        // Baud rate is NOT modelled by the emulator: TX fires immediately
        // regardless of BRT/Timer config. "Emulation passed" does not mean
        // "the wire works" — a baud mismatch is invisible in emulation.
        timing: {
          baud: false,
          reason: 'emulator delivers bytes immediately; baud mismatch ' +
            'between BRT (STC12) and T2H/T2L (STC15) cannot be detected',
        },
      };
    },

    state() { return state; },

    async run() {
      await sendCommand(CMD.RUN);
      state = 'running';
    },

    async halt() {
      await sendCommand(CMD.HALT);
      // Halt takes effect at the next yield point — not instant
      // The EVT_HALT will arrive asynchronously
    },

    async step(kind = 'block', count = 1) {
      if (kind !== 'block') {
        return { unsupported: `step('${kind}') not available on serial target` };
      }
      const data = await sendCommand(CMD.STEP, [STEP_BLOCK, count]);
      state = 'halted';
      return { stepped: true };
    },

    async setBreakpoint(bp) {
      const kind = bp?.kind ?? bp;
      const task = bp?.task ?? 0;
      const stateVal = bp?.state ?? 0;
      if (kind !== 'yield') {
        return { unsupported: `breakpoint kind '${kind}' not available` };
      }
      const data = await sendCommand(CMD.BPSET, [
        BP_YIELD, task, (stateVal >> 8) & 0xFF, stateVal & 0xFF,
      ]);
      return { handle: data[0] ?? 0 };
    },

    async clearBreakpoint(handle) {
      await sendCommand(CMD.BPCLR, [handle]);
    },

    async readMem(space, addr, len) {
      const spaceId = SPACE[space] ?? 0;
      const data = await sendCommand(CMD.READ, [
        spaceId, (addr >> 8) & 0xFF, addr & 0xFF, len,
      ]);
      return data;
    },

    async writeMem(space, addr, bytes) {
      const spaceId = SPACE[space] ?? 0;

      // Refuse writes to protected SFRs
      if (space === 'sfr') {
        for (let i = 0; i < bytes.length; i++) {
          if (PROTECTED_SFRS.has(addr + i)) {
            const name = { 0x98: 'SCON', 0x99: 'SBUF', 0x87: 'PCON', 0x9C: 'BRT' }[addr + i];
            return { refused: `${name} (0x${(addr+i).toString(16)}): writing breaks the UART link` };
          }
        }
      }

      await sendCommand(CMD.WRITE, [
        spaceId, (addr >> 8) & 0xFF, addr & 0xFF, ...bytes,
      ]);
    },

    async readRegs() {
      const data = await sendCommand(CMD.REGS);
      // A B DPL DPH SP PSW bank R0..R7
      return {
        A: data[0], B: data[1],
        DPL: data[2], DPH: data[3],
        SP: data[4], PSW: data[5],
        bank: data[6],
        R: Array.from(data.slice(7, 15)),
      };
    },

    async position() {
      const data = await sendCommand(CMD.POS);
      return { raw: data };
    },

    async reset() {
      await sendCommand(CMD.RESET);
      state = 'halted';
    },

    onHalt(cb) { onHaltCb = cb; },

    setSymbols(syms) { symbols = syms; },

    /** Skew: program time lost while halted on a live board. */
    getSkewNs() { return haltSkewNs; },

    /** Whether the link is alive. */
    isConnected() { return state !== 'detached'; },

    /**
     * Why the target is detached. The UI needs three sentences:
     *   null          → "Choose a serial port"
     *   'link-lost'   → "Connection lost. The board kept running.
     *                     Press Connect to restart the debug session."
     *   other string  → the error message from the failed connection
     */
    getDetachReason() { return detachReason; },
  };

  return target;
}

export { buildFrame, FrameReceiver, CMD, SPACE, PROTECTED_SFRS };
