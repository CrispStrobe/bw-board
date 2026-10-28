// SPDX-License-Identifier: MIT
// Exact-source software profile asset, separate from a physical board catalogue.
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

export const SAMD_PROFILE_ASSET = 'samd-no-asf-profile.json';
export const SAMD_PROFILE_SOURCES = Object.freeze({
    chip_yaml: 'configs/chips/samd51-no-asf-simulation.yaml',
    system_yaml: 'configs/systems/samd51-no-asf-simulation.yaml',
    display_yaml: 'configs/devices/st7735r-memory-simulation.yaml'
});
const sha = b => createHash('sha256').update(b).digest('hex');
const need = (ok, reason) => { if (!ok) throw new Error(reason); };

export function makeSamdProfile (ref, sources) {
    need(/^[a-f0-9]{40}$/.test(ref), 'full immutable Core source commit required');
    const names = Object.values(SAMD_PROFILE_SOURCES);
    need(Object.keys(sources).every(n => names.includes(n)), 'only declared profile source paths');
    if (Object.keys(sources).length === 0) return null; // historical engines have no profile
    need(names.every(n => sources[n] instanceof Uint8Array), 'complete profile source union required');
    const bindings = {};
    const yaml = {};
    for (const [field, name] of Object.entries(SAMD_PROFILE_SOURCES)) {
        const raw = Buffer.from(sources[name]);
        need(raw.length > 0 && raw.length < 128_000, 'bounded nonempty profile source');
        const text = raw.toString('utf8');
        need(Buffer.from(text, 'utf8').equals(raw), 'profile source must round-trip UTF-8');
        bindings[name] = {bytes: raw.length, sha256: sha(raw)};
        yaml[field] = text;
    }
    const sw0 = Buffer.alloc(1024);
    sw0.fill(255, 0x80, 0x90);
    sw0.writeUInt32LE(0x1b29, 0x84);
    const serial = Buffer.alloc(1024);
    [1, 2, 3].forEach((v, i) => serial.writeUInt32LE(v, 0x10 + 4 * i));
    serial.writeUInt32LE(0x42570001, 0x1fc);
    const input = raw => ({encoding: 'hex', bytes: raw.length, sha256: sha(raw), data: raw.toString('hex')});
    return {
        schema: 1, source: ref, profile: 'samd51-no-asf-simulation',
        kind: 'authored-software-profile', physical_capture: false,
        source_bindings: bindings, ...yaml,
        inputs: {
            LABWIRED_SAMD51_SIM_SW0: input(sw0),
            LABWIRED_SAMD51_SIM_SERIAL: input(serial)
        },
        boundary: 'Controller-memory software assembly. No physical module, glass colour, electrical timing or hardware-accuracy qualification.'
    };
}

export function writeSamdProfile ({sourceDir, outDir, ref}) {
    need(/^[a-f0-9]{40}$/.test(ref), 'full immutable Core source commit required');
    const actual = execFileSync('git', ['-C', sourceDir, 'rev-parse', 'HEAD'], {encoding: 'utf8'}).trim();
    need(actual === ref, 'profile and compiled engine must use the same source');
    execFileSync('git', ['-C', sourceDir, 'diff', '--exit-code', ref, '--', ...Object.values(SAMD_PROFILE_SOURCES)], {stdio: 'pipe'});
    const sources = {};
    for (const name of Object.values(SAMD_PROFILE_SOURCES)) {
        try {
            execFileSync('git', ['-C', sourceDir, 'cat-file', '-e', `${ref}:${name}`], {stdio: 'ignore'});
        } catch { continue; }
        sources[name] = execFileSync('git', ['-C', sourceDir, 'show', `${ref}:${name}`]);
    }
    const profile = makeSamdProfile(ref, sources);
    const destination = join(outDir, SAMD_PROFILE_ASSET);
    need(!existsSync(destination), 'fresh immutable profile output required');
    if (!profile) return {};
    mkdirSync(outDir, {recursive: true});
    const raw = Buffer.from(`${JSON.stringify(profile, null, 2)}\n`);
    writeFileSync(destination, raw, {flag: 'wx'});
    return {[SAMD_PROFILE_ASSET]: {bytes: raw.length, sha256: sha(raw), profile: profile.profile}};
}
