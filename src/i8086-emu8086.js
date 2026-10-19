/**
 * The emu8086 compatibility layer -- Tier B's second half, and the tier that
 * makes the "traffic light", "stepper motor" and "thermometer" lessons work.
 *
 * A large body of 8086 coursework does not target DOS. It targets emu8086:
 * `#start=Traffic_Lights.exe#`, `out 4, ax` to a built-in traffic light,
 * `int 15h`/AH=86h for delays, `include 'emu8086.inc'` for I/O helpers.
 * Measured on yousefkotp/8086-Assembly-Projects (MIT, 10 projects): 6 of 10
 * `include` the macro library, 2 of 10 drive a virtual device by port, and
 * the traffic-light project is nothing BUT a device plus int 15h delays.
 * `src/i8086-dos.js` already provides int 21h/10h/16h/1Ah/15h. What was
 * missing is emu8086's VIRTUAL DEVICES and its macro library. That is this.
 *
 * THIS IS A CLEAN RE-IMPLEMENTATION, and it has to be. emu8086 is
 * proprietary and its `emu8086.inc` carries no licence anyone can rely on,
 * so not one byte of it was copied, transcribed or downloaded. Everything
 * here was rebuilt from two legitimate sources: emu8086's own PUBLISHED
 * DOCUMENTATION (the observable interface -- port numbers and register
 * conventions are facts, not expression), and how the MIT-licensed corpus
 * CALLS the library. Every non-obvious fact below cites the call site or the
 * documentation page that established it. Where neither established a
 * thing, it is listed as unestablished and left unimplemented rather than
 * guessed -- see `report().unestablished`.
 *
 * THE PORT SPACE IS FLAT, and this is the fact that makes the whole design
 * fall out. emu8086's own device README says: "Available input / output
 * addresses for custom devices are from 0 to 65535 ... Port 100 corresponds
 * to byte 100 in this file c:\emu8086.io, port 101 to the byte 101, port 0
 * to byte 0". So the port space is a 65536-BYTE ARRAY, devices are separate
 * programs that poll and poke bytes in it, and `IN` reads back whatever is
 * there. It is not a set of chips with chip selects.
 *
 * Two consequences a naive implementation gets wrong:
 *
 *   - A WORD PORT IS TWO BYTE PORTS. `out 4, ax` is two bus cycles: AL to
 *     port 4, AH to port 5. Our own CPU core already decomposes it that way
 *     (i8086.js opcodes E7/EF). So the traffic light is not "a 16-bit
 *     register at port 4", it is bytes 4 and 5, and there is a real instant
 *     between the two writes where the lamps are half-updated. Modelling it
 *     as one atomic word hides that instant and makes port 5 dead.
 *
 *   - `IN` FROM AN OUTPUT DEVICE READS BACK. The traffic-light page says so
 *     in as many words ("if required you can read the data from port using
 *     IN instruction ... IN AX, 4"), and emu8086's own simple_io example
 *     writes 0A7h to port 110 and 1234h to port 112 and then reads both
 *     straight back. An implementation that returns 0FFh for open bus --
 *     which is right for a breadboard and is what i8086-machine.js does --
 *     is wrong here. The array IS the device.
 *
 * WHAT IS MODELLED: the traffic lights (port 4), the stepper motor (port 7),
 * the robot (ports 9/10/11), the thermometer and its heater (ports 125/127),
 * the printer (port 130), the LED display (port 199), and the flat read-back
 * that makes the "simple" test device work with no code at all.
 *
 * WHAT IS NOT MODELLED, deliberately and not silently:
 *
 *   - The DEVICE TIMING of every device. emu8086's devices are separate
 *     Windows programs polling a file; how long a stepper takes to become
 *     ready, or a robot to finish a move, is a property of that program and
 *     is documented nowhere. Every such interval is a constructor option
 *     defaulting to ZERO (always ready), so a documented busy-wait loop
 *     terminates instead of hanging. The defaults are OURS, they are
 *     reported as invented, and they are not a claim about emu8086.
 *
 *   - The THERMOMETER'S THERMAL MODEL. That the temperature rises with the
 *     heater on and falls with it off is established (emu8086's own example
 *     says "temperature rises fast" and assumes ambient is below 60). The
 *     RATES are not documented anywhere. Ours are invented, named, and
 *     reported as invented.
 *
 *   - The ROBOT'S MAP FILE. `robot_map.dat` is a 54-byte binary whose format
 *     is not documented. We take a map as text instead. The robot's
 *     INSTRUCTION SET is fully documented and is modelled exactly.
 *
 *   - The LED DISPLAY'S DIGIT COUNT and whether it renders signed or
 *     unsigned. It is a word at port 199 and it shows a NUMBER (emu8086's
 *     own test writes 1234 then -5678, which only makes sense as signed
 *     decimal), so both renderings are exposed and neither is asserted to
 *     be the device's own choice.
 *
 *   - The VGA_STATE device, and any user-written add-on. They are ordinary
 *     users of the flat port space and need nothing from us.
 *
 * REFUSALS ARE COUNTED, NOT SWALLOWED, the same way the DOS layer counts an
 * unimplemented service: a write to a reserved traffic-light bit, a command
 * the robot does not have, a port claimed by no device -- each lands in
 * `report()` with a count, so a program that depends on one fails visibly
 * and the report names what it wanted.
 *
 * @module
 */
import { trapRegion } from './i8086-dos.js';

/**
 * Every port number this layer answers to.
 *
 * EVIDENCE, one line per number, because these are the load-bearing facts:
 *   TRAFFIC 4      emu8086 io.html "Traffic Lights - port 4 (word)"; and
 *                  corpus Project #6 line 9: `out 4, ax  ;4 is the output
 *                  number for the traffic (built-in)`.
 *   STEPPER 7      io.html "Stepper Motor - port 7 (byte)"; and emu8086's
 *                  stepper_motor.asm comment "stepper_motor.exe is on port 7".
 *   ROBOT_* 9/10/11  io.html "Robot - port 9 (3 bytes)": 9 command, 10 data,
 *                  11 status.
 *   THERMOMETER 125  emu8086's own thermometer.asm: `in al, 125`.
 *   HEATER 127     the same file: `out 127, al  ; turn heater "on"`.
 *   PRINTER 130    DEVICES/Printer.txt: "the printer can be accessed through
 *                  port 130 (decimal)".
 *   LED 199        emu8086's LED_display_test.asm: `out 199, ax`; and corpus
 *                  Project #1 lines 51 and 93: `out 199,ax` with 0 then 1,
 *                  for a spec whose only output is "LED turned red if time is
 *                  expired".
 *   SIMPLE_*       emu8086's simple_io.asm uses 110 (byte) and 112 (word)
 *                  with the Simple.exe device. Named for documentation only:
 *                  they need no handler, because flat read-back IS the
 *                  behaviour that example demonstrates.
 */
export const PORTS = Object.freeze({
    TRAFFIC: 4,
    STEPPER: 7,
    ROBOT_CMD: 9,
    ROBOT_DATA: 10,
    ROBOT_STATUS: 11,
    SIMPLE_BYTE: 110,
    SIMPLE_WORD: 112,
    THERMOMETER: 125,
    HEATER: 127,
    PRINTER: 130,
    LED: 199,
});

/** The port space is byte-addressed over the full 16-bit port range. */
export const PORT_SPACE_SIZE = 0x10000;

// ---------------------------------------------------------------------------
// Word devices: the shared two-byte-port machinery
// ---------------------------------------------------------------------------

/**
 * A device occupying a pair of consecutive ports as one 16-bit value.
 *
 * TWO HISTORIES, and the reason is the thing this whole layer keeps insisting
 * on: `out 4, ax` is TWO bus cycles, low byte then high byte, so there is a
 * real instant when the port pair holds the new low byte beside the OLD high
 * byte. That transient is not an artefact of the model -- emu8086's devices
 * are separate programs polling a file, so whether one is ever seen is a
 * genuine race, and a model that hides it is lying about the hardware.
 *
 * But a caller drawing "the sequence of traffic-light patterns" from the
 * transient-inclusive list would render a frame the program never meant. So
 * both are offered and named for what they are:
 *
 *   `history`         every distinct value the pair has held, transients
 *                     included. Faithful, and noisy.
 *   `settledHistory`  a value only once BOTH bytes have been written since
 *                     the last entry -- which, for the universal `out N, ax`
 *                     idiom, is exactly the sequence the program intended.
 *                     A program that only ever writes one byte of the pair
 *                     never settles, and this list stays empty rather than
 *                     inventing an entry.
 */
class WordPort {
    constructor(basePort) {
        this.basePort = basePort;
        this.lo = 0;
        this.hi = 0;
        this.history = [];
        this.settledHistory = [];
        this._wroteLo = false;
        this._wroteHi = false;
    }

    get ports() { return [this.basePort, this.basePort + 1]; }

    /** Composed from the two bytes on every read, never cached, so the
     *  half-updated instant is visible rather than smoothed away. */
    get word() { return (this.lo | (this.hi << 8)) & 0xffff; }

