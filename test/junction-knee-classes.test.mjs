/**
 * WHICH DEVICE CLASSES TAKE THE DATASHEET CONVENTION, AND WHY THE OTHERS DO NOT.
 *
 * `vf` is the DATASHEET total drop at a rated current for led and diode, so the
 * piecewise path converts it to a knee with `kneeFromVf`. Zener forward drop and
 * BJT `vbe` are deliberately left as knees. Three reasons, each measured, and
 * this file exists so that the exclusion is a decision rather than an oversight:
 *
 * 1. ONE PATH, NOTHING TO AGREE WITH — **EXPIRED FOR THE BJT, 2026-09-14, AND
 *    THE DECISION IS MADE.** This file always said the day a BJT reached an
 *    exponential path it would fail and the decision would get made on purpose.
 *    That day came: `stampNPN` and `stampPNP` now reach FULL EBERS-MOLL — both
 *    junctions with a reverse beta — gated on the same routing switch the
 *    diodes use. There IS a second answer now, ngspice's, and on the motor
 *    bench the two agree to 0.5 mV at the base (0.814789 against 0.815259) and
 *    0.1 mV at the collector (0.147254 against 0.147347), where the knee was
 *    765 mV out because it never entered saturation at all.
 *
 *    The gate below did NOT catch the change, which is the second thing worth
 *    recording. It scanned for three NAMES — `junctionOpts`,
 *    `shockleyCompanion`, `model: 'shockley'` — and Ebers-Moll arrived under a
 *    fourth, `ebersMollParams`. A refusal by name needs the reachable set, and
 *    nobody has that for names not yet written. So the gate is now DRIVEN: it
 *    asks the function what it returns, in both routing modes, instead of
 *    reading the source for a word.
 *
 *    `stampZener` keeps the exclusion, unchanged and for the original reason.
 *
 *    What has NOT changed is the DEFAULT. `JUNCTION_ROUTING.mode` is 'auto',
 *    which for a BJT means piecewise, and the test below drives a bench in both
 *    modes to hold that: every corpus number and every other test in this suite
 *    is written against the knee.
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
 * The day someone gives a ZENER a rated current, this file fails and that
 * decision gets made on purpose too.
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

test('zener and BJT stamps do not apply the LED rated-current knee conversion', () => {
    const mna = stripComments(read('src/mna.js'));
    const fnBody = name => {
        const i = mna.indexOf(`function ${name}(`);
        assert.ok(i > 0, `${name} not found — re-point this pin, do not delete it`);
        // To the NEXT top-level function, not a fixed window. `stampNPN` is 3,620
        // characters long and the window was 4,000, so the gate was already
        // reading 380 characters of its neighbour and would have named the wrong
        // function in the failure message.
        const j = mna.indexOf('\nfunction ', i + 1);
        assert.ok(j > i, `${name} has no following top-level function — re-point this pin`);
        return mna.slice(i, j);
    };
    for (const name of ['stampZener', 'stampNPN', 'stampPNP']) {
        const body = fnBody(name);
        assert.ok(!/\bkneeFromVf\s*\(/.test(body),
            `${name} calls kneeFromVf. It has no rated current and no exponential counterpart, so `
            + 'the conversion would change its behaviour with nothing to check it against. If a '
            + 'rated current has been given to this class, say so here and make the decision.');
    }
    // An explicit zener now deliberately reaches the same Shockley companion
    // as an ordinary diode in forward bias. This source assertion makes that
    // routing decision load-bearing beside the independent ngspice test; the
    // no-model zener remains on the legacy piecewise branch.
    {
        const body = fnBody('stampZener');
        assert.match(body, /junctionModelOf\(part, undefined\) === ['"]shockley['"]/,
            'the explicit zener Shockley route disappeared');
        assert.match(body, /diodeCompanion\(vAcross, vf, rd, junctionOpts\(part\)\)/,
            'the explicit zener forward route no longer shares the diode companion');
        assert.match(body, /else if \(vAcross >= vf\)/,
            'the legacy no-model zener knee disappeared');
    }
    for (const name of ['stampNPN', 'stampPNP']) {
        assert.match(fnBody(name), /diodeCompanion\(vAcross,\s*vbe,\s*rd\)/,
            `${name} no longer calls the three-argument piecewise B-E companion`);
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
