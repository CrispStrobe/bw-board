import {dirname,isAbsolute,resolve} from 'node:path';

function tokens(line) {
  const result=[];
  let token='',quote=null;
  for(let index=0;index<line.length;index++) {
    const ch=line[index];
    if(quote) {
      if(ch===quote)quote=null;
      else token+=ch;
    } else if(ch==='"'||ch==="'")quote=ch;
    else if(ch===';'||ch==='#')break;
    else if(/\s/.test(ch)) { if(token){result.push(token);token='';} }
    else token+=ch;
  }
  if(quote)throw new Error('DOSBox config has an unterminated quoted path');
  if(token)result.push(token);
  return result;
}

/** Read only one raw HDD imgmount; DOSBox autoexec commands are never executed. */
export function parseDosboxAtConfig(text,configPath) {
  let section='';
  const mounts=[],ignored=[];
  let boot=null;
  for(const raw of String(text).split(/\r?\n/)) {
    const line=raw.trim();
    const header=line.match(/^\[([^\]]+)\]/);
    if(header){section=header[1].trim().toLowerCase();continue;}
    if(section!=='autoexec')continue;
    const parts=tokens(line);
    if(!parts.length)continue;
    const command=parts[0].toLowerCase();
    if(command==='imgmount') {
      if(parts.length<3)throw new Error('DOSBox imgmount needs a drive and image path');
      const drive=parts[1].toLowerCase(),image=parts[2];
      const options={};
      for(let index=3;index<parts.length;index++) {
        const option=parts[index].toLowerCase();
        if(!['-t','-fs','-size'].includes(option)||index+1>=parts.length)
          throw new Error(`unsupported DOSBox imgmount option ${parts[index]}`);
        options[option]=parts[++index];
      }
      if((options['-t']??'hdd').toLowerCase()!=='hdd'){
        ignored.push(line);continue;
      }
      if(!/^(2|c:?)$/.test(drive))throw new Error('only primary HDD imgmount 2 or C is supported');
      if(options['-fs']&&!['none','fat'].includes(options['-fs'].toLowerCase()))
        throw new Error('unsupported DOSBox HDD filesystem mode');
      const size=options['-size']?.split(',').map(Number);
      if(!size||size.length!==4||size[0]!==512||!size.every(Number.isInteger))
        throw new Error('DOSBox HDD imgmount needs -size 512,sectors,heads,cylinders');
      const [,sectors,heads,cylinders]=size;
      if(sectors<1||sectors>63||heads<1||heads>16||cylinders<1||cylinders>1024)
        throw new Error('DOSBox HDD geometry exceeds original AT limits');
      mounts.push({drive,image,geometry:[cylinders,heads,sectors],filesystem:options['-fs']??null});
    } else if(command==='boot')boot=parts.slice(1);
    else ignored.push(line);
  }
  if(mounts.length!==1)throw new Error('DOSBox config must have exactly one primary HDD imgmount');
  const mount=mounts[0];
  if(boot?.length&&boot[0].toLowerCase()!=='-l') {
    const imageName=boot[0];
    if(resolve(dirname(configPath),imageName)!==resolve(dirname(configPath),mount.image))
      throw new Error('DOSBox boot names a different image than primary HDD imgmount');
  }
  if(boot?.[0]?.toLowerCase()==='-l'&&boot[1]?.toLowerCase()!=='c')
    throw new Error('DOSBox boot -l must select C');
  const imagePath=isAbsolute(mount.image)?mount.image:resolve(dirname(configPath),mount.image);
  return {imagePath,geometry:mount.geometry,drive:mount.drive,
    filesystem:mount.filesystem,boot,ignored};
}
