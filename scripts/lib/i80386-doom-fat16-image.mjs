import {createHash} from 'node:crypto';

export const DOOM_HDD_GEOMETRY=Object.freeze({cylinders:306,heads:4,sectors:17});
export const DOOM_PARTITION=Object.freeze({startLba:17,sectors:20791,sectorsPerCluster:2,fatSectors:41,rootEntries:512});
const put16=(b,o,v)=>{b[o]=v&255;b[o+1]=v>>>8&255;};
const put32=(b,o,v)=>{put16(b,o,v);put16(b,o+2,v>>>16);};
const sha256=b=>createHash('sha256').update(b).digest('hex');

export function createDoomFat16Hdd({doomExe,doomWad,extraFiles=[]}) {
  if(!(doomExe instanceof Uint8Array)||!(doomWad instanceof Uint8Array))
    throw new Error('Doom FAT16 inputs must be Uint8Array instances');
  if(doomExe.length===0||doomWad.length===0)
    throw new Error('Doom FAT16 inputs must be nonempty');
  const canonicalShortName=name=>{
    if(typeof name!=='string'||name.length!==11)return false;
    const base=name.slice(0,8),extension=name.slice(8),trimmedBase=base.trimEnd(),trimmedExtension=extension.trimEnd();
    return trimmedBase.length>0&&/^[A-Z0-9]+$/.test(trimmedBase)&&/^[A-Z0-9]*$/.test(trimmedExtension)&&
      base===trimmedBase.padEnd(8)&&extension===trimmedExtension.padEnd(3);
  };
  if(!Array.isArray(extraFiles)||extraFiles.some(file=>
    !canonicalShortName(file?.name)||
    !(file.bytes instanceof Uint8Array)||file.bytes.length===0))
    throw new Error('extra Doom FAT16 files require a canonical uppercase 8.3 short name and nonempty bytes');
  const allNames=['DOOM    EXE','DOOM1   WAD',...extraFiles.map(file=>file.name)];
  if(new Set(allNames).size!==allNames.length)throw new Error('duplicate Doom FAT16 short name');
  const g=DOOM_HDD_GEOMETRY,p=DOOM_PARTITION;
  if(allNames.length>p.rootEntries)throw new Error('Doom FAT16 files exceed the root directory capacity');
  const image=new Uint8Array(g.cylinders*g.heads*g.sectors*512);
  const entry=446;
  image[entry+1]=1;image[entry+2]=1;image[entry+3]=0;
  image[entry+4]=0x04;
  image[entry+5]=3;image[entry+6]=0x51;image[entry+7]=0x31;
  put32(image,entry+8,p.startLba);put32(image,entry+12,p.sectors);
  image[510]=0x55;image[511]=0xaa;

  const volume=p.startLba*512;
  image.set([0xeb,0x3c,0x90],volume);
  image.set(Buffer.from('ASTRA386'),volume+3);
  put16(image,volume+11,512);image[volume+13]=p.sectorsPerCluster;
  put16(image,volume+14,1);image[volume+16]=2;put16(image,volume+17,p.rootEntries);
  put16(image,volume+19,p.sectors);image[volume+21]=0xf8;put16(image,volume+22,p.fatSectors);
  put16(image,volume+24,g.sectors);put16(image,volume+26,g.heads);
  put32(image,volume+28,p.startLba);image[volume+36]=0x80;image[volume+38]=0x29;
  put32(image,volume+39,0x386d0019);image.set(Buffer.from('ASTRA DOOM '),volume+43);
  image.set(Buffer.from('FAT16   '),volume+54);image[volume+510]=0x55;image[volume+511]=0xaa;

  const rootSectors=Math.ceil(p.rootEntries*32/512);
  const firstData=p.startLba+1+2*p.fatSectors+rootSectors;
  const clusterBytes=p.sectorsPerCluster*512;
  let nextCluster=2;
  const files=[];
  for(const [name,bytes] of [['DOOM    EXE',doomExe],['DOOM1   WAD',doomWad],
    ...extraFiles.map(file=>[file.name,file.bytes])]) {
    const count=Math.ceil(bytes.length/clusterBytes);
    const first=nextCluster;
    files.push({name,bytes,first,count});nextCluster+=count;
  }
  const dataClusters=Math.floor((p.sectors-1-2*p.fatSectors-rootSectors)/p.sectorsPerCluster);
  if(nextCluster-2>dataClusters)throw new Error('Doom files exceed the fixed type-1 FAT16 partition');
  for(const fatSector of [p.startLba+1,p.startLba+1+p.fatSectors]) {
    const fat=fatSector*512;put16(image,fat,0xfff8);put16(image,fat+2,0xffff);
    for(const file of files)for(let i=0;i<file.count;i++)
      put16(image,fat+(file.first+i)*2,i+1===file.count?0xffff:file.first+i+1);
  }
  const root=(p.startLba+1+2*p.fatSectors)*512;
  files.forEach((file,index)=>{
    const at=root+index*32;image.set(Buffer.from(file.name),at);image[at+11]=0x20;
    put16(image,at+26,file.first);put32(image,at+28,file.bytes.length);
    image.set(file.bytes,(firstData+(file.first-2)*p.sectorsPerCluster)*512);
  });
  return {image,manifest:{geometry:g,partition:p,files:files.map(file=>({name:file.name,
    bytes:file.bytes.length,sha256:sha256(file.bytes),firstCluster:file.first,clusters:file.count})),
    imageSha256:sha256(image)}};
}

export function readDoomFat16File(image, shortName) {
  if(!(image instanceof Uint8Array))throw new Error('Doom FAT16 image must be a Uint8Array');
  const p=DOOM_PARTITION,volume=p.startLba*512;
  const imageStart=(image[454]|image[455]<<8|image[456]<<16|image[457]<<24)>>>0;
  if(image.length!==DOOM_HDD_GEOMETRY.cylinders*DOOM_HDD_GEOMETRY.heads*DOOM_HDD_GEOMETRY.sectors*512||
      image[510]!==0x55||image[511]!==0xaa||image[450]!==0x04||
      imageStart!==p.startLba)
    throw new Error('Doom FAT16 image layout mismatch');
  const rootSectors=Math.ceil(p.rootEntries*32/512);
  const root=(p.startLba+1+2*p.fatSectors)*512;
  const firstData=p.startLba+1+2*p.fatSectors+rootSectors;
  let entry=-1;
  for(let i=0;i<p.rootEntries;i++) {
    const at=root+i*32;
    if(Buffer.from(image.subarray(at,at+11)).toString()===shortName){entry=at;break;}
  }
  if(entry<0)return null;
  const size=(image[entry+28]|image[entry+29]<<8|image[entry+30]<<16|image[entry+31]<<24)>>>0;
  let cluster=image[entry+26]|image[entry+27]<<8;
  const output=new Uint8Array(size),seen=new Set();let offset=0;
  while(offset<size) {
    if(cluster<2||cluster>=0xfff8||seen.has(cluster))throw new Error('invalid Doom FAT16 chain');
    seen.add(cluster);
    const bytes=Math.min(p.sectorsPerCluster*512,size-offset);
    output.set(image.subarray((firstData+(cluster-2)*p.sectorsPerCluster)*512,
      (firstData+(cluster-2)*p.sectorsPerCluster)*512+bytes),offset);
    offset+=bytes;
    cluster=image[(p.startLba+1)*512+cluster*2]|
      image[(p.startLba+1)*512+cluster*2+1]<<8;
  }
  if(cluster<0xfff8)throw new Error('Doom FAT16 chain continues beyond file size');
  return output;
}