    /** Flat read-back: io.html documents `IN AX, 4` explicitly. */
    onRead(port) { return port === this.basePort ? this.lo : this.hi; }

    _noteWrite(port, val) {
        if (port === this.basePort) { this.lo = val & 0xff; this._wroteLo = true; }
        else { this.hi = val & 0xff; this._wroteHi = true; }
        const w = this.word;
        if (this.history[this.history.length - 1] !== w) this.history.push(w);
        if (this._wroteLo && this._wroteHi) {
            this._wroteLo = false; this._wroteHi = false;
            if (this.settledHistory[this.settledHistory.length - 1] !== w) {
                this.settledHistory.push(w);
            }
        }
        return w;
    }
}

// ---------------------------------------------------------------------------
// Traffic lights -- port 4, word
// ---------------------------------------------------------------------------

/**
 * Four sets of three lamps in the low 12 bits of the word at ports 4 and 5.
 *
 * THE BIT LAYOUT, and it took two independent sources to settle because the
 * official reference does NOT state it. io.html says only "there are 12
 * lamps: 4 green, 4 yellow, and 4 red ... only 12 low bits of a word are
 * used (0 to 11)". It never says which bit is which colour. Two sources do:
 *
 *   1. Corpus Project #6's own header comment, lines 2-5:
 *        ";Red is the least significant of each consecutive 3 bits : 0,3,6,9
 *         ;Yellow is the middle significant of each 3 consecutive bits: 1,4,7,A
 *         ;Green is the most significant of each 3 consecutive bits: 2,5,8,B
 *         ;the last 4 bits are unused C,D,E,F"
 *
 *   2. emu8086's OWN documented example, asm_tutorial_12.html, which ends
 *      with `all_red equ 0000_0010_0100_1001b`. That constant is 249h, and
 *      249h is exactly bits 0, 3, 6 and 9. Project #6 line 8 agrees to the
 *      digit: `mov ax, 249h  ; 249h means all are red 0,3,6,9 bits are all
 *      ones`. Two sources, one written by emu8086's author, naming the same
 *      four bits as the four reds.
 *
 * So a lamp group g occupies bits 3g, 3g+1, 3g+2 = red, yellow, green.
 *
 * A PLAUSIBLE-LOOKING WRONG ANSWER, recorded because it is the one a summary
 * of io.html invites: "bits 0-3 are the four greens, 4-7 the four yellows,
 * 8-11 the four reds", i.e. grouped by colour rather than by direction. It
 * is refuted by arithmetic, not by opinion. Under it, all-red would be
 * 0F00h, not 249h. And Project #6's `transition2 equ 0000_0111_1001_1110b`
 * is commented "all 4 are Yellow"; under the by-colour reading that word
 * lights greens 1-3, yellows 0 and 3, and reds 0-2 -- no reading of it has
 * all four yellows on. Under the by-group reading every one of the six
 * documented constants comes out as its comment describes.
 *
 * WHICH GROUP FACES WHICH WAY is NOT established. Project #6 reads groups 0
 * and 2 as "north and south" and 1 and 3 as "east and west" (its comments on
 * transition1 and transition3), which is a statement about where the lamps
 * sit in emu8086's window, not something any documentation says. So the
 * groups are numbered 0..3 here and that reading is offered as a hint the
 * caller may ignore.
 */
export class TrafficLights extends WordPort {
    constructor() {
        super(PORTS.TRAFFIC);
        /** Writes that set a bit io.html calls unused. Counted, not ignored. */
        this.reservedWrites = 0;
    }

    onWrite(port, val) {
        this._noteWrite(port, val);
        // Bits 12-15: io.html calls them unused, and Project #6's comment
        // calls them "unused C,D,E,F". A program setting one is confused
        // about the layout, which is the exact bug this counter catches.
        if (this.hi & 0xf0) this.reservedWrites++;
    }

    /**
     * The readable state a test or a UI asserts on.
     * @returns {{word: number, groups: Array<{red: boolean, yellow: boolean,
     *   green: boolean, lamps: string}>, reservedWrites: number,
     *   allRed: boolean}}
     */
    state() {
        const w = this.word;
        const groups = [];
        for (let g = 0; g < 4; g++) {
            const base = g * 3;
            const red = !!(w & (1 << base));
            const yellow = !!(w & (1 << (base + 1)));
            const green = !!(w & (1 << (base + 2)));
            // A one-glance rendering: "R--", "--G", "-Y-". Tests read better
            // asserting on this than on three booleans.
            const lamps = (red ? 'R' : '-') + (yellow ? 'Y' : '-') + (green ? 'G' : '-');
            groups.push({ red, yellow, green, lamps });
        }
        return {
            word: w,
            groups,
            reservedWrites: this.reservedWrites,
            // 249h, the constant both sources name. Worth having by name
            // because it is the state every corpus program starts from.
            allRed: (w & 0x0fff) === 0x249,
        };
    }
}

/** All four groups red: bits 0, 3, 6, 9. emu8086's own `all_red`. */
export const TRAFFIC_ALL_RED = 0x249;

// ---------------------------------------------------------------------------
// Stepper motor -- port 7, byte
// ---------------------------------------------------------------------------

/**
 * A 3-phase stepper: three magnets on bits 0..2, a ready flag on bit 7.
 *
 * ESTABLISHED, from io.html: "This is a basic 3-phase stepper motor, it has
 * 3 magnets controlled by bits 0, 1 and 2. other bits (3..7) are unused" and
 * "Stepper motor sets topmost bit of byte value in port 7 when it's ready".
 * From asm_tutorial_12.html: "Half step is equal to 11.25 degrees. Full step
 * is equal to 22.5 degrees." From emu8086's stepper_motor.asm, the four-entry
 * pattern tables and the busy-wait that reads them:
 *     wait:  in al, 7
 *            test al, 10000000b
 *            jz wait
 * which is why bit 7 must read as set or that loop never exits.
 *
 * THE READY BIT IS AN OR, NOT A REPLACEMENT. The documentation says the motor
 * "sets topmost bit of byte value in port 7", i.e. it sets a bit in the byte
 * that is already there -- the magnet pattern you wrote. So a read returns
 * pattern | 80h, and a naive implementation that returns 80h alone breaks
 * any program that reads the port back to see what it last commanded.
 *
 * WHAT IS NOT ESTABLISHED: how the device turns a magnet pattern into an
 * absolute shaft angle. The documented pattern tables are recognised here
 * and each recognised transition moves the shaft by one half-step in the
 * direction that table implies; anything else is counted in
 * `unrecognisedPatterns` and moves nothing. So `halfSteps` and `angleDeg`
 * are honest about the documented sequences and silent about the rest.
 * The zero datum is ours -- nothing documents where the shaft starts.
 */
export class StepperMotor {
    /**
     * @param {{ settleUs?: number }} [opts] `settleUs` is how long the motor
     *   reads as NOT ready after a command. Default 0 -- always ready --
     *   because the real interval is undocumented and a non-zero guess would
     *   turn every documented busy-wait into a hang. Ours, not emu8086's.
     */
    constructor(opts = {}) {
        this.settleUs = opts.settleUs || 0;
        this.pattern = 0;
        this.halfSteps = 0;
        /** 'cw', 'ccw' or null (nothing recognised yet). */
        this.direction = null;
        this.unrecognisedPatterns = 0;
        this._readyAtUs = 0;
        this._nowUs = 0;
    }

    get ports() { return [PORTS.STEPPER]; }

    /** Degrees per half step, from asm_tutorial_12.html. */
    static get DEG_PER_HALF_STEP() { return 11.25; }

    /**
     * The documented half-step tables, in emu8086's own order. Kept as data
     * because they are the ONLY evidence of which way a pattern change turns
     * the shaft: consecutive entries of the clockwise table are a clockwise
     * half step by construction.
     * Clockwise half step: 0110, 0100, 0011, 0010.
     * Counter-clockwise half step: 0011, 0001, 0110, 0010.
     */
    static get CW_HALF() { return [0b110, 0b100, 0b011, 0b010]; }
    static get CCW_HALF() { return [0b011, 0b001, 0b110, 0b010]; }

    /** Advance the clock. Called by the port space before any access, so the
     *  ready flag tracks MACHINE time -- including the jump an int 15h/86h
     *  delay makes -- and never wall-clock time. */
    sync(nowUs) { this._nowUs = nowUs; }

    get ready() { return this._nowUs >= this._readyAtUs; }

    onWrite(port, val) {
        const next = val & 0b111;
        // A rejected command still costs nothing: the doc gives the motor no
        // way to say "busy", only a ready bit for the program to poll.
        this._step(next);
        this.pattern = next;
        this._readyAtUs = this._nowUs + this.settleUs;
    }

    /** Pattern in the low three bits, ready in bit 7. */
    onRead() { return (this.pattern & 0b111) | (this.ready ? 0x80 : 0x00); }

