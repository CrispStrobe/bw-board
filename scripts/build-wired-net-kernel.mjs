/** Owned freestanding prototype build; explicitly supplied output directory. */
import {execFileSync} from 'node:child_process';
import {existsSync,readFileSync,realpathSync,statSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
if(process.argv.length!==3)throw new Error('usage: node scripts/build-wired-net-kernel.mjs EXISTING_BUILD_DIRECTORY');
const directory=realpathSync(process.argv[2]);if(!statSync(directory).isDirectory())throw new TypeError('build directory required');
const output=join(directory,'wired-net-kernel.wasm'),manifest=join(directory,'wired-net-kernel-build.json');
if(existsSync(output)||existsSync(manifest))throw new Error('refusing to overwrite existing build');
const clang=process.env.CLANG??'clang';
const sourceNames=['src/experimental/wired-kernel/net-resolver.c','src/experimental/wired-kernel/memory-banks.c','src/experimental/wired-kernel/memory-circuit.c','src/experimental/wired-kernel/phase-components.c','src/experimental/wired-kernel/phase-circuit.c','src/experimental/wired-kernel/phase-schedule.c','src/experimental/wired-kernel/incremental-nets.c','src/experimental/wired-kernel/bus-sequencer.c'];
const sources=sourceNames.map(p=>fileURLToPath(new URL('../'+p,import.meta.url)));
const args=['--target=wasm32','-O3','-nostdlib','-fno-builtin','-Werror','-Wall','-Wextra',
    ...(process.env.WASM_LD?[`-fuse-ld=${process.env.WASM_LD}`]:[]),
    '-Wl,--no-entry','-Wl,--export=arena_ptr','-Wl,--export=arena_capacity','-Wl,--export=resolve_nets','-Wl,--export=settle_owned','-Wl,--export=owned_kernel_version',
    '-Wl,--export=memory_kernel_version','-Wl,--export=preview_memory_banks','-Wl,--export=memory_circuit_version','-Wl,--export=settle_memory_circuit',
    ...['phase_components_version','read_memory_phase_commands','begin_memory_phase','preview_memory_phase_end','finish_memory_phase','update_address_latch'].map(n=>`-Wl,--export=${n}`),
    ...['phase_circuit_version','begin_latched_memory_clock','end_latched_memory_clock',
        'preview_latched_memory_clock','finish_latched_memory_clock','abort_latched_memory_clock'].map(n=>`-Wl,--export=${n}`),
    ...['phase_schedule_version','run_latched_memory_schedule'].map(n=>`-Wl,--export=${n}`),
    ...['admit_owned_context','settle_owned_context'].map(n=>`-Wl,--export=${n}`),
    '-Wl,--export=incremental_kernel_version',
    ...['bus_sequencer_version','bus_input_ptr','bus_output_ptr','bus_completion_ptr','bus_error_pin','bus_initialize','bus_submit','bus_begin','bus_end','bus_inspect'].map(n=>`-Wl,--export=${n}`),
    '-Wl,--export=incremental_work_counters_version','-Wl,--export=incremental_work_counters_ptr','-Wl,--export=reset_incremental_work_counters',
    '-Wl,--export=write_owned_driver',
    '-Wl,--export-memory',...sources,'-o',output];
const version=execFileSync(clang,['--version'],{encoding:'utf8'}).trim();
execFileSync(clang,args,{stdio:'inherit'});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const report={prototype:'wired-owned-memory-circuit',compiler:version,args,
    sourceSHA256:hash(readFileSync(sources[0])),sourceHashes:Object.fromEntries(sourceNames.map((p,i)=>[p,hash(readFileSync(sources[i]))])),wasmSHA256:hash(readFileSync(output)),
    notes:['Owned C, no runtime imports/WASI, no guest media.','No board backend or real-time throughput claim.']};
writeFileSync(manifest,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({output,manifest,...report},null,2));
