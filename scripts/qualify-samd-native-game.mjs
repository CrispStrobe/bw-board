#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Hosted actual source-built game on the exact production WASM/config package.
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync, mkdirSync, lstatSync, readdirSync} from 'node:fs';
import {resolve, join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
const sha = raw => createHash('sha256').update(raw).digest('hex');
const need = (ok, why) => { if (!ok) throw new Error(why); };
const exact = (object, names) => need(JSON.stringify(Object.keys(object).sort()) === JSON.stringify([...names].sort()), 'closed field union');
export function admitProfile (raw, info) {
    const name = 'samd-no-asf-profile.json';
    const row = info.configAssets?.[name];
    need(row && row.sha256 === sha(raw) && row.bytes === raw.length, 'exact built profile asset');
    const profile = JSON.parse(raw);
    need(profile.schema === 1 && profile.source === info.ref && /^[0-9a-f]{40}$/.test(profile.source), 'same immutable engine/profile source');
    need(profile.profile === 'samd51-no-asf-simulation' && profile.kind === 'authored-software-profile' && profile.physical_capture === false, 'declared software boundary');
    const sources = {
        chip_yaml: 'configs/chips/samd51-no-asf-simulation.yaml',
        system_yaml: 'configs/systems/samd51-no-asf-simulation.yaml',
        display_yaml: 'configs/devices/st7735r-memory-simulation.yaml'
    };
    exact(profile.source_bindings, Object.values(sources));
    for (const [field, path] of Object.entries(sources)) {
        const bytes = Buffer.from(profile[field]);
        const binding = profile.source_bindings[path];
        need(bytes.length > 0 && bytes.length < 128_000 && bytes.length === binding.bytes && sha(bytes) === binding.sha256, 'source/config byte binding');
    }
    exact(profile.inputs, ['LABWIRED_SAMD51_SIM_SW0', 'LABWIRED_SAMD51_SIM_SERIAL']);
    for (const input of Object.values(profile.inputs)) {
        need(input.encoding === 'hex' && /^[0-9a-f]{2048}$/.test(input.data), 'bounded authored input');
        const bytes = Buffer.from(input.data, 'hex');
        need(bytes.length === 1024 && bytes.length === input.bytes && sha(bytes) === input.sha256, 'exact authored input identity');
    }
    return profile;
}
function walk (root, prefix = '') {
    const files = [];
    for (const name of readdirSync(join(root, prefix))) {
        const rel = prefix ? `${prefix}/${name}` : name;
        const st = lstatSync(join(root, rel));
        need(!st.isSymbolicLink(), 'fixture symlinks refused');
        if (st.isDirectory()) files.push(...walk(root, rel));
        else { need(st.isFile() && st.size < 16_000_000, 'bounded regular fixture'); files.push(rel); }
    }
    return files;
}
export function admitProductionNodeEngine (engineDir, info) {
    exact(info.targets.nodejs, ['labwired_wasm.js', 'labwired_wasm_bg.wasm', 'package.json']);
    for (const [name, binding] of Object.entries(info.targets.nodejs)) {
        const raw = readFileSync(join(engineDir, 'nodejs', name));
        need(raw.length === binding.bytes && sha(raw) === binding.sha256, 'exact production Node engine output');
    }
    need(readFileSync(join(engineDir, 'nodejs/package.json'), 'utf8') === '{"type":"commonjs"}\n', 'exact production loader marker');
}
export function qualify ({engineDir, fixtureDir, outDir}) {
    const info = JSON.parse(readFileSync(join(engineDir, 'BUILD-INFO.json')));
    const profile = admitProfile(readFileSync(join(engineDir, 'samd-no-asf-profile.json')), info);
    admitProductionNodeEngine(engineDir, info);
    const manifest = JSON.parse(readFileSync(join(fixtureDir, 'MANIFEST.json')));
    need(manifest.schema === 2 && manifest.kind === 'source-built-samd-game' && manifest.physical_capture === false && manifest.bootloader_code === false && manifest.actual_guest_qualified === false, 'fresh authored source build, before actual qualification');
    need(manifest.builder.source === info.ref, 'same source recipe and production engine');
    need(manifest.sources.samd.repository === 'CrispStrobe/codal-samd' && manifest.sources.samd.source === '5d3f7e4a704006ef2acbe0be3dd0e59f9be1ef0a', 'qualified public runtime source');
    const reference = manifest.qualified_reference;
    need(reference.repository === 'CrispStrobe/codal-samd' && reference.source === '8e4781e3a455d616f48780bd70fc7b587e917a3c' && reference.workflow_run === 40334385377 && reference.artifact_id === 12660811276 && reference.artifact_sha256 === '3fab3e5b45476c75893bfe9b3ff6f508ec9d56dbe3a374000ac6f0e45ce786ea', 'original reference retained separately from fresh compiler outputs');
    need(manifest.files['wasm.mjs']?.sha256 === 'df863d7a452da703cbcd3d0bfa48ba540cdd1599e4e4daf848eae2e326598d12' && manifest.files['game.ts']?.sha256 === '54239e1d794c13f6ae674037f3e1f218082fb203c611d5ec103a9a3f9742dfdb', 'exact qualified guest/observer source; fresh binary has its own identity');
    const members = walk(fixtureDir).filter(n => n !== 'MANIFEST.json');
    exact(manifest.files, members);
    for (const name of members) {
        const raw = readFileSync(join(fixtureDir, name));
        need(sha(raw) === manifest.files[name].sha256 && raw.length === manifest.files[name].bytes, 'every retained fixture byte');
    }
    for (const name of ['game.bin','game.elf','symbols.json','sw0.bin','serial.bin','game.ts','wasm.mjs','NOTICES.md']) need(members.includes(name), 'closed guest/source/notice packet');
    need(readFileSync(join(fixtureDir, 'game.elf')).subarray(0,7).equals(Buffer.from([127,69,76,70,1,1,1])), 'actual source-built ARM ELF wrapper');
    for (const [file, key] of [['sw0.bin','LABWIRED_SAMD51_SIM_SW0'],['serial.bin','LABWIRED_SAMD51_SIM_SERIAL']]) need(readFileSync(join(fixtureDir,file)).equals(Buffer.from(profile.inputs[key].data,'hex')), 'actual fixture and shipped calibration inputs agree');
    mkdirSync(outDir); // exclusive fresh result union
    for (const name of ['game.bin','game.elf','symbols.json','sw0.bin','serial.bin']) writeFileSync(join(outDir,name),readFileSync(join(fixtureDir,name)),{flag:'wx'});
    for (const [field, path] of Object.entries({chip_yaml:'configs/chips/samd51-no-asf-simulation.yaml',system_yaml:'configs/systems/samd51-no-asf-simulation.yaml'})) {
        const dest = join(outDir, 'engine-profile', path); mkdirSync(dirname(dest), {recursive:true}); writeFileSync(dest,profile[field],{flag:'wx'});
    }
    execFileSync(process.execPath,[join(fixtureDir,'wasm.mjs'),outDir,join(outDir,'engine-profile'),join(engineDir,'nodejs/labwired_wasm.js'),info.ref],{stdio:'inherit',timeout:60*60*1000});
    const samples = JSON.parse(readFileSync(join(outDir,'wasm-results.json')));
    need(samples.length === 3 && samples.every(v => v.engine === info.ref && v.image_sha256 === sha(readFileSync(join(fixtureDir,'game.bin')))), 'three actual production-WASM game samples');
    console.log(`SAMD_PRODUCTION_WASM_GAME_PASS source=${info.ref} samples=3 physical_capture=false`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    need(process.argv.length === 5, 'engine-directory fixture-directory fresh-output-directory required');
    const [engineDir,fixtureDir,outDir] = process.argv.slice(2).map(v => resolve(v));
    qualify({engineDir,fixtureDir,outDir});
}
