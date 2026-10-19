/** Parse only a complete, bounded BW386O2 hook record from native Bochs stderr. */
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const prefix='BW386O2\t';
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

export function parseBochsCpu3OwnedOracleV2(stderr){
  const lines=stderr.split(/\r?\n/).filter(line=>line.startsWith(prefix));
  if(!lines.length) throw new Error('missing BW386O2 record');
  const record={schema:'bw.bochs-cpu3-owned-memory-checkpoint.v2',
    boundary:'after final E9 marker OUT, before next fixture instruction',events:[],segments:{},ramSnapshots:{}};
  let begun=false,ended=false,checkpoint=false,lastInstruction=0;
  for(const line of lines){
    const [,kind,...fields]=line.split('\t');
    if(kind==='ERROR') throw new Error(`Bochs probe error: ${fields.join(' ')}`);
    if(kind==='BEGIN'){
      if(begun || fields.length!==2 || fields[0]!=='paging-v2' || fields[1]!=='BHPG004')
        throw new Error('unexpected Bochs probe start');
      begun=true;
      continue;
    }
    if(!begun || ended) throw new Error('record outside owned boundary');
    if(kind==='EVENT'){
      if(checkpoint || fields.length!==11 || decimal(fields[0])!==record.events.length+1)
        throw new Error('nonconsecutive event or malformed event');
      const currentInstruction=decimal(fields[1]);
      if(!eventKinds.has(fields[2]) || currentInstruction>100000 ||
          (fields[2]==='instruction' ? currentInstruction!==lastInstruction+1 :
            currentInstruction!==lastInstruction))
        throw new Error('invalid event kind or instruction order');
      lastInstruction=currentInstruction;
      const memory=fields[2]==='linear-access' || fields[2]==='physical-access';
      const len=hex(fields[5]);
      const phase=fields[9];
      const bytes=fields[10];
      if(memory){
        if(len<1 || len>8 || !/^(?:[0-9a-f]{2})+$/.test(bytes) || bytes.length!==2*len ||
            !['prewrite','postread','postwrite','read-for-rmw','unknown'].includes(phase))
          throw new Error('malformed hook bytes or phase');
        const rw=hex(fields[7]);
        if(![0,1,3].includes(rw) || (fields[2]==='linear-access' && fields[8]!=='0'))
          throw new Error('unsupported hook access mode or linear reason');
        if(phase!==(rw===0?'postread':rw===3?'read-for-rmw':
            fields[2]==='linear-access'?'prewrite':
            [5,6].includes(hex(fields[8]))?'postwrite':'unknown'))
          throw new Error('hook phase contradicts source and access mode');
      } else if(fields[8]!=='0' || phase!=='none' || bytes!=='-')
        throw new Error('non-memory event has hook bytes');
      record.events.push({ordinal:decimal(fields[0]),instruction:currentInstruction,
        kind:fields[2],a:hex(fields[3]),b:hex(fields[4]),
        c:len,d:hex(fields[6]),e:hex(fields[7]),
        why:hex(fields[8]),phase,bytes:memory?bytes:null});
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
    } else if(kind==='RAM'){
      if(!checkpoint || fields.length!==3 ||
          !['pde0','pte5','data5'].includes(fields[0]) || record.ramSnapshots[fields[0]])
        throw new Error('unexpected RAM snapshot');
      const address=hex(fields[1]);
      const expected={pde0:0x9000,pte5:0xa014,data5:0x5000}[fields[0]];
      if(address!==expected || !/^[0-9a-f]{8}$/.test(fields[2]))
        throw new Error('RAM snapshot outside owned plain-RAM range');
      record.ramSnapshots[fields[0]]={physicalAddress:address,bytes:fields[2],
        source:'checkpoint plain RAM snapshot, not a hook event'};
    } else if(kind==='END'){
      if(!checkpoint || fields.length!==3 || fields[0]!=='BHPG004' ||
          decimal(fields[2])!==record.events.length) throw new Error('malformed checkpoint end');
      record.instructionCount=decimal(fields[1]);
      if(record.instructionCount!==lastInstruction || record.instructionCount>100000)
        throw new Error('invalid checkpoint instruction count');
      ended=true;
    } else throw new Error(`unknown Bochs probe record: ${kind}`);
  }
  if(!ended || !record.state || !record.debug || !record.tables || !record.schedule ||
      segments.some(name=>!record.segments[name]) ||
      ['pde0','pte5','data5'].some(name=>!record.ramSnapshots[name]))
    throw new Error('incomplete Bochs checkpoint');
  if(((record.state.cr0&0x80000001)>>>0)!==0x80000001 || record.state.cr3!==0x9000 ||
      record.segments.cs.selector!==8)
    throw new Error('fixture did not stop in the expected paged CPU3 state');
  if(record.events.length>100000) throw new Error('event limit exceeded');
  const markerBytes=record.events.filter(e=>e.kind==='port-write' && e.a===0xe9 && e.c===1)
    .map(e=>String.fromCharCode(e.b&255)).join('');
  if(markerBytes!=='BHPG004') throw new Error('owned port marker mismatch');
  const find=(kind,address,why,phase,bytes)=>record.events.find(e=>
    e.kind===kind && e.a===address && e.why===why && e.phase===phase && e.bytes===bytes);
  const pdeRead=find('physical-access',0x9000,6,'postread','03a00000');
  const pdeWrite=find('physical-access',0x9000,6,'postwrite','23a00000');
  const pteRead=find('physical-access',0xa014,5,'postread','03500000');
  const pteWrite=find('physical-access',0xa014,5,'postwrite','63500000');
  const dataWrite=find('linear-access',0x5000,0,'prewrite','44332211');
  const dataRead=find('linear-access',0x5000,0,'postread','44332211');
  if(!pdeRead || !pdeWrite || !pteRead || !pteWrite || !dataWrite || !dataRead ||
      !(pdeRead.ordinal<pdeWrite.ordinal && pteRead.ordinal<pteWrite.ordinal &&
        pteWrite.ordinal<dataWrite.ordinal && dataWrite.ordinal<dataRead.ordinal) ||
      dataWrite.b!==0x5000 || dataRead.b!==0x5000)
    throw new Error('missing or unordered direct hook byte proof for page walk and data');
  if(record.ramSnapshots.pde0.bytes!=='23a00000' ||
      record.ramSnapshots.pte5.bytes!=='63500000' ||
      record.ramSnapshots.data5.bytes!=='44332211')
    throw new Error('final owned plain RAM paging/data bytes differ');
  return record;
}

if(process.argv[1] && fileURLToPath(import.meta.url)===process.argv[1]){
  if(process.argv.length!==3) throw new Error('usage: node scripts/bochs-cpu3-owned-oracle-v2/parse.mjs captured-stderr.txt');
  console.log(JSON.stringify(parseBochsCpu3OwnedOracleV2(readFileSync(process.argv[2],'utf8')),null,2));
}