    /** Recognise the transition against the two documented tables. */
    _step(next) {
        if (next === this.pattern) return;               // no change, no step
        const cw = StepperMotor.CW_HALF, ccw = StepperMotor.CCW_HALF;
        const follows = (table) => {
            const i = table.indexOf(this.pattern);
            return i >= 0 && table[(i + 1) % table.length] === next;
        };
        // The two tables share entries, so test both and prefer the one that
        // continues the direction already established -- otherwise a shared
        // pattern would flip the reported direction at random.
        const isCw = follows(cw), isCcw = follows(ccw);
        let dir = null;
        if (isCw && isCcw) dir = this.direction || 'cw';
        else if (isCw) dir = 'cw';
        else if (isCcw) dir = 'ccw';
        if (!dir) { this.unrecognisedPatterns++; return; }
        this.direction = dir;
        this.halfSteps += dir === 'cw' ? 1 : -1;
    }

    /**
     * @returns {{pattern: number, magnets: boolean[], ready: boolean,
     *   halfSteps: number, angleDeg: number, direction: string|null,
     *   unrecognisedPatterns: number}}
     */
    state() {
        return {
            pattern: this.pattern,
            magnets: [0, 1, 2].map((b) => !!(this.pattern & (1 << b))),
            ready: this.ready,
            halfSteps: this.halfSteps,
            angleDeg: this.halfSteps * StepperMotor.DEG_PER_HALF_STEP,
            direction: this.direction,
            unrecognisedPatterns: this.unrecognisedPatterns,
        };
    }
}

// ---------------------------------------------------------------------------
// Thermometer and heater -- ports 125 and 127, bytes
// ---------------------------------------------------------------------------

/**
 * A temperature byte the program reads, and a heater byte it writes.
 *
 * ESTABLISHED, entirely from emu8086's own thermometer.asm, which is the
 * only place either port appears: `in al, 125` then `cmp al, 60` / `cmp al,
 * 80`, and `mov al, 1 / out 127, al  ; turn heater "on"` against `mov al, 0
 * / out 127, al  ; turn heater "off"`. So port 125 reads degrees as a plain
 * byte -- not a scaled or offset value, since the program compares it
 * directly against 60 and 80 -- and port 127 takes 1 for on and 0 for off.
 * The same file's header says "it is assumed that air temperature is lower
 * 60" and "temperature rises fast, thus emulator should be set to run at the
 * maximum speed", which establishes the DIRECTIONS: heater on, temperature
 * rises; heater off, it falls towards ambient.
 *
 * NOT ESTABLISHED: the rates, the ambient value, the range, and whether the
 * device treats port 127 as a bit or as a number. Every one of those is a
 * constructor option here with an invented default, and `report()` says so.
 * We take any non-zero write as "on" because only 0 and 1 are evidenced.
 *
 * WHY THE MODEL IS LAZY rather than ticked: the temperature is integrated
 * from MACHINE time on each access. That is not an optimisation -- it is the
 * only way an `int 15h`/AH=86h delay affects it, because that service jumps
 * `machine.cycles` forward in one go rather than running cycles. A ticked
 * model driven off instruction execution would see a three-minute wait as no
 * time at all, and the corpus's Heater Alarm project is built on exactly
 * that wait.
 */
export class Thermometer {
    /**
     * @param {{ ambientC?: number, startC?: number, heatRateCPerSec?: number,
     *   coolRateCPerSec?: number, minC?: number, maxC?: number }} [opts]
     *   All defaults are OURS. emu8086 documents none of them.
     */
    constructor(opts = {}) {
        this.ambientC = opts.ambientC ?? 20;
        this.heatRateCPerSec = opts.heatRateCPerSec ?? 10;
        this.coolRateCPerSec = opts.coolRateCPerSec ?? 5;
        this.minC = opts.minC ?? 0;
        this.maxC = opts.maxC ?? 255;      // it is read as a byte
        this.tempC = opts.startC ?? this.ambientC;
        this.heaterOn = false;
        this._nowUs = 0;
        this._lastUs = 0;
    }

    get ports() { return [PORTS.THERMOMETER, PORTS.HEATER]; }

    sync(nowUs) {
        this._nowUs = nowUs;
        this._integrate();
    }

    /** Move the temperature from _lastUs to _nowUs. */
    _integrate() {
        const dt = (this._nowUs - this._lastUs) / 1e6;
        this._lastUs = this._nowUs;
        if (dt <= 0) return;
        if (this.heaterOn) {
            this.tempC += this.heatRateCPerSec * dt;
        } else if (this.tempC > this.ambientC) {
            // Newton would make this exponential. Linear-towards-ambient is
            // ours and is deliberately the simplest thing that cannot
            // overshoot: clamp at ambient rather than oscillate around it.
            this.tempC = Math.max(this.ambientC, this.tempC - this.coolRateCPerSec * dt);
        }
        this.tempC = Math.min(this.maxC, Math.max(this.minC, this.tempC));
    }

    onWrite(port, val) {
        if (port !== PORTS.HEATER) return;
        this.heaterOn = (val & 0xff) !== 0;
    }

    onRead(port) {
        if (port === PORTS.THERMOMETER) {
            // A byte. Truncated, not rounded: a program comparing `cmp al,
            // 60` against a reading of 59.9 must see 59, the way an ADC
            // that has not reached the next code would report it.
            return Math.trunc(this.tempC) & 0xff;
        }
        return this.heaterOn ? 1 : 0;
    }

    /** @returns {{tempC: number, reading: number, heaterOn: boolean}} */
    state() {
        return {
            tempC: this.tempC,
            reading: Math.trunc(this.tempC) & 0xff,
            heaterOn: this.heaterOn,
        };
    }
}

// ---------------------------------------------------------------------------
// LED display -- port 199, word
// ---------------------------------------------------------------------------

/**
 * A numeric display, not a segment-pattern display.
 *
 * ESTABLISHED: emu8086's LED_display_test.asm writes to port 199 as a word
 * (`out 199, ax`) and the values it writes are 1234, then -5678, then a
 * counting loop. Corpus Project #1 writes 0 and then 1 to the same port
 * (lines 51 and 93) for a specification whose entire output is "LED turned
 * red if time is expired". A device fed 1234 and -5678 is showing a NUMBER;
 * if port 199 were a seven-segment bit pattern those two values would be
 * meaningless bit soup, and nobody would write -5678 to it.
 *
 * NOT ESTABLISHED: how many digits the display has, and whether the device
 * itself renders the word signed or unsigned. The example's deliberate
 * -5678 leans hard towards signed, but "leans towards" is not "documents",
 * so `state()` gives the raw word plus BOTH renderings and asserts neither.
 * The seven-segment SEGMENT MAP, which a caller might reasonably expect from
 * something called an LED display, is not established at all and is not
 * invented here.
 */
export class LedDisplay extends WordPort {
    constructor() { super(PORTS.LED); }

    /** The displayed word. Named `value` rather than `word` because that is
     *  what a display shows, but it is the same pair of bytes. */
    get value() { return this.word; }

    onWrite(port, val) { this._noteWrite(port, val); }

    /** @returns {{value: number, signed: number, unsignedText: string,
     *   signedText: string}} */
    state() {
        const v = this.value;
        const signed = v >= 0x8000 ? v - 0x10000 : v;
        return {
            value: v,
            signed,
            unsignedText: String(v),
            signedText: String(signed),
        };
    }
}

// ---------------------------------------------------------------------------
// Printer -- port 130, byte
// ---------------------------------------------------------------------------

/**
 * A line printer with the simplest imaginable handshake.
 *
 * ESTABLISHED, and unusually well, because this device shipped with its own
 * README (DEVICES/Printer.txt, by Andrew Nelis, dated 20 Feb 2003):
 * "the printer can be accessed through port 130 (decimal)"; "you just 'out'
 * a byte to the printer port and it'll print out the corresponding character
 * onto the page, then clear the port back to zero once its done, that way
 * you can tell when it's time to pass it the next character"; "If the char
 * value is greater than 31, then it'll just be printed straight out. Below
 * and including that, it's won't be printed ... apart from the ones that
 * I've implemented: 07 - Bell. 08 - Backspace, move print head left one
 * character. 10 - Line feed. 13 - Carriage return."
 *
 * THE PORT CLEARS ITSELF, and that is the whole handshake. There is no
 * status port and no busy bit: the program writes a byte, the device zeroes
 * the byte when it has consumed it, and a program that wants flow control
 * polls port 130 for zero. Because our device consumes the character inside
 * the write, the port is already zero by the time any `IN` can observe it --
 * which is the correct answer to that poll, not a shortcut past it.
 *
 * BACKSPACE MOVES THE HEAD, IT DOES NOT DELETE. The README says "move print
 * head left one character", so the page is a grid with a head position and a
 * backspace-then-print overstrikes. A naive `text.slice(0, -1)` gets CR
 * wrong too: carriage return returns the head to column zero WITHOUT
 * advancing the line, so `13` alone means the next characters overwrite the
 * line just printed. That is why the page is stored as lines of characters
 * rather than as a string.
 */
export class Printer {
    constructor() {
        /** @type {string[][]} the page, one array of characters per line */
        this.lines = [[]];
        this.row = 0;
        this.col = 0;
        /** Bytes below 32 that the README says are not printed and are not
         *  one of the four it implements. Counted, because a program sending
         *  form-feed (12) expecting a new page gets nothing and should be
         *  able to find out why. */
        this.ignoredControls = 0;
        this.bells = 0;
    }

