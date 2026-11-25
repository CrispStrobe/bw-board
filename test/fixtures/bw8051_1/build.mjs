#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Rebuild the selected firmware without downloading sources or tools.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, cpSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const option = (name, fallback) => {
    const i = args.indexOf(name);
    if (i < 0) return fallback;
    if (!args[i + 1] || args[i + 1].startsWith('--')) throw Error(`${name} needs a value`);
    return args[i + 1];
};
const output = path.resolve(option('--output', path.join(root, 'images')));
const only = option('--only', null);
const sdcc = process.env.SDCC || 'sdcc';
const digest = data => createHash('sha256').update(data).digest('hex');

function run(argv, cwd) {
    const result = spawnSync(sdcc, argv, {cwd, encoding: 'utf8'});
    if (result.error) throw result.error;
    if (result.status !== 0) throw Error(`sdcc ${argv.join(' ')} failed (${result.status})\n${result.stdout}\n${result.stderr}`);
    if (result.stderr) process.stderr.write(result.stderr);
    return result.stdout;
}

const version = run(['--version'], root).trim();
if (!/SDCC.*\b4\.5\.0\b/.test(version)) {
    throw Error(`This corpus is pinned to SDCC 4.5.0; received ${version.split('\n')[0]}`);
}

const upstream = JSON.parse(readFileSync(path.join(root, 'sources.json'), 'utf8'));
for (const entry of upstream.files) {
    assert.equal(digest(readFileSync(path.join(root, entry.path))), entry.sha256,
        `vendored source changed: ${entry.path}`);
}

const hal = path.join(root, 'vendor/stc15lib/include');
const hourglass = path.join(root, 'vendor/hourglass');
const clock = path.join(root, 'vendor/clock');
const shared = ['-mmcs51', '--model-small', '--std-sdcc11', '--iram-size', '256', '--xram-size', '0'];
const programs = [
    {id: 'hal-gpio-adc', sources: [path.join(root, 'hal-gpio-adc.c')], flags: [...shared, '--code-size', '4096', '-I' + hal]},
    {id: 'hal-timer-1t', sources: [path.join(root, 'hal-timer.c')], flags: [...shared, '--code-size', '4096', '-I' + hal]},
    {id: 'hal-timer-12t', sources: [path.join(root, 'hal-timer.c')], flags: [...shared, '--code-size', '4096', '-I' + hal, '-DTIMER_12T']},
    {id: 'hourglass-stage2', sources: [path.join(hourglass, 'src/stages/stage2/led_timer.c'), path.join(hourglass, 'lib/leds1/leds1.c')],
        flags: [...shared, '--code-size', '1024', '--opt-code-size', '-I' + hal, '-I' + path.join(hourglass, 'lib/leds1')]},
    // Matches upstream `make MOD4=1 NMEA=0`: NMEA is deliberately undefined.
    {id: 'clock-mod4', sources: ['main', 'adc', 'ds1302', 'eeprom'].map(n => path.join(clock, `src/${n}.c`)),
        flags: ['--code-size', '4089', '--xram-size', '0', '--data-loc', '0x30', '--disable-warning', '126', '--disable-warning', '59', '--disable-warning', '283', '-DWITHOUT_LEDTABLE_RELOC', '-DMOD4', '-I' + path.join(clock, 'src')],
        patch: 'patches/clock-mod4.patch'},
];
if (only && !programs.some(p => p.id === only)) throw Error(`Unknown program: ${only}`);

mkdirSync(output, {recursive: true});
const manifest = {schema: 1, compiler: {version, requiredVersion: '4.5.0'}, programs: []};
for (const program of programs.filter(p => !only || p.id === only)) {
    const work = mkdtempSync(path.join(output, '.build-'));
    try {
        let sources = program.sources;
        if (program.patch) {
            const patched = path.join(work, 'clock-src');
            cpSync(path.join(clock, 'src'), patched, {recursive: true});
            sources = program.sources.map(source => path.join(patched, path.basename(source)));
            const result = spawnSync('patch', ['--batch', '--forward', '--fuzz=0', '-p1', '-d', patched, '-i', path.join(root, program.patch)], {encoding: 'utf8'});
            if (result.error || result.status !== 0) throw Error(`Clock compatibility patch failed: ${result.error || result.stdout + result.stderr}`);
        }
        const objects = sources.slice(1).map((source, i) => {
            const dest = path.join(work, `object-${i}.rel`);
            run([...program.flags, '-c', source, '-o', dest], work);
            return dest;
        });
        const image = path.join(work, program.id + '.ihx');
        run([...program.flags, sources[0], ...objects, '-o', image], work);
        const bytes = readFileSync(image);
        writeFileSync(path.join(output, program.id + '.hex'), bytes);
        const map = readFileSync(path.join(work, program.id + '.map'), 'utf8');
        const symbols = {};
        for (const match of map.matchAll(/^\s*([0-9a-fA-F]{8})\s+(_\w+)\s+/gm)) {
            symbols[match[2]] = parseInt(match[1], 16);
        }
        const sourceFiles = program.sources.map(source => ({
            path: path.relative(root, source).split(path.sep).join('/'), sha256: digest(readFileSync(source)),
        }));
        const flags = program.flags.map(f => f.replaceAll(root, '$FIXTURE'));
        const entry = {id: program.id, image: program.id + '.hex', sha256: digest(bytes),
            sources: sourceFiles, flags, symbols};
        if (program.patch) entry.patches = [{path: program.patch, sha256: digest(readFileSync(path.join(root, program.patch)))}];
        manifest.programs.push(entry);
        console.log(`${program.id}: ${entry.sha256}`);
    } finally {
        if (args.includes('--keep-work')) console.log(`Retained compiler work: ${work}`);
        else rmSync(work, {recursive: true, force: true});
    }
}
writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
