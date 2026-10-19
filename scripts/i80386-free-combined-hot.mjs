/** Source-only assembly and hard workload contract; no CPU execution claim. */
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
export const hotWorkload=Object.freeze({registerIterations:20000,memoryIterations:4096,registerChecksum:200010000,registerNext:20001,memoryChecksum:4096,witnessAddresses:[0x580,0x584,0x588],marker:'RPGH001',proposedTotalQuantaCap:150000,proposedTotalNativeTickCap:160000,scope:'source-only separate guest; requires new actual-board qualification and authenticated native profile'});
export function assembleCombinedHotRom(){
 const fixture=fileURLToPath(new URL('../test/fixtures/i80386-free-combined-hot.S',import.meta.url)),dir=mkdtempSync(join(tmpdir(),'bw-combined-hot-rom-'));
 try{
  execFileSync('as',['--32','-o',join(dir,'rom.o'),fixture]);
  execFileSync('ld',['-m','elf_i386','-Ttext','0','-e','setup','-o',join(dir,'rom.elf'),join(dir,'rom.o')]);
  execFileSync('objcopy',['-O','binary','-j','.text',join(dir,'rom.elf'),join(dir,'rom.bin')]);
  const rom=readFileSync(join(dir,'rom.bin')),symbols={};
  for(const line of execFileSync('nm',['--defined-only',join(dir,'rom.elf')],{encoding:'utf8'}).trim().split('\n')){const [value,,name]=line.trim().split(/\s+/);symbols[name]=parseInt(value,16);}
  if(rom.length!==65536||symbols.setup!==0x100)throw Error('hot ROM reset footprint');
  const disassembly=execFileSync('objdump',['-D','-b','binary','-mi386','-M','addr16,data16',join(dir,'rom.bin')],{encoding:'utf8',maxBuffer:8<<20});
  return {rom,symbols,disassembly,sha256:createHash('sha256').update(rom).digest('hex'),sourceSha256:createHash('sha256').update(readFileSync(fixture)).digest('hex')};
 }finally{rmSync(dir,{recursive:true,force:true});}
}
