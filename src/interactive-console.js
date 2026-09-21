/**
 * Interactive console — the reusable core of "steer a booted OS from a
 * widget". It turns `machine.keyIn(scancode)` (the XT keyboard path: latch
 * 8255 port A, raise IRQ1) into a text-level interface: type a string, wait
 * for the screen to say something, read the screen back. The lite keyboard
 * widget drives the same `keyIn`; this module is what a headless script (or
 * a server-side session) uses to script the same interaction.
 *
 * It is deliberately machine-agnostic above `keyIn`/`mem`: any I8086Machine
 * (PCXT8086, the 286/386 AT configs) whose keyboard reaches the guest works.
 * NOT pinned by any receipt — a new file.
 *
 * @module
 */

// US XT set-1 make codes, by the character they produce UNSHIFTED.
const BASE = {
    '1':0x02,'2':0x03,'3':0x04,'4':0x05,'5':0x06,'6':0x07,'7':0x08,'8':0x09,'9':0x0a,'0':0x0b,
    '-':0x0c,'=':0x0d,
    'q':0x10,'w':0x11,'e':0x12,'r':0x13,'t':0x14,'y':0x15,'u':0x16,'i':0x17,'o':0x18,'p':0x19,'[':0x1a,']':0x1b,
    'a':0x1e,'s':0x1f,'d':0x20,'f':0x21,'g':0x22,'h':0x23,'j':0x24,'k':0x25,'l':0x26,';':0x27,"'":0x28,'`':0x29,
    '\\':0x2b,'z':0x2c,'x':0x2d,'c':0x2e,'v':0x2f,'b':0x30,'n':0x31,'m':0x32,',':0x33,'.':0x34,'/':0x35,
    ' ':0x39,'\n':0x1c,'\r':0x1c,'\t':0x0f,'\b':0x0e,'\x1b':0x01,
};
// Characters that are the SHIFTED form of a base key.
const SHIFTED = {
    '!':'1','@':'2','#':'3','$':'4','%':'5','^':'6','&':'7','*':'8','(':'9',')':'0','_':'-','+':'=',
    '{':'[','}':']',':':';','"':"'",'~':'`','|':'\\','<':',','>':'.','?':'/',
};
const LSHIFT = 0x2a;

/** [scancode, needsShift] for one character, or null if we can't type it. */
export function charToScancode(ch) {
    if (BASE[ch] !== undefined) return [BASE[ch], false];
    const lower = ch.toLowerCase();
    if (ch !== lower && BASE[lower] !== undefined) return [BASE[lower], true]; // A-Z
    if (SHIFTED[ch] !== undefined) return [BASE[SHIFTED[ch]], true];
    return null;
}

export class InteractiveConsole {
    /**
     * @param {object} machine - an I8086Machine with keyIn(scancode) + mem
     * @param {{ perKeySteps?: number, cols?: number, rows?: number, textBase?: number }} [opts]
     */
    constructor(machine, opts = {}) {
        this.m = machine;
        this.perKey = opts.perKeySteps ?? 80_000;
        this.cols = opts.cols ?? 80;
        this.rows = opts.rows ?? 25;
        this.textBase = opts.textBase ?? 0xb8000;
    }

    /** Run the CPU for n instructions. */
    spin(n) { for (let i = 0; i < n; i++) this.m.step(); }

    /**
     * Press then release one scancode, stepping between EVERY scancode so the
     * guest's keyboard ISR reads each byte before the next overwrites port A.
     * (keyIn latches a single byte at port A; two calls with no CPU steps
     * between them lose the first — which silently drops the Shift prefix.)
     */
    tap(scancode, { shift = false } = {}) {
        if (shift) { this.m.keyIn(LSHIFT); this.spin(this.perKey); }
        this.m.keyIn(scancode & 0x7f); this.spin(this.perKey);
        this.m.keyIn((scancode & 0x7f) | 0x80); this.spin(this.perKey);   // break
        if (shift) { this.m.keyIn(LSHIFT | 0x80); this.spin(this.perKey); }
    }

    /** Type a string; unknown characters are skipped (returns them). */
    type(str) {
        const skipped = [];
        for (const ch of str) {
            const sc = charToScancode(ch);
            if (!sc) { skipped.push(ch); continue; }
            this.tap(sc[0], { shift: sc[1] });
        }
        return skipped;
    }

    /** The text plane as one string (unprintable → space). */
    screen() {
        const v = this.m.mem.subarray(this.textBase, this.textBase + this.cols * this.rows * 2);
        let t = '';
        for (let i = 0; i < v.length; i += 2) t += (v[i] >= 32 && v[i] < 127) ? String.fromCharCode(v[i]) : ' ';
        return t;
    }

    /** Compact screen (collapsed runs of spaces), handy for matching. */
    compact() { return this.screen().replace(/ {2,}/g, ' ').trim(); }

    /**
     * Step until the screen contains `needle`, or `maxSteps` elapse.
     * @returns {boolean} whether it appeared.
     */
    waitFor(needle, maxSteps = 20_000_000, chunk = 200_000) {
        for (let done = 0; done < maxSteps; done += chunk) {
            this.spin(chunk);
            if (this.screen().includes(needle)) return true;
        }
        return this.screen().includes(needle);
    }

    /** Type a line (adds Enter) and settle. */
    sendLine(line, settle = 2_000_000) { this.type(line + '\n'); this.spin(settle); }
}
