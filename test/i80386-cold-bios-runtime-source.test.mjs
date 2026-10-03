import test from 'node:test';
import assert from 'node:assert/strict';
import {deriveColdBiosRuntime,coldNativeProfile} from '../scripts/bochs-cpu3-native-cold-bios/runtime.mjs';
import {deriveColdBiosNapi} from '../scripts/bochs-cpu3-native-cold-bios/napi.mjs';
import {deriveColdBiosRepFragment} from '../scripts/bochs-cpu3-native-cold-bios/runtime-rep.mjs';
import {cHelpers} from '../scripts/bochs-cpu3-native-cold-bios/fetch-policy.mjs';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {replacement,sha256} from '../scripts/bochs-cpu3-native-owned-clock/derive.mjs';
test('cold C exact inverse recovers held four-site REP fragment',()=>{
 const d=deriveColdBiosRuntime();let s=d.bytes.toString();for(const e of [...d.edits].reverse())s=replacement(s,e.next,e.old,e.label);
 assert.equal(sha256(s),sha256(deriveColdBiosRepFragment().bytes));
 for(const e of d.edits){assert.throws(()=>replacement(s,e.old+e.old,e.next,e.label));}
});
test('both CS aliases and actual-length page tape replace stale fetch pointer',()=>{
 const s=deriveColdBiosRuntime().bytes.toString();const a=s.slice(s.indexOf('void bw_slice_note_attempt'),s.indexOf('bool bw_slice_ticks_reached'));
 assert.ok(s.includes('base==0xf0000 || base==0xffff0000'));
 assert.ok(s.includes('length<=65536-eip'));assert.ok(a.includes('k<length'));
 assert.ok(a.includes('bw_pages[j].epoch==bw_mapping_epoch'));assert.ok(a.includes('bw_cold_fetch_page(true,current->raw'));
 assert.ok(!a.includes('pAddrFetchPage'));assert.ok(!a.includes('instruction-page-cross'));
 assert.ok(a.includes('memcmp(instruction,r->bytes,length)'));
});
test('cold profile preserves clock barriers and closes only paused state',()=>{
 const s=deriveColdBiosRuntime().bytes.toString();assert.equal(coldNativeProfile.totalQuanta,400000);
 for(const token of ['BW_OWNED_PRE_PIO','BW_OWNED_POST_PIO,true','cold-BIOS-no-ACK','cold-BIOS-no-fault','cold-BIOS-no-IRQ-delivery','cold-BIOS-unexpected-HLT','bw_direct_paused_thread'])assert.ok(s.includes(token),token);
 assert.ok(!s.includes('160000'));assert.ok(!s.includes('150000'));assert.ok(!s.includes('static const char marker[]'));
 assert.ok(s.includes('(asserted!=0&&asserted!=1)'));assert.ok(s.includes('bw_bios_rep_state()'));
});
test('ABI4 typed reply machinery unchanged outside exact port seam',()=>{
 const d=deriveColdBiosNapi();let s=d.bytes.toString();for(const e of d.edits)s=replacement(s,e.next,e.old,e.label);assert.equal(sha256(s),d.baseSha256);
 assert.ok(d.bytes.toString().includes('(a!=0x71&&a!=0x64&&a!=0x60)'));
});