    get ports() { return [PORTS.PRINTER]; }

    onWrite(port, val) {
        const b = val & 0xff;
        if (b > 31) { this._put(String.fromCharCode(b)); return; }
        switch (b) {
            case 0x07: this.bells++; return;              // audible, not visible
            case 0x08: if (this.col > 0) this.col--; return;
            case 0x0a: this._lineFeed(); return;
            case 0x0d: this.col = 0; return;
            default: this.ignoredControls++; return;
        }
    }

    /** Always zero: the device has consumed the byte. See the class comment. */
    onRead() { return 0; }

    _lineFeed() {
        this.row++;
        while (this.lines.length <= this.row) this.lines.push([]);
    }

    _put(ch) {
        const line = this.lines[this.row];
        // Overstrike, not insert: the head is at a column and prints there.
        while (line.length < this.col) line.push(' ');
        line[this.col] = ch;
        this.col++;
    }

    /** The page as text. Trailing blanks are kept inside a line and trimmed
     *  at its end, the way paper looks. */
    get page() { return this.lines.map((l) => [...l].join('').replace(/\s+$/, '')).join('\n'); }

    /** @returns {{page: string, lines: string[], row: number, col: number,
     *   bells: number, ignoredControls: number}} */
    state() {
        return {
            page: this.page,
            lines: this.lines.map((l) => [...l].join('').replace(/\s+$/, '')),
            row: this.row,
            col: this.col,
            bells: this.bells,
            ignoredControls: this.ignoredControls,
        };
    }
}

// ---------------------------------------------------------------------------
// Robot -- ports 9, 10, 11
// ---------------------------------------------------------------------------

/** Commands, exactly as io.html tabulates them. */
export const ROBOT_CMD = Object.freeze({
    NOTHING: 0, FORWARD: 1, TURN_LEFT: 2, TURN_RIGHT: 3,
    EXAMINE: 4, LAMP_ON: 5, LAMP_OFF: 6,
});

/** Data-register values, exactly as io.html tabulates them. */
export const ROBOT_DATA = Object.freeze({
    WALL: 255, NOTHING: 0, LAMP_ON: 7, LAMP_OFF: 8,
});

/**
 * The robot: a command register, a data register and a status register.
 *
 * ESTABLISHED, and this is the best-documented device of the seven. io.html
 * gives the whole instruction set: port 9 is "a command register" taking
 * 0 do nothing, 1 move forward, 2 turn left, 3 turn right, 4 examine
 * ("examines an object in front using sensor. when robot completes the task,
 * result is set to data register and bit #0 of status register is set to 1"),
 * 5 switch on a lamp, 6 switch off a lamp. Port 10 is "a data register ...
 * set after robot completes the examine command", holding 255 wall, 0
 * nothing, 7 switched-on lamp, 8 switched-off lamp. Port 11 is "a status
 * register" whose bit 0 is new-data, bit 1 is busy, and bit 2 is "one when
 * there is an error on command execution (when robot cannot complete the
 * task: move, turn, examine, switch on/off lamp)". io.html also warns: "you
 * should always check bit#1 of status register before sending data to port
 * 9, otherwise the robot will reject your command".
 *
 * NOT ESTABLISHED: the world. `robot_map.dat` is 54 undocumented bytes, so
 * this takes a map as text -- '#' wall, '*' lamp on, 'o' lamp off, '.' or
 * space empty, and one of '^v<>' for the robot and its heading. The DEFAULT
 * MAP IS OURS. Also not established: how long a command takes (see
 * `commandUs`, default 0), and whether reading the data register clears the
 * new-data bit. We clear it on read, because that is the only rule under
 * which a program can distinguish the result of THIS examine from the last
 * one, and a program polling bit 0 after a second examine would otherwise
 * see a stale one immediately. Inferred, and said so.
 *
 * WHAT A NAIVE IMPLEMENTATION GETS WRONG: treating "examine" as a move. It
 * looks at the cell in front and does not enter it, so examining a wall is a
 * SUCCESS that reports 255 -- not an error. The error bit is for a command
 * the robot could not carry out: walking into a wall, or switching on a lamp
 * where there is none.
 */
export class Robot {
    /**
     * @param {{ map?: string[]|string, commandUs?: number }} [opts]
     */
    constructor(opts = {}) {
        this.commandUs = opts.commandUs || 0;
        this.loadMap(opts.map || Robot.DEFAULT_MAP);
        this._nowUs = 0;
        this._readyAtUs = 0;
        this.newData = false;
        this.error = false;
        this.data = 0;
        this.lastCommand = 0;
        this.rejectedCommands = 0;
        this.unknownCommands = 0;
    }

    /**
     * Ours, not emu8086's: a small walled room with two lamps and a wall to
     * bump into, chosen so every documented command has both a success and a
     * failure case reachable in a few moves.
     */
    static get DEFAULT_MAP() {
        return [
            '#######',
            '#^..*.#',
            '#.###.#',
            '#..o..#',
            '#######',
        ];
    }

    /** Headings as unit steps, in the order a right turn visits them. */
    static get HEADINGS() {
        return [
            { name: 'north', dx: 0, dy: -1, glyph: '^' },
            { name: 'east', dx: 1, dy: 0, glyph: '>' },
            { name: 'south', dx: 0, dy: 1, glyph: 'v' },
            { name: 'west', dx: -1, dy: 0, glyph: '<' },
        ];
    }

    get ports() { return [PORTS.ROBOT_CMD, PORTS.ROBOT_DATA, PORTS.ROBOT_STATUS]; }

    loadMap(map) {
        const rows = (Array.isArray(map) ? map : String(map).split('\n')).map((r) => [...r]);
        this.grid = rows;
        this.x = 0; this.y = 0; this.heading = 0;
        for (let y = 0; y < rows.length; y++) {
            for (let x = 0; x < rows[y].length; x++) {
                const i = '^>v<'.indexOf(rows[y][x]);
                if (i >= 0) {
                    this.x = x; this.y = y; this.heading = i;
                    rows[y][x] = '.';
                }
            }
        }
        return this;
    }

    sync(nowUs) { this._nowUs = nowUs; }

    get busy() { return this._nowUs < this._readyAtUs; }

    _cell(x, y) {
        const row = this.grid[y];
        if (!row) return '#';                            // off the map is wall
        return row[x] === undefined ? '#' : row[x];
    }

    _front() {
        const h = Robot.HEADINGS[this.heading];
        return { x: this.x + h.dx, y: this.y + h.dy };
    }

    onWrite(port, val) {
        if (port !== PORTS.ROBOT_CMD) return;
        const cmd = val & 0xff;
        // "you should always check bit#1 of status register before sending
        // data to port 9, otherwise the robot will reject your command".
        if (this.busy) { this.rejectedCommands++; return; }
        this.lastCommand = cmd;
        this.error = false;
        const f = this._front();
        switch (cmd) {
            case ROBOT_CMD.NOTHING:
                break;
            case ROBOT_CMD.FORWARD:
                if (this._cell(f.x, f.y) === '#') this.error = true;
                else { this.x = f.x; this.y = f.y; }
                break;
            case ROBOT_CMD.TURN_LEFT:
                this.heading = (this.heading + 3) % 4;
                break;
            case ROBOT_CMD.TURN_RIGHT:
                this.heading = (this.heading + 1) % 4;
                break;
            case ROBOT_CMD.EXAMINE: {
                // Looking at a wall is a successful examine reporting 255.
                const c = this._cell(f.x, f.y);
                this.data = c === '#' ? ROBOT_DATA.WALL
                    : c === '*' ? ROBOT_DATA.LAMP_ON
                        : c === 'o' ? ROBOT_DATA.LAMP_OFF
                            : ROBOT_DATA.NOTHING;
                this.newData = true;
                break;
            }
            case ROBOT_CMD.LAMP_ON:
                if (this._cell(this.x, this.y) === 'o') this.grid[this.y][this.x] = '*';
                else this.error = true;
                break;
            case ROBOT_CMD.LAMP_OFF:
                if (this._cell(this.x, this.y) === '*') this.grid[this.y][this.x] = 'o';
                else this.error = true;
                break;
            default:
                // io.html tabulates 0..6 and nothing else.
                this.unknownCommands++;
                this.error = true;
                break;
        }
        this._readyAtUs = this._nowUs + this.commandUs;
    }

    onRead(port) {
        if (port === PORTS.ROBOT_DATA) {
            const d = this.data;
            this.newData = false;       // the handshake; inferred, see above
            return d & 0xff;
        }
        if (port === PORTS.ROBOT_STATUS) {
            return (this.newData ? 0x01 : 0)
                | (this.busy ? 0x02 : 0)
                | (this.error ? 0x04 : 0);
        }
        return this.lastCommand & 0xff;                  // port 9 reads back
    }

    /** The map as text with the robot drawn in, so a test can assert on the
     *  whole world in one string. */
    get mapText() {
        return this.grid.map((row, y) => row.map((c, x) => (
            x === this.x && y === this.y ? Robot.HEADINGS[this.heading].glyph : c
        )).join('')).join('\n');
    }

