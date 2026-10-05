/**
 * rp2040js MEDIA BUNDLE runner — the executable half of a GPL-Lab
 * `brickwright-media.json` whose `machine` is `rp2040js` and whose payload is a
 * pico-sdk `.uf2` booted from flash (PicoBB — BBC BASIC for the Pico, and any
 * other RP2040 firmware that talks a UART0 console the same way).
 *
 * WHY THIS IS A SEPARATE MODULE, not a branch in machine-media.js — the same
 * reason the i8086 floppy runner is (see machine-media-i8086.js): `runMediaBundle`
 * is content-pinned by the AT/386 platform receipts, and its entry/slot logic
 * assumes an 8/16-bit core (`machine.cpu.pc = … & 0xffff`, the reset vector at
 * `machine.mem[0xfffc]`). The RP2040 is a 32-bit Cortex-M0+ with no flat `mem`
 * and no `cpu.pc`: it is reached through bw-board's canonical
 * `createRp2040jsAdapter()` — boot a flattened UF2 from flash, capture UART0 TX
 * via `onSerial`, type into the console via `rp2040.uart[0].feedByte`. This
 * module is the ONE place that boot/console dance lives, so the lab proof, a CLI
 * script, and (later) the GUI share it instead of each re-implementing it.
 *
 * THE CONTRACT (manifest fields this reads):
 *   machine:            "rp2040js"
 *   slots.flash:        the filename of the .uf2 in `files`
 *   program.console:    "uart0" (the only console this runner drives today)
 *   program.bootMs:     ms of sim time to run before pressing the start key (default 400)
 *   program.startKey:   byte(s) to send once "Waiting for connection" appears (default "\r")
 *   expect:             substrings the boot transcript must contain
 *   programs[]:         scripted REPL sessions — {title, input, expect[]}
 *
 * SINGLE CORE. `advanceNs` steps core0 only, so the firmware must not launch
 * core1 (PicoBB's bundle is built SOUND=NONE for exactly that reason); a
 * core1-launching build hangs in the SIO inter-core FIFO handshake.
 *
 * @module
 */
import { createRp2040jsAdapter } from './rp2040js-adapter.js';
import { parseUF2, FLASH_BASE } from './uf2.js';

const CHUNK_MS = 2;   // sim-time granularity of one advance tick
const QUIET_MS = 24;  // output idle this long ends an advance window early

/**
 * Boot an rp2040js media bundle and run its scripted REPL sessions.
 *
 * @param {object} manifest - parsed brickwright-media.json (machine === 'rp2040js')
 * @param {Record<string, Uint8Array>} files - fetched, keyed by filename
 * @param {{adapter?: object, rows?: number, cols?: number}} [opts]
 *   adapter: options forwarded to createRp2040jsAdapter(); rows/cols: VT100 size reported to DSR
 * @returns {{
 *   adapter: object, output: string, machineMs: bigint,
 *   expect: {text: string, ok: boolean}[],
 *   programs: {title: string, expect: {text: string, ok: boolean}[]}[],
 *   ok: boolean
 * }}
 */
export function runRp2040Bundle(manifest, files, opts = {}) {
    if (manifest.machine !== 'rp2040js') {
        throw new Error(`runRp2040Bundle: machine is '${manifest.machine}', expected 'rp2040js'`);
    }
    // Resolve + validate the payload BEFORE constructing the engine, so a bad
    // bundle fails by name without spinning up the emulator.
    const fname = manifest.slots?.flash;
    if (!fname) throw new Error('runRp2040Bundle: manifest has no slots.flash');
    const uf2 = files[fname];
    if (!uf2) throw new Error(`runRp2040Bundle: file not provided: ${fname}`);
    const { base, image } = parseUF2(uf2);
    if (base !== FLASH_BASE) {
        throw new Error(`runRp2040Bundle: UF2 base 0x${base.toString(16)} != FLASH_BASE 0x${FLASH_BASE.toString(16)}`);
    }

    const rows = opts.rows ?? 24;
    const cols = opts.cols ?? 80;
    const adapter = createRp2040jsAdapter(opts.adapter || {});
    const { rp2040 } = adapter;
    let out = '';
    adapter.onSerial((b) => { out += String.fromCharCode(b); });
    adapter.bootFromFlash(image);

    const feed = (s) => { for (const ch of s) rp2040.uart[0].feedByte(ch.charCodeAt(0)); };

    // VT100 terminal: the console probes its size with ESC[6n (DSR) and waits
    // for an ESC[row;colR reply. Answer every outstanding query.
    let dsrAnswered = 0;
    const serviceTerminal = () => {
        const n = (out.match(/\x1b\[6n/g) || []).length;
        while (dsrAnswered < n) { feed(`\x1b[${rows};${cols}R`); dsrAnswered++; }
    };

    // Advance sim time, servicing DSR, until output goes quiet or maxMs elapses.
    const advance = (maxMs, { stopOnQuiet = true } = {}) => {
        let ms = 0, last = out.length, quiet = 0;
        while (ms < maxMs) {
            adapter.advanceNs(CHUNK_MS * 1e6); ms += CHUNK_MS;
            serviceTerminal();
            if (out.length !== last) { last = out.length; quiet = 0; }
            else if (stopOnQuiet && out.length > 0) { quiet += CHUNK_MS; if (quiet >= QUIET_MS) break; }
        }
        return ms;
    };
    const type = (s) => { for (const ch of s) { feed(ch); advance(ch === '\r' ? 500 : 80); } };

    // Boot to the connection prompt, press the start key, let the banner print.
    advance(manifest.program?.bootMs || 400);
    const startKey = manifest.program?.startKey ?? '\r';
    if (startKey && out.includes('Waiting for connection')) {
        feed(startKey);
        // The wait loop sleeps ~1s between polls, so run the full window without
        // early-stopping on quiet: let it wake, read the CR, print the banner.
        advance(2400, { stopOnQuiet: false });
    }

    const score = (texts) => (texts || []).map((text) => ({ text, ok: out.includes(text) }));
    const expect = score(manifest.expect);

    const programs = [];
    for (const prog of manifest.programs || []) {
        const before = out.length;
        type(prog.input || '');
        const slice = out.slice(before);
        programs.push({
            title: prog.title || 'program',
            // a match in the new slice OR anywhere in the live transcript (the
            // REPL echoes, and earlier output may already carry the text)
            expect: (prog.expect || []).map((text) => ({ text, ok: slice.includes(text) || out.includes(text) })),
        });
    }

    const ok = expect.every((e) => e.ok) && programs.every((p) => p.expect.every((e) => e.ok));
    return { adapter, output: out, machineMs: adapter.timeNs() / 1000000n, expect, programs, ok };
}
