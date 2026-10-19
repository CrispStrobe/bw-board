/**
 * STM32 system-bootloader (USART) flasher — the AN3155 protocol,
 * transport-agnostic. Clean-room from ST's application note AN3155
 * ("USART protocol used in the STM32 bootloader"), which documents the
 * wire format: no ST code involved, MIT like the rest of this engine.
 *
 * The transport is the only platform-specific piece:
 *   { write(Uint8Array): Promise<void>,
 *     read(n: number, timeoutMs: number): Promise<Uint8Array> }
 * — a Web Serial port adapts in a dozen lines (reader/writer pair), and
 * the tests drive a mock bootloader through the same shape, so every
 * frame this module emits is byte-checked without silicon.
 *
 * Hardware entry ritual (NOT this module's job, but the part everyone
 * trips on): the STM32 ROM bootloader only listens when BOOT0 is HIGH
 * at reset — tie BOOT0 to 3.3 V (the F030 breakout has a jumper),
 * reset, then init. 8E1 framing (even parity!), 9600–115200 baud,
 * auto-bauded from the 0x7F init byte.
 *
 * SILICON STATUS: mock-validated only (byte-exact against AN3155's
 * framing); first real-chip run still owed — the module reports every
 * NACK with the command that drew it, so that run can say WHERE.
 *
 * @module
 */

const ACK = 0x79;
const NACK = 0x1f;

const CMD = {
  GET: 0x00,
  GET_VERSION: 0x01,
  GET_ID: 0x02,
  READ_MEMORY: 0x11,
  GO: 0x21,
  WRITE_MEMORY: 0x31,
  ERASE: 0x43,           // classic, page-count based
  EXTENDED_ERASE: 0x44,  // two-byte pages — the F0 family speaks THIS one
};

/** XOR checksum over bytes (AN3155's integrity byte). */
const xor = (bytes) => bytes.reduce((a, b) => a ^ b, 0);

const be32 = (v) => Uint8Array.of((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff);

/**
 * @param {{write: (b: Uint8Array) => Promise<void>,
 *          read: (n: number, timeoutMs: number) => Promise<Uint8Array>}} transport
 * @param {{timeoutMs?: number, eraseTimeoutMs?: number,
 *          onProgress?: (done: number, total: number) => void}} [opts]
 */
export function createStm32Isp (transport, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 1000;
  // A mass erase takes real time on silicon (tens of ms per page, the
  // whole array for a global) — its ACK gets its own patience.
  const eraseTimeoutMs = opts.eraseTimeoutMs ?? 30_000;
  const onProgress = opts.onProgress || (() => {});

  async function expectAck (what, t = timeoutMs) {
    const r = await transport.read(1, t);
    if (!r || r.length < 1) throw new Error(`${what}: no reply (is BOOT0 high and the chip fresh out of reset?)`);
    if (r[0] === NACK) throw new Error(`${what}: NACK`);
    if (r[0] !== ACK) throw new Error(`${what}: expected ACK 0x79, got 0x${r[0].toString(16)}`);
  }

  async function command (cmd, what) {
    await transport.write(Uint8Array.of(cmd, (~cmd) & 0xff));
    await expectAck(what);
  }

  return {
    /** The 0x7F auto-baud byte. The ROM answers ACK exactly once per
     *  reset; a second init on a live session draws NACK on some parts,
     *  which is tolerated here (the session is already open). */
    async init () {
      await transport.write(Uint8Array.of(0x7f));
      const r = await transport.read(1, timeoutMs);
      if (!r || r.length < 1) throw new Error('init: no reply (BOOT0 high? fresh reset? even parity?)');
      if (r[0] !== ACK && r[0] !== NACK) {
        throw new Error(`init: expected ACK/NACK, got 0x${r[0].toString(16)}`);
      }
    },

    /** GET (0x00): bootloader version + supported command bytes. */
    async get () {
      await command(CMD.GET, 'GET');
      const n = (await transport.read(1, timeoutMs))[0]; // bytes to follow - 1
      const body = await transport.read(n + 1, timeoutMs);
      await expectAck('GET tail');
      return { version: body[0], commands: [...body.slice(1)] };
    },

    /** GET ID (0x02): the product id (F030x4/x6 answers 0x444). */
    async getId () {
      await command(CMD.GET_ID, 'GET_ID');
      const n = (await transport.read(1, timeoutMs))[0];
      const body = await transport.read(n + 1, timeoutMs);
      await expectAck('GET_ID tail');
      let id = 0;
      for (const b of body) id = (id << 8) | b;
      return id;
    },

    /** Extended erase (0x44), global: the two 0xFFFF special-erase
     *  bytes plus their XOR — the F0 family's whole-array wipe. */
    async globalErase () {
      await command(CMD.EXTENDED_ERASE, 'EXTENDED_ERASE');
      const frame = Uint8Array.of(0xff, 0xff, 0x00);
      frame[2] = xor(frame.slice(0, 2));
      await transport.write(frame);
      await expectAck('global erase', eraseTimeoutMs);
    },

    /** WRITE MEMORY (0x31), one chunk of at most 256 bytes, word-aligned
     *  address. Frame: addr(4 BE)+xor, then (N-1), data..., xor(N-1,data). */
    async writeChunk (addr, data) {
      if (data.length < 1 || data.length > 256) throw new Error(`writeChunk: ${data.length} bytes (1..256)`);
      if (addr % 4 !== 0) throw new Error(`writeChunk: address 0x${addr.toString(16)} not word-aligned`);
      await command(CMD.WRITE_MEMORY, 'WRITE_MEMORY');
      const a = be32(addr);
      await transport.write(Uint8Array.of(...a, xor(a)));
      await expectAck(`write addr 0x${addr.toString(16)}`);
      const head = (data.length - 1) & 0xff;
      await transport.write(Uint8Array.of(head, ...data, head ^ xor(data)));
      await expectAck(`write data @0x${addr.toString(16)}`);
    },

    /** GO (0x21): jump to the application (stacked-vector start). */
    async go (addr) {
      await command(CMD.GO, 'GO');
      const a = be32(addr);
      await transport.write(Uint8Array.of(...a, xor(a)));
      await expectAck('go');
    },

    /** The whole ritual: init → id → global erase → chunked write → go.
     *  `image` is the raw flash binary (vectors first), `base` normally
     *  0x08000000. Returns the product id for the caller's sanity line. */
    async flash (image, base = 0x08000000) {
      await this.init();
      const id = await this.getId();
      await this.globalErase();
      const CHUNK = 256;
      // AN3155 wants full words; pad the tail to a multiple of 4 with
      // 0xFF (erased-flash value, harmless).
      const padded = image.length % 4 === 0 ? image
        : Uint8Array.of(...image, ...new Uint8Array(4 - (image.length % 4)).fill(0xff));
      for (let off = 0; off < padded.length; off += CHUNK) {
        await this.writeChunk(base + off, padded.subarray(off, Math.min(off + CHUNK, padded.length)));
        onProgress(Math.min(off + CHUNK, padded.length), padded.length);
      }
      await this.go(base);
      return { productId: id, bytes: padded.length };
    },
  };
}

export default createStm32Isp;
