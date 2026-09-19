import {gunzipSync} from 'node:zlib';
import {readFileSync} from 'node:fs';

export const REGISTERS386 = [
  'cr0','cr3','eax','ebx','ecx','edx','esi','edi','ebp','esp',
  'cs','ds','es','fs','gs','ss','eip','eflags','dr6','dr7',
];
const KNOWN_REGISTER_BITS=(1<<REGISTERS386.length)-1;
const readU32=(buffer,offset)=>buffer.readUInt32LE(offset);

function readChunks(buffer,start,end) {
  const chunks=[];
  for(let offset=start;offset<end;) {
    if(offset+8>end)throw new Error('truncated MOO chunk header');
    const tag=buffer.toString('ascii',offset,offset+4);
    const length=readU32(buffer,offset+4);
    const data=offset+8,next=data+length;
    if(next>end)throw new Error(`truncated ${tag} chunk`);
    chunks.push({tag,length,data,end:next});
    offset=next;
  }
  return chunks;
}

function one(chunks,tag,{required=false}={}) {
  const found=chunks.filter(chunk=>chunk.tag===tag);
  if(found.length>1)throw new Error(`duplicate ${tag} chunk`);
  if(required&&found.length!==1)throw new Error(`missing ${tag} chunk`);
  return found[0];
}

function readRegisters(buffer,chunk) {
  if(chunk.length<4)throw new Error(`${chunk.tag} is too short`);
  const present=readU32(buffer,chunk.data);
  if((present&~KNOWN_REGISTER_BITS)!==0)throw new Error(`${chunk.tag} has unknown presence bits`);
  const values={};let offset=chunk.data+4;
  for(let index=0;index<REGISTERS386.length;index++) {
    if(!(present&(1<<index)))continue;
    if(offset+4>chunk.end)throw new Error(`truncated ${chunk.tag} register`);
    values[REGISTERS386[index]]=readU32(buffer,offset);offset+=4;
  }
  if(offset!==chunk.end)throw new Error(`${chunk.tag} has trailing bytes`);
  return values;
}

function readRam(buffer,chunk) {
  if(chunk.length<4)throw new Error('RAM chunk is too short');
  const count=readU32(buffer,chunk.data),entries=[];let offset=chunk.data+4;
  if(offset+count*5!==chunk.end)throw new Error('RAM count does not match chunk length');
  const addresses=new Set();
  for(let index=0;index<count;index++,offset+=5) {
    const address=readU32(buffer,offset);
    if(addresses.has(address))throw new Error('duplicate RAM address');
    addresses.add(address);entries.push([address,buffer[offset+4]]);
  }
  return entries;
}

function readState(buffer,chunk,{initial}) {
  const chunks=readChunks(buffer,chunk.data,chunk.end);
  const regs=readRegisters(buffer,one(chunks,'RG32',{required:true}));
  const maskChunk=one(chunks,'RM32');
  const ramChunk=one(chunks,'RAM ',{required:true});
  const allowed=new Set(['RG32','RM32','RAM ','QUEU','EA32']);
  for(const child of chunks)if(!allowed.has(child.tag))throw new Error(`unsupported state chunk ${child.tag}`);
  one(chunks,'QUEU');one(chunks,'EA32');
  if(initial)for(const name of REGISTERS386)if(!(name in regs))throw new Error(`initial state lacks ${name}`);
  return{regs,masks:maskChunk?readRegisters(buffer,maskChunk):{},ram:readRam(buffer,ramChunk)};
}

function readTest(buffer,chunk) {
  if(chunk.length<4)throw new Error('TEST is too short');
  const index=readU32(buffer,chunk.data),chunks=readChunks(buffer,chunk.data+4,chunk.end);
  const bytesChunk=one(chunks,'BYTS',{required:true});
  const initialChunk=one(chunks,'INIT',{required:true});
  const finalChunk=one(chunks,'FINA',{required:true});
  const hashChunk=one(chunks,'HASH',{required:true});
  const allowed=new Set(['GMET','NAME','BYTS','INIT','FINA','CYCL','HASH','EXCP','IDX ']);
  for(const child of chunks)if(!allowed.has(child.tag))throw new Error(`unsupported TEST chunk ${child.tag}`);
  for(const tag of ['GMET','NAME','CYCL','EXCP','IDX '])one(chunks,tag);
  if(bytesChunk.length<4)throw new Error('BYTS is too short');
  const count=readU32(buffer,bytesChunk.data);
  if(count+4!==bytesChunk.length||count===0||count>15)throw new Error('invalid BYTS count');
  if(hashChunk.length!==20)throw new Error('HASH must be a 20-byte published identifier');
  return{index,bytes:[...buffer.subarray(bytesChunk.data+4,bytesChunk.end)],
    initial:readState(buffer,initialChunk,{initial:true}),final:readState(buffer,finalChunk,{initial:false}),
    hash:buffer.subarray(hashChunk.data,hashChunk.end).toString('hex')};
}

export function readMoo386(path) {
  const compressed=readFileSync(path),buffer=gunzipSync(compressed);
  if(buffer.length<20||buffer.toString('ascii',0,4)!=='MOO ')throw new Error('not a MOO file');
  const headerLength=readU32(buffer,4),headerStart=8;
  if(headerLength<12||headerStart+headerLength>buffer.length)throw new Error('invalid MOO header');
  const major=buffer[headerStart],minor=buffer[headerStart+1];
  const declaredCount=readU32(buffer,headerStart+4),cpu=buffer.toString('ascii',headerStart+8,headerStart+12);
  if(major!==1||minor!==1||cpu!=='386E')throw new Error(`unsupported MOO ${major}.${minor} ${cpu}`);
  const chunks=readChunks(buffer,headerStart+headerLength,buffer.length);
  for(const chunk of chunks)if(!['META','RM32','TEST'].includes(chunk.tag))throw new Error(`unsupported top-level chunk ${chunk.tag}`);
  one(chunks,'META',{required:true});
  const maskChunk=one(chunks,'RM32');
  const tests=chunks.filter(chunk=>chunk.tag==='TEST').map(chunk=>readTest(buffer,chunk));
  if(tests.length!==declaredCount)throw new Error(`header count ${declaredCount} != parsed ${tests.length}`);
  const indices=new Set();for(const test of tests){if(indices.has(test.index))throw new Error(`duplicate TEST index ${test.index}`);indices.add(test.index);}
  return{compressed,major,minor,cpu,masks:maskChunk?readRegisters(buffer,maskChunk):{},tests};
}
