export function readFat12RootFile(image,requested) {
    const u16=offset=>image[offset]|(image[offset+1]<<8);
    const bytesPerSector=u16(11),sectorsPerCluster=image[13],reserved=u16(14);
    const fats=image[16],rootEntries=u16(17),totalSectors=u16(19),sectorsPerFat=u16(22);
    if(bytesPerSector!==512||!sectorsPerCluster||!reserved||!fats||!rootEntries||!totalSectors||!sectorsPerFat)
        throw new Error('AT acceptance requires a valid FAT12 BIOS parameter block');
    const [base='',extension='',extra]=requested.toUpperCase().split('.');
    if(extra!==undefined||!/^[A-Z0-9_-]{1,8}$/.test(base)||!/^([A-Z0-9_-]{0,3})$/.test(extension))
        throw new Error('AT_EXPECT_FILE must be an 8.3 root filename');
    const name=base.padEnd(8)+extension.padEnd(3);
    const rootOffset=(reserved+fats*sectorsPerFat)*bytesPerSector;
    const rootSectors=Math.ceil(rootEntries*32/bytesPerSector);
    const dataSector=reserved+fats*sectorsPerFat+rootSectors;
    const dataOffset=dataSector*bytesPerSector;
    const clusters=Math.floor((totalSectors-dataSector)/sectorsPerCluster);
    if(totalSectors*bytesPerSector>image.length||rootOffset+rootEntries*32>image.length||
        dataOffset>image.length||clusters<1||clusters>=4085)
        throw new Error('AT FAT12 layout exceeds the supplied image');
    for(let index=0;index<rootEntries;index++) {
        const entry=rootOffset+index*32;
        if(image[entry]===0)break;
        if(image[entry]===0xe5||String.fromCharCode(...image.subarray(entry,entry+11))!==name)continue;
        const attributes=image[entry+11];
        if((attributes&0x18)||attributes===0x0f)throw new Error('AT expected file is not a regular root file');
        const cluster=u16(entry+26);
        const size=(image[entry+28]|(image[entry+29]<<8)|(image[entry+30]<<16)|
            (image[entry+31]<<24))>>>0;
        const clusterBytes=sectorsPerCluster*bytesPerSector;
        if(cluster<2||cluster>=clusters+2||size>clusterBytes)
            throw new Error('AT acceptance currently requires one valid data cluster');
        const fatOffset=reserved*bytesPerSector+Math.floor(cluster*3/2);
        const fatEnd=(reserved+sectorsPerFat)*bytesPerSector;
        if(fatOffset+1>=fatEnd||fatOffset+1>=image.length)
            throw new Error('AT FAT12 entry exceeds the declared FAT');
        const pair=image[fatOffset]|(image[fatOffset+1]<<8);
        const next=(cluster&1)?pair>>4:pair&0xfff;
        if(next<0xff8)throw new Error('AT expected single-cluster file lacks an end-of-chain marker');
        const start=dataOffset+(cluster-2)*clusterBytes;
        if(start+size>image.length)throw new Error('AT expected file data exceeds the supplied image');
        const bytes=image.subarray(start,start+size);
        return {name,cluster,size,bytes:Array.from(bytes),text:Buffer.from(bytes).toString('ascii')};
    }
    return null;
}

export function gradeAtDosAcceptance(evidence,{expectedText,inputBootSectorSha256,inputMediaSha256=null,
    priorOutputMediaSha256=null}={}) {
    const boot=evidence.executionBoundaries?.bootSector;
    const dma=boot?.devices?.primaryDma;
    const channel=dma?.channels?.[2];
    const lines=evidence.screenText??[];
    const outputLine=lines.some(line=>line===expectedText.trim());
    const lastLine=[...lines].reverse().find(line=>line.trim()!=='')??'';
    const prompt=/^A>\s*$/.test(lastLine);
    const dmaSector=channel?.page===0&&channel.baseAddr===0x7c00&&channel.baseCount===0x1ff&&
        channel.curAddr===0x7e00&&channel.curCount===0xffff&&(dma.status&4)!==0;
    const mediaLinked=priorOutputMediaSha256===null||inputMediaSha256===priorOutputMediaSha256;
    return !!evidence.passed&&!evidence.final?.halted&&!evidence.final?.shutdown&&
        !!evidence.executionBoundaries?.int19&&!!boot&&!evidence.executionBoundaries?.unexpectedInterrupt&&
        boot.sha256===inputBootSectorSha256&&dmaSector&&
        evidence.keyboardScript?.remaining?.length===0&&evidence.keyboardScript?.injected?.length>0&&
        evidence.guestFile?.text===expectedText&&outputLine&&prompt&&mediaLinked;
}
