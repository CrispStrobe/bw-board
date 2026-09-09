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
const clang=process.env.CLANG??'clang',source=fileURLToPath(new URL('../src/experimental/wired-kernel/net-resolver.c',import.meta.url));
const args=['--target=wasm32','-O3','-nostdlib','-fno-builtin','-Werror','-Wall','-Wextra',
    ...(process.env.WASM_LD?[`-fuse-ld=${process.env.WASM_LD}`]:[]),
    '-Wl,--no-entry','-Wl,--export=arena_ptr','-Wl,--export=arena_capacity','-Wl,--export=resolve_nets','-Wl,--export-memory',source,'-o',output];
const version=execFileSync(clang,['--version'],{encoding:'utf8'}).trim();
execFileSync(clang,args,{stdio:'inherit'});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const report={prototype:'wired-net-resolution-only',compiler:version,args,
    sourceSHA256:hash(readFileSync(source)),wasmSHA256:hash(readFileSync(output)),
    notes:['Owned C, no runtime imports/WASI, no guest media.','No board backend or real-time throughput claim.']};
writeFileSync(manifest,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({output,manifest,...report},null,2));
