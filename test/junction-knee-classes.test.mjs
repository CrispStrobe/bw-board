/**
 * WHICH DEVICE CLASSES TAKE THE DATASHEET CONVENTION, AND WHY THE OTHERS DO NOT.
 *
 * `vf` is the DATASHEET total drop at a rated current for led and diode, so the
 * piecewise path converts it to a knee with `kneeFromVf`. Zener forward drop and
 * BJT `vbe` are deliberately left as knees. Three reasons, each measured, and
 * this file exists so that the exclusion is a decision rather than an oversight:
 *
 * 1. ONE PATH, NOTHING TO AGREE WITH. Only led and diode can reach the
 *    exponential model (board.js gates on `kind === 'led' || kind === 'diode'`;
 *    stampZener, stampNPN and stampPNP hold no reference to it). For led and
 *    diode the correction makes two disagreeing paths agree — that is the whole
 *    argument. For zener and BJT there is no second answer, so the same edit
 *    would be a unilateral behaviour change with nothing to check it against.
 *
 * 2. NO RATED CURRENT. `JUNCTION_I_RATED` is 20 mA because that is what an LED
 *    datasheet specifies Vf at. A BJT's `vbe` is not "Vbe at 20 mA of BASE
 *    current" — that is a large-signal condition for a small-signal part.
 *    Subtracting `0.020 * rd` there would be true about something other than
 *    what it is about.
 *
 * 3. THE CORPUS GIVES NO TELL. The led argument rests on the values being
 *    datasheet-shaped: 1,766 circuits say `vf: 2` and nobody wrote 0.6 for a
 *    silicon part. But `vbe: 0.7` (x8) and `vz: 5.1` (x8) are just the defaults,
 *    and 0.7 IS the knee number for a silicon junction. There is nothing to read.
 *
 * The day someone gives a BJT or zener a rated current, this file fails and the
 * decision gets made on purpose.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {kneeFromVf, JUNCTION_RD, JUNCTION_I_RATED} from '../src/mna.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('the conversion is what it claims: datasheet drop minus the rating times rd', () => {
    assert.equal(kneeFromVf(2.0, 10, 0.020), 1.8);
    assert.equal(kneeFromVf(2.0), 2.0 - JUNCTION_I_RATED * JUNCTION_RD);
    // The rating is a PARAMETER, because a part can carry its own (the bargraph
    // has iFull). A knee derived from the wrong rating is the same error one
    // level down, so this must not silently fall back to the LED's.
    assert.equal(kneeFromVf(2.0, 10, 0.005), 1.95);
});

/**
 * The scan below must read CODE, and a source file is code plus prose.
 *
 * Twice now this gate has answered about the wrong text. It fired on `stampNPN`
 * the day a COMMENT inside it recorded a measurement naming `model: 'shockley'`
 * — a note explaining why the exponential base-emitter junction was TRIED and
 * REVERTED, i.e. prose whose whole content is that the code does not do this.
 * An evidence keyword is not evidence, in either direction.
 *
 * `mna.js` holds no regex literals today, so tracking the three string quotes is
 * enough. If one is ever added, `/` after `=` or `(` starts a regex and this
 * stripper will mis-read it; the self-check below fires on the shapes it does
 * handle, so add a case there rather than trusting it silently.
 */
const stripComments = src => {
    let out = '', i = 0, quote = null;
    while (i < src.length) {
        const c = src[i], d = src[i + 1];
        if (quote) {
            if (c === '\\') { out += '  '; i += 2; continue; }
            if (c === quote) quote = null;
            out += c; i++; continue;
        }
        if (c === '\'' || c === '"' || c === '`') { quote = c; out += c; i++; continue; }
        if (c === '/' && d === '/') {
            while (i < src.length && src[i] !== '\n') { out += ' '; i++; }
            continue;
        }
        if (c === '/' && d === '*') {
            const end = src.indexOf('*/', i + 2);
            const stop = end < 0 ? src.length : end + 2;
            // Keep newlines so an offset still lands on its own line.
            for (; i < stop; i++) out += src[i] === '\n' ? '\n' : ' ';
            continue;
        }
        out += c; i++;
    }
    return out;
};

test('the comment stripper removes prose and keeps code', () => {
    // Driven at an example AND a counter-example, because a stripper that
    // removed everything would make the gate below pass forever.
    assert.match(stripComments('a(); // shockley\nb();'), /a\(\);\s*\nb\(\);/);
    assert.doesNotMatch(stripComments('a(); // shockley\n'), /shockley/);
    assert.doesNotMatch(stripComments('/* junctionOpts */ a();'), /junctionOpts/);
    assert.match(stripComments('/* x */ shockley();'), /shockley\(\)/);
    assert.match(stripComments(`const s = '// not a comment';`), /not a comment/);
    assert.match(stripComments('const s = "a/*b*/c";'), /a\/\*b\*\/c/);
});

test('zener and BJT stamps do NOT convert their vf, and cannot reach the exponential path', () => {
    const mna = stripComments(read('src/mna.js'));
    const fnBody = name => {
        const i = mna.indexOf(`function ${name}(`);
        assert.ok(i > 0, `${name} not found — re-point this pin, do not delete it`);
        // To the NEXT top-level function, not a fixed window. `stampNPN` is 3,620
        // characters long and the window was 4,000, so the gate was already
        // reading 380 characters of its neighbour and would have named the wrong
        // function in the failure message.
        const j = mna.indexOf('\nfunction ', i + 1);
        return mna.slice(i, j < 0 ? mna.length : j);
    };
    for (const name of ['stampZener', 'stampNPN', 'stampPNP']) {
        const body = fnBody(name);
        assert.ok(!body.includes('kneeFromVf'),
            `${name} calls kneeFromVf. It has no rated current and no exponential counterpart, so `
            + 'the conversion would change its behaviour with nothing to check it against. If a '
            + 'rated current has been given to this class, say so here and make the decision.');
        assert.ok(!/junctionOpts|shockley/.test(body),
            `${name} now reaches the exponential path. Reason 1 for excluding it has expired: it `
            + 'now HAS a second answer to agree with, so revisit the exclusion.');
    }
});

test('led and diode DO convert, at every reader', () => {
    // Source-scanned rather than driven, because a reader that silently stopped
    // converting would still produce plausible numbers — the failure this whole
    // correction is about. Each of these is a reader the census named.
    const sites = [
        ['src/mna.js', 'kneeFromVf', 2],        // stamp + branch-current reader
        ['src/board.js', 'kneeFromVf', 1],      // the closed-form walker
        ['src/ac.js', 'kneeFromVf', 1],         // small-signal, led/diode branch
        ['src/devices/display.js', 'kneeFromVf', 2]  // bargraph stamp + update
    ];
    for (const [file, needle, atLeast] of sites) {
        // Comments stripped here too: a `>=` count is satisfied by a comment
        // NAMING the function, so the reader that stopped converting could be
        // covered by the note explaining that it converts.
        const n = stripComments(read(file)).split(needle).length - 1;
        assert.ok(n >= atLeast,
            `${file} references ${needle} ${n} time(s), expected at least ${atLeast}. A reader has `
            + 'stopped converting, which splits it from the others — and nodeVoltage and '
            + 'branchCurrent disagreeing about one LED is exactly what this change removed.');
    }
});
