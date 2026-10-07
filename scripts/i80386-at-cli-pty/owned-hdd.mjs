/** Owned FAT16 boot sector for a bounded real TTY keyboard acceptance.
 * It prints READY, waits for three BIOS INT 16h keys, echoes their ASCII bytes
 * via INT 10h, prints DONE, then idles. No DOS or external guest bytes.
 */
import {createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createI80386AtFat16Image,IBM_TYPE1_GEOMETRY} from '../lib/i80386-at-hdd-image.mjs';

export const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
export const geometry=Object.freeze({...IBM_TYPE1_GEOMETRY});
export const readyText='PTY READY> ';
export const doneText=' PTY DONE';

function codeBytes(){
  const bytes=[],labels=new Map(),fixups=[];
  const emit=(...part)=>{for(const byte of part){if(!Number.isInteger(byte)||byte<0||byte>255)throw new Error('invalid byte');bytes.push(byte);}};
  const mark=name=>{if(labels.has(name))throw new Error('duplicate label');labels.set(name,bytes.length);};
  const address=name=>{emit(0xbe,0,0);fixups.push({name,at:bytes.length-2,kind:'absolute'});};
  const near=name=>{emit(0xe8,0,0);fixups.push({name,at:bytes.length-2,kind:'near'});};
  const short=(opcode,name)=>{emit(opcode,0);fixups.push({name,at:bytes.length-1,kind:'short'});};
  emit(0xfa,0x31,0xc0,0x8e,0xd8,0x8e,0xc0,0x8e,0xd0,0xbc,0x00,0x7c,0xfb,0xfc);
  address('ready');near('print');
  emit(0xb9,0x03,0x00); // Three real keys, after the shell has focus.
  mark('key');emit(0x30,0xe4,0xcd,0x16,0xb4,0x0e,0xbb,0x07,0x00,0xcd,0x10);
  short(0xe2,'key');
  address('done');near('print');
  mark('idle');emit(0xf4);short(0xeb,'idle');
  mark('print');emit(0xac,0x84,0xc0);short(0x74,'return');
  emit(0xb4,0x0e,0xbb,0x07,0x00,0xcd,0x10);short(0xeb,'print');
  mark('return');emit(0xc3);
  mark('ready');emit(...Buffer.from(readyText,'ascii'),0);
  mark('done');emit(...Buffer.from(doneText,'ascii'),0);
  const origin=0x7c00+62;
  for(const fixup of fixups){
    const target=labels.get(fixup.name);
    if(target===undefined)throw new Error('unresolved label');
    const value=fixup.kind==='absolute'?origin+target:
      target-(fixup.at+(fixup.kind==='near'?2:1));
    if(fixup.kind==='short'){
      if(value< -128||value>127)throw new Error('short jump out of range');
      bytes[fixup.at]=value&255;
    }else{
      if(fixup.kind==='absolute'&&(value<0||value>65535))throw new Error('absolute address out of range');
      if(fixup.kind==='near'&&(value< -32768||value>32767))throw new Error('near call out of range');
      bytes[fixup.at]=value&255;bytes[fixup.at+1]=value>>8&255;
    }
  }
  if(bytes.length>448)throw new Error('owned boot program exceeds one sector');
  return Uint8Array.from(bytes);
}

export function makeOwnedHdd(){
  const image=createI80386AtFat16Image();
  const sector=image.subarray(0,512);
  if(sector[510]!==0x55||sector[511]!==0xaa||sector[11]!==0||sector[12]!==2)
    throw new Error('unexpected FAT16 boot-sector base');
  sector.fill(0,62,510);
  const code=codeBytes();sector.set(code,62);
  return {image,geometry,bootCodeBytes:code.length,
    imageSha256:sha256(image),bootSectorSha256:sha256(sector)};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.length!==4)throw new Error('usage: node owned-hdd.mjs OUTPUT_IMG OUTPUT_RECEIPT_JSON');
  const {image,...receipt}=makeOwnedHdd();
  writeFileSync(process.argv[2],image,{flag:'wx'});
  writeFileSync(process.argv[3],JSON.stringify({schema:'bw.i80386-cli-pty-owned-hdd.v1',...receipt},null,2)+'\n',{flag:'wx'});
  process.stdout.write(JSON.stringify(receipt)+'\n');
}