test('exact C helpers admit aliases/crossing and deny missing stale wrong-kind pages and wrap',()=>{
 const generated=deriveColdBiosRuntime().bytes.toString();assert.ok(generated.includes(cHelpers));
 const dir=mkdtempSync(join(tmpdir(),'cold-fetch-controls-'));
 try{
 const source=join(dir,'control.cc'),binary=join(dir,'control');
 writeFileSync(source,`#include <cstdint>
#include <cassert>
${cHelpers}
int main(){
 assert(bw_cold_fetch_domain(0xf000,false,false,false,0xf0000,4095,2,0xf0fff,false,1));
 assert(bw_cold_fetch_domain(0xf000,false,false,false,0xffff0000,0xfff0,5,0xfffffff0,false,1));
 assert(bw_cold_fetch_domain(0xf000,false,false,false,0xffff0000,4095,2,0xffff0fff,false,1));
 assert(!bw_cold_fetch_domain(0xf000,false,false,false,0xf0000,4095,0,0xf0fff,false,1));
 assert(!bw_cold_fetch_domain(0xf000,false,false,false,0xf0000,4095,16,0xf0fff,false,1));
 assert(bw_cold_fetch_domain(0xf000,false,false,false,0xf0000,0xffff,1,0xfffff,false,1));
 assert(!bw_cold_fetch_domain(0xf000,false,false,false,0xf0000,0xffff,2,0xfffff,false,1));
 assert(!bw_cold_fetch_domain(0xf000,false,false,false,0xffff0000,0xffff,2,0xffffffff,false,1));
 assert(!bw_cold_fetch_domain(0xf000,false,false,false,0x100000000ULL,0,1,0x100000000ULL,false,1));
 assert(!bw_cold_fetch_domain(0xf000,false,false,true,0xf0000,4095,2,0xf0fff,false,1));
 assert(!bw_cold_fetch_domain(0xf000,false,false,false,0xf0000,4095,2,0xf0fff,true,1));
 assert(!bw_cold_fetch_domain(0xf000,false,false,false,0xf0000,4095,2,0xf0fff,false,0));
 assert(bw_cold_fetch_page(true,0xf0000,0xf0000,0,0,2,0xf0000,0xf0000,0x66,0x66));
 assert(bw_cold_fetch_page(true,0xf1000,0xf1000,0,0,2,0xf1000,0xf1000,0x90,0x90));
 assert(!bw_cold_fetch_page(false,0xf1000,0xf1000,0,0,2,0xf1000,0xf1000,0x90,0x90));
 assert(!bw_cold_fetch_page(true,0xf1000,0xf1000,1,0,2,0xf1000,0xf1000,0x90,0x90));
 assert(!bw_cold_fetch_page(true,0xf1000,0xf1000,0,0,1,0xf1000,0xf1000,0x90,0x90));
 assert(!bw_cold_fetch_page(true,0xf0000,0xf1000,0,0,2,0xf1000,0xf1000,0x90,0x90));
 assert(!bw_cold_fetch_page(true,0xf1000,0xf1000,0,0,2,0xf0000,0xf1000,0x90,0x90));
 assert(!bw_cold_fetch_page(true,0xf1000,0xf1000,0,0,2,0xf1000,0xf1000,0x91,0x90));
}`);
 const compile=spawnSync('g++',['-std=c++11','-Wall','-Wextra','-Werror',source,'-o',binary],{encoding:'utf8',timeout:10000});assert.equal(compile.status,0,compile.stderr);
 const run=spawnSync(binary,[],{encoding:'utf8',timeout:3000});assert.equal(run.status,0,run.stderr);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('exact cold ROM-data C helper admits unvisited bytes and denies invalid domains',()=>{
 const d=deriveColdBiosRuntime();const edit=d.edits.find(e=>e.label==='cold authenticated ROM data independent of execute cache');assert.ok(edit);assert.ok(d.bytes.toString().includes(edit.next));
 const dir=mkdtempSync(join(tmpdir(),'cold-rom-data-'));try{
 const source=join(dir,'control.cc'),binary=join(dir,'control');
 writeFileSync(source,`#include <cstdint>\n#include <cstring>\n#include <cstdio>\n#include <cassert>\n#include <initializer_list>\nstatic uint8_t bw_direct_rom[65536];\n${edit.next}\nint main(int argc,char**argv){assert(argc==2);FILE*f=fopen(argv[1],"rb");assert(f);assert(fread(bw_direct_rom,1,65536,f)==65536);assert(fgetc(f)==EOF);fclose(f);\nuint8_t data[16];memcpy(data,bw_direct_rom+0x8000,16);assert(bw_rom_observed(0xf8000,data,16));assert(bw_rom_observed(0xff8000,data,16));\ndata[3]^=1;assert(!bw_rom_observed(0xf8000,data,16));data[3]^=1;\nassert(!bw_rom_observed(0xf8000,nullptr,1));assert(!bw_rom_observed(0xf8000,data,0));assert(!bw_rom_observed(0xf8000,data,17));\nfor(uint32_t address:{0xeffffU,0x100000U,0xfeffffU,0x1000000U,0xffff0000U,0xffffffffU})assert(!bw_rom_observed(address,data,1));\nmemcpy(data,bw_direct_rom+65535,1);assert(bw_rom_observed(0xfffff,data,1));assert(bw_rom_observed(0xffffff,data,1));assert(!bw_rom_observed(0xfffff,data,2));assert(!bw_rom_observed(0xffffff,data,2));\nmemcpy(data,bw_direct_rom+4095,1);assert(bw_rom_observed(0xf0fff,data,1));assert(!bw_rom_observed(0xf0fff,data,2));\nuint8_t attemptedWrite=data[0]^1;assert(!bw_rom_observed(0xf0fff,&attemptedWrite,1));assert(bw_rom_observed(0xf0fff,data,1));return 0;}`);

 const compile=spawnSync('g++',['-std=c++11','-Wall','-Wextra','-Werror',source,'-o',binary],{encoding:'utf8',timeout:10000});assert.equal(compile.status,0,compile.stderr);
 const rom=new URL('../roms/free-at-bios/BIOS-bochs-legacy',import.meta.url).pathname;
 const run=spawnSync(binary,[rom],{encoding:'utf8',timeout:3000});assert.equal(run.status,0,run.stderr);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
