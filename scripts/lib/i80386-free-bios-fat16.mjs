// General bootable-partition FAT16 HDD image builder with caller-chosen CHS geometry.
// All CHS fields (MBR partition entry start/end) are DERIVED from the geometry so the
// partition table, BPB, and the geometry the BIOS presents stay mutually consistent.
import fs from 'fs';
const put16=(b,o,v)=>{b[o]=v&255;b[o+1]=(v>>>8)&255;};
const put32=(b,o,v)=>{put16(b,o,v);put16(b,o+2,(v>>>16)&0xffff);};
function chs(lba,g){ // returns [head, sectorField, cylLow, ...] encoded for partition entry
  const spt=g.sectors, hpc=g.heads;
  let c=Math.floor(lba/(spt*hpc));
  let rem=lba%(spt*hpc);
  let h=Math.floor(rem/spt);
  let s=(rem%spt)+1;
  if(c>1023){c=1023;h=hpc-1;s=spt;} // clamp per convention
  return {c,h,s};
}
function writeEntry(img,off,type,startLba,numSec,g,active){
  const a=chs(startLba,g), e=chs(startLba+numSec-1,g);
  img[off+0]=active?0x80:0x00;
  img[off+1]=a.h; img[off+2]=((a.c>>>8&3)<<6)|(a.s&0x3f); img[off+3]=a.c&0xff;
  img[off+4]=type;
  img[off+5]=e.h; img[off+6]=((e.c>>>8&3)<<6)|(e.s&0x3f); img[off+7]=e.c&0xff;
  put32(img,off+8,startLba); put32(img,off+12,numSec);
}
export function buildFat16({geometry,files,volLabel='FREE DOOM ',oem='ASTRA386'}){
  const g=geometry;
  const totalSectors=g.cylinders*g.heads*g.sectors;
  const img=new Uint8Array(totalSectors*512);
  const startLba=g.sectors; // one track reserved; partition starts head1 sect1 cyl0
  const partSectors=totalSectors-startLba;
  const spc=(partSectors> (32768*2))?8:(partSectors>(16384*4)?4:2); // keep clusters in FAT16 range
  const rootEntries=512;
  const rootSectors=Math.ceil(rootEntries*32/512);
  // solve FAT size: clusters ~ (partSectors - reserved(1) - 2*fat - root)/spc
  let fatSectors=1;
  for(let it=0;it<40;it++){
    const dataSec=partSectors-1-2*fatSectors-rootSectors;
    const clusters=Math.floor(dataSec/spc);
    const need=Math.ceil((clusters+2)*2/512);
    if(need===fatSectors)break; fatSectors=need;
  }
  const dataSec=partSectors-1-2*fatSectors-rootSectors;
  const clusters=Math.floor(dataSec/spc);
  if(clusters<4086||clusters>65524) throw new Error('cluster count '+clusters+' out of FAT16 range');
  // --- MBR ---
  writeEntry(img,446,0x06,startLba,partSectors,g,true); // type 0x06 = FAT16 (>32MB); use 0x0e LBA? keep 0x06
  img[510]=0x55;img[511]=0xaa;
  // --- BPB / VBR ---
  const vol=startLba*512;
  img.set([0xeb,0x3c,0x90],vol);
  img.set(Buffer.from(oem.padEnd(8).slice(0,8)),vol+3);
  put16(img,vol+11,512);            // bytes/sector
  img[vol+13]=spc;                  // sectors/cluster
  put16(img,vol+14,1);              // reserved sectors
  img[vol+16]=2;                    // FAT count
  put16(img,vol+17,rootEntries);    // root entries
  put16(img,vol+19, partSectors<0x10000?partSectors:0); // small total sectors
  img[vol+21]=0xf8;                 // media
  put16(img,vol+22,fatSectors);     // sectors/FAT
  put16(img,vol+24,g.sectors);      // sectors/track
  put16(img,vol+26,g.heads);        // heads
  put32(img,vol+28,startLba);       // hidden sectors
  put32(img,vol+32, partSectors>=0x10000?partSectors:0); // large total sectors
  img[vol+36]=0x80;                 // drive number
  img[vol+38]=0x29;                 // ext boot sig
  put32(img,vol+39,0x386d0019);
  img.set(Buffer.from(volLabel.padEnd(11).slice(0,11)),vol+43);
  img.set(Buffer.from('FAT16   '),vol+54);
  img[vol+510]=0x55;img[vol+511]=0xaa;
  // --- FAT + root + data ---
  const fat1=(startLba+1)*512;
  const fat2=(startLba+1+fatSectors)*512;
  const root=(startLba+1+2*fatSectors)*512;
  const firstData=startLba+1+2*fatSectors+rootSectors;
  const clusterBytes=spc*512;
  let next=2; const placed=[];
  for(const f of files){
    const cnt=Math.ceil(f.bytes.length/clusterBytes);
    placed.push({...f,first:next,count:cnt}); next+=cnt;
  }
  if(next-2>clusters) throw new Error('files exceed data area: need '+(next-2)+' clusters, have '+clusters);
  for(const fatBase of [fat1,fat2]){
    put16(img,fatBase,0xfff8);put16(img,fatBase+2,0xffff);
    for(const f of placed)for(let i=0;i<f.count;i++)
      put16(img,fatBase+(f.first+i)*2, i+1===f.count?0xffff:f.first+i+1);
  }
  placed.forEach((f,idx)=>{
    const at=root+idx*32;
    img.set(Buffer.from(f.name),at); img[at+11]=0x20;
    put16(img,at+26,f.first); put32(img,at+28,f.bytes.length);
    img.set(f.bytes,(firstData+(f.first-2)*spc)*512);
  });
  return {image:img, info:{geometry:g,totalSectors,startLba,partSectors,spc,fatSectors,rootSectors,clusters,firstData,used:next-2}};
}
