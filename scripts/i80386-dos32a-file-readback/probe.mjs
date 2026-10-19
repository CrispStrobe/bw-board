import fs from 'node:fs';
import {createHash} from 'node:crypto';
import * as M from '../../src/experimental/i80386-at-machine.js';
import {buildFat16} from '../lib/i80386-free-bios-fat16.mjs';
import {readRootFile,GEOMETRY,EXTENDER_SHA,LICENSE_SHA,ACKNOWLEDGMENT} from '../i80386-dos32a-owned/media.mjs';
import {encode} from '../i80386-dos32a-owned/keyboard.mjs';
export const sha = b=>createHash('sha256').update(b).digest('hex');
const PINS={bios:[65536,'6481181809b58a9f805346a7ecf9bebdaf5b322c32825fb49ee89da51552c4ac'],vga:[38400,'76af53f14955df3edd6365daa64393e91fafe55241c2c00384ff05b740431da1'],floppy:[1228800,'03df6088be016e57a6c44275f5bb9ab0244db71de1360957fd76ba83243b6a77']};
export function exact(path,size,digest){const s=fs.lstatSync(path);if(!s.isFile()||s.isSymbolicLink()||s.size!==size)throw Error('input shape');const b=fs.readFileSync(path);if(sha(b)!==digest)throw Error('input digest');return b;}
const ascii=s=>Buffer.from(s,'ascii');
export function media(extender,client,license){
 if(extender.length!==27504||sha(extender)!==EXTENDER_SHA||license.length!==1821||sha(license)!==LICENSE_SHA||!license.toString().includes(ACKNOWLEDGMENT))throw Error('extender admission');
 if(client.length!==8192||client.subarray(0,2).toString()!=='LE')throw Error('client shape');
 const files=[{name:'DOS32A  EXE',bytes:extender},{name:'FILEIN  EXE',bytes:client},
 {name:'RUNFILE BAT',bytes:ascii('@ECHO OFF\r\nC:\\DOS32A.EXE C:\\FILEIN.EXE\r\nIF ERRORLEVEL 1 GOTO FAIL\r\nECHO BW-FILE-EXIT-0>C:\\KEYOK.TXT\r\nGOTO DONE\r\n:FAIL\r\nECHO BW-FILE-EXIT-1>C:\\KEYFAIL.TXT\r\n:DONE\r\nECHO BW-FILE-BATCH-DONE\r\n')},
 {name:'VERIFY  BAT',bytes:ascii('@ECHO OFF\r\nECHO BW-FILE-SHELL-RETURN>C:\\RETURN.TXT\r\n')}];
 return Buffer.from(buildFat16({geometry:GEOMETRY,files,volLabel:'BWFILEINPUT'}).image);
}
function screen(machine){const raw=Buffer.alloc(4000);for(let i=0;i<4000;i++)raw[i]=machine._read386(0xb8000+i);return raw;}
export function rows(raw){if(raw.length!==4000)throw Error('VGA extent');return Array.from({length:25},(_,y)=>Array.from({length:80},(_,x)=>{const c=raw[y*160+x*2];return c>=32&&c<=126?String.fromCharCode(c):' ';}).join('').trimEnd());}
export const prompt=lines=>/^[A-Z]:\\>\s*$/.test(lines.filter(x=>x.trim()).at(-1)?.trim()??'');
function makeMachine(bios,vga,floppy,disk){
 const base=M.PCAT80386_EXPERIMENTAL_4M_HDD_FREEDOS_VGA,g=GEOMETRY;
 const cmos=[[0x19,47],[0x1b,g.cylinders&255],[0x1c,g.cylinders>>8],[0x1d,g.heads],[0x1e,255],[0x1f,255],[0x20,0xc0],[0x21,g.cylinders&255],[0x22,g.cylinders>>8],[0x23,g.sectors],[0x39,0]];
 const replaced=new Set([0x3d,0x12,...cmos.map(x=>x[0])]);
 const cfg={...base,functionalInstructionCycles:6,regions:[...base.regions.filter(r=>!(r.kind==='rom'&&r.start===0xc0000)),{kind:'rom',start:0xc0000,end:0xc9fff}],chips:base.chips.map(c=>c.kind==='rtc'?{...c,initialCmos:[...c.initialCmos.filter(([i])=>!replaced.has(i)),[0x3d,0x21],[0x12,0xf0],...cmos]}:c)};
 const machine=new M.ExperimentalI80386ATMachine(cfg,{ataImage:new Uint8Array(disk),ataGeometry:g});
 machine.loadRom(bios,0xf0000);machine.loadRom(bios,0xff0000);machine.loadRom(vga,0xc0000);
 machine.chips.fdc1.insert(0,new Uint8Array(floppy),{cylinders:80,heads:2,sectors:15,bytesPerSector:512});machine.reset();return machine;
}
function rootFiles(disk){return Object.fromEntries([['data','DATA    BIN'],['result','RESULT  BIN'],['ok','KEYOK   TXT'],['fail','KEYFAIL TXT'],['returned','RETURN  TXT']].map(([k,n])=>[k,readRootFile(disk,n)?.toString('hex')??null]));}
export function witness(cpu,entry,meta,client,readByte,step){
 const cs=cpu.segmentCaches[1],ds=cpu.segmentCaches[3];
 if(!(cpu.cr0&1)||(cpu.cr0&0x80000000)||!cs?.default32)return null;
 const linear=cs.base+cpu.eip;if(!Number.isSafeInteger(linear)||linear<0||linear>0xffffffff)return null;
 let role,initial;
 if(entry===null){
  if(!client.subarray(4096,4102).every((b,i)=>readByte(linear+i)===b))return null;
  initial=Buffer.from(Array.from({length:4096},(_,i)=>readByte(linear+i)));
  if(!initial.equals(client.subarray(4096)))throw Error('owned payload mismatch');role='entry';
 }else{
  if(cpu.cs!==entry.cs||cs.base!==entry.csBase||cs.limit!==entry.csLimit)return null;
  const off=linear-entry.linear;
  role=meta.witnessRoles.find(name=>meta.labels[name]===off);
  if(!role)role=['write_fail','read_fail','proof_fail','fail'].find(name=>meta.labels[name]===off);
  if(!role)return null;
  if(cpu.ebp!==entry.eip+5||entry.eip+5>0xffffffff)throw Error('original CALL/POP EBP anchor');
  if(cpu.ds!==entry.ds||ds.base!==entry.dsBase||ds.limit!==entry.dsLimit)throw Error('original DS descriptor identity');
 }
 const offset=entry===null?0:linear-entry.linear;
 const code=Buffer.from(Array.from({length:6},(_,i)=>readByte(linear+i)));
 if(!code.equals(client.subarray(4096+offset,4096+offset+6)))throw Error('owned code changed');
 const row={role,step,linear,eip:cpu.eip>>>0,cr0:cpu.cr0>>>0,cs:cpu.cs>>>0,csBase:cs.base>>>0,csLimit:cs.limit>>>0,csDefault32:!!cs.default32,ds:cpu.ds>>>0,dsSelector:cpu.ds>>>0,dsBase:ds.base>>>0,dsLimit:ds.limit>>>0,dsDefault32:!!ds.default32,codeHex:code.toString('hex')};
 for(const reg of ['eax','ebx','ecx','edx','esi','edi','ebp','esp','eflags'])row[reg]=cpu[reg]>>>0;
 const bytes=(at,n)=>Buffer.from(Array.from({length:n},(_,i)=>readByte(at+i))).toString('hex');
 if(role==='entry')row.payloadHex=initial.toString('hex');
 const part=/^(full|short|eof)_(call|return)$/.exec(role);
 if(part){
  const [label,n]=({full:['full_buffer',64],short:['tail_buffer',16],eof:['eof_buffer',16]})[part[1]],at=entry.linear+meta.labels[label];
  if(at-8<entry.linear||at+n+8>entry.linear+4096)throw Error('owned buffer extent');
  if(part[2]==='call'&&(ds.base+cpu.edx!==at||cpu.edx<8||cpu.edx+n+7>ds.limit))throw Error('original DS buffer address');
  row.buffer={linear:at,prefixHex:bytes(at-8,8),dataHex:bytes(at,n),suffixHex:bytes(at+n,8)};
 }
 if(role==='proof_ready'){
  row.proofLinear=entry.linear+meta.labels.proof;row.savedCountsLinear=entry.linear+meta.labels.saved_counts;
  if(row.proofLinear+155>entry.linear+4096||row.savedCountsLinear+12>entry.linear+4096)throw Error('owned proof extent');
  row.proofHex=bytes(row.proofLinear,155);row.savedCountsHex=bytes(row.savedCountsLinear,12);
 }
 return row;
}
export function regionProof(raw,initialFat){
 if(raw.length!==10653696)throw Error('disk proof extent');
 if(!Buffer.isBuffer(initialFat)||initialFat.length!==20992)throw Error('frozen initial FAT extent');
 const fat=raw.subarray(9216,30208),fat2=raw.subarray(30208,51200),root=raw.subarray(51200,67584),clusters={},selected=[];
 if(!fat.equals(fat2))throw Error('FAT mirrors');
 const owners=new Set();
 for(let i=0;i<512;i++){const row=root.subarray(i*32,(i+1)*32);if(row[0]===0)break;if(row[0]===229)continue;if(row[11]!==32)throw Error('root file type');let c=row.readUInt16LE(26);const n=row.readUInt32LE(28);if(n>32768)throw Error('root file cap');for(let j=0;j<Math.ceil(n/1024);j++){if(c<2||c>10339||owners.has(c))throw Error('FAT chain crosslink');owners.add(c);c=fat.readUInt16LE(c*2);}if(n&&c<65528)throw Error('FAT EOC');}
 for(let i=0;i<512;i++){const row=root.subarray(i*32,(i+1)*32);if(row[0]===0)break;
  if(['DATA    BIN','RESULT  BIN','KEYOK   TXT','KEYFAIL TXT','RETURN  TXT'].includes(row.subarray(0,11).toString('ascii'))){
   const c=row.readUInt16LE(26),n=row.readUInt32LE(28);if(c<2||c>10339||n>1024)throw Error('proof selected extent');
   if(initialFat.readUInt16LE(c*2)!==0)throw Error('selected cluster initially allocated');selected.push(c);}}
 // Admit every selected cluster before copying any selected file bytes.
 for(const c of selected)clusters[c]=raw.subarray(67584+(c-2)*1024,67584+(c-1)*1024).toString('hex');
 return {fatHex:fat.toString('hex'),fat2Hex:fat2.toString('hex'),rootHex:root.toString('hex'),clusters,diskSha256:sha(raw),diskBytes:raw.length};
}
export async function run(input,out){
 if(!['a','b'].includes(input.key))throw Error('fixed challenge');
 const report={schema:'bw.le-file.target.v1',key:input.key,firstFailure:null,events:[],witnesses:[],screens:[]};let machine;
 try{
 const [bios,vga,floppy]=Object.keys(PINS).map(k=>exact(input[k],...PINS[k]));
 const client=exact(input.client,8192,input.clientSha256),disk=exact(input.disk,10653696,input.diskSha256),meta=JSON.parse(fs.readFileSync(input.metadata,'utf8'));
 if(meta.sha256!==sha(client))throw Error('client metadata');
 if(Object.values(rootFiles(disk)).some(v=>v!==null))throw Error('preexisting result');
 const initialFat=Buffer.from(disk.subarray(9216,30208));
 machine=makeMachine(bios,vga,floppy,disk);const cpu=machine.cpu;
 let queue=[],stage='boot',declined=false,entered=false,lastAccepted=-65536,entry=null,ready=null,steps=0,lastText='',stable=0,lastLines=[];
 const snap=(role,step,raw)=>{if(report.screens.length>=16)throw Error('screen cap');report.screens.push({role,step,hex:raw.toString('hex'),regions:regionProof(Buffer.from(machine.ata.mediaBytes()),initialFat)});};
 for(;steps<120000000;steps++){
  const w=witness(cpu,entry,meta,client,a=>machine._read386(a),steps);
  if(w&&['write_fail','read_fail','proof_fail','fail'].includes(w.role)){report.failureWitness=w;throw Error('owned client entered '+w.role);}
  if(w&&!report.witnesses.some(x=>x.role===w.role)){report.witnesses.push(w);if(w.role==='entry')entry=w;}
  if(steps%50000===0){
   if(stage!=='boot'&&rootFiles(Buffer.from(machine.ata.mediaBytes())).fail!==null)throw Error('actual guest failure marker');
   const raw=screen(machine);lastLines=rows(raw);const text=lastLines.join('\n');if(text!==lastText){lastText=text;stable=steps;}
   if(stage==='boot'){
    if(!declined&&lastLines.some(s=>/Do you want to proceed/i.test(s))){queue=encode('n\r');declined=true;}
    else if(!declined&&!entered&&lastLines.some(s=>/press \[ENTER\]|Select from Menu/i.test(s))){queue=encode('\r');entered=true;}
    else if(declined&&queue.length===0&&prompt(lastLines)){snap('boot',steps,raw);queue=encode('c:\\runfile.bat\r');stage='client';}
   }else if(stage==='client'&&queue.length===0&&report.witnesses.some(x=>x.role==='input_call')&&lastLines.some(s=>s.trim()==='BW-LE-FILE-READY')){
    snap('ready',steps,raw);ready=steps;queue=encode(input.key);stage='response';
   }else if(stage==='response'&&queue.length===0&&steps-stable>=1500000&&prompt(lastLines)){
    const f=rootFiles(Buffer.from(machine.ata.mediaBytes()));
    if(f.fail!==null)throw Error('guest failed');
    if(f.result&&f.ok&&f.returned===null){snap('response',steps,raw);queue=encode('c:\\verify.bat\r');stage='shell';}
   }else if(stage==='shell'&&queue.length===0&&steps-stable>=1500000&&prompt(lastLines)&&rootFiles(Buffer.from(machine.ata.mediaBytes())).returned){snap('final',steps,raw);stage='done';break;}
  }
  if(queue.length&&steps-lastAccepted>=65536&&(machine._a20Controller.readStatus()&1)===0){
   const ev=queue[0],accepted=machine.keyIn(ev.scan);if(report.events.length>=512)throw Error('input attempt cap');report.events.push({step:steps,stage,scan:ev.scan,key:ev.key,phase:ev.phase,accepted});if(accepted){queue.shift();lastAccepted=steps;}
  }
  machine.step();if(cpu.shutdown)throw Error('CPU shutdown');
 }
 const after=Buffer.from(machine.ata.mediaBytes());fs.writeFileSync(out+'/disk.raw',after,{flag:'wx'});
 Object.assign(report,{stage,steps,readyStep:ready,pending:queue.length,files:rootFiles(after),diskSha256:sha(after),initialDiskSha256:sha(disk),clientSha256:sha(client),inputHashes:Object.fromEntries(Object.entries(PINS).map(([k,v])=>[k,v[1]])),final:{eax:cpu.eax>>>0,cycles:cpu.cycles,shutdown:cpu.shutdown},ordinaryStep:true});
 if(stage!=='done')throw Error('step budget incomplete');
 }catch(e){report.firstFailure=String(e?.stack??e).slice(0,2000);}
 fs.writeFileSync(out+'/report.json',JSON.stringify(report,null,2)+'\n',{flag:'wx'});if(report.firstFailure)throw Error(report.firstFailure);
}
if(process.argv[1]===new URL(import.meta.url).pathname){const [mode,a,b,c,d]=process.argv.slice(2);if(mode==='media'){const raw=media(fs.readFileSync(a),fs.readFileSync(b),fs.readFileSync(c));fs.writeFileSync(d,raw,{flag:'wx'});}else if(mode==='target'){await run(JSON.parse(fs.readFileSync(a)),b);}else throw Error('mode media|target');}