    state() {
        return {
            x: this.x, y: this.y,
            heading: Robot.HEADINGS[this.heading].name,
            data: this.data,
            newData: this.newData,
            busy: this.busy,
            error: this.error,
            status: this.onReadStatusPeek(),
            mapText: this.mapText,
            rejectedCommands: this.rejectedCommands,
            unknownCommands: this.unknownCommands,
        };
    }

    /** The status byte WITHOUT the side effect a data-register read has.
     *  `state()` must not change the machine it is describing. */
    onReadStatusPeek() {
        return (this.newData ? 0x01 : 0) | (this.busy ? 0x02 : 0) | (this.error ? 0x04 : 0);
    }
}

// ---------------------------------------------------------------------------
// The port space
// ---------------------------------------------------------------------------

/**
 * emu8086's `c:\emu8086.io` as an object: 65536 bytes, plus the devices that
 * watch some of them.
 *
 * The unclaimed bytes are not open bus and not an error -- they are memory.
 * emu8086's simple_io.asm proves it by writing two values to ports 110 and
 * 112 and reading them straight back, and that is the entire behaviour of
 * the "simple test device". So an unclaimed port here reads back what was
 * written and is counted in `report().unclaimed` for visibility, not
 * refused.
 */
export class Emu8086Ports {
    /**
     * @param {{ traffic?: TrafficLights, stepper?: StepperMotor,
     *   thermometer?: Thermometer, led?: LedDisplay, printer?: Printer,
     *   robot?: Robot, now?: () => number }} [opts]
     *   `now` returns MACHINE time in microseconds. Default 0, which freezes
     *   every time-dependent device -- fine for a program that never waits.
     */
    constructor(opts = {}) {
        this.bytes = new Uint8Array(PORT_SPACE_SIZE);
        this.now = opts.now || (() => 0);
        this.devices = {
            traffic: opts.traffic ?? new TrafficLights(),
            stepper: opts.stepper ?? new StepperMotor(),
            thermometer: opts.thermometer ?? new Thermometer(),
            led: opts.led ?? new LedDisplay(),
            printer: opts.printer ?? new Printer(),
            robot: opts.robot ?? new Robot(),
        };
        /** port -> device, built from each device's own declaration so a port
         *  number is stated once, in the device that owns it. */
        this._owner = new Map();
        for (const dev of Object.values(this.devices)) {
            for (const p of dev.ports) {
                if (this._owner.has(p)) {
                    throw new Error(`emu8086 port ${p} claimed by two devices`);
                }
                this._owner.set(p, dev);
            }
        }
        /** "port" -> count, for ports no device owns. */
        this._unclaimed = new Map();
        this.reads = 0;
        this.writes = 0;
    }

    /** Push machine time into every device that cares, before any access. */
    _sync() {
        const us = this.now();
        for (const dev of Object.values(this.devices)) {
            if (dev.sync) dev.sync(us);
        }
    }

    /** @param {number} port @returns {number} a byte */
    read(port) {
        this._sync();
        this.reads++;
        const p = port & 0xffff;
        const dev = this._owner.get(p);
        if (dev && dev.onRead) {
            const v = dev.onRead(p);
            if (v !== undefined) return v & 0xff;
        }
        if (!dev) this._unclaimed.set(p, (this._unclaimed.get(p) || 0) + 1);
        return this.bytes[p];
    }

    /** @param {number} port @param {number} val */
    write(port, val) {
        this._sync();
        this.writes++;
        const p = port & 0xffff;
        // The byte lands in the array FIRST, always. A device is a watcher of
        // the array, not a replacement for it, so even a device port reads
        // back sensibly if the device declines to answer.
        this.bytes[p] = val & 0xff;
        const dev = this._owner.get(p);
        if (dev && dev.onWrite) dev.onWrite(p, val & 0xff);
        else if (!dev) this._unclaimed.set(p, (this._unclaimed.get(p) || 0) + 1);
    }

    /** Convenience for tests and UIs: the word at `port` and `port+1`. */
    readWord(port) { return this.read(port) | (this.read(port + 1) << 8); }

    /** What the machine did, and what we refuse to claim we know. */
    report() {
        // Sync FIRST. The time-dependent devices are integrated lazily on
        // access, so a report taken after a long int 15h delay but before
        // the next IN would otherwise show the temperature and the ready
        // flags as they were at the last port access, not as they are now.
        this._sync();
        return {
            reads: this.reads,
            writes: this.writes,
            unclaimed: [...this._unclaimed].map(([port, count]) => ({ port, count })),
            traffic: this.devices.traffic.state(),
            stepper: this.devices.stepper.state(),
            thermometer: this.devices.thermometer.state(),
            led: this.devices.led.state(),
            printer: this.devices.printer.state(),
            robot: this.devices.robot.state(),
            /** Facts this layer does NOT have evidence for. Kept in the
             *  report so a caller reading device state cannot mistake an
             *  invented default for an emulated one. */
            unestablished: UNESTABLISHED,
            /** Values that are ours, not emu8086's. */
            invented: {
                thermometerAmbientC: this.devices.thermometer.ambientC,
                thermometerHeatRateCPerSec: this.devices.thermometer.heatRateCPerSec,
                thermometerCoolRateCPerSec: this.devices.thermometer.coolRateCPerSec,
                stepperSettleUs: this.devices.stepper.settleUs,
                robotCommandUs: this.devices.robot.commandUs,
                robotMap: 'ours -- robot_map.dat format is undocumented',
            },
        };
    }
}

/**
 * Everything this layer could not establish from documentation or from a
 * corpus call site. Exported so it can be asserted on: a later contributor
 * who finds evidence for one of these should delete the line, not add a
 * guess next to it.
 */
export const UNESTABLISHED = Object.freeze([
    'traffic lights: which lamp group faces which compass direction (the '
        + 'corpus reads groups 0/2 as north-south and 1/3 as east-west, which '
        + 'is a statement about emu8086\'s window, not documentation)',
    'stepper motor: how the device derives an absolute shaft angle from an '
        + 'arbitrary magnet pattern, and where the zero datum is',
    'stepper motor: how long the motor is not-ready after a command',
    'thermometer: the ambient temperature, the heating and cooling rates, '
        + 'the valid range, and whether port 127 is a bit or a number',
    'LED display: the digit count, and whether the device renders the word '
        + 'signed or unsigned (the -5678 in emu8086\'s own test leans signed)',
    'LED display: any seven-segment segment map -- port 199 is a number, and '
        + 'no evidence of a per-segment bit layout was found',
    'robot: the robot_map.dat file format, and so the default world',
    'robot: how long a command takes, and whether reading the data register '
        + 'is what clears the new-data bit',
    'printer: whether the device has any status beyond the port clearing '
        + 'itself to zero',
    'the "simple" test device: whether Simple.exe does anything beyond the '
        + 'flat read-back that emu8086\'s simple_io.asm demonstrates',
]);

// ---------------------------------------------------------------------------
// Installing into the machine
// ---------------------------------------------------------------------------

/**
 * A machine shaped for emu8086 programs: RAM everywhere a .COM or a .BIN can
 * land, the DOS layer's trap page, and NO decoded chips -- because in
 * emu8086 there are none. The entire port space belongs to the virtual
 * devices.
 *
 * Deliberately the same shape as `DOSBOX8086`, since an emu8086 program
 * still wants int 21h and int 15h from `createDos8086`.
 */
export const EMU8086BOX = Object.freeze({
    clockHz: 5_000_000,
    regions: [
        { kind: 'ram', start: 0x00000, end: 0xbffff },
        // The DOS layer's trap page. See i8086-dos.js: the vectors are real
        // and each slot holds `jmp $`, so this page must be WRITABLE.
        trapRegion(),
    ],
    chips: [],
});

/**
 * Install the emu8086 port space on a machine.
 *
 * HOW IT PLUGS IN, and why this way. `i8086-machine.js` decodes I/O through
 * a list of windows, each `{start, end, chip}` with `chip.read(reg)` and
 * `chip.write(reg, val)`, and `_in` returns 0FFh when no window matches. Its
 * chip KINDS are a fixed set in that module, which this layer must not
 * touch, so the port space is registered as one window spanning the whole
 * 16-bit port range with a stride of 1 -- which makes the machine's own
 * `regOf` hand us the port number unchanged.
 *
 * THE WINDOW GOES ON THE END OF THE LIST ON PURPOSE. The machine tries
 * windows in order, so any chip the config actually declared -- an 8255, a
 * UART -- still wins for its own ports, and the emu8086 devices fill
 * everything else. A machine built from `EMU8086BOX` declares no chips, so
 * the port space gets all 65536; a hybrid board keeps its real hardware and
 * gains the virtual devices around it. Installing at the FRONT would silently
 * shadow the board's own chips, which is the bug this ordering avoids.
 *
 * @param {import('./i8086-machine.js').I8086Machine} machine
 * @param {{ traffic?: TrafficLights, stepper?: StepperMotor,
 *   thermometer?: Thermometer, led?: LedDisplay, printer?: Printer,
 *   robot?: Robot }} [opts]
 */
