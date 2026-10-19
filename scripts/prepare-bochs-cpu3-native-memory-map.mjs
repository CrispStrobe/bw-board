/** Prepare a separate pinned Bochs tree. This does not build or run guests. */
import {execFileSync} from 'node:child_process';
import {copyFileSync,existsSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {patchPinnedSource,revision,sha256,upstreamHashes} from './bochs-cpu3-native-memory-map/patch.mjs';

const repo=resolve(fileURLToPath(new URL('..',import.meta.url)));
const source=process.env.BOCHS_386_ROOT && resolve(process.env.BOCHS_386_ROOT);
const [mode,destination,...extra]=process.argv.slice(2);
if(!source || extra.length || !['--check','--prepare'].includes(mode) ||
  (mode==='--check' && destination) || (mode==='--prepare' && !destination))
  throw new Error('BOCHS_386_ROOT=/clean/pinned/Bochs node scripts/prepare-bochs-cpu3-native-memory-map.mjs --check | --prepare /new/tree');
const git=(cwd,args)=>execFileSync('git',args,{cwd,encoding:'utf8'}).trim();
if(git(source,['rev-parse','HEAD'])!==revision ||
   git(source,['status','--porcelain','--untracked-files=no']))
  throw new Error('input Bochs source is not the clean pinned revision');
const changed=Object.fromEntries(Object.keys(upstreamHashes).map(path=>
  [path,patchPinnedSource(path,readFileSync(resolve(source,path)))]));
const romPath='roms/free-at-bios/BIOS-bochs-legacy';
const rom=readFileSync(resolve(repo,romPath));
const romSha=sha256(rom);
if(rom.length!==65536 ||
   romSha!=='6481181809b58a9f805346a7ecf9bebdaf5b322c32825fb49ee89da51552c4ac')
  throw new Error('owned free BIOS ROM identity changed');
const romLines=[];
for(let at=0;at<rom.length;at+=16)
  romLines.push('  '+[...rom.subarray(at,at+16)].map(byte=>
    `0x${byte.toString(16).padStart(2,'0')}`).join(',')+',');
const romInclude=Buffer.from(`// Generated from source-pinned ${romPath}.\n`
  +`static const unsigned char bw_owned_rom[65536] = {\n${romLines.join('\n')}\n};\n`
  +`static const char *const bw_owned_rom_sha256 = "${romSha}";\n`);
const owned=['scripts/bochs-cpu3-native-memory-map/abi.h',
  'scripts/bochs-cpu3-native-memory-map/runtime.h',
  'scripts/bochs-cpu3-native-memory-map/runtime.inc',
  'scripts/bochs-cpu3-native-memory-map/patch.mjs',
  'scripts/prepare-bochs-cpu3-native-memory-map.mjs',
  'scripts/bochs-cpu3-native-events/patch.mjs',
  'scripts/bochs-cpu3-native-slice/patch.mjs',
  romPath,
  'test/fixtures/i80386-bochs-cpu3-native-memory-map.S'];
for(const path of owned){
  execFileSync('git',['ls-files','--error-unmatch','--',path],{cwd:repo,stdio:'ignore'});
  const committed=execFileSync('git',['show',`HEAD:${path}`],{cwd:repo});
  if(sha256(committed)!==sha256(readFileSync(resolve(repo,path))))
    throw new Error(`owned source differs from HEAD: ${path}`);
}
const result={bochsRevision:revision,boardRevision:git(repo,['rev-parse','HEAD']),
  romSha256:romSha,romIncludeSha256:sha256(romInclude),
  sourceHashes:Object.fromEntries(owned.map(path=>[path,sha256(readFileSync(resolve(repo,path)))])),
  upstreamHashes,
  patchedHashes:Object.fromEntries(Object.entries(changed).map(([path,bytes])=>[path,sha256(bytes)]))};
if(mode==='--prepare'){
  const target=resolve(destination);
  if(existsSync(target))throw new Error(`destination exists: ${target}`);
  execFileSync('git',['clone','--local','--no-hardlinks','--quiet',source,target]);
  if(git(target,['rev-parse','HEAD'])!==revision)throw new Error('clone changed revision');
  for(const [path,bytes] of Object.entries(changed))writeFileSync(resolve(target,path),bytes);
  for(const [path,dst] of [
    [owned[0],'bochs/cpu/bw_slice_abi.h'],
    [owned[1],'bochs/cpu/bw_slice_runtime.h'],
    [owned[2],'bochs/cpu/bw_slice_runtime.inc']])
    copyFileSync(resolve(repo,path),resolve(target,dst));
  writeFileSync(resolve(target,'bochs/cpu/bw_owned_rom.inc'),romInclude);
  result.preparedTree=target;
  result.configure=['./configure','--enable-cpu-level=3','--with-nogui',
    '--disable-plugins','--disable-debugger','--disable-repeat-speedups',
    '--disable-handlers-chaining','--enable-instrumentation=instrument/stubs'];
  result.build=['nice','make','-j1'];
  result.requiredConfig={'BX_CPU_LEVEL':3,'BX_USE_IDLE_HACK':0,
    'BX_SUPPORT_HANDLERS_CHAINING_SPEEDUPS':0};
}
console.log(JSON.stringify(result,null,2));
