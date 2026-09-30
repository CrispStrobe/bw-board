/** Parse only a complete, bounded BW386O1 hook record from native Bochs stderr. */
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const prefix='BW386O1\t';
const states=['eax','ecx','edx','ebx','esp','ebp','esi','edi','eip','eflags','cr0','cr2','cr3'];
const debugs=['dr0','dr1','dr2','dr3','dr6','dr7'];
const tables=['gdtrBase','gdtrLimit','idtrBase','idtrLimit'];
const segments=['es','cs','ss','ds','fs','gs','ldtr','tr'];
const segmentFields=['selector','valid','base','limitScaled','present','dpl','segment','type','granularity','default32'];
const eventKinds=new Set(['instruction','interrupt','exception','hardware-interrupt',
  'linear-access','physical-access','port-read','port-write']);
const hex=value=>{
  if(!/^[0-9a-f]+$/i.test(value??'')) throw new Error(`invalid hex field: ${value}`);
  const number=Number.parseInt(value,16);
  if(!Number.isSafeInteger(number) || number>0xffffffff)
    throw new Error(`hex field exceeds CPU3 width: ${value}`);
  return number;
};
const decimal=value=>{
  if(!/^\d+$/.test(value??'')) throw new Error(`invalid decimal field: ${value}`);
  const number=Number(value);
  if(!Number.isSafeInteger(number)) throw new Error(`unsafe decimal field: ${value}`);
  return number;
};
const named=(names,values)=>{
  if(values.length!==names.length) throw new Error(`expected ${names.length} fields, got ${values.length}`);
  return Object.fromEntries(names.map((name,index)=>[name,hex(values[index])]));
};

export function parseBochsCpu3OwnedOracle(stderr){
  const lines=stderr.split(/\r?\n/).filter(line=>line.startsWith(prefix));
  if(!lines.length) throw new Error('missing BW386O1 record');
  const record={schema:'bw.bochs-cpu3-owned-hook-checkpoint.v1',
    boundary:'after final E9 marker OUT, before next fixture instruction',events:[],segments:{}};
  let begun=false,ended=false,checkpoint=false,lastInstruction=0;
  for(const line of lines){
    const [,kind,...fields]=line.split('\t');
    if(kind==='ERROR') throw new Error(`Bochs probe error: ${fields.join(' ')}`);
    if(kind==='BEGIN'){
      if(begun || fields.length!==2 || fields[0]!=='vm-task' || fields[1]!=='BHVK003')
        throw new Error('unexpected Bochs probe start');
      begun=true;
      continue;
    }
    if(!begun || ended) throw new Error('record outside owned boundary');
    if(kind==='EVENT'){
      if(checkpoint || fields.length!==8 || decimal(fields[0])!==record.events.length+1)
        throw new Error('nonconsecutive event or malformed event');
      const currentInstruction=decimal(fields[1]);
      if(!eventKinds.has(fields[2]) || currentInstruction<lastInstruction ||
          currentInstruction>100000 || (fields[2]==='instruction' &&
          currentInstruction!==lastInstruction+1))
        throw new Error('invalid event kind or instruction order');
      lastInstruction=currentInstruction;
      record.events.push({ordinal:decimal(fields[0]),instruction:currentInstruction,
        kind:fields[2],a:hex(fields[3]),b:hex(fields[4]),
        c:hex(fields[5]),d:hex(fields[6]),e:hex(fields[7])});
    } else if(kind==='STATE'){
      if(record.state || !record.events.length) throw new Error('duplicate or premature state');
      checkpoint=true;
      record.state=named(states,fields);
    } else if(kind==='DEBUG'){
      if(!checkpoint || record.debug) throw new Error('duplicate or premature debug state');
      record.debug=named(debugs,fields);
    } else if(kind==='TABLE'){
      if(!checkpoint || record.tables) throw new Error('duplicate or premature descriptor tables');
      record.tables=named(tables,fields);
    } else if(kind==='SCHED'){
      if(!checkpoint || record.schedule || fields.length!==3)
        throw new Error('duplicate, premature or malformed scheduling state');
      record.schedule={inhibitMask:hex(fields[0]),inhibitIcount:decimal(fields[1]),icount:decimal(fields[2])};
    } else if(kind==='SEG'){
      const [name,...values]=fields;
      if(!checkpoint || !segments.includes(name) || record.segments[name])
        throw new Error('premature, duplicate or unknown segment');
      const parsed=named(segmentFields,values);
      if(parsed.valid===0) for(const field of segmentFields.slice(2)) parsed[field]=null;
      record.segments[name]=parsed;
    } else if(kind==='END'){
      if(!checkpoint || fields.length!==3 || fields[0]!=='BHVK003' ||
          decimal(fields[2])!==record.events.length) throw new Error('malformed checkpoint end');
      record.instructionCount=decimal(fields[1]);
      if(record.instructionCount<lastInstruction || record.instructionCount>100000)
        throw new Error('invalid checkpoint instruction count');
      ended=true;
    } else throw new Error(`unknown Bochs probe record: ${kind}`);
  }
  if(!ended || !record.state || !record.debug || !record.tables || !record.schedule ||
      segments.some(name=>!record.segments[name])) throw new Error('incomplete Bochs checkpoint');
  if(record.events.length>100000) throw new Error('event limit exceeded');
  const markerBytes=record.events.filter(e=>e.kind==='port-write' && e.a===0xe9 && e.c===1)
    .map(e=>String.fromCharCode(e.b&255)).join('');
  if(markerBytes!=='BHVK003') throw new Error('owned port marker mismatch');
  return record;
}

if(process.argv[1] && fileURLToPath(import.meta.url)===process.argv[1]){
  if(process.argv.length!==3) throw new Error('usage: node scripts/bochs-cpu3-owned-oracle/parse.mjs captured-stderr.txt');
  console.log(JSON.stringify(parseBochsCpu3OwnedOracle(readFileSync(process.argv[2],'utf8')),null,2));
}