export function createEmu8086(machine, opts = {}) {
    const ports = new Emu8086Ports({
        ...opts,
        // Machine time in microseconds. `machine.tMs` is fractional
        // milliseconds derived from `cycles`, so an int 15h/86h delay -- which
        // advances `cycles` in one jump -- shows up here immediately.
        now: () => machine.tMs * 1000,
    });
    let installed = false;
    return {
        machine,
        ports,
        devices: ports.devices,

        install() {
            if (installed) return this;
            for (const w of machine._io) {
                if (w.name === 'emu8086') return this;
            }
            machine._io.push({
                name: 'emu8086',
                chip: ports,
                regs: PORT_SPACE_SIZE,
                stride: 1,
                start: 0,
                end: PORT_SPACE_SIZE - 1,
            });
            installed = true;
            return this;
        },

        /** The macro library as assembly source text. See EMU8086_INC. */
        inc() { return EMU8086_INC; },

        report() { return ports.report(); },
    };
}

// ---------------------------------------------------------------------------
// The emu8086.inc equivalent, as source text
// ---------------------------------------------------------------------------

/**
 * A clean-room replacement for `emu8086.inc`, as assembly source an
 * assembler can INCLUDE.
 *
 * NOT ONE LINE OF THIS CAME FROM emu8086.inc. That file was never
 * downloaded, opened or transcribed; its licence is unclear and the project's
 * ruling is to refuse it. What was used instead is emu8086's PUBLISHED
 * DOCUMENTATION of the interface -- asm_tutorial_05.html, "Library of common
 * functions - emu8086.inc", which lists every macro and procedure with its
 * register convention -- and the corpus call sites that exercise them. The
 * bodies below are written from those descriptions using ordinary int 21h
 * and int 10h services, which is all these helpers ever were.
 *
 * WHAT THE DOCUMENTATION ESTABLISHED, verbatim in substance:
 *   PUTC char       "prints out an ASCII char at current cursor position"
 *   GOTOXY col,row  "sets cursor position"
 *   PRINT string    "prints out a string"
 *   PRINTN string   "The same as PRINT but automatically adds carriage
 *                   return at the end of the string"
 *   CURSORON /
 *   CURSOROFF       "turns on / off the text cursor"
 *   PRINT_STRING    "print a null terminated string at current cursor
 *                   position, receives address of string in DS:SI"
 *   PTHIS           "just as PRINT_STRING, but receives address of string
 *                   from Stack. The ZERO TERMINATED string should be defined
 *                   just after the CALL instruction"
 *   GET_STRING      "get a null terminated string from a user, the received
 *                   string is written to buffer at DS:DI, buffer size should
 *                   be in DX. Procedure stops the input when 'Enter' is
 *                   pressed"
 *   CLEAR_SCREEN    "clear the screen, (done by scrolling entire screen
 *                   window), and set cursor position to top of it"
 *   SCAN_NUM        "gets the multi-digit SIGNED number from the keyboard,
 *                   and stores the result in CX register"
 *   PRINT_NUM       "prints a signed number in AX register"
 *   PRINT_NUM_UNS   "prints out an unsigned number in AX register"
 * and, for each procedure, "To use it declare DEFINE_<name> before END".
 *
 * WHAT THE CORPUS ESTABLISHED that the documentation does not:
 *
 *   - PRINT TAKES A NUMBER AS WELL AS A STRING. Project #0 lines 48, 49 and
 *     108: `PRINT 0AH`, `PRINT 0DH`, `PRINT 09H`. So the parameter is
 *     whatever `DB` accepts, not specifically a quoted string, and the macro
 *     must pass it through to a DB rather than assume text.
 *
 *   - PRINTN TAKES NO ARGUMENT. Project #7 lines 8, 10 and 12 use a bare
 *     `PRINTN` as a line separator between `PRINT` calls. So the parameter
 *     is optional, which is why the body below is guarded with IFNB.
 *
 *   - PRINTN MUST EMIT LINE FEED, NOT JUST CARRIAGE RETURN. The
 *     documentation says "carriage return", and taken literally that is byte
 *     13 alone -- which returns the cursor to column zero WITHOUT advancing
 *     a line, so Project #7's consecutive PRINTNs would overprint one line
 *     instead of separating three. It emits 13 then 10. This is the one
 *     place where the documented wording and the corpus's evident intent
 *     disagree, and the corpus wins because it is the thing that has to run.
 *
 *   - PRINT_STRING MUST PRESERVE SI, and every helper must preserve the
 *     registers it does not document as outputs. Project #0's LOOP1 keeps an
 *     array index in SI across `CALL SCAN_NUM` and two `PRINT` calls (lines
 *     45-51). A helper that clobbered SI would corrupt the loop, and the
 *     failure would look like bad sorting rather than a broken library.
 *     SCAN_NUM therefore returns in CX and preserves everything else --
 *     Project #0 line 35 comments "THE FUNCTION PUTS THE INPUT IN CX".
 *
 *   - DEFINE_* MUST BE SAFE TO PLACE IN THE LIVE INSTRUCTION PATH. The
 *     documentation says to declare them "in the bottom of your file (but
 *     before the END directive)", where they are unreachable. Project #0
 *     lines 25-28 and Project #2 lines 21-25 do NOT do that: they sit
 *     between `MOV DS, AX` and the first real instruction. If DEFINE_X
 *     expanded to a bare PROC the CPU would fall straight into the procedure
 *     and hit its RET with the wrong return address, and the program would
 *     die on the fourth instruction. So every DEFINE_ below jumps over its
 *     own body. That makes both placements work, and it is the single most
 *     important thing here: without it, six of the ten corpus projects fail
 *     immediately.
 *
 *   - PRINT_NUM DEPENDS ON PRINT_NUM_UNS. The documentation says PRINT_NUM
 *     needs "DEFINE_PRINT_NUM and DEFINE_PRINT_NUM_UNS", which only makes
 *     sense if the signed one calls the unsigned one. It does here: print a
 *     '-', negate, and fall through. That also gets -32768 right for free,
 *     since NEG 8000h is 8000h and 8000h printed unsigned is 32768.
 *
 * ASSEMBLER REQUIREMENTS, stated because they are real: the text below uses
 * MASM-style `MACRO`/`ENDM` with `LOCAL` for macro-local labels, `PROC
 * NEAR`/`ENDP`, `IFNB`/`ENDIF`, and `OFFSET`. `LOCAL` is not a nicety -- a
 * macro that emits a label and is used twice is a duplicate-declaration
 * error otherwise, which is the problem emu8086's own macro tutorial warns
 * about. An assembler without `LOCAL` cannot host this file unmodified.
 *
 * WHY THE MACROS USE A CS OVERRIDE for their inline strings: a macro's
 * string is emitted in the CODE segment, next to the instruction that prints
 * it. `PRINT_STRING` reads DS:SI, which is the same place only in a .COM
 * where DS equals CS. The macros here read `CS:[SI]` explicitly so they are
 * also correct in an .EXE with a separate data segment -- where the naive
 * version prints whatever happens to sit at the same offset in DS.
 */
