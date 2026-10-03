import {readFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const repo='/mnt/volume1/code/lego/wt-labwired-wasm-literal-barrier-20261002';
const target='/mnt/volume1/code/lego/.fastpath-census-evidence.kYeuzx/window-profile-20261003/core-inspection.json';
const core='43b2d62f5a0fa24ae0b38a645069f5aaa78af685';
const show=path=>execFileSync('git',['show',core+':'+path],{cwd:repo,encoding:'utf8'});
const hash=b=>createHash('sha256').update(b).digest('hex');
const channelsPath='crates/core/src/peripherals/components/declarative_logic.rs',traitPath='crates/core/src/sim_input.rs',coldPath='crates/core/src/bus/device_hooks.rs';
const channels=show(channelsPath),trait=show(traitPath),cold=show(coldPath);
const implementation='    fn input_channels(&self) -> &[InputChannel] {\n        NO_CHANNELS\n    }';
assert(channels.includes(implementation));assert(trait.includes('fn input_channels(&self) -> &[InputChannel];'));
const start=cold.indexOf('    fn service_edge_driven_gpio_devices_cold'),end=cold.indexOf('    /// Set or clear',start);
const body=cold.slice(start,end);assert(body.includes('.edge_service_addrs()'));assert(!body.includes('input_channels'));
const value={core,files:[channelsPath,traitPath,coldPath].map(path=>({path,sha256:hash(show(path))})),implementation,traitSignature:'fn input_channels(&self) -> &[InputChannel];',coldBody:body,
    conclusions:['input_channels returns an empty borrowed slice; no metadata allocation or scan in that implementation',
        'the cold source queries edge_service_addrs, not SimInput channel discovery',
        'sampled labels/caller paths can reflect shared trivial bodies; do not infer metadata-work cost from this label alone'],engineModified:false};
const text=JSON.stringify(value,null,2)+'\n';
if(existsSync(target))assert.equal(readFileSync(target,'utf8'),text);
else execFileSync('apply_patch',[],{input:`*** Begin Patch\n*** Add File: ${target}\n${text.trimEnd().split('\n').map(l=>'+'+l).join('\n')}\n*** End Patch\n`});
console.log('Bound exact production source inspection: borrowed empty slice and actual cold GPIO edge-service calls.');
