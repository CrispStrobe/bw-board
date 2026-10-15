#!/usr/bin/env node
/** Stage only fixed authored/pinned inputs; the separate Python owner runs CLI sessions. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {buildFat16} from '../lib/i80386-free-bios-fat16.mjs';
import {expandI80386SourceInventory} from '../lib/i80386-source-inventory.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const need=(x,s)=>{if(!x)throw new Error(s);};
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const pins={bios:[65536,'6481181809b58a9f805346a7ecf9bebdaf5b322c32825fb49ee89da51552c4ac'],vga:[38400,'76af53f14955df3edd6365daa64393e91fafe55241c2c00384ff05b740431da1'],floppy:[1228800,'03df6088be016e57a6c44275f5bb9ab0244db71de1360957fd76ba83243b6a77']};
const args=process.argv.slice(2);need(args.length===3,'usage: probe.mjs SESSION STAGED_FLOPPY EXPECTED_HEAD');
const [sessionName,floppyName,expectedHead]=args;
need(process.version==='v22.23.3','Node22.23.3 policy');
need(/^[0-9a-f]{40}$/.test(expectedHead),'expected source head');
const git=(...a)=>execFileSync('/usr/bin/git',['-C',root,...a],{encoding:'utf8',maxBuffer:2*1024*1024,timeout:10000}).trim();
need(git('rev-parse','HEAD')===expectedHead&&!git('status','--porcelain'),'exact clean source');
const consolePath='scripts/run-i80386-at-console.mjs';
const consoleSource=fs.readFileSync(path.join(root,consolePath),'utf8');
need(sha(Buffer.from(consoleSource))==='2258a62e920ac5c74ced1991e5709b53507c241afd29c27751137309bc300d70','reviewed floppy console bytes');
const match=consoleSource.match(/const sourcePaths=\[([\s\S]*?)\];/);need(match,'console source seeds');
const seeds=[...match[1].matchAll(/'([^']+)'/g)].map(m=>m[1]);
need(match[1].replace(/'[^']+'/g,'').replace(/[\s,]/g,'')==='','literal source seed grammar');
const consoleKeys=expandI80386SourceInventory(seeds,new URL('../run-i80386-at-console.mjs',import.meta.url));
need(consoleKeys.length===79&&new Set(consoleKeys).size===79,'closed79 console roles');
const common=['scripts/i80386-hdd-export/probe.mjs','scripts/i80386-hdd-export/probe.py','scripts/i80386-hdd-export/reader.py','scripts/i80386-hdd-export/controls.py','scripts/i80386-hdd-export/README.md','.github/workflows/i80386-hdd-export.yml','scripts/lib/i80386-free-bios-fat16.mjs','scripts/lib/i80386-source-inventory.mjs','package.json'];
const mapping=Object.fromEntries(consoleKeys.map(k=>[k,path.posix.normalize('scripts/'+k)]));
const names=[...new Set([...Object.values(mapping),...common])].sort();
const rows=names.map(name=>{
 need(!name.startsWith('../')&&!path.isAbsolute(name),'canonical source role');const file=path.join(root,name),s=fs.lstatSync(file);need(s.isFile()&&!s.isSymbolicLink()&&s.size<=2*1024*1024,'source regular cap');
 const bytes=fs.readFileSync(file),blob=git('rev-parse',`HEAD:${name}`),original=execFileSync('/usr/bin/git',['-C',root,'show',`HEAD:${name}`],{maxBuffer:2*1024*1024,timeout:10000});
 need(bytes.equals(original),'source Git/live bytes');return {path:name,gitBlob:blob,byteLength:bytes.length,sha256:sha(bytes)};
});
const session=path.resolve(sessionName);fs.mkdirSync(session,{mode:0o700});
for(const dir of ['inputs','outputs','originals','runtime','runtime/bin'])fs.mkdirSync(path.join(session,dir),{mode:0o700});
fs.symlinkSync(root,path.join(session,'source'),'dir');fs.symlinkSync(fs.realpathSync(process.execPath),path.join(session,'runtime/bin/node'));
for(const [role,input,output]of [['bios',path.join(root,'roms/free-at-bios/BIOS-bochs-legacy'),'bios.bin'],['vga',path.join(root,'roms/free-at-bios/vgabios-lgpl.bin'),'vga.bin'],['floppy',path.resolve(floppyName),'floppy.img']]){
 const stat=fs.statSync(input);need(stat.isFile()&&stat.size===pins[role][0],'pinned input extent');const bytes=fs.readFileSync(input);need(bytes.length===pins[role][0]&&sha(bytes)===pins[role][1],'pinned input hash');fs.writeFileSync(path.join(session,'inputs',output),bytes,{flag:'wx',mode:0o600});
}
const {image}=buildFat16({geometry:{cylinders:306,heads:4,sectors:17},volLabel:'FREEBIOSHD',files:[{name:'CMOUNTOKTXT',bytes:Buffer.from('FREE-BIOS 386 C: MOUNT OK\r\n')}]});
need(image.length===10653696&&sha(image)==='2fa9c252f22cec4f8c5bdc82d1587293ffcaed791e0982384628d19a7316a851','authored initial image pin');
fs.writeFileSync(path.join(session,'inputs/initial.img'),image,{flag:'wx',mode:0o600});fs.writeFileSync(path.join(session,'originals/initial.img'),image,{flag:'wx',mode:0o600});
const write=(n,v)=>fs.writeFileSync(path.join(session,'originals',n),JSON.stringify(v,null,2)+'\n',{flag:'wx',mode:0o600});
write('source-before.json',{schema:'bw.hdd-cli-source.v1',head:expectedHead,tree:git('rev-parse','HEAD^{tree}'),rows});
// Mapping is part of the root input policy, not a replacement for raw report keys.
fs.writeFileSync(path.join(session,'source-map.json'),JSON.stringify({consoleMap:mapping,commonPaths:common.filter(p=>!Object.values(mapping).includes(p)),rows},null,2)+'\n',{flag:'wx',mode:0o600});
process.stdout.write('Fixed pinned input/source staging complete; no CLI guest started.\n');