export const EMU8086_INC = `; ---------------------------------------------------------------------------
; emu8086.inc work-alike -- a CLEAN RE-IMPLEMENTATION.
;
; This file is NOT emu8086's emu8086.inc and contains none of it. emu8086 is
; proprietary and its include file carries no licence that can be relied on,
; so this was written from emu8086's PUBLISHED DOCUMENTATION of the interface
; (asm_tutorial_05.html, "Library of common functions") plus the observable
; conventions of MIT-licensed programs that call it. Interfaces are facts;
; this is a fresh implementation of them.
;
; Macros (use by name):     PUTC, GOTOXY, PRINT, PRINTN, CURSORON, CURSOROFF
; Procedures (CALL these,   PRINT_STRING, PTHIS, GET_STRING, CLEAR_SCREEN,
; after DEFINE_<name>):      SCAN_NUM, PRINT_NUM, PRINT_NUM_UNS
;
; Each DEFINE_ macro jumps over the procedure it emits, so it is safe both
; at the bottom of the file (as the documentation advises) and in the middle
; of running code (as real programs actually place it).
;
; Requires an assembler with MACRO/ENDM, LOCAL, PROC/ENDP and IFNB.
; ---------------------------------------------------------------------------

; ---- macros ---------------------------------------------------------------

; PUTC char -- print one character at the cursor.
PUTC MACRO ch
    PUSH AX
    PUSH DX
    MOV  DL, ch
    MOV  AH, 2
    INT  21h
    POP  DX
    POP  AX
ENDM

; GOTOXY col, row -- set the cursor position on page 0.
GOTOXY MACRO col, row
    PUSH AX
    PUSH BX
    PUSH DX
    MOV  DL, col
    MOV  DH, row
    MOV  BH, 0
    MOV  AH, 2
    INT  10h
    POP  DX
    POP  BX
    POP  AX
ENDM

; CURSOROFF -- hide the text cursor. Bit 5 of CH is the "no cursor" bit of
; the BIOS set-cursor-shape call; there is no separate "off" service.
CURSOROFF MACRO
    PUSH AX
    PUSH CX
    MOV  CX, 2000h
    MOV  AH, 1
    INT  10h
    POP  CX
    POP  AX
ENDM

; CURSORON -- restore an ordinary underline cursor (scan lines 6..7, the
; text-mode default a BIOS reports).
CURSORON MACRO
    PUSH AX
    PUSH CX
    MOV  CX, 0607h
    MOV  AH, 1
    INT  10h
    POP  CX
    POP  AX
ENDM

; PRINT arg -- print an inline string or byte. \`arg\` is passed straight to
; DB, so both PRINT 'text' and PRINT 0AH work.
;
; The string is emitted here in the code segment and read back with a CS
; override, so this is correct in an .EXE as well as in a .COM. SI is saved:
; callers keep loop counters in it.
PRINT MACRO arg
    LOCAL str, skip, nextch, done
    PUSH AX
    PUSH DX
    PUSH SI
    JMP  skip
str:
    DB   arg, 0
skip:
    MOV  SI, OFFSET str
nextch:
    MOV  AL, CS:[SI]
    CMP  AL, 0
    JE   done
    MOV  DL, AL
    MOV  AH, 2
    INT  21h
    INC  SI
    JMP  nextch
done:
    POP  SI
    POP  DX
    POP  AX
ENDM

; PRINTN arg -- PRINT then end the line. The argument is OPTIONAL: a bare
; PRINTN is a blank line, which is how real programs use it as a separator.
;
; Emits 13 AND 10. Carriage return alone would return to column zero without
; advancing, so consecutive PRINTNs would overprint a single line.
PRINTN MACRO arg
    IFNB <arg>
    PRINT arg
    ENDIF
    PUTC 13
    PUTC 10
ENDM

; ---- procedures -----------------------------------------------------------

; PRINT_STRING -- print the NUL-terminated string at DS:SI.
DEFINE_PRINT_STRING MACRO
    LOCAL over
    JMP  over
PRINT_STRING PROC NEAR
    PUSH AX
    PUSH DX
    PUSH SI
ps_next:
    MOV  AL, [SI]
    CMP  AL, 0
    JE   ps_done
    MOV  DL, AL
    MOV  AH, 2
    INT  21h
    INC  SI
    JMP  ps_next
ps_done:
    POP  SI
    POP  DX
    POP  AX
    RET
PRINT_STRING ENDP
over:
ENDM

; PTHIS -- print the NUL-terminated string that follows the CALL, then
; return PAST it.
;
; The return address a NEAR call pushed IS the address of the string. The
; whole point of the procedure is that it must fix that address up before
; returning: a version that just RETs jumps into its own text and executes
; the message as instructions.
DEFINE_PTHIS MACRO
    LOCAL over
    JMP  over
PTHIS PROC NEAR
    PUSH BP
    MOV  BP, SP
    PUSH AX
    PUSH DX
    PUSH SI
    MOV  SI, [BP+2]
pt_next:
    MOV  AL, CS:[SI]
    INC  SI
    CMP  AL, 0
    JE   pt_done
    MOV  DL, AL
    MOV  AH, 2
    INT  21h
    JMP  pt_next
pt_done:
    MOV  [BP+2], SI
    POP  SI
    POP  DX
    POP  AX
    POP  BP
    RET
PTHIS ENDP
over:
ENDM

; GET_STRING -- read a line into the buffer at DS:DI, DX bytes long,
; NUL-terminating it. Stops on Enter.
;
; DX is the buffer SIZE and DL is half of it, so the size is copied to BX
; immediately: the echo below needs DL, and a version that keeps the size in
; DX corrupts it on the first backspace.
; One byte of the buffer is reserved for the terminator, so DX=1 stores no
; characters at all -- which is the only reading under which the result is
; always a valid NUL-terminated string. DX=0 stores NOTHING, not even the
; terminator: writing one into a zero-byte buffer would overrun the very
; buffer whose size the caller passed in to prevent that.
DEFINE_GET_STRING MACRO
    LOCAL over
    JMP  over
GET_STRING PROC NEAR
    PUSH AX
    PUSH BX
    PUSH CX
    PUSH DX
    PUSH DI
    MOV  BX, DX
    XOR  CX, CX
    CMP  BX, 0
    JE   gs_ret
    DEC  BX
gs_key:
    MOV  AH, 1
    INT  21h
    CMP  AL, 13
    JE   gs_done
    CMP  AL, 8
    JNE  gs_store
    CMP  CX, 0
    JE   gs_key
    DEC  CX
    DEC  DI
    MOV  DL, ' '
    MOV  AH, 2
    INT  21h
    MOV  DL, 8
    MOV  AH, 2
    INT  21h
    JMP  gs_key
gs_store:
    CMP  CX, BX
    JAE  gs_key
    MOV  [DI], AL
    INC  DI
    INC  CX
    JMP  gs_key
gs_done:
    MOV  BYTE PTR [DI], 0
gs_ret:
    POP  DI
    POP  DX
    POP  CX
    POP  BX
    POP  AX
    RET
GET_STRING ENDP
over:
ENDM

; CLEAR_SCREEN -- blank the screen and home the cursor.
;
; Done by scrolling the whole window, which is what the documented behaviour
; describes: AH=6 with AL=0 blanks the named window rather than scrolling it.
DEFINE_CLEAR_SCREEN MACRO
    LOCAL over
    JMP  over
CLEAR_SCREEN PROC NEAR
    PUSH AX
    PUSH BX
    PUSH CX
    PUSH DX
    MOV  AX, 0600h
    MOV  BH, 07h
    MOV  CX, 0000h
    MOV  DX, 184Fh
    INT  10h
    MOV  AH, 2
    MOV  BH, 0
    MOV  DX, 0000h
    INT  10h
    POP  DX
    POP  CX
    POP  BX
    POP  AX
    RET
CLEAR_SCREEN ENDP
over:
ENDM

; SCAN_NUM -- read a multi-digit SIGNED decimal number into CX.
;
; CX is the documented output, so it is the one register not preserved. A
; leading '-' or '+' is accepted; non-digits are ignored; Enter ends it.
; The digit is held in BL and the sign in BH because MUL writes DX, and a
; version that parks the digit in DL loses it on the first multiply.
DEFINE_SCAN_NUM MACRO
    LOCAL over
    JMP  over
SCAN_NUM PROC NEAR
    PUSH AX
    PUSH BX
    PUSH DX
    XOR  CX, CX
    XOR  BX, BX
    MOV  AH, 1
    INT  21h
    CMP  AL, '-'
    JNE  sn_plus
    MOV  BH, 1
    JMP  sn_next
sn_plus:
    CMP  AL, '+'
    JNE  sn_digit
sn_next:
    MOV  AH, 1
    INT  21h
sn_digit:
    CMP  AL, 13
    JE   sn_end
    CMP  AL, '0'
    JB   sn_next
    CMP  AL, '9'
    JA   sn_next
    SUB  AL, '0'
    MOV  BL, AL
    MOV  AX, CX
    MOV  DX, 10
    MUL  DX
    MOV  CX, AX
    XOR  AX, AX
    MOV  AL, BL
    ADD  CX, AX
    JMP  sn_next
sn_end:
    CMP  BH, 0
    JE   sn_ret
    NEG  CX
sn_ret:
    POP  DX
    POP  BX
    POP  AX
    RET
SCAN_NUM ENDP
over:
ENDM

; PRINT_NUM_UNS -- print AX as an unsigned decimal number.
;
; Digits come out of DIV least-significant first, so they are pushed and then
; popped in reverse. CX counts them, which is also what LOOP wants, and a
; zero AX still pushes one digit so 0 prints as "0" rather than as nothing.
DEFINE_PRINT_NUM_UNS MACRO
    LOCAL over
    JMP  over
PRINT_NUM_UNS PROC NEAR
    PUSH AX
    PUSH BX
    PUSH CX
    PUSH DX
    MOV  BX, 10
    XOR  CX, CX
pnu_div:
    XOR  DX, DX
    DIV  BX
    PUSH DX
    INC  CX
    CMP  AX, 0
    JNE  pnu_div
pnu_out:
    POP  DX
    ADD  DL, '0'
    MOV  AH, 2
    INT  21h
    LOOP pnu_out
    POP  DX
    POP  CX
    POP  BX
    POP  AX
    RET
PRINT_NUM_UNS ENDP
over:
ENDM

; PRINT_NUM -- print AX as a signed decimal number.
;
; Calls PRINT_NUM_UNS, which is why the documented usage requires
; DEFINE_PRINT_NUM_UNS as well. -32768 comes out right without a special
; case: NEG 8000h is 8000h, and 8000h printed unsigned is 32768.
DEFINE_PRINT_NUM MACRO
    LOCAL over
    JMP  over
PRINT_NUM PROC NEAR
    PUSH AX
    PUSH DX
    CMP  AX, 0
    JGE  pn_pos
    PUSH AX
    MOV  DL, '-'
    MOV  AH, 2
    INT  21h
    POP  AX
    NEG  AX
pn_pos:
    CALL PRINT_NUM_UNS
    POP  DX
    POP  AX
    RET
PRINT_NUM ENDP
over:
ENDM
`;

/** The macro and procedure names this library provides, so a runner can tell
 *  a program using an ESTABLISHED helper from one using something we never
 *  found evidence for. */
export const INC_MACROS = Object.freeze([
    'PUTC', 'GOTOXY', 'PRINT', 'PRINTN', 'CURSORON', 'CURSOROFF',
]);
export const INC_PROCEDURES = Object.freeze([
    'PRINT_STRING', 'PTHIS', 'GET_STRING', 'CLEAR_SCREEN',
    'SCAN_NUM', 'PRINT_NUM', 'PRINT_NUM_UNS',
]);

// ---------------------------------------------------------------------------
// Source directives: #start=...#, #make_COM#, #make_BIN#
// ---------------------------------------------------------------------------

/**
 * What emu8086's `#...#` directives mean, for a runner deciding how to load.
 *
 * `#start=NAME#` IS NOT AN ENTRY POINT, and this is the trap. It looks
 * exactly like a "start here" directive and it is nothing of the kind: it
 * names a VIRTUAL DEVICE to open. emu8086's device README says devices are
 * activated "when its file name is found anywhere in comments or in string
 * buffers", and emu8086's own thermometer.asm carries `#start=thermometer.exe#`
 * under the comment "thermometer.exe is started automatically from
 * c:\\emu8086\\devices. it is also accessible from the 'virtual devices' menu".
 * Corpus Project #6 opens with `#start=Traffic_Lights.exe#` and its entry
 * point is simply the first instruction. A runner that treated the name as a
 * label or a file to execute would fail on every device program in the
 * corpus; what it should do is make sure that device is present.
 *
 * The output-type directives decide the LOADER, from compiler.html:
 *   #make_com#   raw binary loaded at offset 100h behind a PSP; needs
 *                `ORG 100h`; execution starts at the first byte. Selected
 *                automatically when `org 100h` is present. -> loadCom().
 *   #make_exe#   an MZ image with a real header, its own stack segment, and
 *                an entry point named in the header. Selected automatically
 *                when a stack segment is found. -> loadExe().
 *   #make_bin#   raw binary plus a .BINF sidecar naming the load address and
 *                the initial value of every register. Defaults, when the
 *                sidecar says nothing: LOAD_SEGMENT=0100, LOAD_OFFSET=0000,
 *                CS=DS=ES=SS=0100, IP=0000. -> a flat load at seg:off with
 *                registers preset. THIS IS THE ONE THE DEVICE EXAMPLES USE,
 *                and it has no PSP and no int 20h trapdoor, so a program that
 *                just runs off the end is not rescued the way a .COM is.
 *   #make_boot#  #make_bin# with the load address fixed at 0000:7C00 and a
 *                512-byte limit; needs `ORG 7C00h`.
 *
 * The register-preset directives (#AX=..# style, #LOAD_SEGMENT=..#,
 * #LOAD_OFFSET=..#, #MEM=..#) are all HEXADECIMAL WITHOUT A SUFFIX, which is
 * the other easy mistake: `#CS=1234#` is 1234h, not decimal 1234.
 */
export const MAKE_TYPES = Object.freeze({
    make_com: { loader: 'com', org: 0x100, describe: 'raw binary at PSP:0100h' },
    make_exe: { loader: 'exe', org: null, describe: 'MZ image, entry point from header' },
    make_bin: { loader: 'bin', org: null, describe: 'raw binary at LOAD_SEGMENT:LOAD_OFFSET' },
    make_boot: { loader: 'bin', org: 0x7c00, describe: 'boot sector at 0000:7C00, max 512 bytes' },
});

/** The eight-bit and sixteen-bit register presets a .BINF can carry. */
const BINF_REGS = [
    'al', 'ah', 'bl', 'bh', 'cl', 'ch', 'dl', 'dh',
    'ds', 'es', 'si', 'di', 'bp', 'cs', 'ip', 'ss', 'sp',
];

/**
 * Read emu8086's source directives out of a program's text.
 *
 * @param {string} source
 * @returns {{devices: string[], makeType: string|null, loader: string,
 *   loadSegment: number, loadOffset: number, registers: Record<string, number>,
 *   mem: Array<{at: number, bytes: number[]}>, org: number|null,
 *   warnings: string[]}}
 */
export function parseDirectives(source) {
    const text = String(source);
    const warnings = [];
    const devices = [];
    const registers = {};
    const mem = [];
    let makeType = null;

    // Devices: the #start= form, which is the only one worth honouring
    // mechanically. emu8086 ALSO activates a device whose filename appears
    // anywhere in a comment, which is far too loose to imitate -- a program
    // merely mentioning robot.exe would open the robot. Recorded as a
    // difference rather than implemented.
    for (const m of text.matchAll(/#start\s*=\s*([^#]+)#/gi)) {
        devices.push(m[1].trim());
    }

    for (const m of text.matchAll(/#(make_com|make_exe|make_bin|make_boot)#/gi)) {
        const t = m[1].toLowerCase();
        if (makeType && makeType !== t) {
            warnings.push(`two output types requested: ${makeType} and ${t}; ${t} wins`);
        }
        makeType = t;
    }

    // All directive values are hex with no suffix. See the module comment.
    const hex = (s) => parseInt(s.trim(), 16);
    let loadSegment = null, loadOffset = null;
    const seg = text.match(/#load_segment\s*=\s*([0-9a-f]+)\s*#/i);
    if (seg) loadSegment = hex(seg[1]);
    const off = text.match(/#load_offset\s*=\s*([0-9a-f]+)\s*#/i);
    if (off) loadOffset = hex(off[1]);

    for (const r of BINF_REGS) {
        const m = text.match(new RegExp(`#${r}\\s*=\\s*([0-9a-f]+)\\s*#`, 'i'));
        if (m) registers[r] = hex(m[1]);
    }

    // #MEM=nnnn,bytestring-nnnn:nnnn,bytestring#
    const memDir = text.match(/#mem\s*=\s*([^#]+)#/i);
    if (memDir) {
        for (const entry of memDir[1].split('-')) {
            const m = entry.match(/\s*(?:([0-9a-f]+):)?([0-9a-f]+)\s*,\s*([0-9a-f\s]+)/i);
            if (!m) { warnings.push(`unparsable #MEM# entry: ${entry.trim()}`); continue; }
            const body = m[3].replace(/\s+/g, '');
            if (body.length % 2) { warnings.push(`#MEM# byte string has an odd length: ${body}`); continue; }
            const at = m[1] === undefined
                ? parseInt(m[2], 16)
                : ((parseInt(m[1], 16) << 4) + parseInt(m[2], 16)) & 0xfffff;
            const bytes = [];
            for (let i = 0; i < body.length; i += 2) bytes.push(parseInt(body.substr(i, 2), 16));
            mem.push({ at, bytes });
        }
    }

    // Automatic selection, in the order compiler.html gives: an explicit
    // directive first, then `org 100h` means COM, then a stack segment means
    // EXE. Nothing else is inferable and we do not guess.
    if (!makeType) {
        if (/^\s*org\s+100h\b/im.test(text)) makeType = 'make_com';
        else if (/\.stack\b|\bstack\s+segment\b/i.test(text)) makeType = 'make_exe';
        else warnings.push('no output type directive, no ORG 100h and no stack segment: '
            + 'the loader cannot be determined from the source');
    }

    const info = makeType ? MAKE_TYPES[makeType] : null;
    if (loadSegment === null && loadOffset === null && makeType === 'make_boot') {
        loadSegment = 0x0000; loadOffset = 0x7c00;
    }

    for (const d of devices) {
        if (!/\.exe$/i.test(d)) {
            warnings.push(`#start=${d}# does not name a .exe device; emu8086's `
                + 'devices are all .exe files, so this may be a misuse of the directive');
        }
    }

    return {
        devices,
        makeType,
        loader: info ? info.loader : 'unknown',
        // compiler.html: "When not specified these values are set by default:
        // LOAD_SEGMENT = 0100, LOAD_OFFSET = 0000".
        loadSegment: loadSegment === null ? 0x0100 : loadSegment,
        loadOffset: loadOffset === null ? 0x0000 : loadOffset,
        registers,
        mem,
        org: info ? info.org : null,
        warnings,
    };
}

/** Which device object a `#start=NAME#` names, or null if we have no such
 *  device. Case- and extension-insensitive, because the corpus writes
 *  `Traffic_Lights.exe` and emu8086's own examples write `led_display.exe`. */
export function deviceForStart(name) {
    const key = String(name).replace(/\.exe$/i, '').replace(/[^a-z]/gi, '').toLowerCase();
    const map = {
        trafficlights: 'traffic',
        traffic: 'traffic',
        steppermotor: 'stepper',
        stepper: 'stepper',
        thermometer: 'thermometer',
        leddisplay: 'led',
        led: 'led',
        printer: 'printer',
        robot: 'robot',
        // Simple.exe needs no handler: flat read-back is its whole behaviour.
        simple: null,
    };
    return key in map ? map[key] : undefined;
}

export default createEmu8086;
